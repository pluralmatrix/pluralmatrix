import { handleEvent, prisma, setAsToken, initCommandHandler, cryptoManager } from './bot';
import { proxyCache } from './services/cache';

// Mock dependencies
const mockBotClient = {
    redactEvent: jest.fn().mockResolvedValue({}),
    getEvent: jest.fn(),
    getRoomStateEvent: jest.fn().mockResolvedValue({}),
    getJoinedRoomMembers: jest.fn().mockResolvedValue([]),
    sendStateEvent: jest.fn().mockResolvedValue({}),
    getUserProfile: jest.fn().mockResolvedValue({ displayname: "Mock User" }),
    homeserverUrl: "http://localhost:8008",
    doRequest: jest.fn()
};

const mockIntent = {
    userId: "@_plural_test_lily:localhost",
    sendText: jest.fn(),
    sendEvent: jest.fn(),
    join: jest.fn().mockResolvedValue({}),
    ensureRegistered: jest.fn(),
    setDisplayName: jest.fn(),
    setAvatarUrl: jest.fn(),
    matrixClient: mockBotClient
};

const mockBridge = {
    getBot: () => ({
        getUserId: () => "@plural_bot:localhost",
        getClient: () => mockBotClient
    }),
    getIntent: (userId?: string) => mockIntent
};

jest.mock('./services/cache', () => ({
    proxyCache: {
        getSystemRules: jest.fn()
    }
}));

// Mock crypto
jest.mock('./crypto/crypto-utils', () => ({
    processCryptoRequests: jest.fn(),
    registerDevice: jest.fn().mockResolvedValue(true)
}));

jest.mock('./services/queue/MessageQueue', () => ({
    messageQueue: {
        enqueue: jest.fn()
    }
}));

import { messageQueue } from './services/queue/MessageQueue';

describe('Proxy on Edit', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setAsToken("test_token");
        initCommandHandler(mockBridge as any, prisma, cryptoManager, "test_token", "localhost");
    });

    const mockSystem = {
        slug: "test",
        members: [
            { 
                id: "m1", 
                slug: "lily", 
                name: "Lily", 
                proxyTags: [{ prefix: "lily:", suffix: "" }] 
            }
        ]
    };

    it('should proxy when a message is edited to include a valid prefix', async () => {
        const roomId = "!room:localhost";
        const sender = "@alice:localhost";
        const eventId = "$edit_event";
        const originalId = "$original_event";

        // 1. Mock cache to return our system
        (proxyCache.getSystemRules as jest.Mock).mockResolvedValue(mockSystem);

        // 2. Create an edit event
        const editEvent = {
            event_id: eventId,
            room_id: roomId,
            sender: sender,
            type: "m.room.message",
            content: {
                "m.new_content": {
                    body: "lily: New message after edit",
                    msgtype: "m.text"
                },
                "m.relates_to": {
                    rel_type: "m.replace",
                    event_id: originalId
                }
            }
        };

        const req = { getData: () => editEvent } as any;

        // 3. Handle the event
        await handleEvent(req, undefined, mockBridge as any, prisma);

        // 4. Verify original and edit were redacted
        expect(mockBotClient.redactEvent).toHaveBeenCalledWith(roomId, eventId, "PluralProxy");
        expect(mockBotClient.redactEvent).toHaveBeenCalledWith(roomId, originalId, "PluralProxyOriginal");

        // 5. Verify the message was enqueued for the ghost
        expect(messageQueue.enqueue).toHaveBeenCalledWith(
            roomId,
            sender,
            expect.objectContaining({ userId: "@_plural_test_lily:localhost" }),
            "New message after edit",
            undefined,
            expect.anything()
        );
    });
});
