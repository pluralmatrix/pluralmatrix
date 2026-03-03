import { Router } from 'express';
import authRoutes from './authRoutes';
import memberRoutes from './memberRoutes';
import systemRoutes from './systemRoutes';
import importRoutes from './importRoutes';
import mediaRoutes from './mediaRoutes';
import gatekeeperRoutes from './gatekeeperRoutes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/members', memberRoutes);
router.use('/system', systemRoutes);
router.use('/import', importRoutes);
router.use('/media', mediaRoutes);

router.use('/', gatekeeperRoutes);

export default router;
