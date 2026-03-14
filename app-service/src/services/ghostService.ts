import { getBridge, cryptoManager, prisma } from '../bot';
import { messageQueue } from './queue/MessageQueue';
import { registerDevice } from '../crypto/crypto-utils';
import { config } from '../config';

const DOMAIN = config.synapseDomain;

export interface GhostMessageOptions {
    roomId: string;
    cleanContent: string;
    format?: string;
    formattedBody?: string;
    relatesTo?: Record<string, unknown>;
    fullContent?: Record<string, unknown>;
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
    senderId: string;
}

export const sendGhostMessage = async (options: GhostMessageOptions) => {
    const { roomId, cleanContent, format, formattedBody, relatesTo, fullContent, system, member, senderId } = options;

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
        } catch {
            // If join fails, try to have the bot invite the ghost then join again
            try {
                await bridge.getIntent().invite(roomId, ghostUserId);
                await intent.join(roomId);
            } catch {
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
        } catch {
            // Ignore profile update failures
        }

        messageQueue.enqueue(roomId, senderId, intent, cleanContent, relatesTo, prisma, system.slug, format, formattedBody, fullContent);
    } catch (e: unknown) {
        console.error(`[GhostService] Failed to queue message for ${member.slug}:`, (e as Error).message);
    }
};
