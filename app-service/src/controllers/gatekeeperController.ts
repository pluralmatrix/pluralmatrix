import { Request, Response } from 'express';
import { prisma, asToken, cryptoManager, getBridge, commandHandler } from '../bot';
import { proxyCache } from '../services/cache';
import { GatekeeperCheckSchema } from '../schemas/gatekeeper';
import { sendGhostMessage } from '../services/ghostService';
import { parseCommand } from '../utils/commandParser';
import { RoomId } from '@matrix-org/matrix-sdk-crypto-nodejs';

export const checkMessage = async (req: Request, res: Response) => {
    try {
        const validated = GatekeeperCheckSchema.parse(req.body);
        const { event_id, sender, room_id, bot_id, type, encrypted_payload, origin_server_ts } = validated;
        let content = validated.content;
        const isEncryptedSource = type === "m.room.encrypted";

        // --- DECRYPTION SUPPORT (E2EE) ---
        if ((isEncryptedSource || !content) && encrypted_payload) {
            const rustRoomId = new RoomId(room_id);
            const decryptionUserId = bot_id || (getBridge()?.getBot().getUserId()) || sender;
            const machine = await cryptoManager.getMachine(decryptionUserId);
            
            const fullEncryptedEvent = {
                content: encrypted_payload,
                event_id: event_id,
                sender: sender,
                room_id: room_id,
                type: "m.room.encrypted",
                origin_server_ts: origin_server_ts || Date.now()
            };

            // Wait/Retry loop for Megolm keys
            let lastError = "";
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const decrypted = await machine.decryptRoomEvent(JSON.stringify(fullEncryptedEvent), rustRoomId);
                    if (decrypted.event) {
                        const parsed = JSON.parse(decrypted.event);
                        content = parsed.content;
                        break; 
                    }
                } catch (decErr: any) {
                    lastError = decErr.message;
                    if (attempt < 2) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                }
            }

            if (!content) {
                console.warn(`[Gatekeeper] Could not decrypt event ${event_id} after retries:`, lastError);
                return res.json({ action: "ALLOW" });
            }
        }

        const body = content?.body || "";
        const cleanSender = sender.toLowerCase();
        const system = await proxyCache.getSystemRules(cleanSender, prisma);

        if (!system) {
            return res.json({ action: "ALLOW" });
        }

        if (body.startsWith("\\")) {
            return res.json({ action: "ALLOW" });
        }

        // --- ZERO-FLASH FOR COMMANDS ---
        const parsedCommand = parseCommand(body);
        if (parsedCommand) {
            const { cmd } = parsedCommand;
            if (["edit", "e", "reproxy", "rp", "message", "msg", "m"].includes(cmd)) {
                if (!isEncryptedSource) {
                    console.log(`[Gatekeeper] Executing Zero-Flash command ${cmd} for ${event_id}`);
                    // Construct an event object similar to what bot.ts expects
                    const mockEvent = {
                        event_id: event_id,
                        room_id: room_id,
                        sender: sender,
                        content: content
                    };
                    commandHandler.executeTargetingCommand(mockEvent, body, system).catch(e => {
                        console.error("[Gatekeeper] Failed to execute targeting command:", e.message);
                    });
                } else {
                    console.log(`[Gatekeeper] E2EE Match for command ${cmd} - Letting bot.ts handle execution.`);
                }
                return res.json({ action: "BLOCK" });
            }
            return res.json({ action: "ALLOW" });
        }

        // --- PROXY CHECK ---
        let matchFound = false;
        let targetMember: any = null;
        let cleanContent = "";

        for (const member of system.members) {
            const tags = member.proxyTags as any[];
            for (const tag of tags) {
                if (body.startsWith(tag.prefix) && (tag.suffix ? body.endsWith(tag.suffix) : true)) {
                    cleanContent = body.slice(tag.prefix.length, body.length - (tag.suffix?.length || 0)).trim();
                    if (cleanContent) {
                        matchFound = true;
                        targetMember = member;
                        break;
                    }
                }
            }
            if (matchFound) break;
        }

        if (!matchFound && system.autoproxyId) {
            const autoMember = system.members.find(m => m.id === system.autoproxyId);
            if (autoMember) {
                cleanContent = body.trim();
                if (cleanContent) {
                    matchFound = true;
                    targetMember = autoMember;
                }
            }
        }

        if (matchFound && targetMember) {
            // --- CONDITIONAL PROXYING ---
            // We ONLY trigger the ghost message and redaction here for UNENCRYPTED messages.
            // Encrypted messages will be handled by the bot's standard sync loop (bot.ts).
            if (!isEncryptedSource) {
                console.log(`[Gatekeeper] Triggering proxy for unencrypted ${event_id} for member ${targetMember.slug}`);
                sendGhostMessage({
                    roomId: room_id,
                    cleanContent,
                    system,
                    member: {
                        slug: targetMember.slug,
                        name: targetMember.name,
                        displayName: targetMember.displayName,
                        avatarUrl: targetMember.avatarUrl
                    },
                    asToken: asToken,
                    senderId: sender
                    }).catch(e => {                    console.error("[Gatekeeper] Failed to send ghost message:", e.message);
                });
            } else {
                console.log(`[Gatekeeper] E2EE Match for ${event_id} - Visibility BLOCKED, but letting bot.ts handle proxying.`);
            }

            return res.json({ action: "BLOCK" });
        }

        return res.json({ action: "ALLOW" });
    } catch (e) {
        console.warn("[Gatekeeper] Validation/Processing Error:", e);
        return res.json({ action: "ALLOW" });
    }
};
