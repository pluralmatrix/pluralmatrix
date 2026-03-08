import { Router } from 'express';
import { authenticateToken } from '../auth';
import { listGroups, createGroup, updateGroup, deleteGroup } from '../controllers/groupController';

const router = Router();

router.use(authenticateToken);

router.get('/', listGroups);
router.post('/', createGroup);
router.put('/:id', updateGroup);
router.delete('/:id', deleteGroup);

export default router;
