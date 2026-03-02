import { z } from 'zod';

export const ProxyTagSchema = z.object({
    prefix: z.string().min(1),
    suffix: z.string().optional().nullable()
});

const emptyToNull = (val: any) => (val === "" ? null : val);

export const MemberSchema = z.object({
    name: z.string().min(1, "Internal Name is required").max(100),
    displayName: z.preprocess(emptyToNull, z.string().max(100).optional().nullable()),
    avatarUrl: z.preprocess(emptyToNull, z.string().max(256, "Avatar URL must be 256 characters or fewer").url().or(z.string().startsWith('mxc://')).optional().nullable()),
    proxyTags: z.array(ProxyTagSchema).min(1, "At least one proxy tag is required"),
    slug: z.string().regex(/^[a-z0-9-]+$/, "Short ID must be alphanumeric with hyphens").max(50),
    description: z.preprocess(emptyToNull, z.string().max(5000).optional().nullable()),
    pronouns: z.preprocess(emptyToNull, z.string().max(100).optional().nullable()),
    color: z.preprocess(emptyToNull, z.string().regex(/^[0-9a-fA-F]{6}$/, "Color must be a 6-digit hex code").optional().nullable())
});

export const SystemSchema = z.object({
    name: z.string().max(100).optional().nullable(),
    systemTag: z.string().max(50).optional().nullable(),
    slug: z.string().regex(/^[a-z0-9-]+$/).max(50).optional(),
    autoproxyId: z.string().uuid().optional().nullable()
});
