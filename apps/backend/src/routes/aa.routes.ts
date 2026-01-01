import { Router } from 'express';
import { gatekeeper } from '../middleware/gatekeeper';
import { AaController } from '../controllers/aa.controller';

const router = Router();

router.use(gatekeeper);

router.get('/account', AaController.getAccount);
router.post('/userop/options', AaController.getUserOpOptions);
router.post('/userop/send', AaController.sendUserOperation);

export default router;
