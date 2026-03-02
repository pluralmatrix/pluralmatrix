import express, { Router } from 'express';
import * as mediaController from '../controllers/mediaController';
import { authenticateToken } from '../auth';

const router = Router();

router.post('/upload', authenticateToken, express.raw({ type: 'image/*', limit: '2mb' }), mediaController.uploadMedia);
router.get('/download/:server/:mediaId', mediaController.downloadMedia);

export default router;
