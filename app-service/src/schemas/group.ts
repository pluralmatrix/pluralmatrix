import { z } from 'zod';
import { PrivacyLevelSchema } from './member';

export const GroupPrivacySchema = z.object({
    visibility: PrivacyLevelSchema.default("public"),
    name_privacy: PrivacyLevelSchema.default("public"),
    description_privacy: PrivacyLevelSchema.default("public"),
    avatar_privacy: PrivacyLevelSchema.default("public"),
    metadata_privacy: PrivacyLevelSchema.default("public"),
    banner_privacy: PrivacyLevelSchema.default("public")
}).passthrough();

export const GroupSchema = z.object({
    name: z.string().min(1).max(100),
    slug: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Slug can only contain letters, numbers, hyphens, and underscores.').max(50),
    displayName: z.string().max(100).nullable().optional(),
    description: z.string().max(1000).nullable().optional(),
    icon: z.string().url().max(256).nullable().optional().or(z.string().regex(/^mxc:\/\/.*/)),
    color: z.string().regex(/^[0-9a-fA-F]{6}$/, 'Must be a 6-character hex code').nullable().optional(),
    members: z.array(z.string()).optional(), // array of member IDs to link
    privacy: GroupPrivacySchema.optional()
});
