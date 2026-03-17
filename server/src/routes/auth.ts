import { Router } from 'express';
import { authController } from '../controllers/authController.js';

const router = Router();

router.get('/google/url', authController.getGoogleUrl);
router.get('/google/callback', authController.googleCallback);
router.get('/google/status', authController.getGoogleStatus);
router.post('/google/disconnect', authController.disconnectGoogle);

export { router as authRoutes };
