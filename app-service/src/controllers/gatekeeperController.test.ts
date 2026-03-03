import { Request, Response } from 'express';
import { checkMessage } from './gatekeeperController';
import { proxyCache } from '../services/cache';
import { cryptoManager, commandHandler } from '../bot';
import { sendGhostMessage } from '../services/ghostService';

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

describe('GatekeeperController', () => {
    let mockRes: any;

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

        await checkMessage(req, mockRes as Response);
        expect(mockRes.json).toHaveBeenCalledWith({ action: 'ALLOW' });
    });

    it('should ALLOW if the body starts with a backslash', async () => {
        (proxyCache.getSystemRules as jest.Mock).mockResolvedValue(mockSystem);
        
        const req = {
            body: { sender: '@alice:localhost', room_id: '!room:localhost', event_id: '$1', content: { body: '\\escaped' } }
        } as Request;

        await checkMessage(req, mockRes as Response);
        expect(mockRes.json).toHaveBeenCalledWith({ action: 'ALLOW' });
    });

    it('should BLOCK and trigger proxy if unencrypted match is found', async () => {
        (proxyCache.getSystemRules as jest.Mock).mockResolvedValue(mockSystem);
        
        const req = {
            body: { sender: '@alice:localhost', room_id: '!room:localhost', event_id: '$1', content: { body: 'lily: Hello' } }
        } as any;

        await checkMessage(req, mockRes as Response);
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
        } as any;

        await checkMessage(req, mockRes as Response);
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
        } as any;

        // Mock machine to return decrypted content
        (cryptoManager.getMachine as jest.Mock).mockResolvedValue({
            decryptRoomEvent: jest.fn().mockResolvedValue({
                event: JSON.stringify({ content: { body: 'lily: Secret' } })
            })
        });

        await checkMessage(req, mockRes as Response);
        expect(mockRes.json).toHaveBeenCalledWith({ action: 'BLOCK' });
        // Should NOT trigger proxy here, bot.ts will do it
        expect(sendGhostMessage).not.toHaveBeenCalled();
    });

    describe('Zero-Flash Command Interception', () => {
        it('should BLOCK and trigger executeTargetingCommand for unencrypted pk;edit', async () => {
            (proxyCache.getSystemRules as jest.Mock).mockResolvedValue(mockSystem);
            
            const req = {
                body: { sender: '@alice:localhost', room_id: '!room:localhost', event_id: '$1', content: { body: 'pk;edit test' } }
            } as any;

            await checkMessage(req, mockRes as Response);
            expect(mockRes.json).toHaveBeenCalledWith({ action: 'BLOCK' });
            expect(commandHandler.executeTargetingCommand).toHaveBeenCalled();
        });

        it('should BLOCK and trigger executeTargetingCommand for unencrypted pk;rp', async () => {
            (proxyCache.getSystemRules as jest.Mock).mockResolvedValue(mockSystem);
            
            const req = {
                body: { sender: '@alice:localhost', room_id: '!room:localhost', event_id: '$1', content: { body: 'pk;rp lily' } }
            } as any;

            await checkMessage(req, mockRes as Response);
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
            } as any;

            (cryptoManager.getMachine as jest.Mock).mockResolvedValue({
                decryptRoomEvent: jest.fn().mockResolvedValue({
                    event: JSON.stringify({ content: { body: 'pk;edit secret' } })
                })
            });

            await checkMessage(req, mockRes as Response);
            expect(mockRes.json).toHaveBeenCalledWith({ action: 'BLOCK' });
            expect(commandHandler.executeTargetingCommand).not.toHaveBeenCalled();
        });
    });
});
