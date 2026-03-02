import express, { Router } from 'express';
import * as importController from '../controllers/importController';
import { authenticateToken } from '../auth';

const router = Router();

router.use(authenticateToken);

// PluralKit-compatible exports/imports
router.post('/pk/json', importController.importPluralKit);
router.get('/pk/json', importController.exportPluralKitJson);
router.get('/pk/zip', importController.exportPluralKitZip);

// PluralMatrix internal backup exports/imports
router.get('/backup/zip', importController.exportBackupZip);
router.post('/backup/zip', express.raw({ type: 'application/zip', limit: '100mb' }), importController.importZip);

export default router;
