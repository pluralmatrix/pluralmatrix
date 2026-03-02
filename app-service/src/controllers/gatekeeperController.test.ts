import { Request, Response } from 'express';
import { checkMessage } from './gatekeeperController';
import { proxyCache } from '../services/cache';
import { cryptoManager, executeTargetingCommand } from '../bot';
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
    executeTargetingCommand: jest.fn().mockResolvedValue(true)
}));

jest.mock('../services/cache', () => ({
    proxyCache: {
        getSystemRules: jest.fn()
    }
}));

jest.mock('../services/ghostService', () => ({
    sendGhostMessage: jest.fn().mockResolvedValue({})
}));

describe('Gatekeeper Controller', () => {
    let req: Partial<Request>;
    let res: Partial<Response>;
    let jsonMock: jest.Mock;
    
    const mockSystem = {
        slug: 'sys',
        members: [
            { id: 'm1', slug: 'lily', name: 'Lily', proxyTags: [{ prefix: 'l:', suffix: '' }] }
        ],
        autoproxyId: null
    };

    beforeEach(() => {
        jest.clearAllMocks();
        jsonMock = jest.fn();
        res = { json: jsonMock };
        
        (proxyCache.getSystemRules as jest.Mock).mockResolvedValue(mockSystem);
    });

    const createReq = (body: any) => ({ body } as Request);

    describe('Basic Flow & Escapes', () => {
        it('should return ALLOW on invalid schema', async () => {
            req = createReq({}); // Missing required fields
            await checkMessage(req as Request, res as Response);
            expect(jsonMock).toHaveBeenCalledWith({ action: "ALLOW" });
        });

        it('should return ALLOW if user has no system', async () => {
            (proxyCache.getSystemRules as jest.Mock).mockResolvedValue(null);
            req = createReq({ event_id: '$1', sender: '@user:localhost', room_id: '!room:localhost', content: { body: 'l: test' }});
            await checkMessage(req as Request, res as Response);
            expect(jsonMock).toHaveBeenCalledWith({ action: "ALLOW" });
        });

        it('should return ALLOW if message starts with escape char', async () => {
            req = createReq({ event_id: '$1', sender: '@user:localhost', room_id: '!room:localhost', content: { body: '\\l: test' }});
            await checkMessage(req as Request, res as Response);
            expect(jsonMock).toHaveBeenCalledWith({ action: "ALLOW" });
        });
    });

    describe('Unencrypted Proxying', () => {
        it('should trigger proxy and return BLOCK on match', async () => {
            req = createReq({ event_id: '$1', sender: '@user:localhost', room_id: '!room:localhost', content: { body: 'l: hello world' }});
            await checkMessage(req as Request, res as Response);
            
            expect(sendGhostMessage).toHaveBeenCalledWith(expect.objectContaining({
                cleanContent: 'hello world',
                roomId: '!room:localhost',
                member: expect.objectContaining({ slug: 'lily' })
            }));
            expect(jsonMock).toHaveBeenCalledWith({ action: "BLOCK" });
        });

        it('should return ALLOW if no match', async () => {
            req = createReq({ event_id: '$1', sender: '@user:localhost', room_id: '!room:localhost', content: { body: 'hello world' }});
            await checkMessage(req as Request, res as Response);
            
            expect(sendGhostMessage).not.toHaveBeenCalled();
            expect(jsonMock).toHaveBeenCalledWith({ action: "ALLOW" });
        });
    });

    describe('Encrypted Proxying (E2EE)', () => {
        let decryptMock: jest.Mock;

        beforeEach(() => {
            decryptMock = jest.fn();
            (cryptoManager.getMachine as jest.Mock).mockResolvedValue({
                decryptRoomEvent: decryptMock
            });
        });

        it('should decrypt payload, NOT trigger proxy instantly, but return BLOCK', async () => {
            decryptMock.mockResolvedValue({
                event: JSON.stringify({ content: { body: 'l: secret message' } })
            });

            req = createReq({ 
                event_id: '$1', 
                sender: '@user:localhost', 
                room_id: '!room:localhost', 
                type: 'm.room.encrypted',
                encrypted_payload: { ciphertext: '...' }
            });

            await checkMessage(req as Request, res as Response);

            expect(decryptMock).toHaveBeenCalled();
            expect(sendGhostMessage).not.toHaveBeenCalled(); // Handled by bot.ts instead
            expect(jsonMock).toHaveBeenCalledWith({ action: "BLOCK" });
        });

        it('should retry decryption and eventually return ALLOW if it fails', async () => {
            decryptMock.mockRejectedValue(new Error('Decryption failed'));

            req = createReq({ 
                event_id: '$1', 
                sender: '@user:localhost', 
                room_id: '!room:localhost', 
                type: 'm.room.encrypted',
                encrypted_payload: { ciphertext: '...' }
            });

            await checkMessage(req as Request, res as Response);

            expect(decryptMock).toHaveBeenCalledTimes(3); // Wait/Retry loop
            expect(jsonMock).toHaveBeenCalledWith({ action: "ALLOW" });
        });
    });

    describe('Zero-Flash Commands', () => {
        it('should execute command immediately and return BLOCK in unencrypted room', async () => {
            req = createReq({ event_id: '$1', sender: '@user:localhost', room_id: '!room:localhost', content: { body: 'pk;e new text' }});
            await checkMessage(req as Request, res as Response);

            expect(executeTargetingCommand).toHaveBeenCalled();
            expect(jsonMock).toHaveBeenCalledWith({ action: "BLOCK" });
        });

        it('should NOT execute command but return BLOCK in encrypted room', async () => {
            (cryptoManager.getMachine as jest.Mock).mockResolvedValue({
                decryptRoomEvent: jest.fn().mockResolvedValue({
                    event: JSON.stringify({ content: { body: 'pk;e secure text' } })
                })
            });

            req = createReq({ 
                event_id: '$1', 
                sender: '@user:localhost', 
                room_id: '!room:localhost', 
                type: 'm.room.encrypted',
                encrypted_payload: { ciphertext: '...' }
            });
            await checkMessage(req as Request, res as Response);

            expect(executeTargetingCommand).not.toHaveBeenCalled();
            expect(jsonMock).toHaveBeenCalledWith({ action: "BLOCK" });
        });

        it('should return ALLOW for non-targeting pk; commands', async () => {
            req = createReq({ event_id: '$1', sender: '@user:localhost', room_id: '!room:localhost', content: { body: 'pk;system' }});
            await checkMessage(req as Request, res as Response);
            expect(jsonMock).toHaveBeenCalledWith({ action: "ALLOW" });
        });
    });

    describe('Autoproxy', () => {
        it('should trigger autoproxy and return BLOCK if enabled', async () => {
            (proxyCache.getSystemRules as jest.Mock).mockResolvedValue({
                ...mockSystem,
                autoproxyId: 'm1'
            });

            req = createReq({ event_id: '$1', sender: '@user:localhost', room_id: '!room:localhost', content: { body: 'autoprompted message' }});
            await checkMessage(req as Request, res as Response);

            expect(sendGhostMessage).toHaveBeenCalled();
            expect(jsonMock).toHaveBeenCalledWith({ action: "BLOCK" });
        });
    });
});
