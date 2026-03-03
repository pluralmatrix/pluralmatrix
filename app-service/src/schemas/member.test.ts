import { ProxyTagSchema, MemberSchema } from './member';

describe('ProxyTagSchema', () => {
    it('should allow a prefix-only tag', () => {
        const result = ProxyTagSchema.safeParse({ prefix: 'lily:', suffix: null });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.prefix).toBe('lily:');
        }
    });

    it('should allow a suffix-only tag', () => {
        const result = ProxyTagSchema.safeParse({ prefix: null, suffix: '>>' });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.suffix).toBe('>>');
        }
    });

    it('should allow both prefix and suffix', () => {
        const result = ProxyTagSchema.safeParse({ prefix: '[', suffix: ']' });
        expect(result.success).toBe(true);
    });

    it('should reject if both prefix and suffix are missing', () => {
        const result = ProxyTagSchema.safeParse({ prefix: null, suffix: null });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0].message).toContain('At least one of prefix or suffix must be provided');
        }
    });

    it('should reject if both prefix and suffix are empty strings', () => {
        const result = ProxyTagSchema.safeParse({ prefix: '', suffix: '' });
        expect(result.success).toBe(false);
    });
});

describe('MemberSchema Validation', () => {
    const validMember = {
        name: 'Lily',
        slug: 'lily',
        proxyTags: [{ prefix: 'lily:', suffix: '' }]
    };

    it('should accept a valid member with prefix-only tag', () => {
        const result = MemberSchema.safeParse(validMember);
        expect(result.success).toBe(true);
    });

    it('should accept a valid member with suffix-only tag', () => {
        const result = MemberSchema.safeParse({
            ...validMember,
            proxyTags: [{ prefix: null, suffix: '>>' }]
        });
        expect(result.success).toBe(true);
    });

    it('should reject a member with no proxy tags', () => {
        const result = MemberSchema.safeParse({
            ...validMember,
            proxyTags: []
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0].message).toBe('At least one proxy tag is required');
        }
    });

    it('should reject a member with an invalid proxy tag (both null)', () => {
        const result = MemberSchema.safeParse({
            ...validMember,
            proxyTags: [{ prefix: null, suffix: null }]
        });
        expect(result.success).toBe(false);
    });
});
