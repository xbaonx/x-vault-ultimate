import { Router } from 'express';
import deviceRoutes from './device.routes';
import paymasterRoutes from './paymaster.routes';
import walletRoutes from './wallet.routes';

const router = Router();

router.use('/device', deviceRoutes);
router.use('/paymaster', paymasterRoutes);
router.use('/wallet', walletRoutes);

export default router;
