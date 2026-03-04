import { CommandHandler } from './services/commandHandler';
import { RoomId } from '@matrix-org/matrix-sdk-crypto-nodejs';
import { lastMessageCache } from './services/cache';

jest.mock('./services/cache', () => ({
    proxyCache: { invalidate: jest.fn(), getSystemRules: jest.fn() },
    lastMessageCache: {
        get: jest.fn(),
        set: jest.fn(),
        delete: jest.fn()
    }
}));

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
            getUserProfile: jest.fn(),
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
        ],
        accountLinks: [{ matrixId: "@alice:localhost", isPrimary: true }]
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
            mockBotClient.getUserProfile.mockResolvedValue({ displayname: "Bob" });
            
            await commandHandler.handleCommand(event, "link", parts, mockSystem);

            expect(mockPrisma.accountLink.create).toHaveBeenCalledWith({
                data: { matrixId: "@bob:localhost", systemId: "sys123" }
            });
        });

        it('pk;link should fail if profile does not exist', async () => {
            const event = { room_id: "!room:localhost", sender: "@alice:localhost" };
            const parts = ["pk;link", "@nonexistent:localhost"];
            
            mockBotClient.getUserProfile.mockRejectedValue({ errcode: "M_NOT_FOUND" });
            
            await commandHandler.handleCommand(event, "link", parts, mockSystem);

            expect(mockPrisma.accountLink.create).not.toHaveBeenCalled();
            // Should send an error message
            expect(mockCryptoManager.getMachine).toHaveBeenCalledWith("@plural_bot:localhost");
        });

        it('pk;unlink should remove a link', async () => {
            const event = { room_id: "!room:localhost", sender: "@alice:localhost" };
            const parts = ["pk;unlink", "@bob:localhost"];
            
            mockPrisma.accountLink.findUnique.mockResolvedValue({ matrixId: "@bob:localhost", systemId: "sys123" });
            mockPrisma.accountLink.count.mockResolvedValue(2); // Must be > 1 to allow unlinking
            
            await commandHandler.handleCommand(event, "unlink", parts, mockSystem);

            expect(mockPrisma.accountLink.delete).toHaveBeenCalledWith({
                where: { matrixId: "@bob:localhost" }
            });
        });

        it('pk;message -delete should invalidate cache if target is current last message', async () => {
            const roomId = "!room:localhost";
            const rootId = "$root";
            const ghostUserId = "@_plural_seraphim_lily:localhost";
            const event = { room_id: roomId, sender: "@alice:localhost" };
            
            // Mock identity resolution
            mockPrisma.member.findFirst.mockResolvedValue({ id: "mem1", systemId: "sys123" });

            // Mock cache hit for this exact message
            (lastMessageCache.get as jest.Mock).mockReturnValue({ 
                rootEventId: rootId, 
                latestEventId: rootId, 
                sender: ghostUserId, 
                latestContent: { body: "del me" } 
            });

            await commandHandler.executeTargetingCommand(event, "pk;message -delete", mockSystem);

            expect(mockBotClient.redactEvent).toHaveBeenCalledWith(roomId, rootId, expect.anything());
            // Should invalidate cache
            expect(lastMessageCache.delete).toHaveBeenCalledWith(roomId, "seraphim");
        });

        it('pk;reproxy should invalidate cache', async () => {
            const roomId = "!room:localhost";
            const rootId = "$root";
            const ghostUserId = "@_plural_seraphim_lily:localhost";
            const event = { room_id: roomId, sender: "@alice:localhost" };
            
            mockPrisma.member.findFirst.mockResolvedValue({ id: "mem1", systemId: "sys123" });

            // Mock cache hit
            (lastMessageCache.get as jest.Mock).mockReturnValue({ 
                rootEventId: rootId, 
                latestEventId: rootId, 
                sender: ghostUserId, 
                latestContent: { body: "reproxy me" } 
            });

            // Reproxy to a hypothetical member 'bob'
            const systemWithBob = {
                ...mockSystem,
                members: [...mockSystem.members, { id: "mem2", slug: "bob", name: "Bob", matrixId: "@_plural_seraphim_bob:localhost" }]
            };

            await commandHandler.executeTargetingCommand(event, "pk;rp bob", systemWithBob);

            expect(mockBotClient.redactEvent).toHaveBeenCalledWith(roomId, rootId, expect.anything());
            expect(lastMessageCache.delete).toHaveBeenCalledWith(roomId, "seraphim");
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

    describe('resolveGhostMessage', () => {
        const roomId = "!room:localhost";
        const systemSlug = "seraphim";

        it('should return data from cache if available (Fast Path)', async () => {
            const cachedData = {
                rootEventId: "$root",
                latestEventId: "$edit",
                latestContent: { body: "cached text" },
                sender: "@_plural_seraphim_lily:localhost"
            };
            (lastMessageCache.get as jest.Mock).mockReturnValue(cachedData);

            const result = await commandHandler.resolveGhostMessage(roomId, systemSlug);

            expect(result).toEqual({
                event: expect.objectContaining({ event_id: "$edit" }),
                latestContent: cachedData.latestContent,
                originalId: "$root"
            });
            // Should NOT fetch history
            expect(mockBotClient.doRequest).not.toHaveBeenCalled();
        });

        it('should fall back to history if cache is empty (Slow Path)', async () => {
            (lastMessageCache.get as jest.Mock).mockReturnValue(null);
            mockBotClient.doRequest.mockResolvedValue({ chunk: [] });

            await commandHandler.resolveGhostMessage(roomId, systemSlug);

            expect(mockBotClient.doRequest).toHaveBeenCalled();
        });
    });

    describe('getSenderSystem', () => {
        it('should return system if account link exists', async () => {
            const sender = "@newuser:localhost";
            
            // Mock DB hit
            const mockSys = { id: 'sys_new', slug: 'newuser', members: [] };
            mockPrisma.accountLink.findUnique.mockResolvedValue({
                system: mockSys
            });

            // We need to call the private method via any
            const result = await (commandHandler as any).getSenderSystem(sender);

            expect(mockPrisma.accountLink.findUnique).toHaveBeenCalledWith({
                where: { matrixId: sender },
                include: { system: { include: { members: true } } }
            });
            expect(result).toEqual(mockSys);
        });
        
        it('should return null if no link exists', async () => {
            const sender = "@newuser:localhost";
            
            // Mock DB miss
            mockPrisma.accountLink.findUnique.mockResolvedValue(null);

            // We need to call the private method via any
            const result = await (commandHandler as any).getSenderSystem(sender);

            expect(result).toBeNull();
        });
    });

    describe('promoteSystemPowerLevels', () => {
        const roomId = "!room:localhost";
        const ghostUserId = "@_plural_seraphim_lily:localhost";
        const ownerUserId = "@chiara:localhost";
        const botUserId = "@plural_bot:localhost";

        it('should promote bot and owner to match ghost level', async () => {
            // Mock ghost is PL 100, others are 0
            mockBotClient.getRoomStateEvent.mockResolvedValue({
                users: { [ghostUserId]: 100, [botUserId]: 0, [ownerUserId]: 0 },
                users_default: 0
            });

            mockPrisma.system.findUnique.mockResolvedValue({
                id: "sys123",
                slug: "seraphim",
                accountLinks: [{ matrixId: ownerUserId, isPrimary: true }]
            });

            const sendStateMock = jest.fn().mockResolvedValue({});
            mockBotClient.sendStateEvent = sendStateMock;

            await commandHandler.promoteSystemPowerLevels(roomId, ghostUserId);

            expect(sendStateMock).toHaveBeenCalledWith(roomId, "m.room.power_levels", "", expect.objectContaining({
                users: expect.objectContaining({
                    [botUserId]: 100,
                    [ownerUserId]: 100
                })
            }));
        });

        it('should do nothing if ghost has no authority (PL < 50)', async () => {
            mockBotClient.getRoomStateEvent.mockResolvedValue({
                users: { [ghostUserId]: 0 },
                users_default: 0
            });

            const sendStateMock = jest.fn();
            mockBotClient.sendStateEvent = sendStateMock;

            await commandHandler.promoteSystemPowerLevels(roomId, ghostUserId);

            expect(sendStateMock).not.toHaveBeenCalled();
        });

        it('should do nothing if bot and owner are already promoted', async () => {
            mockBotClient.getRoomStateEvent.mockResolvedValue({
                users: { [ghostUserId]: 100, [botUserId]: 100, [ownerUserId]: 100 },
                users_default: 0
            });

            const sendStateMock = jest.fn();
            mockBotClient.sendStateEvent = sendStateMock;

            await commandHandler.promoteSystemPowerLevels(roomId, ghostUserId);

            expect(sendStateMock).not.toHaveBeenCalled();
        });

        it('should handle Matrix API errors gracefully', async () => {
            mockBotClient.getRoomStateEvent.mockRejectedValue(new Error("API Error"));
            
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
            
            await commandHandler.promoteSystemPowerLevels(roomId, ghostUserId);

            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Failed to pre-emptively promote"), "API Error");
            consoleSpy.mockRestore();
        });
    });
});
