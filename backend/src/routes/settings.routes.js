import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { getSettings, updateSettings, addSecret, removeSecret } from '../controllers/settingsController.js';

const router = Router({ mergeParams: true });

router.get('/', requireAuth, getSettings);
router.patch('/', requireAuth, updateSettings);
router.post('/secrets', requireAuth, addSecret);
router.delete('/secrets/:key', requireAuth, removeSecret);

export default router;
