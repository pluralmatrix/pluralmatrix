import { handleEvent, prisma, setAsToken } from './bot';
import { Request } from 'matrix-appservice-bridge';

// Mock dependency: cache
jest.mock('./services/cache', () => ({
    proxyCache: {
        getSystemRules: jest.fn(),
        invalidate: jest.fn()
    }
}));

// Mock bridge and intent
const mockBotClient = {
    redactEvent: jest.fn().mockResolvedValue({}),
    getEvent: jest.fn(),
    getRoomStateEvent: jest.fn().mockResolvedValue({ algorithm: "m.megolm.v1.aes-sha2" }),
    getJoinedRoomMembers: jest.fn().mockResolvedValue(["@alice:localhost", "@_plural_seraphim_lily:localhost"]),
    homeserverUrl: "http://localhost:8008",
    doRequest: jest.fn()
};

const createMockIntent = (userId: string) => ({
    userId: userId,
    sendEvent: jest.fn().mockResolvedValue({ event_id: "$new_event" }),
    sendText: jest.fn(),
    join: jest.fn(),
    ensureRegistered: jest.fn(),
    setDisplayName: jest.fn(),
    setAvatarUrl: jest.fn(),
    matrixClient: mockBotClient
});

const mockBridge = {
    getBot: () => ({
        getUserId: () => "@plural_bot:localhost",
        getClient: () => mockBotClient,
        getIntent: () => createMockIntent("@plural_bot:localhost")
    }),
    getIntent: jest.fn().mockImplementation((userId) => createMockIntent(userId || "@plural_bot:localhost"))
};

// Mock encryption
jest.mock('./crypto/encryption', () => ({
    sendEncryptedEvent: jest.fn().mockImplementation((intent, roomId, type, content) => {
        return intent.sendEvent(roomId, type, content);
    })
}));

// Mock Machine for decryption in tests
jest.mock('./bot', () => {
    const original = jest.requireActual('./bot');
    return {
        ...original,
        getBridge: () => mockBridge,
        sendRichText: jest.fn(),
        sendEncryptedText: jest.fn(),
        cryptoManager: {
            getMachine: jest.fn().mockResolvedValue({
                deviceId: { toString: () => "MOCK_DEVICE" },
                decryptRoomEvent: jest.fn().mockResolvedValue({
                    event: JSON.stringify({ type: "m.room.message", content: { body: "Decrypted Text" } })
                })
            })
        }
    };
});

describe('Bot Commands Resolution Tests', () => {
    const roomId = "!room:localhost";
    const sender = "@alice:localhost";

    beforeEach(() => {
        jest.clearAllMocks();
        setAsToken("mock_token");

        const { proxyCache } = require('./services/cache');
        proxyCache.getSystemRules.mockResolvedValue({
            slug: "seraphim",
            name: "Seraphim",
            members: [
                {
                    id: "lily-id",
                    slug: "lily",
                    name: "Lily",
                    displayName: "Lily 🌸",
                    avatarUrl: "mxc://example.com/lily",
                    proxyTags: [{ prefix: "l:", suffix: "" }]
                },
                {
                    id: "riven-id",
                    slug: "riven",
                    name: "Riven",
                    proxyTags: [{ prefix: "r:", suffix: "" }]
                }
            ]
        });
    });

    describe('pk;message -delete', () => {
        it('should find the ROOT ID even if the latest event is an edit', async () => {
            const rootId = "$root_event";
            const editId = "$edit_event";

            mockBotClient.doRequest.mockResolvedValue({
                chunk: [
                    {
                        event_id: editId,
                        type: "m.room.message",
                        sender: "@_plural_seraphim_lily:localhost",
                        content: {
                            body: "* Edited text",
                            "m.new_content": { body: "Edited text" },
                            "m.relates_to": { rel_type: "m.replace", event_id: rootId }
                        }
                    },
                    {
                        event_id: rootId,
                        type: "m.room.message",
                        sender: "@_plural_seraphim_lily:localhost",
                        content: { body: "Original text" }
                    }
                ]
            });

            const req = new Request({
                data: {
                    type: "m.room.message",
                    event_id: "$cmd_event",
                    room_id: roomId,
                    sender: sender,
                    content: { body: "pk;message -delete" }
                }
            });

            await handleEvent(req as any, undefined, mockBridge as any, prisma, false, "mock_token");

            expect(mockBotClient.redactEvent).toHaveBeenCalledWith(roomId, rootId, "UserRequest");
        });
    });

    describe('pk;edit', () => {
        it('should correctly resolve chained edits from history', async () => {
            const rootId = "$root_event";
            const editId = "$edit_event";

            mockBotClient.doRequest.mockResolvedValue({
                chunk: [
                    {
                        event_id: editId,
                        type: "m.room.message",
                        sender: "@_plural_seraphim_lily:localhost",
                        content: {
                            body: "* Second Text",
                            "m.new_content": { body: "Second Text" },
                            "m.relates_to": { rel_type: "m.replace", event_id: rootId }
                        }
                    },
                    {
                        event_id: rootId,
                        type: "m.room.message",
                        sender: "@_plural_seraphim_lily:localhost",
                        content: { body: "First Text" }
                    }
                ]
            });

            const req = new Request({
                data: {
                    type: "m.room.message",
                    event_id: "$cmd_event",
                    room_id: roomId,
                    sender: sender,
                    content: { body: "pk;e Final Text" }
                }
            });

            await handleEvent(req as any, undefined, mockBridge as any, prisma, false, "mock_token");

            const { sendEncryptedEvent } = require('./crypto/encryption');
            expect(sendEncryptedEvent).toHaveBeenCalledWith(
                expect.objectContaining({ userId: "@_plural_seraphim_lily:localhost" }),
                roomId,
                "m.room.message",
                expect.objectContaining({
                    "m.relates_to": { rel_type: "m.replace", event_id: rootId }
                }),
                expect.anything(),
                expect.anything()
            );
        });
    });

    describe('pk;reproxy', () => {
        it('Case 1: should reproxy the most recent message (no reply)', async () => {
            const rootId = "$latest_root";
            mockBotClient.doRequest.mockResolvedValue({
                chunk: [{
                    event_id: rootId,
                    type: "m.room.message",
                    sender: "@_plural_seraphim_lily:localhost",
                    content: { body: "Hello World" }
                }]
            });

            const req = new Request({
                data: {
                    type: "m.room.message",
                    event_id: "$cmd_event",
                    room_id: roomId,
                    sender: sender,
                    content: { body: "pk;rp riven" }
                }
            });

            await handleEvent(req as any, undefined, mockBridge as any, prisma, false, "mock_token");

            // Should redact old and send new from Riven
            expect(mockBotClient.redactEvent).toHaveBeenCalledWith(roomId, rootId, "PluralReproxy");
            const { sendEncryptedEvent } = require('./crypto/encryption');
            expect(sendEncryptedEvent).toHaveBeenCalledWith(
                expect.objectContaining({ userId: expect.stringContaining("riven") }),
                roomId,
                "m.room.message",
                expect.objectContaining({ body: "Hello World" }),
                expect.anything(),
                expect.anything()
            );
        });

        it('Case 2: should reproxy a specific message via reply', async () => {
            const targetId = "$older_message";
            mockBotClient.getEvent.mockResolvedValue({
                event_id: targetId,
                sender: "@_plural_seraphim_lily:localhost",
                content: { body: "Specific text" }
            });

            const req = new Request({
                data: {
                    type: "m.room.message",
                    event_id: "$cmd_event",
                    room_id: roomId,
                    sender: sender,
                    content: { 
                        body: "pk;rp riven",
                        "m.relates_to": {
                            "m.in_reply_to": { event_id: targetId }
                        }
                    }
                }
            });

            await handleEvent(req as any, undefined, mockBridge as any, prisma, false, "mock_token");

            expect(mockBotClient.redactEvent).toHaveBeenCalledWith(roomId, targetId, "PluralReproxy");
            const { sendEncryptedEvent } = require('./crypto/encryption');
            expect(sendEncryptedEvent).toHaveBeenCalledWith(
                expect.objectContaining({ userId: expect.stringContaining("riven") }),
                roomId,
                "m.room.message",
                expect.objectContaining({ body: "Specific text" }),
                expect.anything(),
                expect.anything()
            );
        });

        it('Case 3: should target the latest ROOT message even after an older message was edited', async () => {
            const root1 = "$older_root";
            const edit1 = "$older_edit";
            const root2 = "$most_recent_root";

            // Scrollback shows: root2, then edit1 (replacing root1), then root1
            mockBotClient.doRequest.mockResolvedValue({
                chunk: [
                    {
                        event_id: root2,
                        type: "m.room.message",
                        sender: "@_plural_seraphim_lily:localhost",
                        content: { body: "I am the latest" }
                    },
                    {
                        event_id: edit1,
                        type: "m.room.message",
                        sender: "@_plural_seraphim_lily:localhost",
                        content: {
                            "m.relates_to": { rel_type: "m.replace", event_id: root1 }
                        }
                    },
                    {
                        event_id: root1,
                        type: "m.room.message",
                        sender: "@_plural_seraphim_lily:localhost",
                        content: { body: "I was first" }
                    }
                ]
            });

            const req = new Request({
                data: {
                    type: "m.room.message",
                    event_id: "$cmd_event",
                    room_id: roomId,
                    sender: sender,
                    content: { body: "pk;rp riven" }
                }
            });

            await handleEvent(req as any, undefined, mockBridge as any, prisma, false, "mock_token");

            // Should target root2 (the most recent distinct message)
            expect(mockBotClient.redactEvent).toHaveBeenCalledWith(roomId, root2, "PluralReproxy");
            const { sendEncryptedEvent } = require('./crypto/encryption');
            expect(sendEncryptedEvent).toHaveBeenCalledWith(
                expect.anything(),
                roomId,
                "m.room.message",
                expect.objectContaining({ body: "I am the latest" }),
                expect.anything(),
                expect.anything()
            );
        });

        it('Case 4: should use the EDITED text when reproxying an edited message', async () => {
            const rootId = "$root_event";
            const editId = "$edit_event";

            mockBotClient.doRequest.mockResolvedValue({
                chunk: [
                    {
                        event_id: editId,
                        type: "m.room.message",
                        sender: "@_plural_seraphim_lily:localhost",
                        content: {
                            body: "* The NEW text",
                            "m.new_content": { body: "The NEW text" },
                            "m.relates_to": { rel_type: "m.replace", event_id: rootId }
                        }
                    },
                    {
                        event_id: rootId,
                        type: "m.room.message",
                        sender: "@_plural_seraphim_lily:localhost",
                        content: { body: "The OLD text" }
                    }
                ]
            });

            const req = new Request({
                data: {
                    type: "m.room.message",
                    event_id: "$cmd_event",
                    room_id: roomId,
                    sender: sender,
                    content: { body: "pk;rp riven" }
                }
            });

            await handleEvent(req as any, undefined, mockBridge as any, prisma, false, "mock_token");

            expect(mockBotClient.redactEvent).toHaveBeenCalledWith(roomId, rootId, "PluralReproxy");
            const { sendEncryptedEvent } = require('./crypto/encryption');
            expect(sendEncryptedEvent).toHaveBeenCalledWith(
                expect.anything(),
                roomId,
                "m.room.message",
                expect.objectContaining({ body: "The NEW text" }),
                expect.anything(),
                expect.anything()
            );
        });

        it('Case 5: should use the EDITED text when reproxying an edited message via reply', async () => {
            const rootId = "$root_event";
            const editId = "$edit_event";

            // The user replies to the original root message
            mockBotClient.getEvent.mockResolvedValue({
                event_id: rootId,
                sender: "@_plural_seraphim_lily:localhost",
                content: { body: "The OLD text" }
            });

            // But there is a newer edit in the scrollback
            mockBotClient.doRequest.mockResolvedValue({
                chunk: [
                    {
                        event_id: editId,
                        type: "m.room.message",
                        sender: "@_plural_seraphim_lily:localhost",
                        content: {
                            body: "* The NEW text",
                            "m.new_content": { body: "The NEW text" },
                            "m.relates_to": { rel_type: "m.replace", event_id: rootId }
                        }
                    },
                    {
                        event_id: rootId,
                        type: "m.room.message",
                        sender: "@_plural_seraphim_lily:localhost",
                        content: { body: "The OLD text" }
                    }
                ]
            });

            const req = new Request({
                data: {
                    type: "m.room.message",
                    event_id: "$cmd_event",
                    room_id: roomId,
                    sender: sender,
                    content: { 
                        body: "pk;rp riven",
                        "m.relates_to": {
                            "m.in_reply_to": { event_id: rootId }
                        }
                    }
                }
            });

            await handleEvent(req as any, undefined, mockBridge as any, prisma, false, "mock_token");

            expect(mockBotClient.redactEvent).toHaveBeenCalledWith(roomId, rootId, "PluralReproxy");
            const { sendEncryptedEvent } = require('./crypto/encryption');
            expect(sendEncryptedEvent).toHaveBeenCalledWith(
                expect.anything(),
                roomId,
                "m.room.message",
                expect.objectContaining({ body: "The NEW text" }),
                expect.anything(),
                expect.anything()
            );
        });

        it('Case 6: should show error if member slug not found', async () => {
            mockBotClient.doRequest.mockResolvedValue({
                chunk: [
                    {
                        event_id: "$root",
                        type: "m.room.message",
                        sender: "@_plural_seraphim_lily:localhost",
                        content: { body: "hello" }
                    }
                ]
            });

            const req = new Request({
                data: {
                    type: "m.room.message",
                    event_id: "$cmd_event",
                    room_id: roomId,
                    sender: sender,
                    content: { body: "pk;rp non-existent" }
                }
            });

            await handleEvent(req as any, undefined, mockBridge as any, prisma, false, "mock_token");
            
            const { sendEncryptedEvent } = require('./crypto/encryption');
            expect(sendEncryptedEvent).toHaveBeenCalledWith(
                expect.anything(),
                roomId,
                "m.room.message",
                expect.objectContaining({ body: "No member found with ID: non-existent" }),
                expect.anything(),
                expect.anything()
            );
        });
    });


    describe('Informational Commands', () => {
        it('pk;list should use the encrypted rich text helper', async () => {
            const req = new Request({
                data: {
                    type: "m.room.message",
                    event_id: "$cmd_event",
                    room_id: roomId,
                    sender: sender,
                    content: { body: "pk;list" }
                }
            });

            await handleEvent(req as any, undefined, mockBridge as any, prisma, false, "mock_token");

            const { sendEncryptedEvent } = require('./crypto/encryption');
            expect(sendEncryptedEvent).toHaveBeenCalledWith(
                expect.objectContaining({ userId: "@plural_bot:localhost" }),
                roomId,
                "m.room.message",
                expect.objectContaining({
                    msgtype: "m.text",
                    format: "org.matrix.custom.html"
                }),
                expect.anything(),
                expect.anything()
            );
        });

        it('pk;member should show member details and avatar if available', async () => {
            const req = new Request({
                data: {
                    type: "m.room.message",
                    event_id: "$cmd_event",
                    room_id: roomId,
                    sender: sender,
                    content: { body: "pk;member lily" }
                }
            });

            await handleEvent(req as any, undefined, mockBridge as any, prisma, false, "mock_token");

            const { sendEncryptedEvent } = require('./crypto/encryption');
            
            // Should send text details
            expect(sendEncryptedEvent).toHaveBeenCalledWith(
                expect.objectContaining({ userId: "@plural_bot:localhost" }),
                roomId,
                "m.room.message",
                expect.objectContaining({
                    msgtype: "m.text",
                    body: expect.stringContaining("Member Details: Lily"),
                    format: "org.matrix.custom.html"
                }),
                expect.anything(),
                expect.anything()
            );

            // Should also send the avatar image as a rich-text fallback
            expect(sendEncryptedEvent).toHaveBeenCalledWith(
                expect.objectContaining({ userId: "@plural_bot:localhost" }),
                roomId,
                "m.room.message",
                expect.objectContaining({
                    msgtype: "m.text",
                    body: expect.stringContaining("Avatar"),
                    format: "org.matrix.custom.html",
                    formatted_body: expect.stringContaining('<img src="mxc://example.com/lily"')
                }),
                expect.anything(),
                expect.anything()
            );
        });
    });

    describe('Autoproxy', () => {
        // ... (keep existing autoproxy tests) ...
    });

    describe('Linking & Multi-Account', () => {
        it('pk;link should link a valid target account', async () => {
            const req = new Request({
                data: {
                    type: "m.room.message",
                    event_id: "$cmd_event",
                    room_id: roomId,
                    sender: sender,
                    content: { body: "pk;link @bob:localhost" }
                }
            });

            // Mock prisma
            prisma.system.findUnique = jest.fn();
            prisma.accountLink.findUnique = jest.fn().mockResolvedValue(null);
            prisma.accountLink.create = jest.fn().mockResolvedValue({});
            
            const { proxyCache } = require('./services/cache');
            proxyCache.getSystemRules.mockResolvedValue({
                id: "s1",
                slug: "seraphim",
                members: []
            });

            await handleEvent(req as any, undefined, mockBridge as any, prisma, false, "mock_token");

            expect(prisma.accountLink.create).toHaveBeenCalledWith({
                data: { matrixId: "@bob:localhost", systemId: "s1" }
            });
        });

        it('pk;link should FAIL if target already has members', async () => {
            const req = new Request({
                data: {
                    type: "m.room.message",
                    event_id: "$cmd_event",
                    room_id: roomId,
                    sender: sender,
                    content: { body: "pk;link @bob:localhost" }
                }
            });

            prisma.accountLink.findUnique = jest.fn().mockResolvedValue({
                systemId: "s2",
                system: { members: [{ id: "m1" }], accountLinks: [{ matrixId: "@bob:localhost" }] }
            });
            
            const { proxyCache } = require('./services/cache');
            proxyCache.getSystemRules.mockResolvedValue({ id: "s1", members: [] });

            await handleEvent(req as any, undefined, mockBridge as any, prisma, false, "mock_token");

            const { sendEncryptedEvent } = require('./crypto/encryption');
            expect(sendEncryptedEvent).toHaveBeenCalledWith(
                expect.anything(),
                roomId,
                "m.room.message",
                expect.objectContaining({ body: expect.stringContaining("already belongs to a system with members") }),
                expect.anything(),
                expect.anything()
            );
        });

        it('pk;unlink should remove the link', async () => {
            const req = new Request({
                data: {
                    type: "m.room.message",
                    event_id: "$cmd_event",
                    room_id: roomId,
                    sender: sender,
                    content: { body: "pk;unlink @bob:localhost" }
                }
            });

            const { proxyCache } = require('./services/cache');
            proxyCache.getSystemRules.mockResolvedValue({ id: "s1", members: [] });

            prisma.accountLink.findUnique = jest.fn().mockResolvedValue({ matrixId: "@bob:localhost", systemId: "s1" });
            prisma.accountLink.delete = jest.fn().mockResolvedValue({});
            prisma.accountLink.count = jest.fn().mockResolvedValue(1);

            await handleEvent(req as any, undefined, mockBridge as any, prisma, false, "mock_token");

            expect(prisma.accountLink.delete).toHaveBeenCalledWith({
                where: { matrixId: "@bob:localhost" }
            });
        });

        it('pk;unlink should delete the system if no links remain', async () => {
            const req = new Request({
                data: {
                    type: "m.room.message",
                    event_id: "$cmd_event",
                    room_id: roomId,
                    sender: sender,
                    content: { body: "pk;unlink @bob:localhost" }
                }
            });

            const { proxyCache } = require('./services/cache');
            proxyCache.getSystemRules.mockResolvedValue({ id: "s1", members: [] });

            prisma.accountLink.findUnique = jest.fn().mockResolvedValue({ matrixId: "@bob:localhost", systemId: "s1" });
            prisma.accountLink.delete = jest.fn();
            prisma.accountLink.count = jest.fn().mockResolvedValue(0);
            prisma.system.delete = jest.fn();

            await handleEvent(req as any, undefined, mockBridge as any, prisma, false, "mock_token");

            expect(prisma.accountLink.delete).toHaveBeenCalledWith({ where: { matrixId: "@bob:localhost" } });
            expect(prisma.system.delete).toHaveBeenCalledWith({ where: { id: "s1" } });
        });

        it('pk;unlink should prevent self-unlinking', async () => {
            const req = new Request({
                data: {
                    type: "m.room.message",
                    event_id: "$cmd_event",
                    room_id: roomId,
                    sender: sender,
                    content: { body: `pk;unlink ${sender}` }
                }
            });

            const { proxyCache } = require('./services/cache');
            proxyCache.getSystemRules.mockResolvedValue({ id: "s1", members: [] });

            await handleEvent(req as any, undefined, mockBridge as any, prisma, false, "mock_token");

            const { sendEncryptedEvent } = require('./crypto/encryption');
            expect(sendEncryptedEvent).toHaveBeenCalledWith(
                expect.anything(),
                roomId,
                "m.room.message",
                expect.objectContaining({ body: expect.stringContaining("cannot unlink your own primary account") }),
                expect.anything(),
                expect.anything()
            );
        });

        it('pk;link should show usage error if no argument', async () => {
            const req = new Request({
                data: {
                    type: "m.room.message",
                    event_id: "$cmd_event",
                    room_id: roomId,
                    sender: sender,
                    content: { body: "pk;link" }
                }
            });

            await handleEvent(req as any, undefined, mockBridge as any, prisma, false, "mock_token");

            const { sendEncryptedEvent } = require('./crypto/encryption');
            expect(sendEncryptedEvent).toHaveBeenCalledWith(
                expect.anything(),
                roomId,
                "m.room.message",
                expect.objectContaining({ body: expect.stringContaining("Usage: `pk;link") }),
                expect.anything(),
                expect.anything()
            );
        });
        it('pk;link primary <mxid> should set the primary account', async () => {
            const targetMxid = "@bob:localhost";
            const req = new Request({
                data: {
                    type: "m.room.message",
                    event_id: "$cmd_event",
                    room_id: roomId,
                    sender: sender,
                    content: { body: `pk;link primary ${targetMxid}` }
                }
            });

            const { proxyCache } = require('./services/cache');
            proxyCache.getSystemRules.mockResolvedValue({
                id: "s1",
                slug: "seraphim",
                members: []
            });

            prisma.accountLink.findUnique = jest.fn().mockResolvedValue({ matrixId: targetMxid, systemId: "s1" });
            prisma.$transaction = jest.fn().mockResolvedValue([]);

            await handleEvent(req as any, undefined, mockBridge as any, prisma, false, "mock_token");

            expect(prisma.$transaction).toHaveBeenCalled();
            const { sendEncryptedEvent } = require('./crypto/encryption');
            expect(sendEncryptedEvent).toHaveBeenCalledWith(
                expect.anything(),
                roomId,
                "m.room.message",
                expect.objectContaining({ body: expect.stringContaining(`is now the primary routing account`) }),
                expect.anything(),
                expect.anything()
            );
        });
    });
});
