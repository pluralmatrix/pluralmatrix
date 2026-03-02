import { Response } from 'express';
import { AuthRequest } from '../auth';
import { PluralKitImportSchema } from '../schemas/import';
import { proxyCache } from '../services/cache';
import { emitSystemUpdate } from '../services/events';
import { prisma } from '../bot';
import { 
    importFromPluralKit, 
    generatePkJson, 
    generateBackupJson, 
    stringifyWithEscapedUnicode, 
    exportSystemZip, 
    importSystemZip 
} from '../import';

const getExportFilename = async (mxid: string, prefix: string, ext: string) => {
    const link = await prisma.accountLink.findUnique({
        where: { matrixId: mxid },
        include: { system: true }
    });
    const slug = link?.system.slug || 'system';
    const date = new Date().toISOString().split('T')[0];
    return `${prefix}_${slug}_${date}.${ext}`;
};

export const importPluralKit = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const jsonData = PluralKitImportSchema.parse(req.body);
        const result = await importFromPluralKit(mxid, jsonData);
        const { count, systemSlug, failedAvatars } = result as any;
        proxyCache.invalidate(mxid);
        emitSystemUpdate(mxid);
        res.json({ success: true, count, systemSlug, failedAvatars });
    } catch (e) {
        console.error('[ImportController] JSON Import failed:', e);
        res.status(400).json({ error: 'Invalid JSON format' });
    }
};

export const exportPluralKitZip = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const filename = await getExportFilename(mxid, 'pluralkit_export', 'zip');
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        await exportSystemZip(mxid, res, 'pk');
    } catch (e) {
        console.error('[ImportController] PK ZIP Export failed:', e);
        if (!res.headersSent) res.status(500).json({ error: 'Export failed' });
    }
};

export const exportBackupZip = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const filename = await getExportFilename(mxid, 'backup', 'zip');
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        await exportSystemZip(mxid, res, 'backup');
    } catch (e) {
        console.error('[ImportController] Backup ZIP Export failed:', e);
        if (!res.headersSent) res.status(500).json({ error: 'Export failed' });
    }
};

export const importZip = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const result = await importSystemZip(mxid, req.body);
        proxyCache.invalidate(mxid);
        emitSystemUpdate(mxid);
        res.json({ 
            success: true, 
            count: result.count, 
            systemSlug: result.systemSlug,
            failedAvatars: result.failedAvatars 
        });
    } catch (e) {
        console.error('[ImportController] ZIP Import failed:', e);
        res.status(400).json({ error: 'Failed to process ZIP backup' });
    }
};

// Kept for backward compatibility if needed by old clients, but returns JSON
export const exportPluralKitJson = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const data = await generatePkJson(mxid);
        if (!data) return res.status(404).json({ error: 'System not found' });
        
        const filename = await getExportFilename(mxid, 'pluralkit_export', 'json');
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        res.send(stringifyWithEscapedUnicode(data));
    } catch (e) {
        console.error('[ImportController] PK JSON Export failed:', e);
        res.status(500).json({ error: 'Export failed' });
    }
};
