import { AppServiceRegistration, Bridge, Request, WeakEvent, BridgeContext, Intent, AppService } from "matrix-appservice-bridge";
import { PrismaClient } from "@prisma/client";
import * as yaml from "js-yaml";
import * as fs from "fs";
import * as path from "path";
import { config } from "./config";
import { proxyCache } from "./services/cache";
import { emitSystemUpdate } from "./services/events";
import { maskMxid } from "./utils/privacy";
import { OlmMachineManager } from "./crypto/OlmMachineManager";
import { TransactionRouter } from "./crypto/TransactionRouter";
import { DeviceLists } from "@matrix-org/matrix-sdk-crypto-nodejs";
import { processCryptoRequests, registerDevice } from "./crypto/crypto-utils";
import { messageQueue } from "./services/queue/MessageQueue";
import { CommandHandler } from "./services/commandHandler";
import { parseCommand } from "./utils/commandParser";
import { parseProxyMatch } from "./utils/proxyParser";

// Configuration
const REGISTRATION_PATH = "/data/app-service-registration.yaml";
const HOMESERVER_URL = config.synapseUrl;
const DOMAIN = config.synapseDomain;

// Initialize Prisma
export const prisma = new PrismaClient();
// Initialize Crypto Manager
export const cryptoManager = new OlmMachineManager();
// Store AS token for crypto requests
export let asToken: string;

/**
 * Sets the global Appservice token (Used for testing and initialization)
 */
export const setAsToken = (token: string) => {
    asToken = token;
};

// Placeholder for the bridge instance
let bridge: Bridge;
export const getBridge = () => bridge;

// Command Handler Instance
export let commandHandler: CommandHandler;

/**
 * Initializes the global command handler.
 */
export const initCommandHandler = (bridgeInstance: Bridge, prismaClient: PrismaClient, cryptoManagerInstance: OlmMachineManager, token: string, domainStr: string) => {
    commandHandler = new CommandHandler(bridgeInstance, prismaClient, cryptoManagerInstance, token, domainStr);
};

export const handleEvent = async (request: Request<WeakEvent>, context: BridgeContext | undefined, bridgeInstance: Bridge, prismaClient: PrismaClient, isDecrypted: boolean = false, asTokenArg?: string) => {

    const currentAsToken = asTokenArg || asToken;
    const event = request.getData();
    const eventId = event.event_id!;
    const roomId = event.room_id!;
    const sender = event.sender;
    
    // Member Event Handling (Invites and Joins)
    if (event.type === "m.room.member") {
        const targetUserId = event.state_key!;
        const membership = event.content.membership;
        const botUserId = bridgeInstance.getBot().getUserId();

        // 1. Case: Invite Handling
        if (membership === "invite") {
            // Main Bot invited
            if (targetUserId === botUserId) {
                console.log(`[Bot] Received invite to ${roomId} from ${maskMxid(sender)}. Joining...`);
                try {
                    await bridgeInstance.getIntent().join(roomId);
                    console.log(`[Bot] Successfully joined ${roomId}`);
                } catch (e: any) {
                    console.error(`[Bot] Failed to join ${roomId}:`, e.message);
                }
                return;
            }

            // Managed Ghost invited
            if (targetUserId.startsWith("@_plural_")) {
                console.log(`[Ghost] ${targetUserId} received invite to ${roomId}. Implementing auto-forwarding...`);
                const ghostIntent = bridgeInstance.getIntent(targetUserId);
                
                try {
                    // Ghost Joins
                    await ghostIntent.join(roomId);

                    // Find the system this ghost belongs to
                    const parts = targetUserId.split(":")[0].split("_");
                    const systemSlug = parts[2];
                    
                    const system = await prismaClient.system.findUnique({
                        where: { slug: systemSlug },
                        include: { accountLinks: true }
                    });

                    if (system) {
                        const isOwnerInviting = system.accountLinks.some(l => l.matrixId.toLowerCase() === sender.toLowerCase());
                        const primaryLink = system.accountLinks.find(l => l.isPrimary) || system.accountLinks[0];
                        
                        if (primaryLink) {
                            // 1. Set Room Name: "[Sender Name], [Ghost Name]"
                            try {
                                const senderProfile = await (ghostIntent as any).matrixClient.getUserProfile(sender);
                                const ghostProfile = await (ghostIntent as any).matrixClient.getUserProfile(targetUserId);
                                const senderName = senderProfile.displayname || sender;
                                const ghostName = ghostProfile.displayname || targetUserId;
                                const roomName = `${senderName}, ${ghostName}`;
                                
                                // Match found: Setting room name
                                console.log(`[Ghost] Setting room name in ${roomId}`);
                                await ghostIntent.setRoomName(roomId, roomName);
                            } catch (e: any) {
                                console.warn(`[Ghost] Failed to set room name in ${roomId}:`, e.message);
                            }

                            if (!isOwnerInviting) {
                                console.log(`[Ghost] Inviting primary account ${primaryLink.matrixId} and bot to ${roomId}`);
                                try {
                                    await ghostIntent.invite(roomId, primaryLink.matrixId);
                                } catch (e: any) {
                                    console.warn(`[Ghost] Failed to invite primary account (already in room?):`, e.message);
                                }
                            } else {
                                console.log(`[Ghost] Owner ${maskMxid(sender)} invited managed ghost. Skipping owner invite, inviting bot.`);
                            }
                            
                            // 2. Invite PluralBot
                            await ghostIntent.invite(roomId, botUserId);
                            
                            // Force Bot to join immediately (Don't wait for invite event loopback)
                            setTimeout(async () => {
                                try {
                                    await bridgeInstance.getIntent().join(roomId);
                                    console.log(`[Bot] Joined ${roomId} via ghost-triggered join.`);
                                } catch (e: any) {
                                    console.warn(`[Bot] Immediate join failed (might already be in room):`, e.message);
                                }
                            }, 500);
    
                            // 3. Pre-emptively promote system (Bot & Owner) to Admin
                            await commandHandler.promoteSystemPowerLevels(roomId, targetUserId);

                            if (!isOwnerInviting) {
                                // 4. Set Room Topic: Temporary notice until owner arrives
                                try {
                                    await ghostIntent.setRoomTopic(roomId, "PluralMatrix: Waiting for account owner to join...");
                                } catch (e: any) {
                                    console.warn(`[Ghost] Failed to set room topic in ${roomId}:`, e.message);
                                }
                            }
                        }
                    }
                } catch (e: any) {
                    console.error(`[Ghost] Auto-forwarding failed for ${targetUserId} in ${roomId}:`, e.message);
                }
                return;
            }
        }

        // 2. Case: Join Handling (Power level promotion & Topic clearing)
        if (membership === "join") {
            try {
                const members = await (bridgeInstance.getBot().getClient() as any).getJoinedRoomMembers(roomId);
                const ghostInRoom = members.find((m: string) => m.startsWith("@_plural_"));
                
                if (ghostInRoom) {
                    const parts = ghostInRoom.split(":")[0].split("_");
                    const systemSlug = parts[2];
                    const system = await prismaClient.system.findUnique({
                        where: { slug: systemSlug },
                        include: { accountLinks: true }
                    });

                    if (system) {
                        const primaryUser = system.accountLinks.find(l => l.isPrimary)?.matrixId || system.accountLinks[0].matrixId;
                        if (targetUserId === primaryUser) {
                            try {
                                const ghostIntent = bridgeInstance.getIntent(ghostInRoom);
                                await ghostIntent.setRoomTopic(roomId, "");
                                console.log(`[Ghost] Cleared room topic in ${roomId} as primary user ${targetUserId} has joined.`);
                            } catch (topicErr: any) {}
                        }
                    }
                }
            } catch (e) {}
        }
    }

    // Reaction deletion logic
    if (event.type === "m.reaction") {
        const relatesTo = event.content?.["m.relates_to"] as any;
        if (relatesTo?.rel_type === "m.annotation") {
            const reaction = relatesTo.key;
            if (reaction?.includes("❌") || reaction?.toLowerCase() === "x" || reaction?.toLowerCase() === ":x:") {
                const targetEventId = relatesTo.event_id;
                const system = await proxyCache.getSystemRules(sender, prismaClient);
                if (!system) return;

                try {
                    const targetEvent = await (bridgeInstance.getBot().getClient() as any).getEvent(roomId, targetEventId);
                    if (targetEvent && targetEvent.sender.startsWith(`@_plural_${system.slug}_`)) {
                        console.log(`[Janitor] Deleting message ${targetEventId} via reaction from ${maskMxid(sender)}`);
                        await commandHandler.safeRedact(roomId, targetEventId, "UserRequest", bridgeInstance.getIntent(targetEvent.sender));
                        await commandHandler.safeRedact(roomId, eventId, "Cleanup");
                    }
                } catch (e: any) {
                    console.error(`[Janitor] Error handling reaction deletion:`, e.message);
                }
            }
        }
        return;
    }

    if (event.type === "m.room.encrypted" && !isDecrypted) return;
    if (event.type !== "m.room.message" && !isDecrypted) return;
    
    const content = event.content as any;
    if (!content) return;

    let body = content.body as string; 
    let isEdit = false;
    let originalEventId = eventId;
    let originalEvent: any = null;

    if (content["m.new_content"] && content["m.relates_to"]?.rel_type === "m.replace") {
        body = content["m.new_content"].body;
        isEdit = true;
        originalEventId = content["m.relates_to"].event_id || content["m.relates_to"].id;
    }

    if (body === undefined || body === null) return;

    const botUserId = bridgeInstance.getBot().getUserId();
    if (sender === botUserId || sender.startsWith("@_plural_")) return;

    // Edit Loop Prevention
    if (isEdit) {
        try {
            originalEvent = await (bridgeInstance.getBot().getClient() as any).getEvent(roomId, originalEventId);
            const redactedBy = originalEvent?.unsigned?.redacted_by;
            if (redactedBy === botUserId || redactedBy?.startsWith("@_plural_")) return;
        } catch (e) { }
    }

    // --- ZERO-FLASH: REDACT EMPTY MESSAGES (MOD-CLEARED) ---
    if (body.trim() === "") {
        console.log(`[Janitor] Redacting module-cleared message ${eventId} in ${roomId}`);
        await commandHandler.safeRedact(roomId, eventId, "ZeroFlash");
        return;
    }

    // --- Command handling ---
    const parsedCommand = parseCommand(body, content?.formatted_body);
    if (parsedCommand) {
        const { cmd, parts } = parsedCommand;
        const system = await proxyCache.getSystemRules(sender, prismaClient);

        const handled = await commandHandler.handleCommand(event, cmd, parts, system);
        if (handled) return;
    }
    
    // --- Janitor Logic (Proxying) ---
    const system = await proxyCache.getSystemRules(sender, prismaClient);
    if (!system) return;

    // Escape hatch for autoproxy/proxying
    if (body.startsWith("\\")) return;

    const proxyMatch = parseProxyMatch(content, system, isEdit ? originalEvent?.content : undefined);
    
    if (proxyMatch) {
        const { targetMember, cleanBody, cleanFormattedBody, wasAutoproxied } = proxyMatch as any;
        const format = cleanFormattedBody ? "org.matrix.custom.html" : undefined;

        // If latch mode is enabled and this was NOT an autoproxy (i.e. they explicitly used a tag), latch them
        if (system.autoproxyMode === "latch" && !wasAutoproxied) {
            // Only update if it's actually a change to avoid unnecessary DB writes
            if (system.autoproxyId !== targetMember.id) {
                try {
                    await prismaClient.system.update({
                        where: { id: system.id },
                        data: { autoproxyId: targetMember.id }
                    });
                    proxyCache.invalidate(sender);
                    emitSystemUpdate(sender);
                } catch (e) {
                    console.error("[Bot] Failed to latch autoproxy:", e);
                }
            }
        }

        // If it's an edit, redact the original root event (Matrix server will cascade redact all associated m.replace edits)
        // If it's a new message, redact the event itself
        const targetRedactionId = isEdit ? originalEventId : eventId;
        await commandHandler.safeRedact(roomId, targetRedactionId, "PluralProxy");
        
        try {
            const ghostUserId = `@_plural_${system.slug}_${targetMember.slug}:${DOMAIN}`;
            const intent = bridgeInstance.getIntent(ghostUserId);
            const finalDisplayName = system.systemTag ? `${targetMember.displayName || targetMember.name} ${system.systemTag}` : (targetMember.displayName || targetMember.name);

            await intent.ensureRegistered();
            try { await intent.join(roomId); } catch (e) {
                try { await bridgeInstance.getIntent().invite(roomId, ghostUserId); await intent.join(roomId); } catch (e2) {}
            }

            const machine = await cryptoManager.getMachine(ghostUserId);
            await registerDevice(intent, machine.deviceId.toString(), prismaClient, targetMember.id);

            try { await intent.setDisplayName(finalDisplayName); if (targetMember.avatarUrl) await intent.setAvatarUrl(targetMember.avatarUrl); } catch (e) {}

            let relatesTo: any = undefined;
            // If it's an edit, we want the *original* event's relations (e.g. what it was replying to)
            // since the edit event itself only contains the m.replace relation.
            const sourceContent = isEdit && originalEvent?.content ? originalEvent.content : event.content;
            
            if (sourceContent["m.relates_to"]) {
                relatesTo = { ...sourceContent["m.relates_to"] } as any;
                if (relatesTo.rel_type === "m.replace") { delete relatesTo.rel_type; delete relatesTo.event_id; }
                if (Object.keys(relatesTo).length === 0) relatesTo = undefined;
            }

            messageQueue.enqueue(roomId, sender, intent, cleanBody, relatesTo, prismaClient, system.slug, format, cleanFormattedBody, proxyMatch.fullContent);
        } catch (e) {}
        return;
    }
};

export const startMatrixBot = async () => {
    const reg = yaml.load(fs.readFileSync(REGISTRATION_PATH, 'utf8')) as AppServiceRegistration;
    asToken = (reg as any).as_token;

    bridge = new Bridge({
        homeserverUrl: HOMESERVER_URL,
        domain: DOMAIN,
        registration: REGISTRATION_PATH,
        roomStore: "./data/room-store.db",
        userStore: "./data/user-store.db",
        userActivityStore: "./data/user-activity-store.db",
        intentOptions: { clients: { dontCheckPowerLevel: true } },
        controller: {
            onUserQuery: () => ({}),
            onEvent: async (request: Request<WeakEvent>) => { await handleEvent(request, undefined, bridge, prisma); }
        }
    });

    console.log("Starting Matrix Bridge...");
    await bridge.initialise();
    cryptoManager.setContext(bridge, asToken);

    // Initialize Command Handler
    initCommandHandler(bridge, prisma, cryptoManager, asToken, DOMAIN);

    const botUserId = bridge.getBot().getUserId();
    
    // Setup Transaction Interception for E2EE
    const router = new TransactionRouter(cryptoManager, botUserId, 
        async (userId) => {
            const machine = await cryptoManager.getMachine(userId);
            const intent = bridge.getIntent(userId);
            const { memberId, systemId } = await commandHandler.resolveIdentity(userId);
            await registerDevice(intent, machine.deviceId.toString(), prisma, memberId, systemId);
            await processCryptoRequests(machine, intent, asToken);
        },
        async (decryptedEvent) => {
            await handleEvent({ getData: () => decryptedEvent } as any, undefined, bridge, prisma, true, asToken);
        }
    );

    // Initial Key Upload for Bot (MSC3202)
    console.log("[Crypto] Performing initial identity sync for Bot...");
    const botMachine = await cryptoManager.getMachine(botUserId);
    const botIntent = bridge.getIntent(botUserId);
    
    const { systemId } = await commandHandler.resolveIdentity(botUserId);
    await registerDevice(botIntent, botMachine.deviceId.toString(), prisma, undefined, systemId);
    await botMachine.receiveSyncChanges("[]", new DeviceLists(), {}, []);
    await processCryptoRequests(botMachine, botIntent, asToken);

    // Explicitly register the bot as an AS user
    const botLocalpart = botUserId.split(":")[0].substring(1);
    try {
        await (botIntent as any).botSdkIntent.underlyingClient.doRequest(
            "POST",
            "/_matrix/client/v3/register",
            null,
            {
                type: "m.login.application_service",
                username: botLocalpart
            }
        );
        console.log(`[Bot] Registered ${botUserId} as Application Service user`);
    } catch (e: any) {
        if (e.message?.includes("M_USER_IN_USE")) {
            console.log(`[Bot] ${botUserId} is already registered`);
        } else {
            console.warn(`[Bot] Registration attempt failed: ${e.message}`);
        }
    }

    // Set Bot Avatar if it exists (lily_avatar.png) and is not already set
    const avatarPath = fs.existsSync(path.join(__dirname, "../assets/images/lily_avatar.png"))
        ? path.join(__dirname, "../assets/images/lily_avatar.png")
        : path.join(__dirname, "../../assets/images/lily_avatar.png");

    if (fs.existsSync(avatarPath)) {
        try {
            const botIntent = bridge.getIntent();
            const profile = await botIntent.getProfileInfo(botUserId);
            
            if (!profile.avatar_url) {
                console.log(`[Bot] Bot has no avatar. Found lily_avatar.png, uploading to MXC...`);
                const avatarData = fs.readFileSync(avatarPath);
                const mxcUrl = await bridge.getBot().getClient().uploadContent(avatarData, "image/png", "lily_avatar.png");
                await botIntent.setAvatarUrl(mxcUrl);
                console.log(`[Bot] Successfully set bot avatar to ${mxcUrl}`);
            } else {
                console.log(`[Bot] Bot already has an avatar set (${profile.avatar_url}). Skipping auto-upload.`);
            }
        } catch (e: any) {
            console.warn(`[Bot] Failed to check/set bot avatar: ${e.message}`);
        }
    }

    const appServiceInstance = new AppService({ homeserverToken: (reg as any).hs_token });
    const app = appServiceInstance.app as any;
    app.use(async (req: any, res: any, next: any) => {
        if (req.method === 'PUT' && req.path.includes('/transactions/')) {
            try { await router.processTransaction(req.body); } catch (e) { console.error("[Router] Error:", e); }
        }
        next();
    });

    if (app._router?.stack) {
        const stack = app._router.stack;
        const myLayer = stack.pop();
        const insertionIndex = stack.findIndex((l: any) => l.route);
        if (insertionIndex !== -1) stack.splice(insertionIndex, 0, myLayer);
        else stack.unshift(myLayer);
    }

    await bridge.listen(8008, "0.0.0.0", 10, appServiceInstance);
    await joinPendingInvites(bridge);
};

const joinPendingInvites = async (bridgeInstance: Bridge) => {
    try {
        const botClient = bridgeInstance.getBot().getClient();
        const syncData = await botClient.doRequest("GET", "/_matrix/client/v3/sync", { filter: '{"room":{"timeline":{"limit":1}}}' });
        if (syncData.rooms?.invite) {
            for (const roomId of Object.keys(syncData.rooms.invite)) {
                try { await bridgeInstance.getIntent().join(roomId); } catch (e) {}
            }
        }
    } catch (e) {}
};
