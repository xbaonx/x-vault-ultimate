import { Router } from 'express';
import { WalletController } from '../controllers/wallet.controller';
import { gatekeeper } from '../middleware/gatekeeper';

const router = Router();

// Protected Routes
router.use(gatekeeper);

router.get('/address/:userId', WalletController.getAddress);
router.get('/portfolio/:userId', WalletController.getPortfolio);
router.post('/deploy', WalletController.deployWallet);

// Transaction Signing Flow
router.post('/transaction/options', WalletController.getTransactionOptions);
router.post('/transaction/send', WalletController.sendTransaction);

export default router;
