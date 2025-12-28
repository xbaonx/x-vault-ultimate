import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';

const router = Router();

router.post('/apple/login', AuthController.loginWithApple);

export default router;
