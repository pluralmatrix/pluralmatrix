import * as importController from './importController';
import { prisma } from '../bot';
import { proxyCache } from '../services/cache';
import { emitSystemUpdate } from '../services/events';
import * as importService from '../import';

jest.mock('../bot', () => ({
    prisma: {
        accountLink: {
            findUnique: jest.fn()
        }
    }
}));
jest.mock('../services/cache');
jest.mock('../services/events');
jest.mock('../import');

describe('importController', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockReq: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockRes: any;

    beforeEach(() => {
        jest.clearAllMocks();
        mockReq = {
            user: { mxid: '@test:localhost' },
            body: {}
        };
        mockRes = {
            json: jest.fn(),
            status: jest.fn().mockReturnThis(),
            setHeader: jest.fn(),
            send: jest.fn(),
            headersSent: false
        };
    });

    describe('importPluralKit', () => {
        it('should successfully import valid JSON', async () => {
            const validData = {
                version: 2,
                system: { id: 'abcde' },
                members: []
            };
            mockReq.body = validData;

            (importService.importFromPluralKit as jest.Mock).mockResolvedValue({
                count: 0,
                systemSlug: 'sys1',
                failedAvatars: []
            });

            await importController.importPluralKit(mockReq, mockRes);

            expect(importService.importFromPluralKit).toHaveBeenCalledWith('@test:localhost', validData);
            expect(proxyCache.invalidate).toHaveBeenCalledWith('@test:localhost');
            expect(emitSystemUpdate).toHaveBeenCalledWith('@test:localhost');
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                count: 0,
                systemSlug: 'sys1',
                failedAvatars: []
            });
        });

        it('should return 400 for invalid JSON schema', async () => {
            mockReq.body = { members: [{ id: '123' }] }; // missing required 'name' field in member

            await importController.importPluralKit(mockReq, mockRes);

            expect(importService.importFromPluralKit).not.toHaveBeenCalled();
            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid JSON format' });
        });

        it('should return 400 when importFromPluralKit throws', async () => {
            const validData = {
                version: 2,
                system: { id: 'abcde' },
                members: []
            };
            mockReq.body = validData;

            (importService.importFromPluralKit as jest.Mock).mockRejectedValue(new Error('Import failed internally'));

            await importController.importPluralKit(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid JSON format' });
        });
    });

    describe('exportPluralKitZip', () => {
        it('should trigger ZIP export successfully', async () => {
            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({
                system: { slug: 'test-sys' }
            });

            await importController.exportPluralKitZip(mockReq, mockRes);

            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/zip');
            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringContaining('attachment; filename=pluralkit_export_test-sys_'));
            expect(importService.exportSystemZip).toHaveBeenCalledWith('@test:localhost', mockRes, 'pk');
        });

        it('should handle export errors gracefully', async () => {
            (prisma.accountLink.findUnique as jest.Mock).mockRejectedValue(new Error('DB Error'));

            await importController.exportPluralKitZip(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Export failed' });
        });
    });

    describe('exportBackupZip', () => {
        it('should trigger backup ZIP export successfully', async () => {
            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue(null);

            await importController.exportBackupZip(mockReq, mockRes);

            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringContaining('attachment; filename=backup_system_'));
            expect(importService.exportSystemZip).toHaveBeenCalledWith('@test:localhost', mockRes, 'backup');
        });

        it('should handle backup export errors gracefully', async () => {
            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue(null);
            (importService.exportSystemZip as jest.Mock).mockRejectedValue(new Error('Stream error'));

            await importController.exportBackupZip(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Export failed' });
        });
    });

    describe('importZip', () => {
        it('should successfully trigger ZIP import', async () => {
            mockReq.body = Buffer.from('mock-zip-data');
            
            (importService.importSystemZip as jest.Mock).mockResolvedValue({
                count: 5,
                systemSlug: 'zip-sys',
                failedAvatars: ['mock_error']
            });

            await importController.importZip(mockReq, mockRes);

            expect(importService.importSystemZip).toHaveBeenCalledWith('@test:localhost', mockReq.body);
            expect(proxyCache.invalidate).toHaveBeenCalledWith('@test:localhost');
            expect(emitSystemUpdate).toHaveBeenCalledWith('@test:localhost');
            expect(mockRes.json).toHaveBeenCalledWith({
                success: true,
                count: 5,
                systemSlug: 'zip-sys',
                failedAvatars: ['mock_error']
            });
        });

        it('should return 400 when ZIP import fails', async () => {
            (importService.importSystemZip as jest.Mock).mockRejectedValue(new Error('Invalid ZIP'));

            await importController.importZip(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Failed to process ZIP backup' });
        });
    });

    describe('exportPluralKitJson', () => {
        it('should return JSON export successfully', async () => {
            (prisma.accountLink.findUnique as jest.Mock).mockResolvedValue({
                system: { slug: 'test-sys' }
            });
            const mockData = { version: 2, system: { id: 'test' } };
            (importService.generatePkJson as jest.Mock).mockResolvedValue(mockData);
            (importService.stringifyWithEscapedUnicode as jest.Mock).mockReturnValue('{"version":2}');

            await importController.exportPluralKitJson(mockReq, mockRes);

            expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
            expect(mockRes.send).toHaveBeenCalledWith('{"version":2}');
        });

        it('should return 404 if system not found', async () => {
            (importService.generatePkJson as jest.Mock).mockResolvedValue(null);

            await importController.exportPluralKitJson(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'System not found' });
        });

        it('should return 500 on internal failure', async () => {
            (importService.generatePkJson as jest.Mock).mockRejectedValue(new Error('Crash'));

            await importController.exportPluralKitJson(mockReq, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Export failed' });
        });
    });
});