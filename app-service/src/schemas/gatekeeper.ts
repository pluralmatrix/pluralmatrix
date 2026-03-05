import { z } from 'zod';

export const GatekeeperCheckSchema = z.object({
    event_id: z.string().startsWith('$').optional(),
    sender: z.string().startsWith('@'),
    bot_id: z.string().startsWith('@').optional(),
    room_id: z.string().startsWith('!'),
    type: z.enum(['m.room.message', 'm.room.encrypted']).optional(),
    origin_server_ts: z.number().optional(),
    content: z.object({
        body: z.string().optional(),
        msgtype: z.string().optional(),
        format: z.string().optional(),
        formatted_body: z.string().optional()
    }).passthrough().optional(),
    encrypted_payload: z.record(z.string(), z.any()).optional()
});
