import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getAnalyticsMetrics } from '../controllers/analyticsController.js';

const router = Router({ mergeParams: true });

router.get('/', requireAuth, getAnalyticsMetrics);

export default router;
