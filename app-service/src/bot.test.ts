const mockPrisma = {
    system: {
        findFirst: jest.fn(),
        findUnique: jest.fn()
    },
    member: {
        findMany: jest.fn(),
        findFirst: jest.fn()
    },
    accountLink: {
        findUnique: jest.fn()
    }
};

// MOCK PRISMA BEFORE ANYTHING ELSE
jest.mock('@prisma/client', () => ({
    PrismaClient: jest.fn().mockImplementation(() => mockPrisma)
}));

import { handleEvent, prisma, setAsToken, cryptoManager, initCommandHandler } from './bot';
import { Request } from 'matrix-appservice-bridge';

const mockBotClient = {
    redactEvent: jest.fn().mockResolvedValue({}),
    getEvent: jest.fn(),
    getRoomStateEvent: jest.fn().mockResolvedValue({}),
    getJoinedRoomMembers: jest.fn().mockResolvedValue([]),
    sendStateEvent: jest.fn().mockResolvedValue({}),
    getUserProfile: jest.fn().mockResolvedValue({ displayname: "Mock User" }),
    setRoomName: jest.fn().mockResolvedValue({}),
    setRoomTopic: jest.fn().mockResolvedValue({}),
    homeserverUrl: "http://localhost:8008"
};

const mockIntent = {
    userId: "@_plural_test_lily:localhost",
    sendText: jest.fn(),
    sendEvent: jest.fn(),
    join: jest.fn().mockResolvedValue({}),
    invite: jest.fn().mockResolvedValue({}),
    setRoomName: jest.fn().mockResolvedValue({}),
    setRoomTopic: jest.fn().mockResolvedValue({}),
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
    getIntent: jest.fn((userId?: string) => mockIntent)
};

// Mock the cache
jest.mock('./services/cache', () => ({
    proxyCache: {
        getSystemRules: jest.fn()
    }
}));

import { proxyCache } from './services/cache';

// Mock crypto
jest.mock('./crypto/crypto-utils', () => ({
    processCryptoRequests: jest.fn(),
    registerDevice: jest.fn().mockResolvedValue(true)
}));

describe('Bot Event Handler', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setAsToken("test_token");
        initCommandHandler(mockBridge as any, prisma, cryptoManager, "test_token", "localhost");
    });

    const createMockRequest = (event: any): Request<any> => {
        return {
            getData: () => event
        } as any;
    };

    describe('Janitor Logic', () => {
        it('should redact empty messages from non-bridge users', async () => {
            const event = {
                event_id: "$123",
                room_id: "!room:localhost",
                sender: "@alice:localhost",
                type: "m.room.message",
                content: { body: "" }
            };

            await handleEvent(createMockRequest(event), undefined, mockBridge as any, prisma);

            // Should redact via commandHandler.safeRedact (which calls botClient.redactEvent)
            expect(mockBotClient.redactEvent).toHaveBeenCalledWith("!room:localhost", "$123", "ZeroFlash");
        });
    });

    describe('Invite Handling', () => {
        it('should auto-join and forward invites for ghost users', async () => {
            const roomId = "!room:localhost";
            const ghostUserId = "@_plural_seraphim_lily:localhost";
            const sender = "@alice:localhost";
            const primaryUser = "@chiara:localhost";

            const event = {
                type: "m.room.member",
                state_key: ghostUserId,
                sender: sender,
                room_id: roomId,
                content: { membership: "invite" }
            };

            const mockSystem = {
                slug: "seraphim",
                accountLinks: [
                    { matrixId: primaryUser, isPrimary: true }
                ]
            };

            // Mock prisma lookup
            (mockPrisma.system.findUnique as jest.Mock).mockResolvedValue(mockSystem);
            
            // Spy on ghost intent methods
            const ghostJoin = jest.spyOn(mockIntent, 'join');
            const ghostInvite = jest.spyOn(mockIntent, 'invite');
            const ghostSetTopic = jest.spyOn(mockIntent, 'setRoomTopic');

            await handleEvent(createMockRequest(event), undefined, mockBridge as any, prisma);

            expect(ghostJoin).toHaveBeenCalled();
            expect(ghostInvite).toHaveBeenCalledWith(roomId, primaryUser);
            expect(ghostInvite).toHaveBeenCalledWith(roomId, "@plural_bot:localhost");
            expect(ghostSetTopic).toHaveBeenCalledWith(roomId, expect.stringContaining("Waiting for account owner"));
        });

        it('should handle self-DMs by skipping redundant owner invite and topic', async () => {
            const roomId = "!room:localhost";
            const ghostUserId = "@_plural_seraphim_lily:localhost";
            const ownerMxid = "@chiara:localhost";

            const event = {
                type: "m.room.member",
                state_key: ghostUserId,
                sender: ownerMxid, // OWNER is inviting
                room_id: roomId,
                content: { membership: "invite" }
            };

            const mockSystem = {
                slug: "seraphim",
                accountLinks: [
                    { matrixId: ownerMxid, isPrimary: true }
                ]
            };

            (mockPrisma.system.findUnique as jest.Mock).mockResolvedValue(mockSystem);
            
            const ghostInvite = jest.spyOn(mockIntent, 'invite');
            const ghostSetTopic = jest.spyOn(mockIntent, 'setRoomTopic');

            await handleEvent(createMockRequest(event), undefined, mockBridge as any, prisma);

            // Should NOT invite owner (sender)
            expect(ghostInvite).not.toHaveBeenCalledWith(roomId, ownerMxid);
            // Should still invite bot
            expect(ghostInvite).toHaveBeenCalledWith(roomId, "@plural_bot:localhost");
            // Should NOT set topic
            expect(ghostSetTopic).not.toHaveBeenCalled();
        });
    });

    describe('Reaction Handling', () => {
        beforeEach(() => {
            (proxyCache.getSystemRules as jest.Mock).mockResolvedValue({
                slug: "seraphim",
                id: "sys123",
                members: []
            });
        });

        it('should trigger handleMessageInfoRequest on question mark reaction and redact the reaction', async () => {
            const event = {
                type: "m.reaction",
                room_id: "!room:localhost",
                sender: "@alice:localhost",
                event_id: "$react1",
                content: {
                    "m.relates_to": {
                        rel_type: "m.annotation",
                        event_id: "$target1",
                        key: "❓"
                    }
                }
            };

            const infoSpy = jest.spyOn(require('./bot').commandHandler, 'handleMessageInfoRequest').mockResolvedValue(undefined);
            const redactSpy = jest.spyOn(require('./bot').commandHandler, 'safeRedact').mockResolvedValue(undefined);

            await handleEvent(createMockRequest(event), undefined, mockBridge as any, prisma);

            expect(infoSpy).toHaveBeenCalledWith("!room:localhost", "@alice:localhost", "$target1", false);
            expect(redactSpy).toHaveBeenCalledWith("!room:localhost", "$react1", "Cleanup");
            
            infoSpy.mockRestore();
            redactSpy.mockRestore();
        });

        it('should trigger handleMessagePingRequest on bell reaction and redact the reaction', async () => {
            const event = {
                type: "m.reaction",
                room_id: "!room:localhost",
                sender: "@alice:localhost",
                event_id: "$react2",
                content: {
                    "m.relates_to": {
                        rel_type: "m.annotation",
                        event_id: "$target2",
                        key: "🔔"
                    }
                }
            };

            const pingSpy = jest.spyOn(require('./bot').commandHandler, 'handleMessagePingRequest').mockResolvedValue(undefined);
            const redactSpy = jest.spyOn(require('./bot').commandHandler, 'safeRedact').mockResolvedValue(undefined);

            await handleEvent(createMockRequest(event), undefined, mockBridge as any, prisma);

            expect(pingSpy).toHaveBeenCalledWith("!room:localhost", "@alice:localhost", "$target2");
            expect(redactSpy).toHaveBeenCalledWith("!room:localhost", "$react2", "Cleanup");

            pingSpy.mockRestore();
            redactSpy.mockRestore();
        });

        it('should not delete another system\'s message on cross reaction', async () => {
            const event = {
                type: "m.reaction",
                room_id: "!room:localhost",
                sender: "@alice:localhost",
                event_id: "$react3",
                content: {
                    "m.relates_to": {
                        rel_type: "m.annotation",
                        event_id: "$target3",
                        key: "❌"
                    }
                }
            };

            // Mock the target event as belonging to a different system
            (mockBotClient as any).getEvent.mockResolvedValue({
                sender: "@_plural_othersys_bob:localhost",
                event_id: "$target3",
                type: "m.room.message"
            });

            const redactSpy = jest.spyOn(require('./bot').commandHandler, 'safeRedact').mockResolvedValue(undefined);

            await handleEvent(createMockRequest(event), undefined, mockBridge as any, prisma);

            // Should not redact the target event or the reaction
            expect(redactSpy).not.toHaveBeenCalled();

            redactSpy.mockRestore();
        });
    });

    describe('Power Level Synchronization', () => {
        const botUserId = "@plural_bot:localhost";
        const ownerUserId = "@chiara:localhost";
        const roomId = "!room:localhost";
        const ghostUserId = "@_plural_seraphim_lily:localhost";

        beforeEach(() => {
            mockBotClient.getJoinedRoomMembers.mockResolvedValue([botUserId, ownerUserId, ghostUserId]);
            mockBotClient.getRoomStateEvent.mockResolvedValue({
                users: { [ghostUserId]: 50 },
                users_default: 0
            });
        });

        it('should clear room topic when primary owner joins', async () => {
            const event = {
                type: "m.room.member",
                state_key: ownerUserId,
                sender: ownerUserId,
                room_id: roomId,
                content: { membership: "join" }
            };

            (mockPrisma.system.findUnique as jest.Mock).mockResolvedValue({
                slug: "seraphim",
                accountLinks: [{ matrixId: ownerUserId, isPrimary: true }]
            });

            const ghostSetTopic = jest.spyOn(mockIntent, 'setRoomTopic');

            await handleEvent(createMockRequest(event), undefined, mockBridge as any, prisma);

            // Should clear the topic
            expect(ghostSetTopic).toHaveBeenCalledWith(roomId, "");
        });
    });
});
