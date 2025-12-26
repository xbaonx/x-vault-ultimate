import { Router } from 'express';
import { PaymasterController } from '../controllers/paymaster.controller';

const router = Router();

// This endpoint is called by the client (or bundler) to get paymasterAndData
router.post('/pm_sponsorUserOperation', PaymasterController.sponsorUserOperation);

export default router;
