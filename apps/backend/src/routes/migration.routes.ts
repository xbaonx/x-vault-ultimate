import { Router } from 'express';
import { MigrationController } from '../controllers/migration.controller';
import { gatekeeper } from '../middleware/gatekeeper';

const router = Router();

router.use(gatekeeper);

router.post('/initiate', MigrationController.initiateMigration);
router.get('/status/:userId', MigrationController.checkStatus);
router.post('/finalize', MigrationController.finalizeMigration);
router.post('/cancel', MigrationController.cancelMigration);

export default router;
