import { z } from 'zod';

export const ProxyTagSchema = z.object({
    prefix: z.string().optional().nullable(),
    suffix: z.string().optional().nullable()
}).refine(data => (data.prefix && data.prefix.length > 0) || (data.suffix && data.suffix.length > 0), {
    message: "At least one of prefix or suffix must be provided",
    path: ["prefix"]
});

const emptyToNull = (val: any) => (val === "" ? null : val);

export const PrivacyLevelSchema = z.enum(["public", "private"]);

export const MemberPrivacySchema = z.object({
    visibility: PrivacyLevelSchema.default("public"),
    name_privacy: PrivacyLevelSchema.default("public"),
    description_privacy: PrivacyLevelSchema.default("public"),
    avatar_privacy: PrivacyLevelSchema.default("public"),
    birthday_privacy: PrivacyLevelSchema.default("public"),
    pronoun_privacy: PrivacyLevelSchema.default("public"),
    metadata_privacy: PrivacyLevelSchema.default("public"),
    proxy_privacy: PrivacyLevelSchema.default("public"),
    banner_privacy: PrivacyLevelSchema.default("public")
}).passthrough();

export const SystemPrivacySchema = z.object({
    description_privacy: PrivacyLevelSchema.default("public"),
    member_list_privacy: PrivacyLevelSchema.default("public"),
    group_list_privacy: PrivacyLevelSchema.default("public"),
    front_privacy: PrivacyLevelSchema.default("public"),
    front_history_privacy: PrivacyLevelSchema.default("public"),
    name_privacy: PrivacyLevelSchema.default("public"),
    avatar_privacy: PrivacyLevelSchema.default("public"),
    banner_privacy: PrivacyLevelSchema.default("public"),
    pronoun_privacy: PrivacyLevelSchema.default("public")
}).passthrough();

export const MemberSchema = z.object({
    name: z.string().min(1, "Internal Name is required").max(100),
    displayName: z.preprocess(emptyToNull, z.string().max(100).optional().nullable()),
    avatarUrl: z.preprocess(emptyToNull, z.string().max(256, "Avatar URL must be 256 characters or fewer").url().or(z.string().startsWith('mxc://')).optional().nullable()),
    proxyTags: z.array(ProxyTagSchema).min(1, "At least one proxy tag is required"),
    slug: z.string().regex(/^[a-z0-9-]+$/, "Short ID must be alphanumeric with hyphens").max(50),
    description: z.preprocess(emptyToNull, z.string().max(5000).optional().nullable()),
    pronouns: z.preprocess(emptyToNull, z.string().max(100).optional().nullable()),
    color: z.preprocess(emptyToNull, z.string().regex(/^[0-9a-fA-F]{6}$/, "Color must be a 6-digit hex code").optional().nullable()),
    groups: z.array(z.string()).optional(),
    privacy: MemberPrivacySchema.optional()
});

export const SystemSchema = z.object({
    name: z.string().max(100).optional().nullable(),
    systemTag: z.string().max(50).optional().nullable(),
    slug: z.string().regex(/^[a-z0-9-]+$/).max(50).optional(),
    autoproxyId: z.string().uuid().optional().nullable(),
    autoproxyMode: z.enum(["off", "latch", "member"]).optional(),
    description: z.preprocess(emptyToNull, z.string().max(1000).optional().nullable()),
    avatarUrl: z.preprocess(emptyToNull, z.string().max(256).url().or(z.string().startsWith('mxc://')).optional().nullable()),
    privacy: SystemPrivacySchema.optional()
});
