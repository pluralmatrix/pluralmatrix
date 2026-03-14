import { Request, Response } from 'express';
import { checkMessage } from './gatekeeperController';
import { proxyCache } from '../services/cache';
import { prisma, cryptoManager, commandHandler, getBridge } from '../bot';
import { sendGhostMessage } from '../services/ghostService';
import { emitSystemUpdate } from '../services/events';

jest.mock('../bot', () => ({
    prisma: {},
    asToken: 'test-token',
    cryptoManager: {
        getMachine: jest.fn()
    },
    getBridge: jest.fn().mockReturnValue({
        getBot: () => ({ getUserId: () => '@bot:localhost' })
    }),
    commandHandler: {
        executeTargetingCommand: jest.fn().mockResolvedValue(true),
        safeRedact: jest.fn().mockResolvedValue({})
    }
}));

jest.mock('../services/cache', () => ({
    proxyCache: {
        getSystemRules: jest.fn(),
        invalidate: jest.fn()
    }
}));

jest.mock('../services/ghostService', () => ({
    sendGhostMessage: jest.fn().mockResolvedValue({})
}));

jest.mock('../services/events', () => ({
    emitSystemUpdate: jest.fn()
}));

describe('GatekeeperController', () => {
    let mockRes: { json: jest.Mock, status: jest.Mock };

    beforeEach(() => {
        jest.clearAllMocks();
        mockRes = {
            json: jest.fn(),
            status: jest.fn().mockReturnThis()
        };
    });

    const mockSystem = {
        id: 'sys1',
        slug: 'seraphim',
        members: [
            { id: 'm1', slug: 'lily', name: 'Lily', proxyTags: [{ prefix: 'lily:', suffix: '' }] }
        ]
    };

    it('should ALLOW if no system matches the sender', async () => {
        (proxyCache.getSystemRules as jest.Mock).mockResolvedValue(null);
        
        const req = {
            body: { sender: '@unknown:localhost', room_id: '!room:localhost', event_id: '$1' }
        } as Request;

        await checkMessage(req, mockRes as unknown as Response);
        expect(mockRes.json).toHaveBeenCalledWith({ action: 'ALLOW' });
    });

    it('should ALLOW if the body starts with a backslash', async () => {
        (proxyCache.getSystemRules as jest.Mock).mockResolvedValue(mockSystem);
        
        const req = {
            body: { sender: '@alice:localhost', room_id: '!room:localhost', event_id: '$1', content: { body: '\\escaped' } }
        } as Request;

        await checkMessage(req, mockRes as unknown as Response);
        expect(mockRes.json).toHaveBeenCalledWith({ action: 'ALLOW' });
    });

    it('should BLOCK and trigger proxy if unencrypted match is found', async () => {
        (proxyCache.getSystemRules as jest.Mock).mockResolvedValue(mockSystem);
        
        const req = {
            body: { sender: '@alice:localhost', room_id: '!room:localhost', event_id: '$1', content: { body: 'lily: Hello' } }
        } as unknown as Request;

        await checkMessage(req, mockRes as unknown as Response);
        expect(mockRes.json).toHaveBeenCalledWith({ action: 'BLOCK' });
        expect(sendGhostMessage).toHaveBeenCalledWith(expect.objectContaining({
            cleanContent: 'Hello',
            member: expect.objectContaining({ slug: 'lily' })
        }));
    });

    it('should BLOCK and trigger autoproxy if enabled and no tag matches', async () => {
        const systemWithAuto = { ...mockSystem, autoproxyId: 'm1' };
        (proxyCache.getSystemRules as jest.Mock).mockResolvedValue(systemWithAuto);
        
        const req = {
            body: { sender: '@alice:localhost', room_id: '!room:localhost', event_id: '$1', content: { body: 'Just chatting' } }
        } as unknown as Request;

        await checkMessage(req, mockRes as unknown as Response);
        expect(mockRes.json).toHaveBeenCalledWith({ action: 'BLOCK' });
        expect(sendGhostMessage).toHaveBeenCalled();
    });

    it('should BLOCK and let bot.ts handle if encrypted match is found', async () => {
        (proxyCache.getSystemRules as jest.Mock).mockResolvedValue(mockSystem);
        
        const req = {
            body: { 
                sender: '@alice:localhost', 
                room_id: '!room:localhost', 
                event_id: '$1', 
                type: 'm.room.encrypted',
                encrypted_payload: { body: 'lily: Secret' } // In real case this is blob, but we mock decrypted content
            }
        } as unknown as Request;

        // Mock machine to return decrypted content
        (cryptoManager.getMachine as jest.Mock).mockResolvedValue({
            decryptRoomEvent: jest.fn().mockResolvedValue({
                event: JSON.stringify({ content: { body: 'lily: Secret' } })
            })
        });

        await checkMessage(req, mockRes as unknown as Response);
        expect(mockRes.json).toHaveBeenCalledWith({ action: 'BLOCK' });
        // Should NOT trigger proxy here, bot.ts will do it
        expect(sendGhostMessage).not.toHaveBeenCalled();
    });

    describe('Zero-Flash Command Interception', () => {
        it('should BLOCK and trigger executeTargetingCommand for unencrypted pk;edit', async () => {
            (proxyCache.getSystemRules as jest.Mock).mockResolvedValue(mockSystem);
            
            const req = {
                body: { sender: '@alice:localhost', room_id: '!room:localhost', event_id: '$1', content: { body: 'pk;edit test' } }
            } as unknown as Request;

            await checkMessage(req, mockRes as unknown as Response);
            expect(mockRes.json).toHaveBeenCalledWith({ action: 'BLOCK' });
            expect(commandHandler.executeTargetingCommand).toHaveBeenCalled();
        });

        it('should BLOCK and trigger executeTargetingCommand for unencrypted pk;rp', async () => {
            (proxyCache.getSystemRules as jest.Mock).mockResolvedValue(mockSystem);
            
            const req = {
                body: { sender: '@alice:localhost', room_id: '!room:localhost', event_id: '$1', content: { body: 'pk;rp lily' } }
            } as unknown as Request;

            await checkMessage(req, mockRes as unknown as Response);
            expect(mockRes.json).toHaveBeenCalledWith({ action: 'BLOCK' });
            expect(commandHandler.executeTargetingCommand).toHaveBeenCalled();
        });

        it('should BLOCK but NOT trigger executeTargetingCommand for ENCRYPTED pk;edit (bot sync handles it)', async () => {
            (proxyCache.getSystemRules as jest.Mock).mockResolvedValue(mockSystem);
            
            const req = {
                body: { 
                    sender: '@alice:localhost', 
                    room_id: '!room:localhost', 
                    event_id: '$1', 
                    type: 'm.room.encrypted',
                    encrypted_payload: {}
                }
            } as unknown as Request;

            (cryptoManager.getMachine as jest.Mock).mockResolvedValue({
                decryptRoomEvent: jest.fn().mockResolvedValue({
                    event: JSON.stringify({ content: { body: 'pk;edit secret' } })
                })
            });

            await checkMessage(req, mockRes as unknown as Response);
            expect(mockRes.json).toHaveBeenCalledWith({ action: 'BLOCK' });
            expect(commandHandler.executeTargetingCommand).not.toHaveBeenCalled();
        });
    });

    it('should catch validation errors and return ALLOW', async () => {
        const req = {
            body: { invalid: 'data' } // Missing required fields
        } as Request;

        await checkMessage(req, mockRes as unknown as Response);
        expect(mockRes.json).toHaveBeenCalledWith({ action: 'ALLOW' });
    });

    it('should ALLOW if E2EE decryption fails completely after retries', async () => {
        const req = {
            body: { 
                sender: '@alice:localhost', 
                room_id: '!room:localhost', 
                event_id: '$1', 
                type: 'm.room.encrypted',
                encrypted_payload: { body: 'lily: Secret' }
            }
        } as unknown as Request;

        (cryptoManager.getMachine as jest.Mock).mockResolvedValue({
            decryptRoomEvent: jest.fn().mockRejectedValue(new Error('Decryption Failed'))
        });

        await checkMessage(req, mockRes as unknown as Response);
        expect(mockRes.json).toHaveBeenCalledWith({ action: 'ALLOW' });
    });

    it('should update latch autoproxy if configured and tag is used', async () => {
        const latchSystem = { ...mockSystem, autoproxyMode: 'latch', autoproxyId: null };
        (proxyCache.getSystemRules as jest.Mock).mockResolvedValue(latchSystem);
        
        const req = {
            body: { sender: '@alice:localhost', room_id: '!room:localhost', event_id: '$1', content: { body: 'lily: Hello' } }
        } as unknown as Request;

        (prisma as unknown as { system: { update: jest.Mock } }).system = { update: jest.fn().mockResolvedValue({}) };

        await checkMessage(req, mockRes as unknown as Response);

        // Wait a tick for async background task
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(prisma.system.update).toHaveBeenCalledWith({
            where: { id: 'sys1' },
            data: { autoproxyId: 'm1' }
        });
        expect(proxyCache.invalidate).toHaveBeenCalledWith('@alice:localhost');
        expect(emitSystemUpdate).toHaveBeenCalledWith('@alice:localhost');
    });

    it('should handle edit events and fetch original event', async () => {
        (proxyCache.getSystemRules as jest.Mock).mockResolvedValue(mockSystem);
        
        const req = {
            body: { 
                sender: '@alice:localhost', 
                room_id: '!room:localhost', 
                event_id: '$edit', 
                content: { 
                    body: 'lily: Edited',
                    'm.new_content': { body: 'lily: Edited' },
                    'm.relates_to': { rel_type: 'm.replace', event_id: '$orig' }
                } 
            }
        } as unknown as Request;

        const mockClient = {
            getEvent: jest.fn().mockResolvedValue({
                content: {
                    body: 'lily: Original',
                    'm.relates_to': { 'm.in_reply_to': { event_id: '$parent' } }
                }
            })
        };

        (getBridge as jest.Mock).mockReturnValue({
            getBot: () => ({ getUserId: () => '@bot:localhost', getClient: () => mockClient })
        });

        await checkMessage(req, mockRes as unknown as Response);

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(mockClient.getEvent).toHaveBeenCalledWith('!room:localhost', '$orig');
        expect(sendGhostMessage).toHaveBeenCalledWith(expect.objectContaining({
            cleanContent: 'Edited',
            relatesTo: { 'm.in_reply_to': { event_id: '$parent' } } // Pulled from original event
        }));
    });
});
