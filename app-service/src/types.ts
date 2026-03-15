import { System, Member, Group, Prisma } from '@prisma/client';
import { Intent } from 'matrix-appservice-bridge';

export type PrivacyLevel = 'public' | 'private';

export interface SystemPrivacy {
    description_privacy?: PrivacyLevel;
    pronoun_privacy?: PrivacyLevel;
    member_list_privacy?: PrivacyLevel;
    group_list_privacy?: PrivacyLevel;
    front_privacy?: PrivacyLevel;
    front_history_privacy?: PrivacyLevel;
    [key: string]: unknown;
}

export interface MemberPrivacy {
    visibility?: PrivacyLevel;
    name_privacy?: PrivacyLevel;
    description_privacy?: PrivacyLevel;
    avatar_privacy?: PrivacyLevel;
    pronoun_privacy?: PrivacyLevel;
    proxy_privacy?: PrivacyLevel;
    metadata_privacy?: PrivacyLevel;
    [key: string]: unknown;
}

export interface ProxyTag {
    prefix?: string;
    suffix?: string;
}

export const getSystemPrivacy = (privacy: Prisma.JsonValue): SystemPrivacy => {
    return (privacy as unknown as SystemPrivacy) || {};
};

export const getMemberPrivacy = (privacy: Prisma.JsonValue): MemberPrivacy => {
    return (privacy as unknown as MemberPrivacy) || {};
};

export const getProxyTags = (tags: Prisma.JsonValue): ProxyTag[] => {
    return (tags as unknown as ProxyTag[]) || [];
};

export interface PluralKitGroup {
    id?: string;
    uuid?: string;
    name?: string;
    display_name?: string;
    description?: string;
    icon?: string;
    color?: string;
    privacy?: Record<string, string>;
    members?: string[];
}

export interface PluralKitMember {
    id?: string;
    uuid?: string;
    name?: string;
    display_name?: string;
    color?: string;
    avatar_url?: string;
    pronouns?: string;
    description?: string;
    proxy_tags?: { prefix?: string | null, suffix?: string | null }[];
    privacy?: Record<string, string>;
}

export interface PluralKitSystem {
    id?: string;
    uuid?: string;
    name?: string;
    tag?: string;
    description?: string;
    color?: string;
    avatar_url?: string;
    banner?: string;
    pronouns?: string;
    privacy?: Record<string, string>;
}

export interface PKExport {
    version: number;
    id?: string;
    uuid?: string;
    name?: string;
    tag?: string;
    description?: string;
    color?: string;
    avatar_url?: string;
    banner?: string;
    pronouns?: string;
    privacy?: Record<string, string>;
    members?: PluralKitMember[];
    groups?: PluralKitGroup[];
    switches?: unknown[];
    pluralmatrix_metadata?: Record<string, unknown>;
    config?: { pluralmatrix_version?: string, [key: string]: unknown };
}

export type GroupWithMembers = Group & { members: Member[] };
export type SystemWithRelations = System & {
    members: Member[];
    groups: GroupWithMembers[];
};

export interface PluralMatrixEventContent {
    body?: string;
    msgtype?: string;
    formatted_body?: string;
    format?: string;
    url?: string;
    "m.relates_to"?: {
        rel_type?: string;
        event_id?: string;
        is_falling_back?: boolean;
        key?: string;
        "m.in_reply_to"?: {
            event_id?: string;
        };
    };
    "m.new_content"?: PluralMatrixEventContent;
    [key: string]: unknown;
}

export interface PluralMatrixEvent {
    event_id?: string;
    room_id: string;
    sender: string;
    type?: string;
    content?: PluralMatrixEventContent;
    origin_server_ts?: number;
    unsigned?: Record<string, unknown>;
    state_key?: string;
    id?: string; // Sometimes events have id instead of event_id
}

export type IntentWithClient = Intent & {
    matrixClient: {
        redactEvent(roomId: string, eventId: string, reason?: string): Promise<void>;
        getUserProfile(userId: string): Promise<{ displayname?: string, avatar_url?: string }>;
        getRoomStateEvent(roomId: string, eventType: string, stateKey: string): Promise<Record<string, unknown>>;
        sendStateEvent(roomId: string, eventType: string, stateKey: string, content: Record<string, unknown>): Promise<void>;
        getEvent(roomId: string, eventId: string): Promise<unknown>;
    }
};
