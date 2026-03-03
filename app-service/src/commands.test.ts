import { CommandHandler } from './services/commandHandler';
import { RoomId } from '@matrix-org/matrix-sdk-crypto-nodejs';

describe('CommandHandler Tests', () => {
    let commandHandler: CommandHandler;
    let mockBridge: any;
    let mockPrisma: any;
    let mockCryptoManager: any;
    let mockBotClient: any;
    const asToken = "mock_token";
    const domain = "localhost";

    beforeEach(() => {
        jest.clearAllMocks();

        mockBotClient = {
            getUserId: jest.fn().mockReturnValue('@plural_bot:localhost'),
            uploadContent: jest.fn().mockResolvedValue('mxc://mock/avatar'),
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

        mockBridge = {
            getBot: jest.fn().mockReturnValue({
                getUserId: () => "@plural_bot:localhost",
                getClient: () => mockBotClient,
                getIntent: () => createMockIntent("@plural_bot:localhost")
            }),
            getIntent: jest.fn().mockImplementation((userId) => createMockIntent(userId || "@plural_bot:localhost"))
        };

        mockPrisma = {
            system: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
                create: jest.fn()
            },
            member: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                update: jest.fn(),
                delete: jest.fn()
            },
            accountLink: {
                findUnique: jest.fn(),
                findFirst: jest.fn(),
                findMany: jest.fn(),
                create: jest.fn(),
                delete: jest.fn(),
                update: jest.fn(),
                updateMany: jest.fn(),
                count: jest.fn()
            },
            $transaction: jest.fn(p => Promise.all(p))
        };

        mockCryptoManager = {
            getMachine: jest.fn().mockResolvedValue({
                deviceId: { toString: () => "MOCK_DEVICE" },
                decryptRoomEvent: jest.fn().mockResolvedValue({
                    event: JSON.stringify({ type: "m.room.message", content: { body: "Decrypted Text" } })
                }),
                receiveSyncChanges: jest.fn().mockResolvedValue(undefined),
                updateTrackedUsers: jest.fn().mockResolvedValue(undefined),
                getMissingSessions: jest.fn().mockResolvedValue(undefined),
                shareRoomKey: jest.fn().mockResolvedValue([]),
                encryptRoomEvent: jest.fn().mockResolvedValue(JSON.stringify({ content: { body: "Encrypted" } })),
                outgoingRequests: jest.fn().mockResolvedValue([])
            })
        };

        commandHandler = new CommandHandler(mockBridge, mockPrisma, mockCryptoManager, asToken, domain);
    });

    const mockSystem = {
        id: "sys123",
        slug: "seraphim",
        members: [
            { id: "mem1", slug: "lily", name: "Lily", matrixId: "@_plural_seraphim_lily:localhost", proxyTags: [{ prefix: "lily:", suffix: "" }] }
        ]
    };

    describe('executeTargetingCommand', () => {
        it('should find the ROOT ID even if the latest event is an edit', async () => {
            const rootId = "$root_event";
            const editId = "$edit_event";
            const roomId = "!room:localhost";

            // Mock scrollback: root followed by edit
            mockBotClient.doRequest.mockResolvedValue({
                chunk: [
                    {
                        event_id: editId,
                        sender: "@_plural_seraphim_lily:localhost",
                        type: "m.room.message",
                        content: { 
                            "m.new_content": { body: "new text" },
                            "m.relates_to": { rel_type: "m.replace", event_id: rootId }
                        }
                    },
                    {
                        event_id: rootId,
                        sender: "@_plural_seraphim_lily:localhost",
                        type: "m.room.message",
                        content: { body: "original text" }
                    }
                ]
            });

            const event = { room_id: roomId, sender: "@alice:localhost", event_id: "$cmd_event" };
            await commandHandler.executeTargetingCommand(event, "pk;message -delete", mockSystem);

            // Should redact the ROOT event
            expect(mockBotClient.redactEvent).toHaveBeenCalledWith(roomId, rootId, expect.anything());
        });

        it('should correctly resolve chained edits from history', async () => {
            const rootId = "$root";
            const edit2Id = "$edit2";
            const roomId = "!room:localhost";

            mockBotClient.doRequest.mockResolvedValue({
                chunk: [
                    {
                        event_id: edit2Id,
                        sender: "@_plural_seraphim_lily:localhost",
                        type: "m.room.message",
                        content: { "m.new_content": { body: "final text" }, "m.relates_to": { rel_type: "m.replace", event_id: rootId } }
                    },
                    {
                        event_id: rootId,
                        sender: "@_plural_seraphim_lily:localhost",
                        type: "m.room.message",
                        content: { body: "start text" }
                    }
                ]
            });

            const event = { room_id: roomId, sender: "@alice:localhost", event_id: "$cmd_event" };
            await commandHandler.executeTargetingCommand(event, "pk;edit newer text", mockSystem);

            // Verify crypto getMachine was called for the ghost to send the edit
            expect(mockCryptoManager.getMachine).toHaveBeenCalledWith("@_plural_seraphim_lily:localhost");
        });
    });

    describe('handleCommand', () => {
        it('pk;list should show member list', async () => {
            const event = { room_id: "!room:localhost", sender: "@alice:localhost" };
            const parts = ["pk;list"];
            
            await commandHandler.handleCommand(event, "list", parts, mockSystem);

            // Should call resolveIdentity for the bot (to send encrypted response)
            expect(mockPrisma.system.findFirst).toHaveBeenCalled();
        });

        it('pk;link should create a new link', async () => {
            const event = { room_id: "!room:localhost", sender: "@alice:localhost" };
            const parts = ["pk;link", "@bob:localhost"];
            
            mockPrisma.accountLink.findUnique.mockResolvedValue(null);
            
            await commandHandler.handleCommand(event, "link", parts, mockSystem);

            expect(mockPrisma.accountLink.create).toHaveBeenCalledWith({
                data: { matrixId: "@bob:localhost", systemId: "sys123" }
            });
        });

        it('pk;unlink should remove a link', async () => {
            const event = { room_id: "!room:localhost", sender: "@alice:localhost" };
            const parts = ["pk;unlink", "@bob:localhost"];
            
            mockPrisma.accountLink.findUnique.mockResolvedValue({ matrixId: "@bob:localhost", systemId: "sys123" });
            mockPrisma.accountLink.count.mockResolvedValue(1); // One left AFTER delete (heuristic check)
            
            await commandHandler.handleCommand(event, "unlink", parts, mockSystem);

            expect(mockPrisma.accountLink.delete).toHaveBeenCalledWith({
                where: { matrixId: "@bob:localhost" }
            });
        });

        it('pk;autoproxy should update autoproxyId', async () => {
            const event = { room_id: "!room:localhost", sender: "@alice:localhost" };
            const parts = ["pk;autoproxy", "lily"];
            
            await commandHandler.handleCommand(event, "autoproxy", parts, mockSystem);

            expect(mockPrisma.system.update).toHaveBeenCalledWith({
                where: { id: "sys123" },
                data: { autoproxyId: "mem1" }
            });
        });
    });
});
