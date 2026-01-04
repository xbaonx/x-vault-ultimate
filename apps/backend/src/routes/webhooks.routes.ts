import { Router } from 'express';
import { WebhooksController } from '../controllers/webhooks.controller';

const router = Router();

router.post('/alchemy', WebhooksController.alchemy);

export default router;
