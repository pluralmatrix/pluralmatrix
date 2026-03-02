import { importFromPluralKit, generatePkJson, generateBackupJson, stringifyWithEscapedUnicode, exportSystemZip, importAvatarsZip } from './import';
import { prisma } from './bot';
import { PassThrough } from 'stream';
import AdmZip from 'adm-zip';
import * as importModule from './import';

// Stable mocks for deep nesting
const mockBotClient = {
    uploadContent: jest.fn().mockResolvedValue('mxc://mock')
};

const mockIntent = {
    ensureRegistered: jest.fn(),
    setDisplayName: jest.fn(),
    setAvatarUrl: jest.fn(),
    leave: jest.fn(),
    matrixClient: {
        getJoinedRooms: jest.fn(),
    }
};

const mockBridge = {
    getBot: () => ({
        getClient: () => mockBotClient
    }),
    getIntent: jest.fn().mockReturnValue(mockIntent)
};

// Mock bot dependencies
jest.mock('./bot', () => ({
    ...jest.requireActual('./bot'),
    getBridge: jest.fn(() => mockBridge),
    prisma: {
        system: {
            upsert: jest.fn(),
            findUnique: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
        },
        member: {
            upsert: jest.fn(),
            findMany: jest.fn(),
            update: jest.fn(),
            create: jest.fn(),
        },
        accountLink: {
            findUnique: jest.fn(),
            create: jest.fn(),
        }
    },
}));

async function streamToBuffer(stream: PassThrough): Promise<Buffer> {
    const chunks: any[] = [];
    return new Promise((resolve, reject) => {
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('error', (err) => reject(err));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
}

describe('PluralKit Roundtrip', () => {
    let imageValidationSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        imageValidationSpy = jest.spyOn(importModule, 'validateImageBuffer').mockReturnValue({ valid: true });
        // Mock fetch for avatar migration globally
        global.fetch = jest.fn().mockImplementation((url) => {
            return Promise.resolve({
                ok: true,
                headers: {
                    get: (name: string) => name.toLowerCase() === 'content-type' ? 'image/png' : null
                },
                arrayBuffer: () => Promise.resolve(new Uint8Array(Buffer.from('fake-image-binary-data-123')).buffer)
            } as any);
        });
    });

    it('should import and then export with consistent data', async () => {
        const mockPkData = {
            version: 2,
            id: 'abcde',
            name: 'Test System',
            tag: '[Test]',
            members: [
                {
                    id: 'mem01',
                    name: 'Alice',
                    display_name: 'Alice 🌸',
                    description: 'A test member',
                    pronouns: 'She/Her',
                    color: 'ff00ff',
                    avatar_url: 'https://example.com/avatar.png',
                    proxy_tags: [{ prefix: 'a:', suffix: null }]
                }
            ]
        };

        let savedSystem: any;
        let savedMembers: any[] = [];

        (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.system.findUnique as jest.Mock).mockResolvedValue(null);

        (prisma.system.create as jest.Mock).mockImplementation((args) => {
            savedSystem = { ...args.data, id: 'sys-uuid', createdAt: new Date() };
            return Promise.resolve(savedSystem);
        });

        (prisma.member.upsert as jest.Mock).mockImplementation((args) => {
            const member = { ...args.create, id: 'mock-uuid', createdAt: new Date() };
            savedMembers.push(member);
            return Promise.resolve(member);
        });

        // 1. Run Import
        await importFromPluralKit('@user:localhost', mockPkData);

        // 2. Setup mock for Export
        (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({
            system: {
                ...savedSystem,
                members: savedMembers
            }
        });

        // 3. Run Export
        const exportedData = await generatePkJson('@user:localhost');

        // 4. Verify roundtrip consistency
        expect(exportedData).toBeDefined();
        expect(exportedData?.name).toBe(mockPkData.name);
        expect(exportedData?.tag).toBe(mockPkData.tag);
        expect(exportedData?.members).toHaveLength(1);
        
        const m = exportedData?.members[0];
        expect(m?.name).toBe(mockPkData.members[0].name);
        expect(m?.display_name).toBe(mockPkData.members[0].display_name);
        expect(m?.description).toBe(mockPkData.members[0].description);
        expect(m?.pronouns).toBe(mockPkData.members[0].pronouns);
        expect(m?.color).toBe(mockPkData.members[0].color);
        expect(m?.proxy_tags).toEqual(mockPkData.members[0].proxy_tags);
    });

    it('should preserve full slugs and reuse IDs during PluralMatrix roundtrip', async () => {
        const longSlug = 'very-long-member-slug-that-should-not-be-truncated';
        const systemSlug = 'my-custom-system-slug';

        const mockPkData = {
            version: 2,
            id: systemSlug,
            name: 'Test System',
            config: {
                pluralmatrix_version: 1
            },
            members: [
                {
                    id: longSlug,
                    name: 'Alice',
                    proxy_tags: [{ prefix: 'a:', suffix: null }]
                }
            ]
        };

        let savedSystem: any;
        let savedMembers: any[] = [];

        (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.system.findUnique as jest.Mock).mockResolvedValue(null);

        (prisma.system.create as jest.Mock).mockImplementation((args) => {
            savedSystem = { ...args.data, id: 'sys-uuid', createdAt: new Date() };
            return Promise.resolve(savedSystem);
        });

        (prisma.member.upsert as jest.Mock).mockImplementation((args) => {
            const member = { ...args.create, id: 'mem-uuid', createdAt: new Date() };
            savedMembers.push(member);
            return Promise.resolve(member);
        });

        // 1. Run Import
        await importFromPluralKit('@user:localhost', mockPkData);

        // Verify slugs were preserved exactly as IDs
        expect(savedSystem.slug).toBe(systemSlug);
        expect(savedMembers[0].slug).toBe(longSlug);

        // 2. Setup mock for Export
        (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({
            system: {
                ...savedSystem,
                members: savedMembers
            }
        });

        // 3. Run Export
        const exportedData = await generateBackupJson('@user:localhost');

        // 4. Verify export preserved the long slugs
        expect(exportedData?.pluralmatrix_metadata?.version).toBe(2);
        expect(exportedData?.id).toBe(systemSlug);
        expect(exportedData?.members[0].id).toBe(longSlug);
    });

    it('should update an existing system slug during import', async () => {
        const mockPkData = {
            version: 2,
            name: 'Brand New Name',
            members: []
        };

        const existingSystem = {
            id: 'sys-1',
            slug: 'old-slug',
            name: 'Old Name'
        };

        (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({
            system: existingSystem
        });
        (prisma.system.findUnique as jest.Mock).mockResolvedValue(null); // No collision
        (prisma.system.update as jest.Mock).mockImplementation((args) => {
            return Promise.resolve({ ...existingSystem, ...args.data });
        });

        await importFromPluralKit('@user:localhost', mockPkData);

        expect(prisma.system.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'sys-1' },
            data: expect.objectContaining({
                slug: 'brand-new-name'
            })
        }));
    });

    describe('stringifyWithEscapedUnicode', () => {
        it('should escape non-ASCII characters correctly', () => {
            const data = { name: "Lily 🌸", role: "Goddess é" };
            const escaped = stringifyWithEscapedUnicode(data);
            
            // Should contain \u escapes
            expect(escaped).toContain("\\ud83c\\udf38"); // 🌸
            expect(escaped).toContain("\\u00e9"); // é
            
            // Should be valid JSON when parsed
            const parsed = JSON.parse(escaped);
            expect(parsed.name).toBe("Lily 🌸");
            expect(parsed.role).toBe("Goddess é");
        });
    });

    describe('Avatar ZIP Roundtrip', () => {
        it('should export avatars to a ZIP stream with correct data and README', async () => {
            const fakeImageData = Buffer.from('fake-image-binary-data-123');
            const mockSystem = {
                id: 'sys1',
                slug: 'sys1-slug',
                createdAt: new Date(),
                members: [
                    { id: 'm1', name: 'Alice', slug: 'alice', avatarUrl: 'mxc://localhost/media1', createdAt: new Date(), proxyTags: [] }
                ]
            };
            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({ system: mockSystem });

            // 1. PK Export should have README and placeholder URLs
            const zipStreamPk = new PassThrough();
            const bufferPkPromise = streamToBuffer(zipStreamPk);
            
            await exportSystemZip('@user:localhost', zipStreamPk, 'pk');
            const bufferPk = await bufferPkPromise;

            const zipPk = new AdmZip(bufferPk);
            expect(zipPk.getEntries().some(e => e.entryName === 'README_AVATARS.txt')).toBe(true);
            
            const jsonPk = JSON.parse(zipPk.getEntry('pluralkit_system.json')!.getData().toString());
            expect(jsonPk.members[0].avatar_url).toContain('https://myimageserver/avatars/alice_media1');

            // 2. Backup Export should have the JSON and avatars
            const zipStreamBackup = new PassThrough();
            const bufferBackupPromise = streamToBuffer(zipStreamBackup);
            
            await exportSystemZip('@user:localhost', zipStreamBackup, 'backup');
            const bufferBackup = await bufferBackupPromise;

            const zipBackup = new AdmZip(bufferBackup);
            const entriesBackup = zipBackup.getEntries();

            expect(entriesBackup.some(e => e.entryName === 'pluralmatrix_backup.json')).toBe(true);
            expect(entriesBackup.some(e => e.entryName === 'avatars/alice_media1.png')).toBe(true);
            
            const avatarEntry = entriesBackup.find(e => e.entryName === 'avatars/alice_media1.png');
            expect(avatarEntry?.getData().toString()).toBe(fakeImageData.toString());
        });

        it('should import avatars from a ZIP and re-upload exact binary data', async () => {
            const originalData = Buffer.from('binary-content-to-preserve');
            const mockSystem = {
                id: 'sys1',
                slug: 'mysys',
                members: [
                    { id: 'm1', slug: 'alice', name: 'Alice', avatarUrl: 'mxc://old/media1' }
                ]
            };
            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({ system: mockSystem });
            (prisma.member.update as jest.Mock).mockResolvedValue({ 
                id: 'm1', 
                slug: 'alice', 
                name: 'Alice', 
                avatarUrl: 'mxc://new/uploaded' 
            });

            const zip = new AdmZip();
            zip.addFile('avatars/alice_media1.png', originalData);
            const zipBuffer = zip.toBuffer();

            mockBotClient.uploadContent.mockResolvedValue('mxc://new/uploaded');

            const result = await importAvatarsZip('@user:localhost', zipBuffer);

            expect(result.count).toBe(1);
            expect(result.failedAvatars).toHaveLength(0);
            
            expect(mockBotClient.uploadContent).toHaveBeenCalledWith(
                originalData,
                'image/png',
                'avatars/alice_media1.png'
            );

            expect(prisma.member.update).toHaveBeenCalledWith(expect.objectContaining({
                where: { id: 'm1' },
                data: { avatarUrl: 'mxc://new/uploaded' }
            }));
        });
    });
});
