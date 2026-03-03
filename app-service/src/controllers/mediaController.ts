import { Request, Response } from 'express';
import { MediaUploadSchema } from '../schemas/media';
import { config } from '../config';

export const uploadMedia = async (req: Request, res: Response) => {
    try {
        const { filename } = MediaUploadSchema.parse(req.query);
        const contentType = req.headers['content-type'] || 'image/png';

        // --- Server-side Validation ---
        
        // 1. Format Check
        const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!validTypes.includes(contentType)) {
            return res.status(400).json({ 
                error: `The image must be in .jpg, .png, or .webp format. Your file type is ${contentType.split('/')[1] || 'unknown'}.` 
            });
        }

        // 2. Size Check (1024 KB)
        const maxSizeInBytes = 1024 * 1024;
        const bodyLength = req.body instanceof Buffer ? req.body.length : 0;
        if (bodyLength > maxSizeInBytes) {
            return res.status(400).json({ 
                error: `The image must be under 1024 KB (1 MB). Your image is ${Math.round(bodyLength / 1024)} KB.` 
            });
        }

        if (!config.asToken) {
            console.error('[MediaController] AS_TOKEN is not configured!');
            return res.status(500).json({ error: 'AS_TOKEN is not configured' });
        }

        const response = await fetch(`${config.synapseUrl}/_matrix/media/v3/upload?filename=${encodeURIComponent(filename)}`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.asToken}`,
                'Content-Type': contentType
            },
            body: req.body
        });

        const data = await response.json() as any;
        if (response.ok) {
            res.json({ content_uri: data.content_uri });
        } else {
            res.status(response.status).json(data);
        }
    } catch (e) {
        console.error('[MediaController] Upload failed:', e);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const downloadMedia = async (req: Request, res: Response) => {
    try {
        const { server, mediaId } = req.params;

        if (!config.asToken) {
            console.error('[MediaController] AS_TOKEN is not configured!');
            return res.sendStatus(500);
        }

        // Modern Synapse requires authenticated media download via /client/v1/
        const response = await fetch(`${config.synapseUrl}/_matrix/client/v1/media/download/${server}/${mediaId}`, {
            headers: {
                'Authorization': `Bearer ${config.asToken}`
            }
        });
        
        if (!response.ok) return res.sendStatus(response.status);
        
        res.setHeader('Content-Type', response.headers.get('content-type') || 'image/png');
        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));
    } catch (e) {
        console.error('[MediaController] Download proxy failed:', e);
        res.sendStatus(500);
    }
};
