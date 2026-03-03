import { PrismaClient, System, Member } from '@prisma/client';
import { config } from '../config';

interface CachedSystem {
    id: string;
    slug: string;
    name: string | null;
    systemTag: string | null;
    autoproxyId: string | null;
    members: Member[];
}

interface CacheEntry {
    data: CachedSystem | null; // null means "we checked DB and found nothing", so don't check again for a bit
    expiresAt: number;
}

export class ProxyCacheService {
    private cache = new Map<string, CacheEntry>();
    private readonly TTL_MS = config.cacheTtlSeconds * 1000;

    /**
     * Retrieves system rules from cache or fetches from DB if missing/expired.
     */
    async getSystemRules(mxid: string, prisma: PrismaClient): Promise<CachedSystem | null> {
        const now = Date.now();
        const entry = this.cache.get(mxid);

        if (entry && entry.expiresAt > now) {
            return entry.data;
        }

        // Cache Miss or Expired
        return this.fetchAndCache(mxid, prisma);
    }

    /**
     * Forces a refresh of the cache for a specific user.
     * Call this after any mutation (Create/Update/Delete member or system).
     */
    invalidate(mxid: string) {
        this.cache.delete(mxid);
    }

    private async fetchAndCache(mxid: string, prisma: PrismaClient): Promise<CachedSystem | null> {
        const link = await prisma.accountLink.findUnique({
            where: { matrixId: mxid },
            include: { 
                system: {
                    include: { members: true }
                }
            }
        });

        const system = link?.system || null;

        // We store the result (even if null) to prevent hammering DB for non-existent users
        this.cache.set(mxid, {
            data: system,
            expiresAt: Date.now() + this.TTL_MS
        });

        return system;
    }
    
    _clear() {
        this.cache.clear();
    }
}

interface LastMessage {
    rootEventId: string;
    latestEventId: string;
    latestContent: any;
    sender: string;
}

/**
 * Remembers the last message sent by each system in each room.
 * This makes 'pk;e' and 'pk;rp' instant and reliable even in busy rooms.
 */
export class LastMessageCacheService {
    private cache = new Map<string, LastMessage>();

    private makeKey(roomId: string, systemSlug: string): string {
        return `${roomId}:${systemSlug}`;
    }

    set(roomId: string, systemSlug: string, data: LastMessage) {
        this.cache.set(this.makeKey(roomId, systemSlug), data);
    }

    get(roomId: string, systemSlug: string): LastMessage | undefined {
        return this.cache.get(this.makeKey(roomId, systemSlug));
    }

    delete(roomId: string, systemSlug: string) {
        this.cache.delete(this.makeKey(roomId, systemSlug));
    }

    _clear() {
        this.cache.clear();
    }
}

export const proxyCache = new ProxyCacheService();
export const lastMessageCache = new LastMessageCacheService();
