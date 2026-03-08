import { ensureUniqueSlug, ensureUniqueGroupSlug } from './slug';
import { PrismaClient } from '@prisma/client';

describe('ensureUniqueSlug', () => {
    let mockPrisma: any;

    beforeEach(() => {
        mockPrisma = {
            system: {
                findUnique: jest.fn()
            }
        };
    });

    it('should return base slug if not taken', async () => {
        mockPrisma.system.findUnique.mockResolvedValue(null);
        const slug = await ensureUniqueSlug(mockPrisma as PrismaClient, 'My System');
        expect(slug).toBe('my-system');
    });

    it('should append -2 if base slug is taken', async () => {
        mockPrisma.system.findUnique
            .mockResolvedValueOnce({ id: 'existing' })
            .mockResolvedValueOnce(null);
            
        const slug = await ensureUniqueSlug(mockPrisma as PrismaClient, 'test');
        expect(slug).toBe('test-2');
    });

    it('should increment counter until free slug found', async () => {
        mockPrisma.system.findUnique
            .mockResolvedValueOnce({ id: '1' })
            .mockResolvedValueOnce({ id: '2' })
            .mockResolvedValueOnce(null);
            
        const slug = await ensureUniqueSlug(mockPrisma as PrismaClient, 'test');
        expect(slug).toBe('test-3');
    });

    it('should return current slug if it belongs to the target system', async () => {
        mockPrisma.system.findUnique.mockResolvedValue({ id: 'current-id' });
        
        const slug = await ensureUniqueSlug(mockPrisma as PrismaClient, 'mine', 'current-id');
        expect(slug).toBe('mine');
    });

    it('should handle complex characters and clean them', async () => {
        mockPrisma.system.findUnique.mockResolvedValue(null);
        const slug = await ensureUniqueSlug(mockPrisma as PrismaClient, '!! My -- System !!');
        expect(slug).toBe('my-system');
    });

    it('should fallback to "system" if base is empty after cleaning', async () => {
        mockPrisma.system.findUnique.mockResolvedValue(null);
        const slug = await ensureUniqueSlug(mockPrisma as PrismaClient, '!!!');
        expect(slug).toBe('system');
    });

    it('should truncate slugs that are too long while keeping them unique', async () => {
        mockPrisma.system.findUnique.mockResolvedValue(null);
        const longBase = 'a'.repeat(100);
        const slug = await ensureUniqueSlug(mockPrisma as PrismaClient, longBase);
        expect(slug.length).toBeLessThanOrEqual(50);
        expect(slug).toBe('a'.repeat(50));
    });
});

describe('ensureUniqueGroupSlug', () => {
    let mockPrisma: any;

    beforeEach(() => {
        mockPrisma = {
            group: {
                findUnique: jest.fn()
            }
        };
    });

    it('should return base slug if not taken in system', async () => {
        mockPrisma.group.findUnique.mockResolvedValue(null);
        const slug = await ensureUniqueGroupSlug(mockPrisma as PrismaClient, 'sys1', 'My Group');
        expect(slug).toBe('my-group');
        expect(mockPrisma.group.findUnique).toHaveBeenCalledWith({
            where: { systemId_slug: { systemId: 'sys1', slug: 'my-group' } },
            select: { id: true }
        });
    });

    it('should return current slug if it belongs to the target group', async () => {
        mockPrisma.group.findUnique.mockResolvedValue({ id: 'group1' });
        
        const slug = await ensureUniqueGroupSlug(mockPrisma as PrismaClient, 'sys1', 'mine', 'group1');
        expect(slug).toBe('mine');
    });

    it('should fallback to "group" if base is empty after cleaning', async () => {
        mockPrisma.group.findUnique.mockResolvedValue(null);
        const slug = await ensureUniqueGroupSlug(mockPrisma as PrismaClient, 'sys1', '!!!');
        expect(slug).toBe('group');
    });

    it('should increment counter until free slug found', async () => {
        mockPrisma.group.findUnique
            .mockResolvedValueOnce({ id: '1' })
            .mockResolvedValueOnce({ id: '2' })
            .mockResolvedValueOnce(null);
            
        const slug = await ensureUniqueGroupSlug(mockPrisma as PrismaClient, 'sys1', 'test');
        expect(slug).toBe('test-3');
    });
});
