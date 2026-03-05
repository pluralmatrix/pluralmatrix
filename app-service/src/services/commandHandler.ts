import { Bridge, Intent } from "matrix-appservice-bridge";
import { PrismaClient } from "@prisma/client";
import { marked } from "marked";
import { RoomId } from "@matrix-org/matrix-sdk-crypto-nodejs";
import { OlmMachineManager } from "../crypto/OlmMachineManager";
import { sendEncryptedEvent } from "../crypto/encryption";
import { registerDevice, processCryptoRequests } from "../crypto/crypto-utils";
import { proxyCache, lastMessageCache } from "./cache";
import { emitSystemUpdate } from "./events";
import { ensureUniqueSlug } from "../utils/slug";
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

    async resolveGhostMessage(roomId: string, systemSlug: string, explicitTargetId?: string) {
        const botClient = this.bridge.getBot().getClient();
        const rustRoomId = new RoomId(roomId);
        const ghostPrefix = `@_plural_${systemSlug}_`;

        // 1. Fast Path: Cache Lookup
        if (!explicitTargetId) {
            const cached = lastMessageCache.get(roomId, systemSlug);
            if (cached) {
                console.log(`[Janitor] Cache hit for system ${systemSlug} in ${roomId}`);
                return {
                    event: { sender: cached.sender, event_id: cached.latestEventId },
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
        const parsed = parseCommand(body);
        if (!parsed) return false;
        
        const { cmd, parts } = parsed;

        if (!["edit", "e", "reproxy", "rp", "message", "msg", "m"].includes(cmd)) return false;

        const relatesTo = (event.content as any)?.["m.relates_to"];
        const replyTo = relatesTo?.["m.in_reply_to"]?.event_id;

        const resolution = await this.resolveGhostMessage(roomId, system.slug, replyTo);
        
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
            if (cmd !== "message" && cmd !== "msg" && cmd !== "m") {
                await this.sendEncryptedText(this.bridge.getIntent(), roomId, "Could not find a proxied message to modify.");
            }
            return true;
        }

        const { memberId, systemId } = await this.resolveIdentity(targetSender);
        await registerDevice(this.bridge.getIntent(targetSender), (await this.cryptoManager.getMachine(targetSender)).deviceId.toString(), this.prisma, memberId, systemId);

        const latestText = targetContent["m.new_content"]?.body || targetContent.body;
        const latestFormat = targetContent["m.new_content"]?.format || targetContent.format;
        const latestFormattedBody = targetContent["m.new_content"]?.formatted_body || targetContent.formatted_body;
        
        let relatesToForReproxy: any = undefined;
        if (targetContent["m.relates_to"]) {
            relatesToForReproxy = { ...targetContent["m.relates_to"] } as any;
            if (relatesToForReproxy.rel_type === "m.replace") { 
                delete relatesToForReproxy.rel_type; 
                delete relatesToForReproxy.event_id; 
            }
            if (Object.keys(relatesToForReproxy).length === 0) relatesToForReproxy = undefined;
        }

        if (cmd === "edit" || cmd === "e") {
            const newText = parts.slice(1).join(" ");
            if (!newText) return true;
            const editPayload = {
                msgtype: "m.text", body: ` * ${newText}`,
                "m.new_content": { msgtype: "m.text", body: newText },
                "m.relates_to": { rel_type: "m.replace", event_id: originalId }
            };
            await sendEncryptedEvent(this.bridge.getIntent(targetSender), roomId, "m.room.message", editPayload, this.cryptoManager, this.asToken, this.prisma);
        } else if (cmd === "reproxy" || cmd === "rp") {
            const memberSlug = parts[1]?.toLowerCase();
            const member = system.members.find((m: any) => m.slug === memberSlug);
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
                
                const reproxyPayload: any = { msgtype: "m.text", body: latestText };
                if (latestFormat && latestFormattedBody) {
                    reproxyPayload.format = latestFormat;
                    reproxyPayload.formatted_body = latestFormattedBody;
                }
                if (relatesToForReproxy) {
                    reproxyPayload["m.relates_to"] = relatesToForReproxy;
                }
                
                await sendEncryptedEvent(intent, roomId, "m.room.message", reproxyPayload, this.cryptoManager, this.asToken, this.prisma);
            } else {
                await this.sendEncryptedText(this.bridge.getIntent(), roomId, `No member found with ID: ${memberSlug}`);
            }
        } else {
            const subCmd = parts[1]?.toLowerCase();
            if (subCmd === "-delete" || subCmd === "-d") {
                await this.safeRedact(roomId, originalId, "UserRequest", this.bridge.getIntent(targetSender));
                
                // Invalidate cache if we just deleted the 'last message'
                const cached = lastMessageCache.get(roomId, system.slug);
                if (cached && (cached.rootEventId === originalId || cached.latestEventId === originalId)) {
                    lastMessageCache.delete(roomId, system.slug);
                }
            }
        }

        return true;
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
        if (!system && cmd !== "link" && cmd !== "system" && cmd !== "s") {
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

        // Targeting Logic
        if (["edit", "e", "reproxy", "rp", "message", "msg", "m"].includes(cmd)) {
            if (!system) return true;
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
            include: { system: { include: { members: true } } }
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
