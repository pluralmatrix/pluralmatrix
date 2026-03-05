import { getBridge, cryptoManager, prisma } from '../bot';
import { sendEncryptedEvent } from '../crypto/encryption';
import { messageQueue } from './queue/MessageQueue';
import { registerDevice } from '../crypto/crypto-utils';
import { config } from '../config';

const DOMAIN = config.synapseDomain;

export interface GhostMessageOptions {
    roomId: string;
    cleanContent: string;
    format?: string;
    formattedBody?: string;
    relatesTo?: any;
    system: {
        slug: string;
        systemTag?: string | null;
    };
    member: {
        slug: string;
        name: string;
        displayName?: string | null;
        avatarUrl?: string | null;
    };
    asToken: string;
    senderId: string;
}

export const sendGhostMessage = async (options: GhostMessageOptions) => {
    const { roomId, cleanContent, format, formattedBody, relatesTo, system, member, asToken, senderId } = options;

    try {
        const bridge = getBridge();
        if (!bridge) {
            console.error("[GhostService] Bridge not initialized!");
            return;
        }

        const ghostUserId = `@_plural_${system.slug}_${member.slug}:${DOMAIN}`;
        const intent = bridge.getIntent(ghostUserId);
        const finalDisplayName = system.systemTag ? `${member.displayName || member.name} ${system.systemTag}` : (member.displayName || member.name);

        await intent.ensureRegistered();
        try {
            await intent.join(roomId);
        } catch (e) {
            // If join fails, try to have the bot invite the ghost then join again
            try {
                await bridge.getIntent().invite(roomId, ghostUserId);
                await intent.join(roomId);
            } catch (e2) {
                // Ignore join failures (might lack permissions)
            }
        }

        const machine = await cryptoManager.getMachine(ghostUserId);
        await registerDevice(intent, machine.deviceId.toString(), prisma, member.slug);

        try {
            await intent.setDisplayName(finalDisplayName);
            if (member.avatarUrl) {
                await intent.setAvatarUrl(member.avatarUrl);
            }
        } catch (e) {
            // Ignore profile update failures
        }

        messageQueue.enqueue(roomId, senderId, intent, cleanContent, relatesTo, prisma, system.slug, format, formattedBody);
    } catch (e: any) {
        console.error(`[GhostService] Failed to queue message for ${member.slug}:`, e.message);
    }
};
