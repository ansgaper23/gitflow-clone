import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { runSeoAudit, fixSeoWithAgent } from '../controllers/seoController.js';

const router = Router({ mergeParams: true });

router.get('/status', requireAuth, runSeoAudit);
router.post('/fix-all', requireAuth, fixSeoWithAgent);

export default router;
