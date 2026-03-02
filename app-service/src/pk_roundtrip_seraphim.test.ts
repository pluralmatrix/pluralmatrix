import { importFromPluralKit, generatePkJson } from './import';
import { prisma, getBridge } from './bot';
import * as importModule from './import';
import fs from 'fs';
import path from 'path';

// Mock fetch globally
(global as any).fetch = jest.fn().mockResolvedValue({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    headers: new Map([['content-type', 'image/png']])
});

jest.mock('./bot', () => ({
    prisma: {
        system: {
            upsert: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
            create: jest.fn(),
        },
        accountLink: {
            findUnique: jest.fn(),
            upsert: jest.fn(),
        },
        member: {
            upsert: jest.fn(),
            findMany: jest.fn(),
        }
    },
    getBridge: jest.fn().mockReturnValue({
        getBot: jest.fn().mockReturnValue({
            getClient: jest.fn().mockReturnValue({
                uploadContent: jest.fn().mockResolvedValue('mxc://mock/avatar')
            })
        }),
        getIntent: jest.fn().mockReturnValue({
            ensureRegistered: jest.fn().mockResolvedValue({}),
            setDisplayName: jest.fn().mockResolvedValue({}),
            setAvatarUrl: jest.fn().mockResolvedValue({}),
            matrixClient: {
                getJoinedRooms: jest.fn().mockResolvedValue([])
            }
        })
    })
}));

// Helper to strip non-comparable fields
function cleanForCompare(data: any) {
    if (!data) return data;
    const clean = JSON.parse(JSON.stringify(data));
    
    // Fields to ignore globally or specifically
    const ignore = [
        'uuid', 'created', 'avatar_url', 'banner', 'webhook_url', 
        'webhook_avatar_url', 'message_count', 'last_message_timestamp', 
        'accounts', 'switches', 'groups', 'privacy'
    ];
    
    const recursiveClean = (obj: any) => {
        if (Array.isArray(obj)) {
            obj.forEach(recursiveClean);
        } else if (obj && typeof obj === 'object') {
            for (const key of ignore) {
                delete obj[key];
            }
            Object.values(obj).forEach(recursiveClean);
        }
    };

    recursiveClean(clean);
    return clean;
}

describe('Seraphim PK Roundtrip', () => {
    let migrateSpy: jest.SpyInstance;
    let syncSpy: jest.SpyInstance;

    beforeAll(() => {
        // Spy on internal functions to make them fast and avoid external hits
        migrateSpy = jest.spyOn(importModule, 'migrateAvatar').mockImplementation((url) => Promise.resolve({ mxcUrl: url }));
        syncSpy = jest.spyOn(importModule, 'syncGhostProfile').mockImplementation(() => Promise.resolve());
    });

    afterAll(() => {
        migrateSpy.mockRestore();
        syncSpy.mockRestore();
    });

    it('should perfectly roundtrip the Seraphim dump (excluding groups, privacy and images)', async () => {
        const dumpPath = path.join(__dirname, '../test-data/pk_dump_seraphim.json');
        const originalJson = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));

        // State for our mock DB
        let storedSystem: any = {
            id: 'mock-sys-uuid',
            slug: 'mock-slug',
            createdAt: new Date(),
            updatedAt: new Date()
        };
        let storedMembers: Map<string, any> = new Map();

        (prisma.system.findUnique as jest.Mock).mockResolvedValue(null);

        (prisma.system.create as jest.Mock).mockImplementation((args) => {
            storedSystem = { 
                ...storedSystem,
                ...args.data,
            };
            return Promise.resolve(storedSystem);
        });

        (prisma.system.upsert as jest.Mock).mockImplementation((args) => {
            storedSystem = { 
                ...storedSystem,
                ...(args.create || {}),
                slug: args.create?.slug || args.where?.slug || storedSystem.slug,
            };
            return Promise.resolve(storedSystem);
        });

        (prisma.system.update as jest.Mock).mockImplementation((args) => {
            storedSystem = { ...storedSystem, ...args.data };
            return Promise.resolve(storedSystem);
        });

        (prisma.member.upsert as jest.Mock).mockImplementation((args) => {
            const member = { 
                id: `mock-mem-uuid-${args.create?.pkId || Math.random()}`,
                createdAt: new Date(),
                updatedAt: new Date(),
                ...args.create,
            };
            storedMembers.set(member.slug, member);
            return Promise.resolve(member);
        });

        // link lookup
        (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.accountLink.upsert as jest.Mock).mockResolvedValue({});

        // 1. Run Import
        await importFromPluralKit('@seraphim:localhost', originalJson);

        // 2. Setup mock for Export lookup
        (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({
            system: {
                ...storedSystem,
                members: Array.from(storedMembers.values())
            }
        });

        // 3. Run Export
        const exportedJson = await generatePkJson('@seraphim:localhost');

        // 4. Compare
        const cleanOriginal = cleanForCompare(originalJson);
        const cleanExported = cleanForCompare(exportedJson);

        // Sort members by ID for stable comparison
        cleanOriginal.members.sort((a: any, b: any) => a.id.localeCompare(b.id));
        cleanExported.members.sort((a: any, b: any) => a.id.localeCompare(b.id));

        expect(cleanExported.id).toBe(cleanOriginal.id);
        expect(cleanExported.name).toBe(cleanOriginal.name);
        expect(cleanExported.members.length).toBe(cleanOriginal.members.length);
        
        expect(cleanExported).toEqual(cleanOriginal);
    });
});
