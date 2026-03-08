import { prisma } from './bot';
import { getBridge } from './bot';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import { maskMxid } from './utils/privacy';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import imageSize from 'image-size';
import os from 'os';
import { config } from './config';

export interface AvatarMigrationError {
    slug: string;
    name: string;
    error: string;
}

/**
 * Generates a random alphabetic ID like PluralKit (e.g. "abcde")
 */
const generateRandomPkId = (length = 5) => {
    const chars = 'abcdefghijklmnopqrstuvwxyz';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

/**
 * Maps decorative, Greek, or Faux Cyrillic characters to their closest Latin equivalents.
 */
export const transliterate = (text: string): string => {
    const charMap: Record<string, string> = {
        // Faux Cyrillic / Aesthetic
        'Д': 'a', 'д': 'a',
        'В': 'b', 'в': 'b',
        'Ё': 'e', 'ё': 'e',
        'И': 'n', 'и': 'n',
        'Я': 'r', 'я': 'r',
        'Х': 'x', 'х': 'x',
        'У': 'y', 'у': 'y',
        '𐒰': 'a',
        // Faux Greek / Aesthetic
        'Σ': 'e', 'σ': 'e',
        'Λ': 'a', 'λ': 'a',
        'Π': 'n', 'π': 'n',
        'Φ': 'ph', 'φ': 'ph',
        'Ω': 'o', 'ω': 'o',
        'Δ': 'd', 'δ': 'd',
        'Θ': 'th', 'θ': 'th',
        'Ξ': 'x', 'ξ': 'x',
        'Ψ': 'ps', 'ψ': 'ps'
    };
    return [...text].map(c => charMap[c] || c).join('');
};

/**
 * Strips decorative emojis and converts name to a slug.
 * Fallback to defaultId if result is empty.
 */
export const generateSlug = (name: string, defaultId: string): string => {
    const transliterated = transliterate(name);

    const clean = transliterated
        .replace(/[^\x00-\x7F]/g, '') 
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-') 
        .replace(/[^a-z0-9-]/g, '') 
        .replace(/-+/g, '-') 
        .replace(/^-+|-+$/g, ''); 

    return clean || defaultId.toLowerCase();
};

/**
 * Extracts alphabetic-only lowercase prefix for slug resolution.
 */
export const getCleanPrefix = (pkMember: any): string => {
    const firstPrefix = pkMember.proxy_tags?.find((t: any) => t.prefix)?.prefix || "";
    return firstPrefix.replace(/[^a-zA-Z]/g, '').toLowerCase();
};

/**
 * Tries to extract a name from a description using common self-introduction patterns.
 */
export const extractNameFromDescription = (description: string | null): string | null => {
    if (!description) return null;
    
    const patterns = [
        /(?:My\s+name\s+is|my\s+name\s+is|I'm|i'm|I\s+am|i\s+am)\s+([A-Z][^.!?\n,]+)/
    ];

    for (const pattern of patterns) {
        const match = description.match(pattern);
        if (match && match[1]) {
            const name = match[1].trim();
            if (name.length > 0 && name.length < 30 && name.split(/\s+/).length <= 4) return name;
        }
    }
    return null;
};

/**
 * Validates an image buffer against avatar limits.
 */
export const validateImageBuffer = (buffer: Buffer, filename: string): { valid: boolean, error?: string } => {
    // 1. Size Check (1024 KB)
    const maxSize = 1024 * 1024;
    if (buffer.length > maxSize) {
        return { valid: false, error: `Image too large (${Math.round(buffer.length / 1024)} KB). Must be under 1024 KB.` };
    }

    // 2. Format & Resolution Check
    try {
        const dimensions = imageSize(buffer);
        const format = dimensions.type;
        
        const validFormats = ['jpg', 'png', 'webp'];
        if (!format || !validFormats.includes(format)) {
            return { valid: false, error: `Invalid format (${format || 'unknown'}). Must be .jpg, .png, or .webp.` };
        }

        const smallestAxis = Math.min(dimensions.width || 0, dimensions.height || 0);
        if (smallestAxis >= 1000) {
            return { valid: false, error: `Resolution too high (${dimensions.width}x${dimensions.height}). Smallest axis must be below 1000px.` };
        }

        const largestAxis = Math.max(dimensions.width || 0, dimensions.height || 0);
        if (largestAxis > 4000) {
            return { valid: false, error: `Resolution too high (${dimensions.width}x${dimensions.height}). Largest axis must be 4000px or fewer.` };
        }
    } catch (e) {
        return { valid: false, error: "Failed to parse image dimensions or format." };
    }

    return { valid: true };
};

/**
 * Downloads an image from a URL and uploads it to the Matrix media repository.
 */
export const migrateAvatar = async (url: string): Promise<{ mxcUrl?: string, error?: string } | null> => {
    if (!url) return null;
    
    // If it's already an mxc:// URL, return it as-is
    if (url.startsWith('mxc://')) return { mxcUrl: url };

    // 1. URL Length Check
    if (url.length > 256) {
        return { error: `Avatar URL too long (${url.length} chars). Max 256 characters.` };
    }

    try {
        const bridge = getBridge();
        if (!bridge) return null;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s for download

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (!response.ok) return { error: `Server returned ${response.status} ${response.statusText}` };

        const buffer = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get('content-type') || 'image/png';

        // 2. Validate Image Content
        const validation = validateImageBuffer(buffer, 'avatar');
        if (!validation.valid) {
            return { error: validation.error };
        }

        const mxcUrl = await bridge.getBot().getClient().uploadContent(buffer, contentType, 'avatar.png');
        return { mxcUrl };
    } catch (e: any) {
        const message = e.name === 'AbortError' ? "Download timed out" : e.message;
        return { error: message };
    }
};

/**
 * Sets the global profile for a ghost user.
 */
export const syncGhostProfile = async (member: any, system: any) => {
    try {
        const bridge = getBridge();
        if (!bridge) return;

        if (!system?.slug || !member?.slug) {
            console.warn(`[Ghost] Skipping sync: missing system or member slug.`);
            return;
        }

        const domain = config.synapseDomain;
        const ghostUserId = `@_plural_${system.slug}_${member.slug}:${domain}`;
        const intent = bridge.getIntent(ghostUserId);

        const finalDisplayName = system.systemTag 
            ? `${member.displayName || member.name} ${system.systemTag}`
            : (member.displayName || member.name);

        console.log(`[Ghost] Syncing global profile for ${ghostUserId}`);
        
        await intent.ensureRegistered();
        await intent.setDisplayName(finalDisplayName);
        if (member.avatarUrl) {
            await intent.setAvatarUrl(member.avatarUrl);
        }
    } catch (e: any) {
        console.warn(`[Ghost] Failed to sync profile for ${member.slug}:`, e.message);
        throw e;
    }
    }


/**
 * Cleanup a ghost user when a member is deleted.
 */
export const decommissionGhost = async (member: any, system: any) => {
    try {
        const bridge = getBridge();
        if (!bridge) return;

        const domain = config.synapseDomain;
        const ghostUserId = `@_plural_${system.slug}_${member.slug}:${domain}`;
        const intent = bridge.getIntent(ghostUserId);

        console.log(`[Ghost] Decommissioning ${ghostUserId}...`);

        // 1. Get joined rooms
        const rooms = await intent.matrixClient.getJoinedRooms();
        
        // 2. Leave all rooms
        for (const roomId of rooms) {
            try {
                await intent.leave(roomId);
            } catch (e) {}
        }

        console.log(`[Ghost] ${ghostUserId} has left all rooms.`);
    } catch (e: any) {
        console.error(`[Ghost] Failed to decommission ${member.slug}:`, e.message || e);
    }
};

import { ensureUniqueSlug } from './utils/slug';

/**
 * Main importer logic for PluralKit JSON.
 */
export const importFromPluralKit = async (mxid: string, jsonData: any): Promise<{ count: number, systemSlug: string, failedAvatars: AvatarMigrationError[] }> => {
    console.log(`[Importer] Starting import for ${maskMxid(mxid)}`);

    const isPluralMatrix = jsonData.pluralmatrix_metadata !== undefined || jsonData.config?.pluralmatrix_version !== undefined;
    const localpart = mxid.split(':')[0].substring(1);
    
    const link = await prisma.accountLink.findUnique({
        where: { matrixId: mxid },
        include: { system: true }
    });

    let system;
    if (link) {
        system = link.system;
        
        let attempts = 0;
        while (attempts < 5) {
            try {
                let baseSlug = (isPluralMatrix && jsonData.id) 
                    ? jsonData.id 
                    : generateSlug(jsonData.name || localpart, localpart);
                
                const systemSlug = await ensureUniqueSlug(prisma, baseSlug, system.id);

                system = await prisma.system.update({
                    where: { id: system.id },
                    data: {
                        name: jsonData.name || system.name,
                        systemTag: jsonData.tag || system.systemTag,
                        slug: systemSlug,
                        pkId: jsonData.id || system.pkId,
                        description: jsonData.description || system.description,
                        pronouns: jsonData.pronouns || system.pronouns,
                        avatarUrl: jsonData.avatar_url || system.avatarUrl,
                        banner: jsonData.banner || system.banner,
                        color: jsonData.color || system.color
                    }
                });
                break;
            } catch (err: any) {
                if (err.code === 'P2002' && err.meta?.target?.includes('slug')) {
                    attempts++;
                    console.warn(`[Import] Slug race condition detected during update, retrying (attempt ${attempts})...`);
                    continue;
                }
                throw err;
            }
        }

        if (attempts >= 5) {
            throw new Error(`Failed to update system after ${attempts} slug collision retries.`);
        }
    } else {
        let attempts = 0;
        while (attempts < 5) {
            try {
                let baseSlug = (isPluralMatrix && jsonData.id) 
                    ? jsonData.id 
                    : generateSlug(jsonData.name || localpart, localpart);
                
                const systemSlug = await ensureUniqueSlug(prisma, baseSlug);

                system = await prisma.system.create({
                    data: {
                        slug: systemSlug,
                        pkId: jsonData.id,
                        name: jsonData.name || `${localpart}'s System`,
                        systemTag: jsonData.tag,
                        description: jsonData.description,
                        pronouns: jsonData.pronouns,
                        avatarUrl: jsonData.avatar_url,
                        banner: jsonData.banner,
                        color: jsonData.color,
                        accountLinks: {
                            create: { matrixId: mxid, isPrimary: true }
                        }
                    }
                });
                break;
            } catch (err: any) {
                if (err.code === 'P2002' && err.meta?.target?.includes('slug')) {
                    attempts++;
                    console.warn(`[Import] Slug race condition detected during creation, retrying (attempt ${attempts})...`);
                    continue;
                }
                throw err;
            }
        }

        if (attempts >= 5) {
            throw new Error(`Failed to create system after ${attempts} slug collision retries.`);
        }
    }

    // Safety: ensure system is definitely defined for TS
    if (!system) {
        throw new Error("System resolution failed unexpectedly.");
    }

    const rawMembers = jsonData.members || [];
    const slugGroups: Record<string, any[]> = {};

    for (const member of rawMembers) {
        let baseSlug = (isPluralMatrix && member.id) 
            ? member.id 
            : generateSlug(member.name, ""); 
        
        if (!baseSlug) {
            const extractedName = extractNameFromDescription(member.description);
            if (extractedName) {
                baseSlug = generateSlug(extractedName, "");
            }
        }
        
        if (!baseSlug) {
            baseSlug = member.id.toLowerCase();
        }

        if (!slugGroups[baseSlug]) slugGroups[baseSlug] = [];
        slugGroups[baseSlug].push(member);
    }

    const processedMembers = [];
    for (const [baseSlug, members] of Object.entries(slugGroups)) {
        if (members.length === 1) {
            processedMembers.push({ ...members[0], finalSlug: baseSlug });
        } else {
            members.sort((a, b) => {
                const preA = getCleanPrefix(a);
                const preB = getCleanPrefix(b);
                return preA.length - preB.length || a.id.localeCompare(b.id);
            });

            members.forEach((m, idx) => {
                if (idx === 0) {
                    processedMembers.push({ ...m, finalSlug: baseSlug });
                } else {
                    const cleanPre = getCleanPrefix(m);
                    const suffix = cleanPre || m.id.toLowerCase();
                    processedMembers.push({ ...m, finalSlug: `${baseSlug}-${suffix}` });
                }
            });
        }
    }

    let importedCount = 0;
    const failedAvatars: AvatarMigrationError[] = [];
    const pkIdToDbIdMap: Record<string, string> = {};

    for (const pkMember of processedMembers) {
        try {
            const slug = pkMember.finalSlug;
            const proxyTags = (pkMember.proxy_tags || [])
                .filter((t: any) => t.prefix)
                .map((t: any) => ({ prefix: t.prefix, suffix: t.suffix || "" }));

            const migrationResult = await migrateAvatar(pkMember.avatar_url);
            let avatarUrl = migrationResult?.mxcUrl;
            
            if (migrationResult?.error) {
                failedAvatars.push({ slug, name: pkMember.name, error: migrationResult.error });
            }

            const memberData = {
                name: pkMember.name,
                pkId: pkMember.id,
                displayName: pkMember.display_name,
                avatarUrl: avatarUrl || undefined,
                pronouns: pkMember.pronouns,
                description: pkMember.description,
                color: pkMember.color,
                proxyTags: proxyTags
            };

            const member = await prisma.member.upsert({
                where: { 
                    systemId_slug: {
                        systemId: system.id,
                        slug: slug
                    }
                },
                update: memberData,
                create: {
                    ...memberData,
                    systemId: system.id,
                    slug: slug
                }
            });

            if (pkMember.id) {
                pkIdToDbIdMap[pkMember.id] = member.id;
            }

            try {
                await syncGhostProfile(member, system);
            } catch (syncErr: any) {
                failedAvatars.push({ 
                    slug: member.slug, 
                    name: member.name, 
                    error: `Matrix Profile Sync Failed: ${syncErr.message || 'Unknown error'}` 
                });
            }

            importedCount++;
            if (importedCount % 10 === 0) {
                console.log(`[Importer] Progress: ${importedCount} members...`);
            }
        } catch (memberError: any) {
            console.error(`[Importer] Failed to import a member:`, memberError);
            failedAvatars.push({ 
                slug: pkMember.finalSlug || 'unknown', 
                name: pkMember.name || 'Unknown', 
                error: `Database/Validation Error: ${memberError.message || 'Unknown error'}` 
            });
        }
    }

    const rawGroups = jsonData.groups || [];
    let importedGroupsCount = 0;
    
    // Create a set of base group slugs to ensure uniqueness within the system
    const groupSlugGroups: Record<string, any[]> = {};
    for (const group of rawGroups) {
        let baseSlug = (isPluralMatrix && group.id) 
            ? group.id 
            : generateSlug(group.name || group.id, group.id);
            
        if (!baseSlug) baseSlug = group.id.toLowerCase();
        
        if (!groupSlugGroups[baseSlug]) groupSlugGroups[baseSlug] = [];
        groupSlugGroups[baseSlug].push(group);
    }
    
    const processedGroups = [];
    for (const [baseSlug, groups] of Object.entries(groupSlugGroups)) {
        if (groups.length === 1) {
            processedGroups.push({ ...groups[0], finalSlug: baseSlug });
        } else {
            groups.forEach((g, idx) => {
                if (idx === 0) {
                    processedGroups.push({ ...g, finalSlug: baseSlug });
                } else {
                    processedGroups.push({ ...g, finalSlug: `${baseSlug}-${g.id.toLowerCase()}` });
                }
            });
        }
    }

    for (const pkGroup of processedGroups) {
        try {
            const slug = pkGroup.finalSlug;
            
            // Link members that were present in the import
            const memberConnections = [];
            if (pkGroup.members && Array.isArray(pkGroup.members)) {
                for (const memberPkId of pkGroup.members) {
                    if (pkIdToDbIdMap[memberPkId]) {
                        memberConnections.push({ id: pkIdToDbIdMap[memberPkId] });
                    }
                }
            }

            const groupData = {
                name: pkGroup.name || 'Unnamed Group',
                pkId: pkGroup.id,
                displayName: pkGroup.display_name,
                description: pkGroup.description,
                icon: pkGroup.icon,
                color: pkGroup.color
            };

            await prisma.group.upsert({
                where: {
                    systemId_slug: {
                        systemId: system.id,
                        slug: slug
                    }
                },
                update: {
                    ...groupData,
                    members: {
                        set: memberConnections // overwrites previous members for this group with the newly imported ones
                    }
                },
                create: {
                    ...groupData,
                    systemId: system.id,
                    slug: slug,
                    members: {
                        connect: memberConnections
                    }
                }
            });

            importedGroupsCount++;
        } catch (groupError) {
            console.error(`[Importer] Failed to import a group:`, groupError);
        }
    }

    console.log(`[Importer] Successfully imported ${importedCount} members and ${importedGroupsCount} groups for ${maskMxid(mxid)}`);
    return { count: importedCount, systemSlug: system.slug, failedAvatars };
};

/**
 * Stringifies an object to JSON while escaping all non-ASCII characters 
 * using \uXXXX sequences for maximum compatibility.
 */
export const stringifyWithEscapedUnicode = (obj: any): string => {
    return JSON.stringify(obj, null, 4).replace(/[^\x00-\x7f]/g, (c) => {
        return "\\u" + c.charCodeAt(0).toString(16).padStart(4, '0');
    });
};

/**
 * Generates a PluralKit-compatible JSON export for a system.
 */
export const generatePkJson = async (mxid: string, avatarUrlMap?: Record<string, string>) => {
    const link = await prisma.accountLink.findUnique({
        where: { matrixId: mxid },
        include: { 
            system: {
                include: { 
                    members: true,
                    groups: {
                        include: { members: true }
                    }
                }
            }
        }
    });

    if (!link) return null;
    const system = link.system;
    const systemPkId = system.pkId || generateRandomPkId();

    const pkExport = {
        version: 2,
        id: systemPkId,
        uuid: system.id,
        name: system.name || null,
        description: system.description || null,
        tag: system.systemTag || null,
        pronouns: system.pronouns || null,
        avatar_url: system.avatarUrl || null,
        banner: system.banner || null,
        color: system.color || null,
        created: system.createdAt.toISOString(),
        webhook_url: null,
        privacy: {
            name_privacy: "public",
            avatar_privacy: "public",
            description_privacy: "public",
            banner_privacy: "public",
            pronoun_privacy: "public",
            member_list_privacy: "public",
            group_list_privacy: "public",
            front_privacy: "public",
            front_history_privacy: "public"
        },
        config: {
            timezone: "UTC",
            pings_enabled: true,
            latch_timeout: null,
            member_default_private: false,
            group_default_private: false,
            show_private_info: true,
            member_limit: 1000,
            group_limit: 250,
            case_sensitive_proxy_tags: true,
            proxy_error_message_enabled: true,
            hid_display_split: false,
            hid_display_caps: false,
            hid_list_padding: "off",
            card_show_color_hex: false,
            proxy_switch: "off",
            name_format: null,
            description_templates: []
        },
        accounts: [],
        members: system.members.map(m => ({
            id: m.pkId || generateRandomPkId(),
            uuid: m.id,
            name: m.name,
            display_name: m.displayName || null,
            color: m.color || null,
            birthday: null,
            pronouns: m.pronouns || null,
            avatar_url: (avatarUrlMap && avatarUrlMap[m.id]) ? avatarUrlMap[m.id] : (m.avatarUrl?.startsWith('mxc://') ? null : m.avatarUrl || null),
            webhook_avatar_url: null,
            banner: null,
            description: m.description || null,
            created: m.createdAt.toISOString(),
            keep_proxy: false,
            tts: false,
            autoproxy_enabled: true,
            message_count: 0,
            last_message_timestamp: null,
            proxy_tags: (m.proxyTags as any[]).map(t => ({
                prefix: t.prefix || null,
                suffix: t.suffix || null
            })),
            privacy: {
                visibility: "public",
                name_privacy: "public",
                description_privacy: "public",
                banner_privacy: "public",
                birthday_privacy: "public",
                pronoun_privacy: "public",
                avatar_privacy: "public",
                metadata_privacy: "public",
                proxy_privacy: "public"
            }
        })),
        groups: (system as any).groups?.map((g: any) => ({
            id: g.pkId || generateRandomPkId(),
            uuid: g.id,
            name: g.name,
            display_name: g.displayName || null,
            description: g.description || null,
            icon: g.icon || null,
            banner: null,
            color: g.color || null,
            created: g.createdAt.toISOString(),
            members: g.members?.map((m: any) => m.pkId) || [],
            privacy: {
                name_privacy: "public",
                description_privacy: "public",
                icon_privacy: "public",
                list_privacy: "public",
                metadata_privacy: "public",
                visibility: "public"
            }
        })) || [],
        switches: []
    };

    return pkExport;
};

/**
 * Generates a PluralMatrix-specific backup JSON.
 */
export const generateBackupJson = async (mxid: string) => {
    const link = await prisma.accountLink.findUnique({
        where: { matrixId: mxid },
        include: { 
            system: {
                include: { 
                    members: true,
                    groups: {
                        include: { members: true }
                    }
                }
            }
        }
    });

    if (!link) return null;
    const system = link.system;

    const backup = {
        version: 2,
        pluralmatrix_metadata: {
            version: 2,
            exported_at: new Date().toISOString(),
            source: "pluralmatrix-app-service"
        },
        id: system.slug,
        pk_id: system.pkId,
        name: system.name,
        description: system.description,
        pronouns: system.pronouns,
        avatar_url: system.avatarUrl,
        banner: system.banner,
        color: system.color,
        tag: system.systemTag,
        members: system.members.map(m => ({
            id: m.slug,
            pk_id: m.pkId,
            name: m.name,
            display_name: m.displayName,
            color: m.color,
            pronouns: m.pronouns,
            avatar_url: m.avatarUrl,
            description: m.description,
            proxy_tags: m.proxyTags
        })),
        groups: (system as any).groups?.map((g: any) => ({
            id: g.slug,
            pk_id: g.pkId,
            name: g.name,
            display_name: g.displayName,
            description: g.description,
            icon: g.icon,
            color: g.color,
            members: g.members?.map((m: any) => m.slug) || []
        })) || []
    };

    return backup;
};

/**
 * Fetches all member avatars and bundles them into a ZIP file, including the system JSON.
 */
export const exportSystemZip = async (mxid: string, stream: NodeJS.WritableStream, type: 'pk' | 'backup') => {
    const link = await prisma.accountLink.findUnique({
        where: { matrixId: mxid },
        include: { 
            system: {
                include: { 
                    members: true,
                    groups: {
                        include: { members: true }
                    }
                }
            }
        }
    });

    if (!link) throw new Error("System not found");
    const system = link.system;

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(stream);

    const bridge = getBridge();
    if (!bridge) throw new Error("Bridge not initialized");

    const PROJECT_NAME = config.projectName;
    const homeserverUrl = config.synapseUrl;
    const asToken = config.asToken;

    if (!asToken) throw new Error("AS_TOKEN is not configured!");

    // 1. Download avatars first to know their extensions for the JSON file
    const avatarFiles: { memberId: string, tmpPath: string, filename: string }[] = [];
    const avatarUrlMap: Record<string, string> = {};
    
    // Create a temporary directory for this export
    const tmpExportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-export-'));

    try {
        for (const member of system.members) {
            if (!member.avatarUrl || !member.avatarUrl.startsWith('mxc://')) continue;

            try {
                const mxc = member.avatarUrl.replace('mxc://', '');
                const [server, mediaId] = mxc.split('/');
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout for export downloads

                const response = await fetch(`${homeserverUrl}/_matrix/client/v1/media/download/${server}/${mediaId}`, {
                    headers: { 'Authorization': `Bearer ${asToken}` },
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (!response.ok) {
                    console.warn(`[Export] Failed to download an avatar: ${response.status}`);
                    continue;
                }

                const contentType = response.headers.get('content-type') || 'image/png';
                const ext = contentType.split('/')[1]?.split(';')[0] || 'png';
                const buffer = Buffer.from(await response.arrayBuffer());

                const filename = `avatars/${member.slug}_${mediaId}.${ext}`;
                const tmpPath = path.join(tmpExportDir, `${mediaId}.${ext}`);
                
                // Write to disk to prevent memory bloat from holding hundreds of buffers in array
                fs.writeFileSync(tmpPath, buffer);
                
                avatarFiles.push({ memberId: member.id, tmpPath, filename });
                
                if (type === 'pk') {
                    avatarUrlMap[member.id] = `https://myimageserver/${filename}`;
                }
            } catch (e) {
                console.error(`[Export] Error pre-processing avatar for ${member.name}:`, e);
            }
        }

        // Handle Group Icons
        const groups = (system as any).groups || [];
        for (const group of groups) {
            if (!group.icon || !group.icon.startsWith('mxc://')) continue;

            try {
                const mxc = group.icon.replace('mxc://', '');
                const [server, mediaId] = mxc.split('/');
                
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000); 

                const response = await fetch(`${homeserverUrl}/_matrix/client/v1/media/download/${server}/${mediaId}`, {
                    headers: { 'Authorization': `Bearer ${asToken}` },
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (!response.ok) {
                    console.warn(`[Export] Failed to download group icon: ${response.status}`);
                    continue;
                }

                const contentType = response.headers.get('content-type') || 'image/png';
                const ext = contentType.split('/')[1]?.split(';')[0] || 'png';
                const buffer = Buffer.from(await response.arrayBuffer());

                const filename = `avatars/group_${group.slug}_${mediaId}.${ext}`;
                const tmpPath = path.join(tmpExportDir, `group_${mediaId}.${ext}`);
                
                fs.writeFileSync(tmpPath, buffer);
                
                avatarFiles.push({ memberId: group.id, tmpPath, filename });
                
                if (type === 'pk') {
                    // For groups, PluralKit uses 'icon' property but we will map it similarly
                    // Actually PK json doesn't support changing URLs in export right now, so we just include the file.
                }
            } catch (e) {
                console.error(`[Export] Error pre-processing group icon for ${group.name}:`, e);
            }
        }

        // 2. Add JSON file
        const jsonData = type === 'pk' ? await generatePkJson(mxid, avatarUrlMap) : await generateBackupJson(mxid);
        const jsonFilename = type === 'pk' ? 'pluralkit_system.json' : 'pluralmatrix_backup.json';
        archive.append(stringifyWithEscapedUnicode(jsonData), { name: jsonFilename });

        // 3. Add Avatars from disk
        for (const avatar of avatarFiles) {
            archive.file(avatar.tmpPath, { name: avatar.filename });
        }

        // 4. Add README for PK recovery
        if (type === 'pk') {
            try {
                const readmePath = path.join(process.cwd(), 'README_AVATARS.txt');
                if (fs.existsSync(readmePath)) {
                    const readme = fs.readFileSync(readmePath, 'utf8');
                    archive.append(readme, { name: 'README_AVATARS.txt' });
                } else {
                    console.warn("[Export] README_AVATARS.txt not found at:", readmePath);
                }
            } catch (e) {
                console.error("[Export] Failed to read README_AVATARS.txt template:", e);
            }
        }

        await archive.finalize();
    } finally {
        // Cleanup temp dir after archive is finalized or if it crashes
        // We delay the cleanup slightly to ensure archiver is done reading from the file system
        setTimeout(() => {
            try {
                fs.rmSync(tmpExportDir, { recursive: true, force: true });
            } catch (e) {}
        }, 5000);
    }
};

/**
 * Unified ZIP importer.
 */
export const importSystemZip = async (mxid: string, zipBuffer: Buffer): Promise<{ count: number, systemSlug: string, failedAvatars: AvatarMigrationError[] }> => {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();
    
    const jsonEntry = entries.find(e => e.entryName === 'pluralmatrix_backup.json' || e.entryName === 'pluralkit_system.json' || e.entryName.endsWith('.json'));
    if (!jsonEntry) throw new Error("No JSON system file found in ZIP");

    const jsonData = JSON.parse(jsonEntry.getData().toString('utf8'));
    
    const result = await importFromPluralKit(mxid, jsonData);

    const zipResult = await importAvatarsZip(mxid, zipBuffer);
    
    // Merge failed avatars from ZIP phase
    result.failedAvatars.push(...zipResult.failedAvatars);

    return result;
};


/**
 * Imports a ZIP of avatars and updates member mappings.
 */
export const importAvatarsZip = async (mxid: string, zipBuffer: Buffer): Promise<{ count: number, failedAvatars: AvatarMigrationError[] }> => {
    const link = await prisma.accountLink.findUnique({
        where: { matrixId: mxid },
        include: { 
            system: {
                include: { 
                    members: true,
                    groups: true
                }
            }
        }
    });

    if (!link) throw new Error("System not found");
    const system = link.system;

    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();
    const bridge = getBridge();
    if (!bridge) throw new Error("Bridge not initialized");

    let count = 0;
    const failedAvatars: AvatarMigrationError[] = [];

    for (const entry of entries) {
        if (entry.isDirectory) continue;

        const filename = entry.entryName;
        if (!filename.startsWith('avatars/')) continue;

        const namePart = filename.split('/').pop()?.split('.')[0];
        if (!namePart) continue;

        const isGroupIcon = namePart.startsWith('group_');
        let oldMediaId = namePart;
        if (isGroupIcon) {
            const parts = namePart.split('_');
            oldMediaId = parts.length > 2 ? parts.slice(2).join('_') : namePart;
        } else {
            oldMediaId = namePart.includes('_') ? namePart.split('_').slice(1).join('_') : namePart;
        }

        const ext = filename.split('.').pop() || 'png';
        const contentType = `image/${ext === 'jpg' ? 'jpeg' : ext}`;

        let affectedMembers: any[] = [];
        let affectedGroups: any[] = [];

        if (isGroupIcon) {
            affectedGroups = (system as any).groups.filter((g: any) => 
                g.icon && g.icon.endsWith(`/${oldMediaId}`)
            );
        } else {
            affectedMembers = system.members.filter(m => 
                m.avatarUrl && m.avatarUrl.endsWith(`/${oldMediaId}`)
            );
        }

        if (affectedMembers.length === 0 && affectedGroups.length === 0) continue;

        try {
            const data = entry.getData();
            
            // Validate Image Content
            const validation = validateImageBuffer(data, filename);
            if (!validation.valid) {
                for (const member of affectedMembers) {
                    failedAvatars.push({ slug: member.slug, name: member.name, error: validation.error! });
                }
                for (const group of affectedGroups) {
                    failedAvatars.push({ slug: group.slug, name: group.name, error: validation.error! });
                }
                continue;
            }

            const mxcUrl = await bridge.getBot().getClient().uploadContent(data, contentType, filename);

            for (const member of affectedMembers) {
                const updated = await prisma.member.update({
                    where: { id: member.id },
                    data: { avatarUrl: mxcUrl }
                });
                try {
                    await syncGhostProfile(updated, system);
                } catch (syncErr: any) {
                    failedAvatars.push({ 
                        slug: member.slug, 
                        name: member.name, 
                        error: `Matrix Profile Sync Failed after avatar upload: ${syncErr.message || 'Unknown error'}` 
                    });
                }
            }

            for (const group of affectedGroups) {
                await prisma.group.update({
                    where: { id: group.id },
                    data: { icon: mxcUrl }
                });
            }

            count++;
        } catch (e: any) {
            console.error(`[Import] Failed to re-upload avatar ${filename}:`, e);
            for (const member of affectedMembers) {
                failedAvatars.push({ slug: member.slug, name: member.name, error: e.message });
            }
            for (const group of affectedGroups) {
                failedAvatars.push({ slug: group.slug, name: group.name, error: e.message });
            }
        }
    }

    return { count, failedAvatars };
};
