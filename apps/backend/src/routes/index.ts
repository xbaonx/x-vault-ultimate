import { Router } from 'express';
import deviceRoutes from './device.routes';
import paymasterRoutes from './paymaster.routes';
import walletRoutes from './wallet.routes';
import adminRoutes from './admin.routes';
import securityRoutes from './security.routes';
import authRoutes from './auth.routes';
import migrationRoutes from './migration.routes';
import appleRoutes from './apple.routes';
import aaRoutes from './aa.routes';
import webhooksRoutes from './webhooks.routes';

const router = Router();

router.use('/device', deviceRoutes);
router.use('/paymaster', paymasterRoutes);
router.use('/wallet', walletRoutes);
router.use('/admin', adminRoutes);
router.use('/security', securityRoutes);
router.use('/auth', authRoutes);
router.use('/migration', migrationRoutes);
router.use('/apple', appleRoutes);
router.use('/aa', aaRoutes);
router.use('/webhooks', webhooksRoutes);

export default router;
