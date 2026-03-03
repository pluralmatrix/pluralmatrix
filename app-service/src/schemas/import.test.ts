import { PluralKitImportSchema } from './import';

describe('PluralKitImportSchema', () => {
    const validImport = {
        name: 'Test System',
        members: [
            {
                id: 'abcde',
                name: 'Lily',
                proxy_tags: [{ prefix: 'lily:', suffix: null }]
            }
        ]
    };

    it('should accept a valid PK import with prefix-only tag', () => {
        const result = PluralKitImportSchema.safeParse(validImport);
        expect(result.success).toBe(true);
    });

    it('should accept a valid PK import with suffix-only tag', () => {
        const result = PluralKitImportSchema.safeParse({
            ...validImport,
            members: [
                {
                    id: 'abcde',
                    name: 'Lily',
                    proxy_tags: [{ prefix: null, suffix: '>>' }]
                }
            ]
        });
        expect(result.success).toBe(true);
    });

    it('should reject a PK import with an invalid proxy tag (both null)', () => {
        const result = PluralKitImportSchema.safeParse({
            ...validImport,
            members: [
                {
                    id: 'abcde',
                    name: 'Lily',
                    proxy_tags: [{ prefix: null, suffix: null }]
                }
            ]
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.issues[0].message).toBe('At least one of prefix or suffix must be provided');
        }
    });

    it('should allow extra fields (passthrough)', () => {
        const result = PluralKitImportSchema.safeParse({
            ...validImport,
            extra_field: 'allowed'
        });
        expect(result.success).toBe(true);
    });
});
