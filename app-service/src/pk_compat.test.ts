import { generatePkJson } from './import';
import { prisma } from './bot';

jest.mock('./bot', () => ({
    prisma: {
        accountLink: {
            findUnique: jest.fn(),
        }
    }
}));

describe('PluralKit Compatibility', () => {
    it('should generate a JSON that strictly follows PluralKit schema from dump', async () => {
        const mockSystem = {
            id: 'sys-uuid',
            slug: 'test-sys',
            pkId: 'oryii', // From dump
            name: 'Seraphim',
            systemTag: '⛩️ Seraphim ⛩️',
            description: 'A test system description',
            pronouns: 'They/Them',
            avatarUrl: 'mxc://localhost/system-avatar',
            banner: null,
            color: '8f00ff',
            createdAt: new Date('2020-12-23T16:37:19.051Z'),
            members: [
                {
                    id: 'mem-uuid',
                    slug: 'alice',
                    pkId: 'udhgx', // From dump
                    name: 'Riven',
                    displayName: 'Riven 🌸',
                    color: '00ff30',
                    pronouns: 'She/Her',
                    avatarUrl: 'mxc://localhost/alice-avatar',
                    description: 'A test member description',
                    proxyTags: [{ prefix: 'Ri:', suffix: '' }],
                    createdAt: new Date('2024-03-29T14:03:06.747Z')
                }
            ]
        };

        (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({
            system: mockSystem
        });

        const pkJson: any = await generatePkJson('@user:localhost');

        expect(pkJson).toBeDefined();
        // Check core PK fields
        expect(pkJson.version).toBe(2);
        expect(pkJson.id).toBe('oryii');
        expect(pkJson.uuid).toBe('sys-uuid');
        expect(pkJson.name).toBe('Seraphim');
        expect(pkJson.tag).toBe('⛩️ Seraphim ⛩️');
        expect(pkJson.description).toBe('A test system description');
        expect(pkJson.color).toBe('8f00ff');
        
        // Ensure NO pluralmatrix_version in the PK-specific export
        expect(pkJson.config.pluralmatrix_version).toBeUndefined();

        expect(pkJson.members).toHaveLength(1);
        const m = pkJson.members[0];
        expect(m.id).toBe('udhgx');
        expect(m.uuid).toBe('mem-uuid');
        expect(m.name).toBe('Riven');
        expect(m.display_name).toBe('Riven 🌸');
        expect(m.color).toBe('00ff30');
        
        // Verify proxy tags format matches dump (suffix null if empty)
        expect(m.proxy_tags).toEqual([{ prefix: 'Ri:', suffix: null }]);
        
        // Ensure privacy fields are present as PK expects them
        expect(pkJson.privacy).toBeDefined();
        expect(pkJson.privacy.name_privacy).toBe('public');
        expect(m.privacy).toBeDefined();
        expect(m.privacy.visibility).toBe('public');
    });

    it('should generate random pkIds if missing', async () => {
        const mockSystem = {
            id: 'sys-uuid',
            slug: 'test-sys',
            pkId: null,
            name: 'No ID System',
            createdAt: new Date(),
            members: [
                {
                    id: 'mem-uuid',
                    slug: 'alice',
                    pkId: null,
                    name: 'Alice',
                    proxyTags: [],
                    createdAt: new Date()
                }
            ]
        };

        (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({
            system: mockSystem
        });

        const pkJson: any = await generatePkJson('@user:localhost');
        expect(pkJson.id).toMatch(/^[a-z]{5}$/);
        expect(pkJson.members[0].id).toMatch(/^[a-z]{5}$/);
    });
});
