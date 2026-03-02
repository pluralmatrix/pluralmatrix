import { exportSystemZip, importSystemZip } from './import';
import { prisma } from './bot';
import { PassThrough } from 'stream';
import AdmZip from 'adm-zip';

const mockBotClient = {
    uploadContent: jest.fn().mockResolvedValue('mxc://new/avatar')
};

jest.mock('./bot', () => ({
    prisma: {
        system: {
            upsert: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
            create: jest.fn(),
        },
        member: {
            upsert: jest.fn(),
            findMany: jest.fn(),
            update: jest.fn(),
            create: jest.fn(),
        },
        accountLink: {
            findUnique: jest.fn(),
            upsert: jest.fn(),
            create: jest.fn(),
        }
    },
    getBridge: jest.fn().mockReturnValue({
        getBot: () => ({ getClient: () => mockBotClient }),
        getIntent: jest.fn().mockReturnValue({
            ensureRegistered: jest.fn().mockResolvedValue({}),
            setDisplayName: jest.fn().mockResolvedValue({}),
            setAvatarUrl: jest.fn().mockResolvedValue({}),
            matrixClient: { getJoinedRooms: jest.fn().mockResolvedValue([]) }
        })
    })
}));

describe('PluralMatrix Backup Roundtrip', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        global.fetch = jest.fn().mockImplementation(() => Promise.resolve({
            ok: true,
            headers: { get: () => 'image/png' },
            arrayBuffer: () => Promise.resolve(Buffer.from('fake-image-data'))
        }));
    });

    it('should perfectly roundtrip a full PluralMatrix backup ZIP', async () => {
        const mxid = '@owner:localhost';
        const mockSystem = {
            id: 'sys-uuid',
            slug: 'seraphim-main',
            pkId: 'oryii',
            name: 'Seraphim System',
            description: 'Internal backup test',
            systemTag: '⛩️',
            createdAt: new Date(),
            members: [
                {
                    id: 'mem-1',
                    slug: 'riven-fox',
                    pkId: 'udhgx',
                    name: 'Riven',
                    displayName: 'Riven (Judge)',
                    avatarUrl: 'mxc://localhost/media123',
                    proxyTags: [{ prefix: 'Ri:', suffix: null }]
                }
            ]
        };

        (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({ system: mockSystem });

        // 1. Export to ZIP
        const chunks: any[] = [];
        const zipStream = new PassThrough();
        zipStream.on('data', (chunk) => chunks.push(chunk));
        
        const [zipBuffer] = await Promise.all([
            new Promise<Buffer>((resolve) => {
                zipStream.on('end', () => resolve(Buffer.concat(chunks)));
            }),
            exportSystemZip(mxid, zipStream, 'backup')
        ]);

        // 2. Setup mocks for Import
        // importFromPluralKit calls findUnique for accountLink once.
        // importAvatarsZip calls findUnique for accountLink once.
        (prisma.accountLink.findUnique as jest.Mock)
            .mockResolvedValueOnce(null) // 1. importFromPluralKit check
            .mockResolvedValue({
                system: {
                    ...mockSystem,
                    id: 'new-sys-id',
                    slug: 'seraphim-main',
                    members: mockSystem.members.map(m => ({ ...m, id: 'new-mem-id' }))
                }
            }); // 2. importAvatarsZip call

        let savedSystem: any;
        let savedMember: any;

        (prisma.system.create as jest.Mock).mockImplementation((args) => {
            savedSystem = { ...args.data, id: 'new-sys-id' };
            return Promise.resolve(savedSystem);
        });

        (prisma.member.upsert as jest.Mock).mockImplementation((args) => {
            savedMember = { ...args.create, id: 'new-mem-id' };
            return Promise.resolve(savedMember);
        });

        (prisma.member.update as jest.Mock).mockImplementation((args) => {
            return Promise.resolve({ ...mockSystem.members[0], ...args.data, id: 'new-mem-id' });
        });

        (prisma.accountLink.upsert as jest.Mock).mockResolvedValue({});

        // 3. Run Import
        const importResult = await importSystemZip(mxid, zipBuffer);

        // 4. Verify Results
        expect(importResult.count).toBe(1);
        expect(importResult.systemSlug).toBe('seraphim-main');

        expect(prisma.system.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ slug: 'seraphim-main' })
        }));

        expect(prisma.member.upsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({ slug: 'riven-fox' })
        }));

        expect(mockBotClient.uploadContent).toHaveBeenCalled();
    });
});
