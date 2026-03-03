import { OlmMachineManager } from "./OlmMachineManager";
import { OlmMachine, UserId, RoomId, DeviceLists } from "@matrix-org/matrix-sdk-crypto-nodejs";
import { maskMxid } from "../utils/privacy";

// Minimal event interface
interface MatrixEvent {
    type: string;
    sender: string;
    room_id?: string;
    content: any;
    event_id?: string;
    to_user_id?: string; // For to-device events in AS transactions (MSC2409)
    [key: string]: any;
}

interface TransactionBody {
    events: MatrixEvent[];
    "de.sorunome.msc2409.ephemeral"?: MatrixEvent[];
    "org.matrix.msc2409.ephemeral"?: MatrixEvent[];
    ephemeral?: MatrixEvent[];
    "de.sorunome.msc2409.to_device"?: MatrixEvent[];
    "org.matrix.msc3202.to_device"?: MatrixEvent[];
    to_device?: MatrixEvent[];
    [key: string]: any;
}

export class TransactionRouter {
    private manager: OlmMachineManager;
    private botUserId: string;
    private onRequestCallback: (userId: string) => Promise<void>;
    private onDecryptedEvent: (event: any) => Promise<void>;

    constructor(
        manager: OlmMachineManager, 
        botUserId: string, 
        onRequestCallback: (userId: string) => Promise<void>,
        onDecryptedEvent: (event: any) => Promise<void>
    ) {
        this.manager = manager;
        this.botUserId = botUserId;
        this.onRequestCallback = onRequestCallback;
        this.onDecryptedEvent = onDecryptedEvent;
    }

    async processTransaction(transaction: TransactionBody) {
        // --- STEP 1: Process To-Device/Ephemeral Events FIRST ---
        const toDeviceEvents: MatrixEvent[] = [
            ...(transaction.to_device || []),
            ...(transaction["org.matrix.msc3202.to_device"] || []),
            ...(transaction["de.sorunome.msc2409.to_device"] || []),
            ...(transaction.ephemeral || []),
            ...(transaction["org.matrix.msc2409.ephemeral"] || []),
            ...(transaction["de.sorunome.msc2409.ephemeral"] || []),
        ];

        const processedUsers = new Set<string>();

        if (toDeviceEvents.length > 0) {
            console.log(`[Router] Transaction Step 1: Processing ${toDeviceEvents.length} to-device/ephemeral events...`);
            for (const event of toDeviceEvents) {
                if (event.to_user_id) {
                    await this.routeToDeviceEvent(event);
                    processedUsers.add(event.to_user_id);
                }
            }

            // Sync database/requests for all users who received keys
            for (const userId of processedUsers) {
                await this.onRequestCallback(userId);
            }
        }

        // --- STEP 2: Process Timeline Events (PDUs) SECOND ---
        if (transaction.events && Array.isArray(transaction.events)) {
            const failedSenders = new Set<string>();
            let hasEncrypted = false;

            for (const event of transaction.events) {
                if (event.type === "m.room.encrypted" && event.room_id) {
                    hasEncrypted = true;
                    await this.routeTimelineEventToBot(event, failedSenders);
                }
            }
            
            // Consolidate "nudges" for all senders we failed to decrypt from
            if (failedSenders.size > 0) {
                try {
                    const machine = await this.manager.getMachine(this.botUserId);
                    const userIds = Array.from(failedSenders).map(s => new UserId(s));
                    await machine.updateTrackedUsers(userIds);
                } catch (e) {
                    console.error("[Router] Failed to perform consolidated tracking nudge:", e);
                }
            }

            // If the bot decrypted anything OR failed to decrypt anything, 
            // it likely has new outgoing requests (KeysQuery, etc)
            if (hasEncrypted) {
                await this.onRequestCallback(this.botUserId);
            }
        }
    }

    private async routeTimelineEventToBot(event: MatrixEvent, failedSenders: Set<string>) {
        try {
            // Attempting decryption of room event
            const machine = await this.manager.getMachine(this.botUserId);
            
            const eventJson = JSON.stringify(event);
            const roomId = new RoomId(event.room_id!);
            const decrypted = await machine.decryptRoomEvent(eventJson, roomId);
            
            if (decrypted.event) {
                // Decryption successful: Processing cleartext event
                const clearEvent = JSON.parse(decrypted.event);
                clearEvent.room_id = event.room_id;
                clearEvent.event_id = event.event_id;
                clearEvent.sender = event.sender;
                await this.onDecryptedEvent(clearEvent);
            }
        } catch (e) {
            console.error(`[Router] DECRYPTION FAILURE for ${event.event_id}:`, e);
            // Collect sender for consolidated nudge at end of transaction
            failedSenders.add(event.sender);
        }
    }

    private async routeToDeviceEvent(event: MatrixEvent) {
        const targetUserId = event.to_user_id!;
        try {
            const machine = await this.manager.getMachine(targetUserId);
            const clientEvent = { ...event };
            delete clientEvent.to_user_id;

            const toDeviceEventsJson = JSON.stringify([clientEvent]);
            
            await machine.receiveSyncChanges(
                toDeviceEventsJson, 
                new DeviceLists(), 
                {}, 
                []
            );
        } catch (e) {
             console.error(`[Router] Failed to route to-device event to ${maskMxid(targetUserId)}:`, e);
        }
    }
}
