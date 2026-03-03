import { messageQueue } from './MessageQueue';
import { sendEncryptedEvent } from '../../crypto/encryption';
import { sleep } from '../../utils/timer';
import { getBridge } from '../../bot';

// Mock dependencies
jest.mock('../../crypto/encryption', () => ({
    sendEncryptedEvent: jest.fn()
}));
jest.mock('../../utils/timer', () => ({
    sleep: jest.fn().mockResolvedValue(undefined)
}));
jest.mock('../../bot', () => {
    const mockBotIntent = {
        userId: "@plural_bot:localhost"
    };
    return {
        asToken: "mock_token",
        cryptoManager: {},
        getBridge: jest.fn().mockReturnValue({
            getBot: () => ({
                getUserId: () => "@plural_bot:localhost"
            }),
            getIntent: jest.fn().mockReturnValue(mockBotIntent)
        })
    };
});

describe('MessageQueueService', () => {
    const roomId = "!test_room:localhost";
    const senderId = "@human:localhost";
    const plaintext = "Hello World";
    
    let mockGhostIntent: any;
    let mockBotIntent: any;

    beforeEach(() => {
        jest.clearAllMocks();
        
        // Reset the singleton instance internal state via its public/private boundaries (or by recreating it, but it's exported as const, so we clean it up)
        // Since it's a singleton, we need to clear its internal maps for clean tests.
        (messageQueue as any).RoomQueues.clear();
        (messageQueue as any).RoomLocks.clear();
        (messageQueue as any).DeadLetterVault.clear();

        mockGhostIntent = {
            userId: "@_plural_ghost:localhost"
        };
        
        mockBotIntent = {
            userId: "@plural_bot:localhost"
        };
        
        const bridge = getBridge();
        (bridge.getIntent as jest.Mock).mockReturnValue(mockBotIntent);
    });

    it('should successfully process and dequeue a message', async () => {
        (sendEncryptedEvent as jest.Mock).mockResolvedValue({});

        messageQueue.enqueue(roomId, senderId, mockGhostIntent, plaintext);
        
        // Let the event loop tick to allow the async processQueue to finish
        await new Promise(r => setImmediate(r));

        expect(sendEncryptedEvent).toHaveBeenCalledTimes(1);
        expect(sendEncryptedEvent).toHaveBeenCalledWith(
            mockGhostIntent,
            roomId,
            "m.room.message",
            expect.objectContaining({ body: plaintext }),
            expect.anything(),
            expect.anything(),
            undefined // prisma
        );

        // Queue should be empty
        expect((messageQueue as any).RoomQueues.get(roomId).length).toBe(0);
        expect((messageQueue as any).RoomLocks.get(roomId)).toBe(false);
    });

    it('should retry transient errors and eventually succeed', async () => {
        // Fail twice with a rate limit, then succeed
        (sendEncryptedEvent as jest.Mock)
            .mockRejectedValueOnce({ message: "M_LIMIT_EXCEEDED" })
            .mockRejectedValueOnce({ message: "M_LIMIT_EXCEEDED" })
            .mockResolvedValueOnce({});

        messageQueue.enqueue(roomId, senderId, mockGhostIntent, plaintext);
        
        // Tick event loop multiple times to allow retries to process
        await new Promise(r => setImmediate(r));
        await new Promise(r => setImmediate(r));
        await new Promise(r => setImmediate(r));
        await new Promise(r => setImmediate(r));

        expect(sendEncryptedEvent).toHaveBeenCalledTimes(3);
        expect(sleep).toHaveBeenCalledTimes(2);
        
        // Queue should be empty after success
        expect((messageQueue as any).RoomQueues.get(roomId).length).toBe(0);
    });

    it('should immediately trigger Fallback 1 on fatal errors', async () => {
        // Fatal error (e.g., 403 Forbidden)
        (sendEncryptedEvent as jest.Mock).mockRejectedValueOnce({ status: 403, message: "Forbidden" });
        (sendEncryptedEvent as jest.Mock).mockResolvedValueOnce({}); // Bot bailout succeeds

        messageQueue.enqueue(roomId, senderId, mockGhostIntent, plaintext);
        
        await new Promise(r => setImmediate(r));
        await new Promise(r => setImmediate(r));

        // Attempted to send as ghost
        expect(sendEncryptedEvent).toHaveBeenNthCalledWith(1, 
            mockGhostIntent, 
            roomId, 
            "m.room.message", 
            expect.anything(), 
            expect.anything(), 
            expect.anything(),
            undefined
        );
        
        // Fallback: Attempted to send as bot
        expect(sendEncryptedEvent).toHaveBeenNthCalledWith(2, 
            mockBotIntent, 
            roomId, 
            "m.room.message", 
            expect.objectContaining({
                body: expect.stringContaining("Delivery Failed")
            }), 
            expect.anything(), 
            expect.anything(),
            undefined
        );

        // No sleeps (no retries)
        expect(sleep).not.toHaveBeenCalled();
        // Item removed from queue
        expect((messageQueue as any).RoomQueues.get(roomId).length).toBe(0);
        // Not in DL vault since fallback 1 succeeded
        expect(messageQueue.getDeadLetters().length).toBe(0);
    });

    it('should exhaust retries and then trigger Fallback 1', async () => {
        // Fail 4 times with transient error
        (sendEncryptedEvent as jest.Mock)
            .mockRejectedValueOnce({ message: "Timeout" })
            .mockRejectedValueOnce({ message: "Timeout" })
            .mockRejectedValueOnce({ message: "Timeout" })
            .mockRejectedValueOnce({ message: "Timeout" })
            .mockResolvedValueOnce({}); // Bot bailout succeeds

        messageQueue.enqueue(roomId, senderId, mockGhostIntent, plaintext);
        
        for(let i=0; i<6; i++) await new Promise(r => setImmediate(r));

        // 4 ghost attempts + 1 bot attempt = 5
        expect(sendEncryptedEvent).toHaveBeenCalledTimes(5);
        // 3 sleeps (after attempt 1, 2, and 3)
        expect(sleep).toHaveBeenCalledTimes(3);
        
        // Item removed from queue
        expect((messageQueue as any).RoomQueues.get(roomId).length).toBe(0);
    });

    it('should trigger Fallback 2 (Dead Letter Vault) if bot bailout fails', async () => {
        // Fatal error for ghost
        (sendEncryptedEvent as jest.Mock).mockRejectedValueOnce({ status: 403, message: "Forbidden" });
        // Fatal error for bot bailout too!
        (sendEncryptedEvent as jest.Mock).mockRejectedValueOnce({ status: 403, message: "Bot also forbidden" });

        messageQueue.enqueue(roomId, senderId, mockGhostIntent, plaintext);
        
        await new Promise(r => setImmediate(r));
        await new Promise(r => setImmediate(r));

        // In Vault
        const deadLetters = messageQueue.getDeadLetters();
        expect(deadLetters.length).toBe(1);
        expect(deadLetters[0].plaintext).toBe(plaintext);
        expect(deadLetters[0].errorReason).toBe("Forbidden");

        // Can be deleted
        messageQueue.deleteDeadLetter(deadLetters[0].id);
        expect(messageQueue.getDeadLetters().length).toBe(0);
    });

    it('should process items strictly FIFO with a mutex lock', async () => {
        // We simulate a slow send
        let resolveSend: any;
        const slowPromise = new Promise(r => resolveSend = r);
        
        (sendEncryptedEvent as jest.Mock)
            .mockReturnValueOnce(slowPromise) // 1st message is slow
            .mockResolvedValueOnce({});       // 2nd is fast

        // Enqueue two messages rapidly
        messageQueue.enqueue(roomId, senderId, mockGhostIntent, "Msg 1");
        messageQueue.enqueue(roomId, senderId, mockGhostIntent, "Msg 2");

        await new Promise(r => setImmediate(r));

        // The queue should have 2 items, but sendEncryptedEvent should only be called ONCE because the lock is held
        expect((messageQueue as any).RoomQueues.get(roomId).length).toBe(2);
        expect(sendEncryptedEvent).toHaveBeenCalledTimes(1);

        // Resolve the first message
        resolveSend({});
        
        // Let event loop process the completion and the next queue item
        await new Promise(r => setImmediate(r));
        await new Promise(r => setImmediate(r));

        // Both sent, queue empty
        expect(sendEncryptedEvent).toHaveBeenCalledTimes(2);
        expect((messageQueue as any).RoomQueues.get(roomId).length).toBe(0);
    });

    it('should garbage collect dead letters older than 24 hours', async () => {
        // Manually insert an item into the vault that is 25 hours old
        const oldTimestamp = Date.now() - (25 * 60 * 60 * 1000);
        (messageQueue as any).DeadLetterVault.set("old-item", {
            id: "old-item",
            timestamp: oldTimestamp,
            roomId,
            ghostUserId: "@ghost:localhost",
            plaintext: "I am very old",
            errorReason: "Failed"
        });

        // Manually insert a fresh item
        (messageQueue as any).DeadLetterVault.set("new-item", {
            id: "new-item",
            timestamp: Date.now(),
            roomId,
            ghostUserId: "@ghost:localhost",
            plaintext: "I am fresh",
            errorReason: "Failed"
        });

        expect(messageQueue.getDeadLetters().length).toBe(2);

        // Manually trigger the garbage collection logic
        (messageQueue as any).runGarbageCollection();

        // The old item should be gone, the new item should remain
        const remaining = messageQueue.getDeadLetters();
        expect(remaining.length).toBe(1);
        expect(remaining[0].id).toBe("new-item");
    });
});
