import { Intent } from "matrix-appservice-bridge";
import { v4 as uuidv4 } from "uuid";
import { PrismaClient } from "@prisma/client";
import { sleep } from "../../utils/timer";
import { sendEncryptedEvent } from "../../crypto/encryption";
import { cryptoManager, asToken, getBridge } from "../../bot";
import { lastMessageCache } from "../cache";

export interface QueueItem {
    id: string;
    roomId: string;
    senderId: string;
    ghostIntent: Intent;
    plaintext: string;
    format?: string;
    formattedBody?: string;
    attempts: number;
    relatesTo?: any; // For replies/edits
    prisma?: PrismaClient;
    systemSlug?: string; // Added to update LastMessageCache on success
    fullContent?: any; // Added to preserve non-text events (images, audio)
}

export interface DeadLetter {
    id: string;
    timestamp: number;
    roomId: string;
    ghostUserId: string;
    plaintext: string;
    errorReason: string;
}

class MessageQueueService {
    private RoomQueues: Map<string, QueueItem[]> = new Map();
    private RoomLocks: Map<string, boolean> = new Map();
    private DeadLetterVault: Map<string, DeadLetter> = new Map();

    constructor() {
        // Garbage collection for Dead Letters (> 24h old)
        setInterval(() => this.runGarbageCollection(), 3600000); // 1 hour
    }

    private runGarbageCollection() {
        const now = Date.now();
        for (const [id, item] of this.DeadLetterVault.entries()) {
            if (now - item.timestamp > 86400000) {
                this.DeadLetterVault.delete(id);
            }
        }
    }

    /**
     * Enqueues a message for a ghost to send and triggers processing.
     */
    public enqueue(
        roomId: string,
        senderId: string,
        ghostIntent: Intent,
        plaintext: string,
        relatesTo?: any,
        prisma?: PrismaClient,
        systemSlug?: string,
        format?: string,
        formattedBody?: string,
        fullContent?: any
    ) {
        const queue = this.RoomQueues.get(roomId) || [];
        queue.push({
            id: uuidv4(),
            roomId,
            senderId,
            ghostIntent,
            plaintext,
            format,
            formattedBody,
            attempts: 0,
            relatesTo,
            prisma,
            systemSlug,
            fullContent
        });
        this.RoomQueues.set(roomId, queue);

        // Fire and forget
        this.processQueue(roomId).catch(err => {
            console.error(`[Queue] Fatal error in queue processor for ${roomId}:`, err);
        });
    }

    /**
     * Returns all current dead letters.
     */
    public getDeadLetters(): DeadLetter[] {
        return Array.from(this.DeadLetterVault.values());
    }

    /**
     * Deletes a specific dead letter.
     */
    public deleteDeadLetter(id: string) {
        this.DeadLetterVault.delete(id);
    }

    /**
     * Internal processor loop for a specific room.
     */
    private async processQueue(roomId: string) {
        // Mutex check
        if (this.RoomLocks.get(roomId)) return;
        this.RoomLocks.set(roomId, true);

        try {
            const queue = this.RoomQueues.get(roomId);
            if (!queue) return;

            while (queue.length > 0) {
                const item = queue[0]; // Peek

                try {
                    // Try to send the event
                    // Use the original full content payload if available to preserve file/image metadata
                    const payload: any = item.fullContent ? { ...item.fullContent } : { msgtype: "m.text", body: item.plaintext };
                    console.log(`[MQ] Building payload. item.fullContent present? ${!!item.fullContent}`);
                    
                    // Always ensure body is correctly stripped of proxy tags
                    if (item.fullContent && item.plaintext) {
                        payload.body = item.plaintext;
                    }

                    if (item.format && item.formattedBody) {
                        payload.format = item.format;
                        payload.formatted_body = item.formattedBody;
                    }
                    if (item.relatesTo) {
                        payload["m.relates_to"] = item.relatesTo;
                    }
                    
                    console.log(`[MQ] Sending payload to Matrix:`, JSON.stringify(payload, null, 2));

                    const result: any = await sendEncryptedEvent(
                        item.ghostIntent,
                        item.roomId,
                        "m.room.message",
                        payload,
                        cryptoManager,
                        asToken,
                        item.prisma
                    );

                    // Success! Update Last Message Cache if system info is present
                    if (item.systemSlug && result?.event_id) {
                        const isReplacement = item.relatesTo?.rel_type === "m.replace";
                        const rootId = isReplacement ? (item.relatesTo.event_id || item.relatesTo.id) : result.event_id;
                        
                        const currentLast = lastMessageCache.get(item.roomId, item.systemSlug);
                        
                        // ONLY update if it's a brand new message OR if it's an edit to the message we currently think is 'last'
                        if (!isReplacement || (currentLast && currentLast.rootEventId === rootId)) {
                            const newRootContent = !isReplacement ? payload : (currentLast ? currentLast.rootContent : payload);
                            lastMessageCache.set(item.roomId, item.systemSlug, {
                                rootEventId: rootId,
                                latestEventId: result.event_id,
                                latestContent: payload,
                                rootContent: newRootContent,
                                sender: item.ghostIntent.userId
                            });
                        }
                    }

                    // Success! Remove from queue.
                    queue.shift();
                } catch (error: any) {
                    await this.handleSendError(item, queue, error);
                }
            }
        } finally {
            this.RoomLocks.set(roomId, false);
        }
    }

    /**
     * Analyzes errors, applies retries, and triggers fallbacks.
     */
    private async handleSendError(item: QueueItem, queue: QueueItem[], error: any) {
        const isFatal = this.isFatalError(error);

        if (!isFatal) {
            item.attempts++;
            if (item.attempts <= 3) {
                // Exponential backoff
                const waitTime = Math.pow(2, item.attempts) * 1000 + (Math.random() * 500);
                console.warn(`[Queue] Transient error sending for ${item.ghostIntent.userId} in ${item.roomId}. Retrying in ${Math.round(waitTime)}ms...`, error.message);
                await sleep(waitTime);
                return; // Continue outer while loop to retry exact item
            }
        }

        // --- Fallback 1: The plural_bot Bailout ---
        console.error(`[Queue] Delivery failed for ${item.ghostIntent.userId}. Triggering Fallback 1 (Bot Bailout). Error:`, error.message);
        queue.shift(); // Remove the failing item

        try {
            const bridge = getBridge();
            if (!bridge) throw new Error("Bridge not initialized");
            
            const botUserId = bridge.getBot().getUserId();
            const botIntent = bridge.getIntent(botUserId);
            
            // We use sendEncryptedEvent for the bot as well to ensure security
            await sendEncryptedEvent(
                botIntent,
                item.roomId,
                "m.room.message",
                {
                    msgtype: "m.notice",
                    body: `⚠️ Delivery Failed for ${item.ghostIntent.userId}:\n\n> ${item.plaintext}\n\n(Error: ${error.message || "Unknown"})`
                },
                cryptoManager,
                asToken,
                item.prisma
            );
            return; // Fallback 1 succeeded.
        } catch (botError: any) {
            console.error(`[Queue] Fallback 1 (Bot Bailout) failed! Triggering Fallback 2 (Dead Letter Vault).`, botError.message);
            
            // --- Fallback 2: The Dead Letter Vault ---
            const dl: DeadLetter = {
                id: item.id,
                timestamp: Date.now(),
                roomId: item.roomId,
                ghostUserId: item.ghostIntent.userId,
                plaintext: item.plaintext,
                errorReason: error.message || "Unknown error"
            };
            this.DeadLetterVault.set(dl.id, dl);
        }
    }

    /**
     * Determines if an error is fatal (should not be retried).
     */
    private isFatalError(error: any): boolean {
        // Matrix API errors often have an HTTP status on error.status or error.httpStatus
        const status = error.status || error.httpStatus;
        if (status) {
            if (status === 400 || status === 403 || status === 401 || status === 404) {
                return true;
            }
        }

        const msg = error.message ? error.message.toLowerCase() : "";
        if (msg.includes("forbidden") || msg.includes("not found") || msg.includes("decrypt") || msg.includes("unrecognized")) {
            return true;
        }

        return false;
    }
}

export const messageQueue = new MessageQueueService();
