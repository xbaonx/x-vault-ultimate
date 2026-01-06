import { Router } from 'express';
import { SecurityController } from '../controllers/security.controller';
import { gatekeeper } from '../middleware/gatekeeper';

const router = Router();

router.use(gatekeeper);

// Endpoint to set PIN (should be protected by auth middleware in real app)
router.post('/pin/set', SecurityController.setSpendingPin);

// Endpoint to verify PIN
router.post('/pin/verify', SecurityController.verifyPin);

export default router;
