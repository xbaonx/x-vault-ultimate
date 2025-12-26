import { Router } from 'express';
import { DeviceController } from '../controllers/device.controller';

const router = Router();

router.post('/register', DeviceController.register);
router.get('/poll/:sessionId', DeviceController.pollStatus);
router.get('/pass/:deviceId', DeviceController.downloadPass);
router.post('/verify', DeviceController.verifyDevice);

export default router;
