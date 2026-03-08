import { Bridge, Intent } from "matrix-appservice-bridge";
import { PrismaClient } from "@prisma/client";
import { marked } from "marked";
import { RoomId } from "@matrix-org/matrix-sdk-crypto-nodejs";
import { OlmMachineManager } from "../crypto/OlmMachineManager";
import { sendEncryptedEvent } from "../crypto/encryption";
import { registerDevice, processCryptoRequests } from "../crypto/crypto-utils";
import { proxyCache, lastMessageCache } from "./cache";
import { emitSystemUpdate } from "./events";
import { ensureUniqueSlug, ensureUniqueGroupSlug } from "../utils/slug";
import { maskMxid } from "../utils/privacy";
import { config } from "../config";
import { parseCommand } from "../utils/commandParser";

export class CommandHandler {
    private permissionWarnedRooms = new Set<string>();

    constructor(
        private bridge: Bridge,
        private prisma: PrismaClient,
        private cryptoManager: OlmMachineManager,
        private asToken: string,
        private domain: string
    ) {}

    /**
     * Resolves memberId or systemId for a given ghost/bot MXID
     */
    async resolveIdentity(userId: string) {
        let memberId = undefined;
        let systemId = undefined;
        if (userId.startsWith('@_plural_')) {
            const parts = userId.split(':')[0].split('_');
            const memberSlug = parts[parts.length - 1];
            const systemSlug = parts[parts.length - 2];
            if (memberSlug && systemSlug) {
                const m = await this.prisma.member.findFirst({
                    where: { slug: memberSlug, system: { slug: systemSlug } },
                    select: { id: true }
                });
                memberId = m?.id;
            }
        } else if (userId === this.bridge.getBot().getUserId()) {
            const system = await this.prisma.system.findFirst({
                where: { accountLinks: { some: { isPrimary: true } } }, 
                select: { id: true }
            });
            systemId = system?.id;
        }
        return { memberId, systemId };
    }

    /**
     * Messaging Helpers
     */
    async sendEncryptedText(intent: Intent, roomId: string, text: string) {
        const userId = intent.userId;
        const machine = await this.cryptoManager.getMachine(userId);
        const { memberId, systemId } = await this.resolveIdentity(userId);
        await registerDevice(intent, machine.deviceId.toString(), this.prisma, memberId, systemId);

        return sendEncryptedEvent(intent, roomId, "m.room.message", {
            msgtype: "m.text",
            body: text
        }, this.cryptoManager, this.asToken, this.prisma);
    }

    async sendRichText(intent: Intent, roomId: string, text: string) {
        const userId = intent.userId;
        const machine = await this.cryptoManager.getMachine(userId);
        const { memberId, systemId } = await this.resolveIdentity(userId);
        await registerDevice(intent, machine.deviceId.toString(), this.prisma, memberId, systemId);

        const html = await marked.parse(text, { breaks: true });
        return sendEncryptedEvent(intent, roomId, "m.room.message", {
            msgtype: "m.text",
            body: text,
            format: "org.matrix.custom.html",
            formatted_body: html.trim()
        }, this.cryptoManager, this.asToken, this.prisma);
    }

    async sendEncryptedNotice(intent: Intent, roomId: string, text: string) {
        const userId = intent.userId;
        const machine = await this.cryptoManager.getMachine(userId);
        const { memberId, systemId } = await this.resolveIdentity(userId);
        await registerDevice(intent, machine.deviceId.toString(), this.prisma, memberId, systemId);

        return sendEncryptedEvent(intent, roomId, "m.room.message", {
            msgtype: "m.notice",
            body: text
        }, this.cryptoManager, this.asToken, this.prisma);
    }

    async sendEncryptedImage(intent: Intent, roomId: string, mxcUrl: string, name: string) {
        const userId = intent.userId;
        const machine = await this.cryptoManager.getMachine(userId);
        const { memberId, systemId } = await this.resolveIdentity(userId);
        await registerDevice(intent, machine.deviceId.toString(), this.prisma, memberId, systemId);

        const html = `<img src="${mxcUrl}" alt="${name}" />`;
        const body = `[Avatar: ${name}] (${mxcUrl})`;

        return sendEncryptedEvent(intent, roomId, "m.room.message", {
            msgtype: "m.text",
            body: body,
            format: "org.matrix.custom.html",
            formatted_body: html
        }, this.cryptoManager, this.asToken, this.prisma);
    }

    async sendEncryptedCustomText(intent: Intent, roomId: string, body: string, formattedBody: string, mentions?: any) {
        const userId = intent.userId;
        const machine = await this.cryptoManager.getMachine(userId);
        const { memberId, systemId } = await this.resolveIdentity(userId);
        await registerDevice(intent, machine.deviceId.toString(), this.prisma, memberId, systemId);

        return sendEncryptedEvent(intent, roomId, "m.room.message", {
            msgtype: "m.text",
            body: body,
            format: "org.matrix.custom.html",
            formatted_body: formattedBody,
            "m.mentions": mentions || {}
        }, this.cryptoManager, this.asToken, this.prisma);
    }

    async safeRedact(roomId: string, eventId: string, reason: string, preferredIntent?: Intent) {
        const intent = preferredIntent || this.bridge.getIntent();
        try {
            await (intent as any).matrixClient.redactEvent(roomId, eventId, reason);
        } catch (e: any) {
            if (e.errcode === 'M_FORBIDDEN' || e.httpStatus === 403) {
                try {
                    await (this.bridge.getIntent() as any).matrixClient.redactEvent(roomId, eventId, reason);
                } catch (fallbackErr: any) {
                    if ((fallbackErr.errcode === 'M_FORBIDDEN' || fallbackErr.httpStatus === 403) && !this.permissionWarnedRooms.has(roomId)) {
                        console.warn(`[Bot] Lacking redaction permissions in ${roomId}.`);
                        await this.sendEncryptedText(this.bridge.getIntent(), roomId, 
                            "⚠️ I don't have permission to redact (delete) messages in this room. " +
                            "To enable high-fidelity proxying and 'Zero-Flash' cleanup, please promote me to Moderator or give me 'Redact events' permissions."
                        );
                        this.permissionWarnedRooms.add(roomId);
                    }
                }
            } else {
                console.error(`[Janitor] Failed to redact message ${eventId}:`, e.message || e);
            }
        }
    }

    /**
     * Resolution Logic
     */
    async getRoomMessages(roomId: string, limit: number = 50) {
        return this.bridge.getBot().getClient().doRequest("GET", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages`, {
            limit,
            dir: 'b'
        });
    }

    async resolveGhostMessage(roomId: string, systemSlug: string | undefined, explicitTargetId?: string) {
        const botClient = this.bridge.getBot().getClient();
        const rustRoomId = new RoomId(roomId);
        const ghostPrefix = systemSlug ? `@_plural_${systemSlug}_` : `@_plural_`;

        // 1. Fast Path: Cache Lookup
        if (!explicitTargetId && systemSlug) {
            const cached = lastMessageCache.get(roomId, systemSlug);
            if (cached) {
                console.log(`[Janitor] Cache hit for system ${systemSlug} in ${roomId}`);
                return {
                    event: { sender: cached.sender, event_id: cached.latestEventId, content: cached.rootContent },
                    latestContent: cached.latestContent,
                    originalId: cached.rootEventId
                };
            }
        }

        // 2. Slow Path: Search/History
        const scrollback = await this.getRoomMessages(roomId, 100);
        let targetRoot: any = null;
        let latestContent: any = null;
        let rootId = explicitTargetId;

        if (rootId) {
            // Target specific message (Reply or Manual ID)
            try {
                let explicitEvent: any = null;
                explicitEvent = scrollback.chunk.find((e: any) => e.event_id === rootId || e.id === rootId);
                if (!explicitEvent) {
                    explicitEvent = await botClient.getEvent(roomId, rootId);
                    if (explicitEvent && !explicitEvent.event_id) {
                        explicitEvent.event_id = rootId;
                    }
                }

                if (!explicitEvent) return null;
                
                const eventSender = explicitEvent.sender || (explicitEvent as any).sender;
                const eventType = explicitEvent.type || (explicitEvent as any).type;
                let content = explicitEvent.content || (explicitEvent as any).content || {};
                
                if (eventType === "m.room.encrypted") {
                    try {
                        const senderMachine = await this.cryptoManager.getMachine(eventSender);
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
            // Auto-resolve last ghost message
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
                            const senderMachine = await this.cryptoManager.getMachine(e.sender);
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

        // Final Pass: Find newest edit in history if not using cache
        for (const e of scrollback.chunk) {
            if (e.unsigned?.redacted_by) continue;
            if (e.sender !== targetRoot.sender) continue;

            let content = e.content || {};
            const rel = content["m.relates_to"] || {};
            
            if (rel.rel_type === "m.replace" && (rel.event_id === rootId || rel.id === rootId)) {
                if (e.type === "m.room.encrypted") {
                    try {
                        const senderMachine = await this.cryptoManager.getMachine(e.sender);
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
    }

    /**
     * Command Execution
     */
    async executeTargetingCommand(event: any, body: string, system: any) {
        const roomId = event.room_id;
        const formattedBody = event.content?.["m.new_content"]?.formatted_body || event.content?.formatted_body;
        
        const parsed = parseCommand(body, formattedBody);
        if (!parsed) return false;
        
        const { cmd, parts, cleanFormattedBody } = parsed;

        if (!["edit", "e", "reproxy", "rp", "message", "msg"].includes(cmd)) return false;

        const relatesTo = (event.content as any)?.["m.relates_to"];
        const replyTo = relatesTo?.["m.in_reply_to"]?.event_id;

        const subCmd = parts[1]?.toLowerCase();
        let explicitId = replyTo;
        if ((cmd === "message" || cmd === "msg") && parts[1] && !parts[1].startsWith("-")) {
            explicitId = parts[1];
        }

        let resolutionSystemSlug = system?.slug;
        if ((cmd === "message" || cmd === "msg") && subCmd !== "-delete" && subCmd !== "-d") {
            resolutionSystemSlug = undefined; // Allow finding ANY proxied message for info queries
        }

        const resolution = await this.resolveGhostMessage(roomId, resolutionSystemSlug, explicitId);
        
        let targetId: string | undefined;
        let targetSender: string | undefined;
        let targetContent: any;
        let originalId: string | undefined;

        if (resolution) {
            targetSender = resolution.event.sender;
            targetContent = resolution.latestContent;
            targetId = resolution.event.event_id || resolution.event.id;
            originalId = resolution.originalId;
        }

        if (!targetId || !targetSender || !targetContent || !originalId) {
            if (cmd !== "message" && cmd !== "msg") {
                await this.sendEncryptedText(this.bridge.getIntent(), roomId, "Could not find a proxied message to modify.");
            } else {
                await this.sendEncryptedText(this.bridge.getIntent(), roomId, "Could not find that proxied message.");
            }
            return true;
        }

        if (cmd === "message" || cmd === "msg") {
            const subCmd = parts[1]?.toLowerCase();
            if (subCmd === "-delete" || subCmd === "-d") {
                if (system?.slug && targetSender.startsWith(`@_plural_${system.slug}_`)) {
                    await this.safeRedact(roomId, originalId, "UserRequest", this.bridge.getIntent(targetSender));
                    
                    const cached = lastMessageCache.get(roomId, system.slug);
                    if (cached && (cached.rootEventId === originalId || cached.latestEventId === originalId)) {
                        lastMessageCache.delete(roomId, system.slug);
                    }
                } else {
                    await this.sendEncryptedText(this.bridge.getIntent(), roomId, "You can only delete your own proxied messages.");
                }
            } else {
                await this.handleMessageInfoRequest(roomId, event.sender, originalId, true);
            }
            return true;
        }

        const { memberId, systemId } = await this.resolveIdentity(targetSender);
        await registerDevice(this.bridge.getIntent(targetSender), (await this.cryptoManager.getMachine(targetSender)).deviceId.toString(), this.prisma, memberId, systemId);

        const latestText = targetContent["m.new_content"]?.body || targetContent.body;
        const latestFormat = targetContent["m.new_content"]?.format || targetContent.format;
        const latestFormattedBody = targetContent["m.new_content"]?.formatted_body || targetContent.formatted_body;
        
        let relatesToForReproxy: any = undefined;
        // The original root event contains the m.in_reply_to block, not necessarily the latest edit
        const originalContent = resolution?.event?.content || (resolution?.event as any)?.content || {};
        console.log(`[CommandHandler] originalContent extracted from resolution:`, JSON.stringify(originalContent));
        const sourceForRelatesTo = originalContent["m.relates_to"] ? originalContent : targetContent;

        if (sourceForRelatesTo["m.relates_to"]) {
            relatesToForReproxy = { ...sourceForRelatesTo["m.relates_to"] } as any;
            if (relatesToForReproxy.rel_type === "m.replace") { 
                delete relatesToForReproxy.rel_type; 
                delete relatesToForReproxy.event_id; 
            }
            if (Object.keys(relatesToForReproxy).length === 0) relatesToForReproxy = undefined;
        }
        console.log(`[CommandHandler] Final relatesToForReproxy:`, JSON.stringify(relatesToForReproxy));

        if (cmd === "edit" || cmd === "e") {
            const newText = parts.slice(1).join(" ");
            if (!newText) return true;
            
            // Base the edit payload on the original target content to preserve attachments
            const editPayload: any = { ...targetContent };
            if (editPayload["m.new_content"]) {
                delete editPayload["m.new_content"];
            }

            editPayload.body = ` * ${newText}`;
            
            if (cleanFormattedBody) {
                editPayload.format = "org.matrix.custom.html";
                editPayload.formatted_body = ` * ${cleanFormattedBody}`;
            } else {
                delete editPayload.format;
                delete editPayload.formatted_body;
            }

            // The new_content object must also preserve the attachment metadata
            const newContent = { ...editPayload };
            delete newContent["m.relates_to"];
            newContent.body = newText;
            if (cleanFormattedBody) {
                newContent.formatted_body = cleanFormattedBody;
            } else {
                delete newContent.format;
                delete newContent.formatted_body;
            }

            editPayload["m.new_content"] = newContent;
            editPayload["m.relates_to"] = { rel_type: "m.replace", event_id: originalId };

            const editResultId = await sendEncryptedEvent(this.bridge.getIntent(targetSender), roomId, "m.room.message", editPayload, this.cryptoManager, this.asToken, this.prisma);
            
            // Critical: If the user used `pk;e` on the "last message", we must update the cache 
            // so subsequent bare commands (like `pk;rp`) don't grab the old unedited text!
            const newEventIdStr = typeof editResultId === 'string' ? editResultId : editResultId?.event_id;
            console.log(`[CommandHandler] pk;e resulted in event ID: ${newEventIdStr}, originalId: ${originalId}`);
            
            if (newEventIdStr) {
                const cached = lastMessageCache.get(roomId, system.slug);
                console.log(`[CommandHandler] Found cache to update:`, !!cached, cached?.rootEventId === originalId);
                if (cached && cached.rootEventId === originalId) {
                    lastMessageCache.set(roomId, system.slug, {
                        ...cached,
                        latestEventId: newEventIdStr,
                        latestContent: editPayload
                    });
                    console.log(`[CommandHandler] Successfully updated lastMessageCache for pk;e.`);
                }
            }

        } else if (cmd === "reproxy" || cmd === "rp") {
            const memberSlug = parts[1]?.toLowerCase();
            const member = system.members.find((m: any) => m.slug === memberSlug);
            console.log(`[CommandHandler] Reproxy targetContent:`, JSON.stringify(targetContent));
            if (member) {
                if (!latestText) {
                    await this.sendEncryptedText(this.bridge.getIntent(), roomId, "Could not extract the message text to reproxy. This usually happens if the bot can't decrypt the original message.");
                    return true;
                }

                await this.safeRedact(roomId, originalId, "PluralReproxy", this.bridge.getIntent(targetSender));
                
                // Invalidate cache if we just deleted the 'last message'
                const cached = lastMessageCache.get(roomId, system.slug);
                if (cached && (cached.rootEventId === originalId || cached.latestEventId === originalId)) {
                    lastMessageCache.delete(roomId, system.slug);
                }

                const ghostUserId = `@_plural_${system.slug}_${member.slug}:${this.domain}`;
                const intent = this.bridge.getIntent(ghostUserId);
                const finalDisplayName = system.systemTag ? `${member.displayName || member.name} ${system.systemTag}` : (member.displayName || member.name);
                
                await intent.ensureRegistered();
                await intent.join(roomId);
                await intent.setDisplayName(finalDisplayName);
                if (member.avatarUrl) await intent.setAvatarUrl(member.avatarUrl);
                
                // Base the payload on the actual content to preserve msgtype (like m.image), URLs, info, and hashes
                const reproxyPayload: any = { ...targetContent };
                
                // If it was an edit, we want to reproxy the LATEST text/html, not the original
                // We've already extracted latestText, latestFormat, and latestFormattedBody
                if (reproxyPayload["m.new_content"]) {
                    delete reproxyPayload["m.new_content"];
                }
                
                reproxyPayload.body = latestText;
                
                if (latestFormat && latestFormattedBody) {
                    reproxyPayload.format = latestFormat;
                    reproxyPayload.formatted_body = latestFormattedBody;
                } else {
                    // Ensure we don't accidentally carry over old formatting if the edit stripped it
                    delete reproxyPayload.format;
                    delete reproxyPayload.formatted_body;
                }

                if (relatesToForReproxy) {
                    reproxyPayload["m.relates_to"] = relatesToForReproxy;
                } else {
                    delete reproxyPayload["m.relates_to"];
                }
                
                await sendEncryptedEvent(intent, roomId, "m.room.message", reproxyPayload, this.cryptoManager, this.asToken, this.prisma);
            } else {
                await this.sendEncryptedText(this.bridge.getIntent(), roomId, `No member found with ID: ${memberSlug}`);
            }
        }

        return true;
    }

    async getOrAutoCreateDMRoom(userId: string): Promise<string | null> {
        try {
            const botClient = this.bridge.getBot().getClient();
            const joinedRooms = await botClient.getJoinedRooms();
            for (const roomId of joinedRooms) {
                const members = await botClient.getJoinedRoomMembers(roomId);
                if (members.length === 2 && members.includes(userId)) {
                    return roomId;
                }
            }
            
            const res = await botClient.createRoom({
                is_direct: true,
                invite: [userId],
                preset: "trusted_private_chat",
                visibility: "private"
            });
            return (res as any).room_id || (typeof res === "string" ? res : null);
        } catch (e) {
            console.error("Failed to find or create DM room for", userId, e);
            return null;
        }
    }

    async handleMessageInfoRequest(roomId: string, requestingUserId: string, targetEventId: string, replyInRoom: boolean = false) {
        try {
            const botClient = this.bridge.getBot().getClient();
            const targetEvent = await botClient.getEvent(roomId, targetEventId);
            if (!targetEvent || !targetEvent.sender.startsWith("@_plural_")) {
                if (replyInRoom) {
                    await this.sendEncryptedText(this.bridge.getIntent(), roomId, "That message does not appear to be a proxied message.");
                }
                return;
            }

            const sender = targetEvent.sender;
            const match = sender.match(/^@_plural_([^_]+)_(.+):/);
            if (!match) return;

            const systemSlug = match[1];
            const memberSlug = match[2];

            const system = await this.prisma.system.findUnique({
                where: { slug: systemSlug },
                include: { accountLinks: true, members: true }
            });
            if (!system) return;

            const member = system.members.find(m => m.slug === memberSlug);
            const primaryLink = system.accountLinks.find(l => l.isPrimary) || system.accountLinks[0];
            
            const systemName = system.name || "Unknown System";
            const memberName = member ? (member.displayName || member.name) : "Unknown Member";
            const accountMxid = primaryLink ? primaryLink.matrixId : "Unknown Account";

            const messageLink = `https://matrix.to/#/${roomId}/${targetEventId}`;
            const baseUrl = config.publicWebUrl.endsWith('/') ? config.publicWebUrl.slice(0, -1) : config.publicWebUrl;
            const systemUrl = `${baseUrl}/s/${system.slug}`;
            
            const accountSplit = accountMxid !== "Unknown Account" ? accountMxid.split(':')[0] : "Unknown Account";
            const senderPillUrl = accountMxid !== "Unknown Account" ? `https://matrix.to/#/${accountMxid}` : "#";
            
            const body = `**Message Information**\n` +
                         `* **System:** ${systemName} (\`${system.slug}\`) - [View on Web](${systemUrl})\n` +
                         `* **Member:** ${memberName} (\`${member?.slug || memberSlug}\`)\n` +
                         `* **Sender:** <${accountMxid}>\n` +
                         `* **Message Link:** [Click Here](${messageLink})`;
                         
            const formattedBody = `<strong>Message Information</strong><br>` +
                                  `<ul>` +
                                  `<li><strong>System:</strong> ${systemName} (<code>${system.slug}</code>) - <a href="${systemUrl}">View on Web</a></li>` +
                                  `<li><strong>Member:</strong> ${memberName} (<code>${member?.slug || memberSlug}</code>)</li>` +
                                  `<li><strong>Sender:</strong> <a href="${senderPillUrl}">${accountSplit}</a></li>` +
                                  `<li><strong>Message Link:</strong> <a href="${messageLink}">Click Here</a></li>` +
                                  `</ul>`;

            const mentions = {}; // Empty mentions object prevents accidental pinging of the sender

            if (replyInRoom) {
                await this.sendEncryptedCustomText(this.bridge.getIntent(), roomId, body, formattedBody, mentions);
            } else {
                const dmRoomId = await this.getOrAutoCreateDMRoom(requestingUserId);
                if (dmRoomId) {
                    await this.sendEncryptedCustomText(this.bridge.getIntent(), dmRoomId, body, formattedBody, mentions);
                }
            }
        } catch (e) {
            console.error("[CommandHandler] Error fetching message info:", e);
        }
    }

    async handleMessagePingRequest(roomId: string, requestingUserId: string, targetEventId: string) {
        try {
            const botClient = this.bridge.getBot().getClient();
            const targetEvent = await botClient.getEvent(roomId, targetEventId);
            if (!targetEvent || !targetEvent.sender.startsWith("@_plural_")) return;

            const sender = targetEvent.sender;
            const match = sender.match(/^@_plural_([^_]+)_(.+):/);
            if (!match) return;

            const systemSlug = match[1];

            const system = await this.prisma.system.findUnique({
                where: { slug: systemSlug },
                include: { accountLinks: true }
            });
            if (!system) return;

            const primaryLink = system.accountLinks.find(l => l.isPrimary) || system.accountLinks[0];
            if (!primaryLink) return;
            
            const accountMxid = primaryLink.matrixId;
            const messageLink = `https://matrix.to/#/${roomId}/${targetEventId}`;
            
            const reqUserSplit = requestingUserId.split(':')[0];
            const accountSplit = accountMxid.split(':')[0];

            const body = `🔔 <${requestingUserId}> pinged ${accountMxid} regarding [this message](${messageLink}).`;
            const formattedBody = `🔔 &lt;<a href="https://matrix.to/#/${requestingUserId}">${reqUserSplit}</a>&gt; pinged <a href="https://matrix.to/#/${accountMxid}">${accountSplit}</a> regarding <a href="${messageLink}">this message</a>.`;

            const mentions = { user_ids: [accountMxid, requestingUserId] };

            await this.sendEncryptedCustomText(this.bridge.getIntent(), roomId, body, formattedBody, mentions);
        } catch (e) {
            console.error("[CommandHandler] Error handling message ping:", e);
        }
    }

    async handleCommand(event: any, cmd: string, parts: string[], system: any) {
        const roomId = event.room_id;
        const sender = event.sender;

        // Handle explicit system creation first
        if (cmd === "system" || cmd === "s") {
            const subCmd = parts[1]?.toLowerCase();
            if (subCmd === "new") {
                if (system) {
                    await this.sendRichText(this.bridge.getIntent(), roomId, `You already have a system registered (\`${system.slug}\`).`);
                    return true;
                }

                try {
                    const localpart = sender.split(':')[0].substring(1);
                    const newSlug = await ensureUniqueSlug(this.prisma, localpart);

                    await this.prisma.system.create({
                        data: {
                            slug: newSlug,
                            name: `${localpart}'s System`,
                            accountLinks: {
                                create: { matrixId: sender, isPrimary: true }
                            }
                        }
                    });

                    proxyCache.invalidate(sender);

                    const webUrl = config.publicWebUrl;
                    const successMessage = `✅ **System created!**
You can now manage your members and settings at:
${webUrl}

**⚠️ Please Note ⚠️**

**Public Profiles:** All system/member metadata is publicly accessible. Do not store private info in profiles.

**Message Content:** Your messages are not public, but using plural_bot in encrypted rooms allows the **homeserver administrator** to read them.

**Data Control:** We don't use tokens. Use the web UI to export your data regularly for backups or to move servers.`;
                    await this.sendRichText(this.bridge.getIntent(), roomId, successMessage);
                    return true;
                } catch (e) {
                    console.error("Failed to create system via command:", e);
                    await this.sendRichText(this.bridge.getIntent(), roomId, "❌ Failed to create system due to an internal error.");
                    return true;
                }
            }
        }

        // For all other commands, if no system exists, prompt them to create one
        if (!system && cmd !== "link" && cmd !== "system" && cmd !== "s" && cmd !== "message" && cmd !== "msg") {
            const webUrl = config.publicWebUrl;
            await this.sendRichText(
                this.bridge.getIntent(), 
                roomId, 
                `❌ You do not have a system registered with PluralMatrix. To create one, type \`pk;system new\` or log in with your Matrix account at: ${webUrl}`
            );
            return true;
        }

        if (cmd === "list") {

            if (!system || system.members.length === 0) {
                await this.sendEncryptedText(this.bridge.getIntent(), roomId, "You don't have any system members registered yet.");
                return true;
            }
            const sortedMembers = system.members.sort((a: any, b: any) => a.slug.localeCompare(b.slug));
            const memberList = sortedMembers.map((m: any) => {
                const tags = m.proxyTags as any[];
                const tag = tags[0];
                const display = tag ? `\`${tag.prefix}text${tag.suffix}\`` : "None";
                return `* **${m.name}** - ${display} (id: \`${m.slug}\`)`;
            }).join("\n");
            await this.sendRichText(this.bridge.getIntent(), roomId, `### ${system.name || "Your System"} Members\n${memberList}`);
            return true;
        }

        if (cmd === "link") {
            if (!parts[1]) {
                await this.sendEncryptedText(this.bridge.getIntent(), roomId, "Usage: `pk;link <@user:domain>` or `pk;link primary <@user:domain>`");
                return true;
            }

            let targetMxid = (parts[1].toLowerCase() === "primary" ? parts[2] : parts[1])?.toLowerCase();
            if (!targetMxid) {
                await this.sendEncryptedText(this.bridge.getIntent(), roomId, "Usage: `pk;link <@user:domain>` or `pk;link primary <@user:domain>`");
                return true;
            }

            if (!targetMxid.startsWith("@")) targetMxid = `@${targetMxid}`;
            if (!targetMxid.includes(":")) targetMxid = `${targetMxid}:${sender.split(":")[1]}`;

            // Issue #5: Verify user existence before linking
            try {
                await (this.bridge.getIntent() as any).matrixClient.getUserProfile(targetMxid);
            } catch (e: any) {
                await this.sendRichText(this.bridge.getIntent(), roomId, `❌ Could not verify Matrix ID **${targetMxid}**. Please ensure the ID is correct and the user exists.`);
                return true;
            }

            if (parts[1].toLowerCase() === "primary" && parts[2]) {
                if (!system) return true;

                const link = await this.prisma.accountLink.findUnique({
                    where: { matrixId: targetMxid }
                });

                if (!link || link.systemId !== system.id) {
                    await this.sendRichText(this.bridge.getIntent(), roomId, `**${targetMxid}** is not linked to your system. Link it first with \`pk;link ${targetMxid}\`.`);
                    return true;
                }

                await this.prisma.$transaction([
                    this.prisma.accountLink.updateMany({
                        where: { systemId: system.id },
                        data: { isPrimary: false }
                    }),
                    this.prisma.accountLink.update({
                        where: { matrixId: targetMxid },
                        data: { isPrimary: true }
                    })
                ]);

                proxyCache.invalidate(sender);
                emitSystemUpdate(sender);
                await this.sendRichText(this.bridge.getIntent(), roomId, `✅ **${targetMxid}** is now the primary routing account for this system. Direct messages sent to system members will be forwarded here.`);
                return true;
            }

            // Normal link logic
            // The sender MUST have a system to link someone else into it.
            if (!system) {
                await this.sendRichText(this.bridge.getIntent(), roomId, "You must have a system to link other accounts to it.");
                return true;
            }

            if (targetMxid === sender) {
                await this.sendRichText(this.bridge.getIntent(), roomId, "You are already linked to this system.");
                return true;
            }

            const targetLink = await this.prisma.accountLink.findUnique({
                where: { matrixId: targetMxid },
                include: { system: { include: { members: true, accountLinks: true } } }
            });

            if (targetLink) {
                if (targetLink.systemId === system.id) {
                    await this.sendRichText(this.bridge.getIntent(), roomId, `**${targetMxid}** is already linked to your system.`);
                    return true;
                }

                if (targetLink.system.members.length > 0) {
                    await this.sendRichText(this.bridge.getIntent(), roomId, `❌ **${targetMxid}** already belongs to an active system with members. They must delete their system before they can be linked to yours.`);
                    return true;
                }

                // If it's an empty system, we can safely delete it or unlink it to make way for the new link
                if (targetLink.system.accountLinks.length === 1) {
                    await this.prisma.system.delete({ where: { id: targetLink.systemId } });
                } else {
                    await this.prisma.accountLink.delete({ where: { matrixId: targetMxid } });
                }
            }

            await this.prisma.accountLink.create({
                data: { matrixId: targetMxid, systemId: system.id }
            });

            proxyCache.invalidate(targetMxid);
            emitSystemUpdate(targetMxid);
            emitSystemUpdate(sender);
            await this.sendRichText(this.bridge.getIntent(), roomId, `✅ Successfully linked **${targetMxid}** to this system (\`${system.slug}\`).`);
            return true;
        }

        if (cmd === "unlink") {
            if (!parts[1]) {
                await this.sendEncryptedText(this.bridge.getIntent(), roomId, "Usage: `pk;unlink <@user:domain>`");
                return true;
            }
            if (!system) return true;

            let targetMxid = parts[1].toLowerCase();
            if (!targetMxid.startsWith("@")) targetMxid = `@${targetMxid}`;
            if (!targetMxid.includes(":")) targetMxid = `${targetMxid}:${sender.split(":")[1]}`;

            if (targetMxid === sender) {
                await this.sendRichText(this.bridge.getIntent(), roomId, "You cannot unlink your own primary account from the system.");
                return true;
            }

            const link = await this.prisma.accountLink.findUnique({
                where: { matrixId: targetMxid }
            });

            if (!link || link.systemId !== system.id) {
                await this.sendRichText(this.bridge.getIntent(), roomId, `**${targetMxid}** is not linked to this system.`);
                return true;
            }

            const remainingLinks = await this.prisma.accountLink.count({
                where: { systemId: system.id }
            });

            if (remainingLinks <= 1) { // 1 because we are about to delete it, so if it's 1 right now, it's the last one
                await this.sendRichText(this.bridge.getIntent(), roomId, "You cannot unlink the last account from a system. Use the Web UI to delete the entire system instead.");
                return true;
            }

            await this.prisma.accountLink.delete({ where: { matrixId: targetMxid } });

            proxyCache.invalidate(targetMxid);
            emitSystemUpdate(targetMxid);
            emitSystemUpdate(sender);
            await this.sendRichText(this.bridge.getIntent(), roomId, `✅ Successfully unlinked **${targetMxid}** from this system.`);
            return true;
        }

        if (cmd === "member" || cmd === "m") {

            const slug = parts[1].toLowerCase();
            const member = system?.members.find((m: any) => m.slug === slug);
            if (!member) {
                await this.sendEncryptedText(this.bridge.getIntent(), roomId, `No member found with ID: ${slug}`);
                return true;
            }
            let info = `## Member Details: ${member.name}\n\n`;
            if (member.pronouns) info += `* **Pronouns:** ${member.pronouns}\n`;
            if (member.color) info += `* **Color:** \`#${member.color}\`\n`;
            if (member.description) info += `\n### Description\n${member.description}\n\n`;
            const tags = (member.proxyTags as any[]).map(t => `\`${t.prefix}text${t.suffix}\``).join(", ");
            info += `--- \n* **Proxy Tags:** ${tags || "None"}`;
            
            await this.sendRichText(this.bridge.getIntent(), roomId, info);

            if (member.avatarUrl) {
                await this.sendEncryptedImage(this.bridge.getIntent(), roomId, member.avatarUrl, `${member.name}'s Avatar`).catch(err => {
                    console.error(`[Bot] Failed to send avatar for ${member.slug}:`, err.message);
                });
            }
            return true;
        }

        if (cmd === "autoproxy" || cmd === "auto" || cmd === "ap") {
            if (!system) {
                await this.sendEncryptedText(this.bridge.getIntent(), roomId, "You don't have a system registered yet.");
                return true;
            }

            const targetSlug = parts[1]?.toLowerCase();
            
            if (!targetSlug || targetSlug === "off") {
                await this.prisma.system.update({
                    where: { id: system.id },
                    data: { autoproxyId: null, autoproxyMode: "off" }
                });
                proxyCache.invalidate(sender);
                emitSystemUpdate(sender);
                await this.sendEncryptedText(this.bridge.getIntent(), roomId, "Autoproxy disabled.");
                return true;
            }

            if (targetSlug === "latch") {
                await this.prisma.system.update({
                    where: { id: system.id },
                    data: { autoproxyMode: "latch" }
                });
                proxyCache.invalidate(sender);
                emitSystemUpdate(sender);
                await this.sendEncryptedText(this.bridge.getIntent(), roomId, "Autoproxy latch mode enabled. The last proxied member will be automatically locked in.");
                return true;
            }

            const member = system.members.find((m: any) => m.slug === targetSlug);
            if (!member) {
                await this.sendEncryptedText(this.bridge.getIntent(), roomId, `No member found with ID: ${targetSlug}`);
                return true;
            }

            await this.prisma.system.update({
                where: { id: system.id },
                data: { autoproxyId: member.id, autoproxyMode: "member" }
            });
            proxyCache.invalidate(sender);
            emitSystemUpdate(sender);
            await this.sendRichText(this.bridge.getIntent(), roomId, `Autoproxy enabled for **${member.name}**.`);
            return true;
        }

        if (cmd === "group" || cmd === "g") {
            if (!system) {
                await this.sendEncryptedText(this.bridge.getIntent(), roomId, "You don't have a system registered yet.");
                return true;
            }

            const subCmd = parts[1]?.toLowerCase();
            
            if (!subCmd || subCmd === "list") {
                const groups = system.groups || [];
                if (groups.length === 0) {
                    await this.sendEncryptedText(this.bridge.getIntent(), roomId, "You don't have any groups in your system.");
                    return true;
                }
                const sortedGroups = groups.sort((a: any, b: any) => a.slug.localeCompare(b.slug));
                const groupList = sortedGroups.map((g: any) => `* **${g.displayName || g.name}** (id: \`${g.slug}\`) - ${g.members?.length || 0} members`).join("\n");
                await this.sendRichText(this.bridge.getIntent(), roomId, `### ${system.name || "Your System"} Groups\n${groupList}`);
                return true;
            }

            if (subCmd === "new") {
                const name = parts.slice(2).join(" ");
                if (!name) {
                    await this.sendEncryptedText(this.bridge.getIntent(), roomId, "Usage: `pk;group new <name>`");
                    return true;
                }
                
                const { generateSlug } = require('../import');
                let baseSlug = generateSlug(name, "group");
                const newSlug = await ensureUniqueGroupSlug(this.prisma, system.id, baseSlug);
                
                await this.prisma.group.create({
                    data: {
                        name: name,
                        slug: newSlug,
                        systemId: system.id
                    }
                });
                
                emitSystemUpdate(sender);
                await this.sendRichText(this.bridge.getIntent(), roomId, `✅ Created group **${name}** (id: \`${newSlug}\`).`);
                return true;
            }

            // Commands that target a specific group: `pk;group <group> <action>`
            const groupSlug = subCmd;
            const group = (system.groups || []).find((g: any) => g.slug === groupSlug || g.pkId === groupSlug);
            
            if (!group) {
                await this.sendEncryptedText(this.bridge.getIntent(), roomId, `No group found with ID: ${groupSlug}`);
                return true;
            }

            const action = parts[2]?.toLowerCase();
            
            if (!action || action === "list") {
                if (!group.members || group.members.length === 0) {
                    await this.sendEncryptedText(this.bridge.getIntent(), roomId, `Group **${group.name}** has no members.`);
                    return true;
                }
                const memberList = group.members.sort((a: any, b: any) => a.slug.localeCompare(b.slug)).map((m: any) => `* **${m.name}** (\`${m.slug}\`)`).join("\n");
                await this.sendRichText(this.bridge.getIntent(), roomId, `### Group: ${group.displayName || group.name}\n${memberList}`);
                return true;
            }

            if (action === "add" || action === "remove") {
                const memberSlugs = parts.slice(3).map(s => s.toLowerCase());
                if (memberSlugs.length === 0) {
                    await this.sendEncryptedText(this.bridge.getIntent(), roomId, `Usage: \`pk;group ${groupSlug} ${action} <member1> <member2> ...\``);
                    return true;
                }
                
                const validMembers = system.members.filter((m: any) => memberSlugs.includes(m.slug) || memberSlugs.includes(m.pkId));
                if (validMembers.length === 0) {
                    await this.sendEncryptedText(this.bridge.getIntent(), roomId, `None of the specified members were found.`);
                    return true;
                }

                const connectArr = validMembers.map((m: any) => ({ id: m.id }));
                
                if (action === "add") {
                    await this.prisma.group.update({
                        where: { id: group.id },
                        data: { members: { connect: connectArr } }
                    });
                    await this.sendRichText(this.bridge.getIntent(), roomId, `✅ Added ${validMembers.length} member(s) to **${group.name}**.`);
                } else {
                    await this.prisma.group.update({
                        where: { id: group.id },
                        data: { members: { disconnect: connectArr } }
                    });
                    await this.sendRichText(this.bridge.getIntent(), roomId, `✅ Removed ${validMembers.length} member(s) from **${group.name}**.`);
                }
                
                emitSystemUpdate(sender);
                return true;
            }

            if (action === "rename") {
                const newName = parts.slice(3).join(" ");
                if (!newName) {
                    await this.sendEncryptedText(this.bridge.getIntent(), roomId, `Usage: \`pk;group ${groupSlug} rename <new name>\``);
                    return true;
                }
                await this.prisma.group.update({
                    where: { id: group.id },
                    data: { name: newName }
                });
                emitSystemUpdate(sender);
                await this.sendRichText(this.bridge.getIntent(), roomId, `✅ Renamed group to **${newName}**.`);
                return true;
            }

            if (action === "description" || action === "desc") {
                const newDesc = parts.slice(3).join(" ");
                await this.prisma.group.update({
                    where: { id: group.id },
                    data: { description: newDesc || null }
                });
                emitSystemUpdate(sender);
                await this.sendRichText(this.bridge.getIntent(), roomId, newDesc ? `✅ Updated group description.` : `✅ Cleared group description.`);
                return true;
            }

            if (action === "icon") {
                const newIcon = parts.slice(3).join(" ");
                await this.prisma.group.update({
                    where: { id: group.id },
                    data: { icon: newIcon || null }
                });
                emitSystemUpdate(sender);
                await this.sendRichText(this.bridge.getIntent(), roomId, newIcon ? `✅ Updated group icon.` : `✅ Cleared group icon.`);
                return true;
            }

            if (action === "delete") {
                await this.prisma.group.delete({ where: { id: group.id } });
                emitSystemUpdate(sender);
                await this.sendRichText(this.bridge.getIntent(), roomId, `✅ Deleted group **${group.name}**.`);
                return true;
            }
            
            // Unrecognized group action
            await this.sendEncryptedText(this.bridge.getIntent(), roomId, `Unknown group action: ${action}`);
            return true;
        }

        // Targeting Logic
        if (["edit", "e", "reproxy", "rp", "message", "msg"].includes(cmd)) {
            if (!system && cmd !== "message" && cmd !== "msg") return true;
            const handled = await this.executeTargetingCommand(event, `pk;${cmd} ${parts.slice(1).join(" ")}`, system);
            if (handled) {
                await this.safeRedact(roomId, event.event_id, "PluralCommand");
            }
            return true;
        }

        return false;
    }

    private async getSenderSystem(sender: string) {
        // Issue #4: Directly query DB instead of relying on cache which might double-query
        const existingLink = await this.prisma.accountLink.findUnique({
            where: { matrixId: sender },
            include: { system: { include: { members: true, groups: { include: { members: true } } } } }
        });
        
        return existingLink ? existingLink.system : null;
    }

    async promoteSystemPowerLevels(roomId: string, ghostUserId: string) {
        try {
            const ghostIntent = this.bridge.getIntent(ghostUserId);
            const botUserId = this.bridge.getBot().getUserId();
            
            // Proactively fetch power levels once during room setup
            const state = await (ghostIntent as any).matrixClient.getRoomStateEvent(roomId, "m.room.power_levels", "");
            const users = state.users || {};
            const ghostLevel = users[ghostUserId] || state.users_default || 0;
            
            // Only proceed if the ghost has authority to promote others
            if (ghostLevel < 50) return;

            const parts = ghostUserId.split(":")[0].split("_");
            const systemSlug = parts[2];
            const system = await this.prisma.system.findUnique({
                where: { slug: systemSlug },
                include: { accountLinks: true }
            });
            if (!system) return;
            
            const primaryLink = system.accountLinks.find(l => l.isPrimary) || system.accountLinks[0];
            if (!primaryLink) return;
            const primaryUser = primaryLink.matrixId;

            let changed = false;
            // Promote both the Bot and the Owner to match the Ghost's level (usually 100 in DMs)
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
                console.log(`[Ghost] ${ghostUserId} pre-emptively promoting bot/owner to PL ${ghostLevel} in ${roomId}`);
                await (this.bridge.getIntent(ghostUserId) as any).matrixClient.sendStateEvent(roomId, "m.room.power_levels", "", state);
            }
        } catch (e: any) {
            console.warn(`[Ghost] Failed to pre-emptively promote system in ${roomId}:`, e.message);
        }
    }
}
