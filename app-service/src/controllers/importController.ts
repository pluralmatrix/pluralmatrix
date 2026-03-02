import { Response } from 'express';
import { AuthRequest } from '../auth';
import { PluralKitImportSchema } from '../schemas/import';
import { proxyCache } from '../services/cache';
import { emitSystemUpdate } from '../services/events';
import { 
    importFromPluralKit, 
    generatePkJson, 
    generateBackupJson, 
    stringifyWithEscapedUnicode, 
    exportSystemZip, 
    importSystemZip 
} from '../import';

export const importPluralKit = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        const jsonData = PluralKitImportSchema.parse(req.body);
        const result = await importFromPluralKit(mxid, jsonData);
        const { count, systemSlug } = result as any;
        proxyCache.invalidate(mxid);
        emitSystemUpdate(mxid);
        res.json({ success: true, count, systemSlug });
    } catch (e) {
        console.error('[ImportController] JSON Import failed:', e);
        res.status(400).json({ error: 'Invalid JSON format' });
    }
};

export const exportPluralKitZip = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename=pluralkit_export.zip');
        await exportSystemZip(mxid, res, 'pk');
    } catch (e) {
        console.error('[ImportController] PK ZIP Export failed:', e);
        if (!res.headersSent) res.status(500).json({ error: 'Export failed' });
    }
};

export const exportBackupZip = async (req: AuthRequest, res: Response) => {
    try {
        const mxid = req.user!.mxid;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename=pluralmatrix_backup.zip');
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
        res.json({ success: true, count: result.count, systemSlug: result.systemSlug });
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
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=pluralkit_export.json');
        res.send(stringifyWithEscapedUnicode(data));
    } catch (e) {
        console.error('[ImportController] PK JSON Export failed:', e);
        res.status(500).json({ error: 'Export failed' });
    }
};
