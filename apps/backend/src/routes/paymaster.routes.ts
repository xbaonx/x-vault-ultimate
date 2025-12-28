import { Router } from 'express';
import { PaymasterController } from '../controllers/paymaster.controller';
import { gatekeeper } from '../middleware/gatekeeper';

const router = Router();

// Protected: Only registered devices can request sponsorship
router.post('/pm_sponsorUserOperation', gatekeeper, PaymasterController.sponsorUserOperation);

export default router;
