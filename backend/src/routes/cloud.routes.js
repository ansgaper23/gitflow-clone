import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getCloudOverview, getTableRowsData } from '../controllers/cloudController.js';

const router = Router({ mergeParams: true });

router.get('/overview', requireAuth, getCloudOverview);
router.get('/tables/:tableName/rows', requireAuth, getTableRowsData);

export default router;
