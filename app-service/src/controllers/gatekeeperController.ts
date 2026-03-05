import { Request, Response } from 'express';
import { prisma, asToken, cryptoManager, getBridge, commandHandler } from '../bot';
import { proxyCache } from '../services/cache';
import { GatekeeperCheckSchema } from '../schemas/gatekeeper';
import { sendGhostMessage } from '../services/ghostService';
import { parseCommand } from '../utils/commandParser';
import { parseProxyMatch } from '../utils/proxyParser';
import { RoomId } from '@matrix-org/matrix-sdk-crypto-nodejs';

export const checkMessage = async (req: Request, res: Response) => {
    try {
        const validated = GatekeeperCheckSchema.parse(req.body);
        const { event_id, sender, room_id, bot_id, type, encrypted_payload, origin_server_ts } = validated;
        let content = validated.content as any;
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

        let isEdit = false;
        let originalEventId: string | undefined = undefined;

        console.log(`[Gatekeeper] Analyzing event ${event_id} - has m.new_content: ${!!content["m.new_content"]}, rel_type: ${content["m.relates_to"]?.rel_type}`);

        if (content["m.new_content"] && content["m.relates_to"]?.rel_type === "m.replace") {
            isEdit = true;
            originalEventId = content["m.relates_to"].event_id;
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
                    // Execute in background
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
        // For the immediate proxy check to decide BLOCK/ALLOW quickly, we just use the current content.
        // If it's a match, we'll fetch the original event in the background before sending the ghost message.
        const proxyMatch = parseProxyMatch(content, system, undefined);

        if (proxyMatch) {
            // We matched! Return BLOCK immediately to Synapse so it can cache the result quickly 
            // and avoid blocking the Twisted reactor or triggering retry loops.
            res.json({ action: "BLOCK" });

            if (!isEncryptedSource) {
                console.log(`[Gatekeeper] Triggering background proxy for unencrypted ${event_id} for member ${proxyMatch.targetMember.slug}`);
                
                // Fire and forget background processor
                (async () => {
                    try {
                        let originalEvent: any = null;
                        if (isEdit && originalEventId) {
                            try {
                                originalEvent = await (getBridge()?.getBot().getClient() as any).getEvent(room_id, originalEventId);
                                console.log(`[Gatekeeper] Successfully fetched original event ${originalEventId} for edit.`);
                            } catch (e) {
                                console.warn(`[Gatekeeper] Could not fetch original event ${originalEventId} for edit proxying.`);
                            }
                        }

                        // Re-parse with the original event to get the rich fallbacks
                        const finalProxyMatch = parseProxyMatch(content, system, isEdit ? originalEvent?.content : undefined);
                        if (!finalProxyMatch) return; // Should never happen since it matched above

                        const { targetMember, cleanBody, cleanFormattedBody } = finalProxyMatch;
                        
                        let relatesTo: any = undefined;
                        const sourceContent = isEdit && originalEvent?.content ? originalEvent.content : content;
                        if (sourceContent["m.relates_to"]) {
                            relatesTo = { ...sourceContent["m.relates_to"] } as any;
                            console.log(`[Gatekeeper] Extracted initial relatesTo:`, JSON.stringify(relatesTo));
                            if (relatesTo.rel_type === "m.replace") { delete relatesTo.rel_type; delete relatesTo.event_id; }
                            if (Object.keys(relatesTo).length === 0) relatesTo = undefined;
                        }
                        
                        console.log(`[Gatekeeper] Final relatesTo sent to queue:`, relatesTo ? JSON.stringify(relatesTo) : 'undefined');

                        await sendGhostMessage({
                            roomId: room_id,
                            cleanContent: cleanBody,
                            format: cleanFormattedBody ? "org.matrix.custom.html" : undefined,
                            formattedBody: cleanFormattedBody,
                            relatesTo: relatesTo,
                            system,
                            member: {
                                slug: targetMember.slug,
                                name: targetMember.name,
                                displayName: targetMember.displayName,
                                avatarUrl: targetMember.avatarUrl
                            },
                            asToken: asToken,
                            senderId: sender
                        });
                    } catch (err: any) {
                        console.error("[Gatekeeper] Background proxy task failed:", err.message);
                    }
                })();
            } else {
                console.log(`[Gatekeeper] E2EE Match for ${event_id} - Visibility BLOCKED, but letting bot.ts handle proxying.`);
            }

            return; // We already called res.json()
        }

        return res.json({ action: "ALLOW" });
    } catch (e) {
        console.warn("[Gatekeeper] Validation/Processing Error:", e);
        return res.json({ action: "ALLOW" });
    }
};
