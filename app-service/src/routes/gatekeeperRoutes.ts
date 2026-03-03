import { Router } from 'express';
import * as gatekeeperController from '../controllers/gatekeeperController';
import { authenticateGatekeeper } from '../auth';

const router = Router();

router.post('/check', authenticateGatekeeper, gatekeeperController.checkMessage);

export default router;
