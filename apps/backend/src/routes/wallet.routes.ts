import { Router } from 'express';
import { WalletController } from '../controllers/wallet.controller';
import { gatekeeper } from '../middleware/gatekeeper';

const router = Router();

// Protected Routes
router.use(gatekeeper);

router.get('/address/:userId', WalletController.getAddress);
router.get('/portfolio/:userId', WalletController.getPortfolio);
router.post('/deploy', WalletController.deployWallet);

export default router;
