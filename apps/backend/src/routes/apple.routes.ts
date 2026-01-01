import { Router } from 'express';
import { ApplePassController } from '../controllers/apple.controller';

const router = Router();

// Apple Wallet Web Service Endpoints
// Base URL: /api/apple

// 1. Register Device for Push Notifications
router.post('/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber', ApplePassController.registerDevice);

// 2. Unregister Device
router.delete('/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier/:serialNumber', ApplePassController.unregisterDevice);

// 3. Get Updatable Passes (Checking for updates)
router.get('/v1/devices/:deviceLibraryIdentifier/registrations/:passTypeIdentifier', ApplePassController.getUpdatablePasses);

// 4. Get Latest Pass Data
router.get('/v1/passes/:passTypeIdentifier/:serialNumber', ApplePassController.getLatestPass);

// 5. Error Logging
router.post('/v1/log', ApplePassController.log);

export default router;
