import { z } from 'zod';

const PKMemberSchema = z.object({
    id: z.string(),
    name: z.string(),
    display_name: z.string().optional().nullable(),
    avatar_url: z.string().optional().nullable(),
    proxy_tags: z.array(z.object({
        prefix: z.string().optional().nullable(),
        suffix: z.string().optional().nullable()
    }).refine(data => (data.prefix && data.prefix.length > 0) || (data.suffix && data.suffix.length > 0), {
        message: "At least one of prefix or suffix must be provided"
    })).optional().nullable(),
    pronouns: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    color: z.string().optional().nullable()
}).passthrough();

export const PluralKitImportSchema = z.object({
    version: z.number().optional(),
    id: z.string().optional().nullable(),
    name: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
    pronouns: z.string().optional().nullable(),
    avatar_url: z.string().optional().nullable(),
    banner: z.string().optional().nullable(),
    color: z.string().optional().nullable(),
    tag: z.string().optional().nullable(),
    pluralmatrix_metadata: z.object({
        version: z.number().optional()
    }).passthrough().optional().nullable(),
    config: z.object({
        pluralmatrix_version: z.number().optional()
    }).passthrough().optional().nullable(),
    members: z.array(PKMemberSchema).optional()
}).passthrough();
