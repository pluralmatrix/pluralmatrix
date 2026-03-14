import { System, Member, Group } from '@prisma/client';
import { Intent } from 'matrix-appservice-bridge';

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
        [key: string]: unknown;
    }
}
