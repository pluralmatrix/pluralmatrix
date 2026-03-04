import { Router } from 'express';
import * as systemController from '../controllers/systemController';
import { authenticateToken } from '../auth';

const router = Router();

router.get('/public/:slug', systemController.getPublicSystem);

router.use(authenticateToken);

router.get('/', systemController.getSystem);
router.post('/', systemController.createSystem);
router.delete('/', systemController.deleteSystem);
router.patch('/', systemController.updateSystem);

router.get('/events', systemController.streamSystemEvents);
router.get('/links', systemController.getLinks);
router.post('/links', systemController.createLink);
router.post('/links/primary', systemController.setPrimaryAccount);
router.delete('/links/:mxid', systemController.deleteLink);

// DLQ Routes
router.get('/dead_letters', systemController.getDeadLetters);
router.delete('/dead_letters/:id', systemController.deleteDeadLetter);

export default router;
