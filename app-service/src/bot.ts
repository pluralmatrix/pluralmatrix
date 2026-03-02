import { AppServiceRegistration, Bridge, Request, WeakEvent, BridgeContext, Intent, AppService } from "matrix-appservice-bridge";
import { PrismaClient } from "@prisma/client";
import * as yaml from "js-yaml";
import * as fs from "fs";
import { marked } from "marked";
import { proxyCache } from "./services/cache";
import { emitSystemUpdate } from "./services/events";
import { ensureUniqueSlug } from "./utils/slug";
import { maskMxid } from "./utils/privacy";
import { OlmMachineManager } from "./crypto/OlmMachineManager";
import { TransactionRouter } from "./crypto/TransactionRouter";
import { DeviceLists, UserId, RoomId } from "@matrix-org/matrix-sdk-crypto-nodejs";
import { sendEncryptedEvent } from "./crypto/encryption";
import { processCryptoRequests, registerDevice } from "./crypto/crypto-utils";
import { messageQueue } from "./services/queue/MessageQueue";

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

// Helper to send plain text (Encrypted if needed)
const sendEncryptedText = async (intent: Intent, roomId: string, text: string) => {
    const userId = intent.userId;
    const machine = await cryptoManager.getMachine(userId);
    await registerDevice(intent, machine.deviceId.toString());

    return sendEncryptedEvent(intent, roomId, "m.room.message", {
        msgtype: "m.text",
        body: text
    }, cryptoManager, asToken);
};

const sendEncryptedNotice = async (intent: Intent, roomId: string, text: string) => {
    const userId = intent.userId;
    const machine = await cryptoManager.getMachine(userId);
    await registerDevice(intent, machine.deviceId.toString());

    return sendEncryptedEvent(intent, roomId, "m.room.message", {
        msgtype: "m.notice",
        body: text
    }, cryptoManager, asToken);
};

// Helper to send formatted Markdown (Encrypted if needed)
const sendRichText = async (intent: Intent, roomId: string, text: string) => {
    const userId = intent.userId;
    const machine = await cryptoManager.getMachine(userId);
    await registerDevice(intent, machine.deviceId.toString());

    const html = await marked.parse(text, { breaks: true });
    return sendEncryptedEvent(intent, roomId, "m.room.message", {
        msgtype: "m.text",
        body: text,
        format: "org.matrix.custom.html",
        formatted_body: html.trim()
    }, cryptoManager, asToken);
};

const sendEncryptedImage = async (intent: Intent, roomId: string, mxcUrl: string, name: string) => {
    const userId = intent.userId;
    const machine = await cryptoManager.getMachine(userId);
    await registerDevice(intent, machine.deviceId.toString());

    // We use m.text with HTML img tag instead of native m.image 
    // because many Matrix clients (like Cinny) show broken icons for m.image 
    // if metadata (w, h, size) is missing, and we don't always have that.
    const html = `<img src="${mxcUrl}" alt="${name}" />`;
    const body = `[Avatar: ${name}] (${mxcUrl})`;

    return sendEncryptedEvent(intent, roomId, "m.room.message", {
        msgtype: "m.text",
        body: body,
        format: "org.matrix.custom.html",
        formatted_body: html
    }, cryptoManager, asToken);
};

const getRoomMessages = async (botClient: any, roomId: string, limit: number = 50) => {
    return botClient.doRequest("GET", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`, {
        limit,
        dir: 'b'
    });
};

/**
 * Robustly resolves a target ghost message, finding its root ID and latest text.
 * Handles both plaintext and encrypted messages, explicit reply targets, and chained edits.
 */
const resolveGhostMessage = async (bridgeInstance: Bridge, botClient: any, roomId: string, systemSlug: string, explicitTargetId?: string) => {
    const scrollback = await getRoomMessages(botClient, roomId, 100);
    const rustRoomId = new RoomId(roomId);

    let targetRoot: any = null;
    let latestContent: any = null;
    const ghostPrefix = `@_plural_${systemSlug}_`;

    let rootId = explicitTargetId;

    if (rootId) {
        // Resolve explicit target (replyTo)
        try {
            let explicitEvent: any = null;
            
            try {
                // First check if the target is already in our recent scrollback to avoid network/permission errors
                explicitEvent = scrollback.chunk.find((e: any) => e.event_id === rootId || e.id === rootId);
                if (!explicitEvent) {
                    // Try fetching specifically via API if not in scrollback
                    explicitEvent = await botClient.getEvent(roomId, rootId);
                }
            } catch (apiErr: any) {
                // API fetch failed, explicitEvent will be null
            }

            if (!explicitEvent) return null;
            
            // Handle both class instances (from botClient.getEvent) and raw JSON (from scrollback)
            const eventSender = explicitEvent.sender || (explicitEvent as any).sender;
            const eventType = explicitEvent.type || (explicitEvent as any).type;
            let content = explicitEvent.content || (explicitEvent as any).content || {};
            
            // Decrypt if encrypted to check for replacement metadata
            if (eventType === "m.room.encrypted") {
                try {
                    const senderMachine = await cryptoManager.getMachine(eventSender);
                    const decrypted = await senderMachine.decryptRoomEvent(JSON.stringify(explicitEvent), rustRoomId);
                    if (decrypted.event) {
                        content = JSON.parse(decrypted.event).content;
                    }
                } catch (err: any) {}
            }
            
            const rel = content["m.relates_to"];
            if (rel?.rel_type === "m.replace") {
                rootId = rel.event_id || rel.id;
            }
            
            targetRoot = { ...explicitEvent, sender: eventSender, type: eventType, content };
            latestContent = content;
            if (!eventSender || !eventSender.startsWith(ghostPrefix)) return null;
        } catch (e: any) {
            return null;
        }
    } else {
        // Find the latest ROOT message in scrollback
        for (const e of scrollback.chunk) {
            if (e.unsigned?.redacted_by) continue;
            if (!e.sender.startsWith(ghostPrefix)) continue;

            const isEncrypted = e.type === "m.room.encrypted";
            const isPlainMessage = e.type === "m.room.message";
            if (!isEncrypted && !isPlainMessage) continue;

            let content = e.content || {};
            const rel = content["m.relates_to"] || {};
            const isReplacement = rel.rel_type === "m.replace";

            if (!isReplacement) {
                targetRoot = e;
                if (isEncrypted) {
                    try {
                        const senderMachine = await cryptoManager.getMachine(e.sender);
                        const decrypted = await senderMachine.decryptRoomEvent(JSON.stringify(e), rustRoomId);
                        if (decrypted.event) {
                            content = JSON.parse(decrypted.event).content;
                        }
                    } catch (err) {}
                }
                latestContent = content;
                rootId = e.event_id || e.id;
                break;
            }
        }
    }

    if (!targetRoot || !rootId) return null;

    // 2. Best Effort: Find LATEST edit of this root in scrollback
    for (const e of scrollback.chunk) {
        if (e.unsigned?.redacted_by) continue;
        if (e.sender !== targetRoot.sender) continue;

        let content = e.content || {};
        const rel = content["m.relates_to"] || {};
        
        // If this is an edit of our root
        if (rel.rel_type === "m.replace" && (rel.event_id === rootId || rel.id === rootId)) {
            // Decrypt using the SENDER's machine (same ghost as root)
            if (e.type === "m.room.encrypted") {
                try {
                    const senderMachine = await cryptoManager.getMachine(e.sender);
                    const decrypted = await senderMachine.decryptRoomEvent(JSON.stringify(e), rustRoomId);
                    if (decrypted.event) {
                        content = JSON.parse(decrypted.event).content;
                    }
                } catch (err) {}
            }
            latestContent = content;
            break;
        }
    }

    return { 
        event: targetRoot, 
        latestContent,
        originalId: rootId
    };
};

// Configuration
const REGISTRATION_PATH = "/data/app-service-registration.yaml";
const HOMESERVER_URL = process.env.SYNAPSE_URL || "http://localhost:8008";
const DOMAIN = process.env.SYNAPSE_DOMAIN || process.env.SYNAPSE_SERVER_NAME || "localhost";

// Placeholder for the bridge instance
let bridge: Bridge;

// Track rooms where we've already warned about missing permissions
const permissionWarnedRooms = new Set<string>();

/**
 * Safely redacts an event, attempting to use the best intent possible.
 */
const safeRedact = async (bridgeInstance: Bridge, roomId: string, eventId: string, reason: string, preferredIntent?: Intent) => {
    const intent = preferredIntent || bridgeInstance.getIntent();
    try {
        await (intent as any).matrixClient.redactEvent(roomId, eventId, reason);
    } catch (e: any) {
        if (e.errcode === 'M_FORBIDDEN' || e.httpStatus === 403) {
            try {
                // Fallback to bot intent if ghost lacked permissions
                await (bridgeInstance.getIntent() as any).matrixClient.redactEvent(roomId, eventId, reason);
            } catch (fallbackErr: any) {
                if ((fallbackErr.errcode === 'M_FORBIDDEN' || fallbackErr.httpStatus === 403) && !permissionWarnedRooms.has(roomId)) {
                    console.warn(`[Bot] Lacking redaction permissions in ${roomId}.`);
                    await sendEncryptedText(bridgeInstance.getIntent(), roomId, 
                        "⚠️ I don't have permission to redact (delete) messages in this room. " +
                        "To enable high-fidelity proxying and 'Zero-Flash' cleanup, please promote me to Moderator or give me 'Redact events' permissions."
                    );
                    permissionWarnedRooms.add(roomId);
                }
            }
        } else {
            console.error(`[Janitor] Failed to redact message ${eventId}:`, e.message || e);
        }
    }
};

/**
 * Ensures the bot and the system owner have the same power level as the ghost.
 */
const syncPowerLevels = async (bridgeInstance: Bridge, roomId: string, ghostUserId: string, prismaClient: PrismaClient) => {
    try {
        const ghostIntent = bridgeInstance.getIntent(ghostUserId);
        const botUserId = bridgeInstance.getBot().getUserId();
        
        // Get current power levels
        const state = await (ghostIntent as any).matrixClient.getRoomStateEvent(roomId, "m.room.power_levels", "");
        const users = state.users || {};
        const ghostLevel = users[ghostUserId] || state.users_default || 0;
        
        if (ghostLevel < 50) return; // Ghost can't promote if it's not at least a moderator

        // Find system primary user
        const parts = ghostUserId.split(":")[0].split("_");
        const systemSlug = parts[2];
        const system = await prismaClient.system.findUnique({
            where: { slug: systemSlug },
            include: { accountLinks: true }
        });
        if (!system) return;
        
        const primaryLink = system.accountLinks.find(l => l.isPrimary) || system.accountLinks[0];
        if (!primaryLink) return;
        const primaryUser = primaryLink.matrixId;

        let changed = false;
        const targets = [botUserId, primaryUser];
        
        for (const target of targets) {
            const currentLevel = users[target] || state.users_default || 0;
            if (currentLevel < ghostLevel) {
                users[target] = ghostLevel;
                changed = true;
            }
        }

        if (changed) {
            state.users = users;
            console.log(`[Ghost] ${ghostUserId} is promoting bot/owner to PL ${ghostLevel} in ${roomId}`);
            await (ghostIntent as any).matrixClient.sendStateEvent(roomId, "m.room.power_levels", "", state);
        }
    } catch (e: any) {
        // Silently fail if lack of permissions or state not found
        console.warn(`[Ghost] Failed to sync power levels in ${roomId}:`, e.message);
    }
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
    
                            // 3. Try to sync power levels if ghost was already promoted by the inviter
                            await syncPowerLevels(bridgeInstance, roomId, targetUserId, prismaClient);

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
            // If the joining user is the bot or a primary user, check if we need to promote them
            // We look for any ghost user already in the room to perform the promotion
            try {
                const members = await (bridgeInstance.getBot().getClient() as any).getJoinedRoomMembers(roomId);
                const ghostInRoom = members.find((m: string) => m.startsWith("@_plural_"));
                
                if (ghostInRoom) {
                    // Check if the joined user is the primary user for this ghost's system
                    const parts = ghostInRoom.split(":")[0].split("_");
                    const systemSlug = parts[2];
                    const system = await prismaClient.system.findUnique({
                        where: { slug: systemSlug },
                        include: { accountLinks: true }
                    });

                    if (system) {
                        const primaryUser = system.accountLinks.find(l => l.isPrimary)?.matrixId || system.accountLinks[0].matrixId;
                        if (targetUserId === botUserId || targetUserId === primaryUser) {
                            await syncPowerLevels(bridgeInstance, roomId, ghostInRoom, prismaClient);
                            
                            // If primary user joined, clear the temporary topic
                            if (targetUserId === primaryUser) {
                                try {
                                    const ghostIntent = bridgeInstance.getIntent(ghostInRoom);
                                    await ghostIntent.setRoomTopic(roomId, "");
                                    console.log(`[Ghost] Cleared room topic in ${roomId} as primary user ${targetUserId} has joined.`);
                                } catch (topicErr: any) {
                                    // Might fail if ghost lost PLs or topic already empty
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                // Members check might fail if bot isn't in room yet
            }
        }
    }

    // Power Level Synchronization: Watch for Ghost promotion
    if (event.type === "m.room.power_levels") {
        try {
            // Find any managed ghost in the room
            const members = await (bridgeInstance.getBot().getClient() as any).getJoinedRoomMembers(roomId);
            const ghostInRoom = members.find((m: string) => m.startsWith("@_plural_"));
            if (ghostInRoom) {
                await syncPowerLevels(bridgeInstance, roomId, ghostInRoom, prismaClient);
            }
        } catch (e) {}
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
                        await safeRedact(bridgeInstance, roomId, targetEventId, "UserRequest", bridgeInstance.getIntent(targetEvent.sender));
                        await safeRedact(bridgeInstance, roomId, eventId, "Cleanup");
                    }
                } catch (e: any) {
                    console.error(`[Janitor] Error handling reaction deletion:`, e.message);
                }
            }
        }
        return;
    }

    // Ignore raw encrypted events pushed via AS (The router handles them locally)
    if (event.type === "m.room.encrypted" && !isDecrypted) return;

    if (event.type !== "m.room.message" && !isDecrypted) return;
    
    const content = event.content as any;
    if (!content) return;

    let body = content.body as string; 
    let isEdit = false;
    let originalEventId = eventId;

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
            const originalEvent = await (bridgeInstance.getBot().getClient() as any).getEvent(roomId, originalEventId);
            const redactedBy = originalEvent?.unsigned?.redacted_by;
            if (redactedBy === botUserId || redactedBy?.startsWith("@_plural_")) return;
        } catch (e) { }
    }

    // --- ZERO-FLASH: REDACT EMPTY MESSAGES (MOD-CLEARED) ---
    if (body.trim() === "") {
        console.log(`[Janitor] Redacting module-cleared message ${eventId} in ${roomId}`);
        await safeRedact(bridgeInstance, roomId, eventId, "ZeroFlash");
        return;
    }

    // --- Command handling ---
    if (body.startsWith("pk;")) {
        const parts = body.split(" ");
        const cmd = parts[0].substring(3).toLowerCase();

        // Helper to ensure sender has a system
        const getOrCreateSenderSystem = async () => {
            const system = await proxyCache.getSystemRules(sender, prismaClient);
            if (system) return system;

            const localpart = sender.split(':')[0].substring(1);
            const slug = await ensureUniqueSlug(prismaClient, localpart);
            const newSystem = await prismaClient.system.create({
                data: {
                    slug,
                    name: `${localpart}'s System`,
                    accountLinks: {
                        create: { matrixId: sender, isPrimary: true }
                    }
                },
                include: { members: true }
            });
            proxyCache.invalidate(sender);
            return newSystem;
        };

        if (cmd === "list") {
            const system = await proxyCache.getSystemRules(sender, prismaClient);
            if (!system || system.members.length === 0) {
                await sendEncryptedText(bridgeInstance.getIntent(), roomId, "You don't have any system members registered yet.");
                return;
            }
            const sortedMembers = system.members.sort((a, b) => a.slug.localeCompare(b.slug));
            const memberList = sortedMembers.map(m => {
                const tags = m.proxyTags as any[];
                const tag = tags[0];
                const display = tag ? `\`${tag.prefix}text${tag.suffix}\`` : "None";
                return `* **${m.name}** - ${display} (id: \`${m.slug}\`)`;
            }).join("\n");
            await sendRichText(bridgeInstance.getIntent(), roomId, `### ${system.name || "Your System"} Members\n${memberList}`);
            return;
        }

        if (cmd === "link") {
            if (!parts[1]) {
                await sendEncryptedText(bridgeInstance.getIntent(), roomId, "Usage: `pk;link <@user:domain>` or `pk;link primary <@user:domain>`");
                return;
            }

            if (parts[1].toLowerCase() === "primary" && parts[2]) {
                const system = await proxyCache.getSystemRules(sender, prismaClient);
                if (!system) return;

                let targetMxid = parts[2].toLowerCase();
                if (!targetMxid.startsWith("@")) targetMxid = `@${targetMxid}`;
                if (!targetMxid.includes(":")) targetMxid = `${targetMxid}:${sender.split(":")[1]}`;

                // Verify target is linked to THIS system
                const link = await prismaClient.accountLink.findUnique({
                    where: { matrixId: targetMxid }
                });

                if (!link || link.systemId !== system.id) {
                    await sendRichText(bridgeInstance.getIntent(), roomId, `**${targetMxid}** is not linked to your system. Link it first with \`pk;link ${targetMxid}\`.`);
                    return;
                }

                // Set as primary, unset others
                await prismaClient.$transaction([
                    prismaClient.accountLink.updateMany({
                        where: { systemId: system.id },
                        data: { isPrimary: false }
                    }),
                    prismaClient.accountLink.update({
                        where: { matrixId: targetMxid },
                        data: { isPrimary: true }
                    })
                ]);

                proxyCache.invalidate(sender);
                emitSystemUpdate(sender);
                await sendRichText(bridgeInstance.getIntent(), roomId, `✅ **${targetMxid}** is now the primary routing account for this system. Direct messages sent to system members will be forwarded here.`);
                return;
            }

            const system = await getOrCreateSenderSystem();
            let targetMxid = parts[1].toLowerCase();
            if (!targetMxid.startsWith("@")) targetMxid = `@${targetMxid}`;
            if (!targetMxid.includes(":")) {
                const domain = sender.split(":")[1];
                targetMxid = `${targetMxid}:${domain}`;
            }

            if (targetMxid === sender) {
                await sendRichText(bridgeInstance.getIntent(), roomId, "You are already linked to this system.");
                return;
            }

            // Check if target is already linked somewhere
            const targetLink = await prismaClient.accountLink.findUnique({
                where: { matrixId: targetMxid },
                include: { system: { include: { members: true, accountLinks: true } } }
            });

            if (targetLink) {
                if (targetLink.systemId === system.id) {
                    await sendRichText(bridgeInstance.getIntent(), roomId, `**${targetMxid}** is already linked to this system.`);
                    return;
                }

                if (targetLink.system.members.length > 0) {
                    await sendRichText(bridgeInstance.getIntent(), roomId, `**${targetMxid}** already belongs to a system with members. You must unlink it or delete its members first.`);
                    return;
                }

                // Safe to merge: delete their old system if they were the only link
                if (targetLink.system.accountLinks.length === 1) {
                    await prismaClient.system.delete({ where: { id: targetLink.systemId } });
                } else {
                    await prismaClient.accountLink.delete({ where: { matrixId: targetMxid } });
                }
            }

            // Create new link
            await prismaClient.accountLink.create({
                data: { matrixId: targetMxid, systemId: system.id }
            });

            proxyCache.invalidate(targetMxid);
            emitSystemUpdate(targetMxid);
            emitSystemUpdate(sender);
            await sendRichText(bridgeInstance.getIntent(), roomId, `Successfully linked **${targetMxid}** to this system.`);
            return;
        }

        if (cmd === "unlink") {
            if (!parts[1]) {
                await sendEncryptedText(bridgeInstance.getIntent(), roomId, "Usage: `pk;unlink <@user:domain>`");
                return;
            }
            const system = await proxyCache.getSystemRules(sender, prismaClient);
            if (!system) return;

            let targetMxid = parts[1].toLowerCase();
            if (!targetMxid.startsWith("@")) targetMxid = `@${targetMxid}`;
            if (!targetMxid.includes(":")) targetMxid = `${targetMxid}:${sender.split(":")[1]}`;

            if (targetMxid === sender) {
                await sendRichText(bridgeInstance.getIntent(), roomId, "You cannot unlink your own primary account from the system.");
                return;
            }

            const link = await prismaClient.accountLink.findUnique({
                where: { matrixId: targetMxid }
            });

            if (!link || link.systemId !== system.id) {
                await sendRichText(bridgeInstance.getIntent(), roomId, `**${targetMxid}** is not linked to this system.`);
                return;
            }

            await prismaClient.accountLink.delete({ where: { matrixId: targetMxid } });
            
            // Cleanup system if no links remain (shouldn't happen here since targetMxid !== sender)
            const remainingLinks = await prismaClient.accountLink.count({
                where: { systemId: system.id }
            });

            if (remainingLinks === 0) {
                await prismaClient.system.delete({ where: { id: system.id } });
            }

            proxyCache.invalidate(targetMxid);
            emitSystemUpdate(targetMxid);
            emitSystemUpdate(sender);
            await sendRichText(bridgeInstance.getIntent(), roomId, `Successfully unlinked **${targetMxid}** from this system.`);
            return;
        }

        if (cmd === "member" && parts[1]) {
            const slug = parts[1].toLowerCase();
            const system = await proxyCache.getSystemRules(sender, prismaClient);
            const member = system?.members.find(m => m.slug === slug);
            if (!member) {
                await sendEncryptedText(bridgeInstance.getIntent(), roomId, `No member found with ID: ${slug}`);
                return;
            }
            let info = `## Member Details: ${member.name}\n\n`;
            if (member.pronouns) info += `* **Pronouns:** ${member.pronouns}\n`;
            if (member.color) info += `* **Color:** \`#${member.color}\`\n`;
            if (member.description) info += `\n### Description\n${member.description}\n\n`;
            const tags = (member.proxyTags as any[]).map(t => `\`${t.prefix}text${t.suffix}\``).join(", ");
            info += `--- \n* **Proxy Tags:** ${tags || "None"}`;
            
            await sendRichText(bridgeInstance.getIntent(), roomId, info);

            if (member.avatarUrl) {
                await sendEncryptedImage(bridgeInstance.getIntent(), roomId, member.avatarUrl, `${member.name}'s Avatar`).catch(err => {
                    console.error(`[Bot] Failed to send avatar for ${member.slug}:`, err.message);
                });
            }
            return;
        }

        if (cmd === "autoproxy" || cmd === "auto" || cmd === "ap") {
            const system = await proxyCache.getSystemRules(sender, prismaClient);
            if (!system) {
                await sendEncryptedText(bridgeInstance.getIntent(), roomId, "You don't have a system registered yet.");
                return;
            }

            const targetSlug = parts[1]?.toLowerCase();
            
            if (!targetSlug || targetSlug === "off") {
                await prismaClient.system.update({
                    where: { id: system.id },
                    data: { autoproxyId: null }
                });
                proxyCache.invalidate(sender);
                console.log(`[EVENT] Emitting update for ${maskMxid(sender)} (OFF)`);
                emitSystemUpdate(sender);
                await sendEncryptedText(bridgeInstance.getIntent(), roomId, "Autoproxy disabled.");
                return;
            }

            const member = system.members.find(m => m.slug === targetSlug);
            if (!member) {
                await sendEncryptedText(bridgeInstance.getIntent(), roomId, `No member found with ID: ${targetSlug}`);
                return;
            }

            await prismaClient.system.update({
                where: { id: system.id },
                data: { autoproxyId: member.id }
            });
            proxyCache.invalidate(sender);
            console.log(`[EVENT] Emitting update for ${maskMxid(sender)} (${member.slug})`);
            emitSystemUpdate(sender);
            await sendRichText(bridgeInstance.getIntent(), roomId, `Autoproxy enabled for **${member.name}**.`);
            return;
        }

        // --- Targeting logic for Edit/Reproxy/Delete ---
        if (["edit", "e", "reproxy", "rp", "message", "msg", "m"].includes(cmd)) {
            const system = await proxyCache.getSystemRules(sender, prismaClient);
            if (!system) return;

            let targetId: string | undefined;
            let targetSender: string | undefined;
            let targetContent: any;
            let originalId: string | undefined;

            const relatesTo = (event.content as any)?.["m.relates_to"];
            const replyTo = relatesTo?.["m.in_reply_to"]?.event_id;

            const resolution = await resolveGhostMessage(bridgeInstance, bridgeInstance.getBot().getClient(), roomId, system.slug, replyTo);
            
            if (resolution) {
                targetSender = resolution.event.sender;
                targetContent = resolution.latestContent;
                targetId = resolution.event.event_id || resolution.event.id;
                originalId = resolution.originalId;
            }

            if (!targetId || !targetSender || !targetContent || !originalId) {
                if (cmd !== "message" && cmd !== "msg" && cmd !== "m") {
                    await sendEncryptedText(bridgeInstance.getIntent(), roomId, "Could not find a proxied message to modify.");
                }
                return;
            }

            // Extract text correctly (plaintext body)
            const latestText = targetContent["m.new_content"]?.body || targetContent.body;

            if (cmd === "edit" || cmd === "e") {
                const newText = parts.slice(1).join(" ");
                if (!newText) return;
                const editPayload = {
                    msgtype: "m.text", body: ` * ${newText}`,
                    "m.new_content": { msgtype: "m.text", body: newText },
                    "m.relates_to": { rel_type: "m.replace", event_id: originalId }
                };
                await sendEncryptedEvent(bridgeInstance.getIntent(targetSender), roomId, "m.room.message", editPayload, cryptoManager, currentAsToken);
            } else if (cmd === "reproxy" || cmd === "rp") {
                const memberSlug = parts[1]?.toLowerCase();
                const member = system.members.find(m => m.slug === memberSlug);
                if (member) {
                    const latestText = targetContent["m.new_content"]?.body || targetContent.body;

                    if (!latestText) {
                        await sendEncryptedText(bridgeInstance.getIntent(), roomId, "Could not extract the message text to reproxy. This usually happens if the bot can't decrypt the original message.");
                        return;
                    }

                    // Reproxy: Redact old root and send new from new ghost
                    await safeRedact(bridgeInstance, roomId, originalId, "PluralReproxy", bridgeInstance.getIntent(targetSender));
                    
                    const ghostUserId = `@_plural_${system.slug}_${member.slug}:${DOMAIN}`;
                    const intent = bridgeInstance.getIntent(ghostUserId);
                    const finalDisplayName = system.systemTag ? `${member.displayName || member.name} ${system.systemTag}` : (member.displayName || member.name);
                    
                    await intent.ensureRegistered();
                    await intent.join(roomId);
                    await intent.setDisplayName(finalDisplayName);
                    if (member.avatarUrl) await intent.setAvatarUrl(member.avatarUrl);
                    
                    await sendEncryptedEvent(intent, roomId, "m.room.message", { msgtype: "m.text", body: latestText }, cryptoManager, currentAsToken);
                } else {
                    await sendEncryptedText(bridgeInstance.getIntent(), roomId, `No member found with ID: ${memberSlug}`);
                }
            } else {
                const subCmd = parts[1]?.toLowerCase();
                if (subCmd === "-delete" || subCmd === "-d") {
                    await safeRedact(bridgeInstance, roomId, originalId, "UserRequest", bridgeInstance.getIntent(targetSender));
                }
            }

            await safeRedact(bridgeInstance, roomId, eventId, "PluralCommand");
            return;
        }
    }
    
    // --- Janitor Logic (Proxying) ---
    const system = await proxyCache.getSystemRules(sender, prismaClient);
    if (!system) return;

    // Escape hatch for autoproxy/proxying
    if (body.startsWith("\\")) return;

    for (const member of system.members) {
        const tags = member.proxyTags as any[];
        for (const tag of tags) {
            if (body.startsWith(tag.prefix) && (tag.suffix ? body.endsWith(tag.suffix) : true)) {
                const cleanContent = body.slice(tag.prefix.length, body.length - (tag.suffix?.length || 0)).trim();
                if (!cleanContent) return;

                // Match found: Proxying for member in room
                await safeRedact(bridgeInstance, roomId, eventId, "PluralProxy");
                if (isEdit && originalEventId !== eventId) {
                    await safeRedact(bridgeInstance, roomId, originalEventId, "PluralProxyOriginal");
                }
                
                try {
                    const ghostUserId = `@_plural_${system.slug}_${member.slug}:${DOMAIN}`;
                    const intent = bridgeInstance.getIntent(ghostUserId);
                    const finalDisplayName = system.systemTag ? `${member.displayName || member.name} ${system.systemTag}` : (member.displayName || member.name);

                    await intent.ensureRegistered();
                    try { await intent.join(roomId); } catch (e) {
                        try { await bridgeInstance.getIntent().invite(roomId, ghostUserId); await intent.join(roomId); } catch (e2) {}
                    }

                    // Ensure ghost device is registered
                    const machine = await cryptoManager.getMachine(ghostUserId);
                    await registerDevice(intent, machine.deviceId.toString());

                    try { await intent.setDisplayName(finalDisplayName); if (member.avatarUrl) await intent.setAvatarUrl(member.avatarUrl); } catch (e) {}

                    let relatesTo: any = undefined;
                    if (event.content["m.relates_to"]) {
                        relatesTo = { ...event.content["m.relates_to"] } as any;
                        if (relatesTo.rel_type === "m.replace") { delete relatesTo.rel_type; delete relatesTo.event_id; }
                        if (Object.keys(relatesTo).length === 0) relatesTo = undefined;
                    }

                    messageQueue.enqueue(roomId, sender, intent, cleanContent, relatesTo);
                } catch (e) {}
                return;
            }
        }
    }

    // --- Autoproxy Fallback ---
    if (system.autoproxyId) {
        const autoMember = system.members.find(m => m.id === system.autoproxyId);
        if (autoMember) {
            const cleanContent = body.trim();
            if (!cleanContent) return;

            // Match found: Autoproxying for member in room
            await safeRedact(bridgeInstance, roomId, eventId, "PluralAutoproxy");
            if (isEdit && originalEventId !== eventId) {
                await safeRedact(bridgeInstance, roomId, originalEventId, "PluralAutoproxyOriginal");
            }
            
            try {
                const ghostUserId = `@_plural_${system.slug}_${autoMember.slug}:${DOMAIN}`;
                const intent = bridgeInstance.getIntent(ghostUserId);
                const finalDisplayName = system.systemTag ? `${autoMember.displayName || autoMember.name} ${system.systemTag}` : (autoMember.displayName || autoMember.name);

                await intent.ensureRegistered();
                try { await intent.join(roomId); } catch (e) {
                    try { await bridgeInstance.getIntent().invite(roomId, ghostUserId); await intent.join(roomId); } catch (e2) {}
                }

                // Ensure ghost device is registered
                const machine = await cryptoManager.getMachine(ghostUserId);
                await registerDevice(intent, machine.deviceId.toString());

                try { await intent.setDisplayName(finalDisplayName); if (autoMember.avatarUrl) await intent.setAvatarUrl(autoMember.avatarUrl); } catch (e) {}

                let relatesTo: any = undefined;
                if (event.content["m.relates_to"]) {
                    relatesTo = { ...event.content["m.relates_to"] } as any;
                    if (relatesTo.rel_type === "m.replace") { delete relatesTo.rel_type; delete relatesTo.event_id; }
                    if (Object.keys(relatesTo).length === 0) relatesTo = undefined;
                }

                messageQueue.enqueue(roomId, sender, intent, cleanContent, relatesTo);
            } catch (e) {}
            return;
        }
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

    const botUserId = bridge.getBot().getUserId();
    
    // Setup Transaction Interception for E2EE
    const router = new TransactionRouter(cryptoManager, botUserId, 
        async (userId) => {
            const machine = await cryptoManager.getMachine(userId);
            const intent = bridge.getIntent(userId);
            await registerDevice(intent, machine.deviceId.toString());
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
    await registerDevice(botIntent, botMachine.deviceId.toString());
    await botMachine.receiveSyncChanges("[]", new DeviceLists(), {}, []);
    await processCryptoRequests(botMachine, botIntent, asToken);

    // Explicitly register the bot as an AS user
    // This resolves issues where clients can't invite the bot if it's only implicitly created
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

    // Hook middleware into Express
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

export const getBridge = () => bridge;
