import { Router } from 'express';
import { DeviceController } from '../controllers/device.controller';
import { gatekeeper } from '../middleware/gatekeeper';

const router = Router();

router.post('/register', DeviceController.register); // Legacy/Fallback
router.post('/register/options', DeviceController.generateRegistrationOptions); // Step 1
router.post('/register/verify', DeviceController.verifyRegistration); // Step 2

// Passkey Login Flow
router.post('/login/options', DeviceController.generateLoginOptions);
router.post('/login/verify', DeviceController.verifyLogin);

router.get('/poll/:sessionId', DeviceController.pollStatus);
router.post('/pass/session', gatekeeper, DeviceController.createPassSession);
router.get('/pass/session/:sessionId', DeviceController.downloadPassBySession);
router.get('/pass/:deviceId', DeviceController.downloadPass);
router.post('/verify', DeviceController.verifyDevice);

export default router;
