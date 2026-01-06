import { Router } from 'express';
import { WalletController } from '../controllers/wallet.controller';
import { gatekeeper } from '../middleware/gatekeeper';

const router = Router();

// Protected Routes
router.use(gatekeeper);

// Wallet Management
router.get('/list', WalletController.listWallets);
router.post('/create', WalletController.createWallet);

// Wallet Actions (param :userId is deprecated but kept for compat, controller ignores it)
router.get('/address/:userId?', WalletController.getAddress);
router.get('/portfolio/:userId?', WalletController.getPortfolio);
router.post('/deploy', WalletController.deployWallet);

export default router;
