import { ProxyCacheService, LastMessageCacheService } from './services/cache';
import { PrismaClient } from '@prisma/client';

// Mock Prisma
const mockLinkFindUnique = jest.fn();
const mockPrisma = {
    accountLink: {
        findUnique: mockLinkFindUnique
    }
} as unknown as PrismaClient;

describe('ProxyCacheService', () => {
    let cache: ProxyCacheService;
    const TEST_MXID = '@alice:localhost';
    const MOCK_SYSTEM = {
        id: 'sys_123',
        slug: 'alice',
        systemTag: null,
        members: [
            { id: 'm_1', name: 'Bob', proxyTags: [{ prefix: 'b:' }] }
        ]
    };

    beforeEach(() => {
        cache = new ProxyCacheService();
        jest.clearAllMocks();
    });

    test('First call should hit the database', async () => {
        mockLinkFindUnique.mockResolvedValue({ system: MOCK_SYSTEM });

        const result = await cache.getSystemRules(TEST_MXID, mockPrisma);

        expect(result).toEqual(MOCK_SYSTEM);
        expect(mockLinkFindUnique).toHaveBeenCalledTimes(1);
    });

    test('Second call should hit the cache (no DB call)', async () => {
        mockLinkFindUnique.mockResolvedValue({ system: MOCK_SYSTEM });

        // First call (Prime cache)
        await cache.getSystemRules(TEST_MXID, mockPrisma);
        
        // Second call
        const result = await cache.getSystemRules(TEST_MXID, mockPrisma);

        expect(result).toEqual(MOCK_SYSTEM);
        expect(mockLinkFindUnique).toHaveBeenCalledTimes(1); // Still 1!
    });

    test('Invalidation should force a new DB call', async () => {
        mockLinkFindUnique.mockResolvedValue({ system: MOCK_SYSTEM });

        // 1. Prime cache
        await cache.getSystemRules(TEST_MXID, mockPrisma);
        expect(mockLinkFindUnique).toHaveBeenCalledTimes(1);

        // 2. Invalidate
        cache.invalidate(TEST_MXID);

        // 3. Fetch again
        await cache.getSystemRules(TEST_MXID, mockPrisma);
        
        expect(mockLinkFindUnique).toHaveBeenCalledTimes(2); // DB hit again
    });

    test('Should cache null results (non-existent users)', async () => {
        mockLinkFindUnique.mockResolvedValue(null);

        // 1. Fetch non-existent user
        const result1 = await cache.getSystemRules('@ghost:localhost', mockPrisma);
        expect(result1).toBeNull();
        expect(mockLinkFindUnique).toHaveBeenCalledTimes(1);

        // 2. Fetch again
        const result2 = await cache.getSystemRules('@ghost:localhost', mockPrisma);
        expect(result2).toBeNull();
        expect(mockLinkFindUnique).toHaveBeenCalledTimes(1); // Still 1
    });
});

describe('LastMessageCacheService', () => {
    let cache: LastMessageCacheService;
    const ROOM_ID = '!room:localhost';
    const SYSTEM_SLUG = 'seraphim';
    const MOCK_DATA = {
        rootEventId: '$root',
        latestEventId: '$edit2',
        latestContent: { body: 'final text' },
        sender: '@_plural_seraphim_lily:localhost'
    };

    beforeEach(() => {
        cache = new LastMessageCacheService();
    });

    test('should store and retrieve data correctly', () => {
        cache.set(ROOM_ID, SYSTEM_SLUG, MOCK_DATA);
        const result = cache.get(ROOM_ID, SYSTEM_SLUG);
        expect(result).toEqual(MOCK_DATA);
    });

    test('should return undefined for cache misses', () => {
        const result = cache.get(ROOM_ID, 'nonexistent');
        expect(result).toBeUndefined();
    });

    test('should overwrite existing data for the same key', () => {
        cache.set(ROOM_ID, SYSTEM_SLUG, MOCK_DATA);
        const newData = { ...MOCK_DATA, latestEventId: '$new' };
        cache.set(ROOM_ID, SYSTEM_SLUG, newData);
        
        const result = cache.get(ROOM_ID, SYSTEM_SLUG);
        expect(result).toEqual(newData);
    });

    test('should delete entries correctly', () => {
        cache.set(ROOM_ID, SYSTEM_SLUG, MOCK_DATA);
        cache.delete(ROOM_ID, SYSTEM_SLUG);
        
        const result = cache.get(ROOM_ID, SYSTEM_SLUG);
        expect(result).toBeUndefined();
    });

    test('should clear all entries', () => {
        cache.set(ROOM_ID, SYSTEM_SLUG, MOCK_DATA);
        cache.set('!other:room', 'othersys', MOCK_DATA);
        
        cache._clear();
        
        expect(cache.get(ROOM_ID, SYSTEM_SLUG)).toBeUndefined();
        expect(cache.get('!other:room', 'othersys')).toBeUndefined();
    });
});
