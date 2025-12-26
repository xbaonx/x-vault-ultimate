import { Router } from 'express';
import { WalletController } from '../controllers/wallet.controller';

const router = Router();

router.get('/address/:userId', WalletController.getAddress);
router.get('/portfolio/:userId', WalletController.getPortfolio);
router.post('/deploy', WalletController.deployWallet);

export default router;
