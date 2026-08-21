import { Router } from 'express';
import { authController } from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { deleteAccountSchema } from '../validators/accountValidator.js';

const router = Router();

// ── Public routes (no auth required) ──
router.get('/login/google/url', authController.getLoginGoogleUrl);

// Single Google callback — branches on state param (login vs connect)
router.get('/google/callback', authController.googleCallback);

// ── Protected routes ──
router.get('/me', requireAuth, authController.getMe);
router.post('/logout', requireAuth, authController.logout);

// Google integration (connect Gmail/Calendar to existing user)
router.get('/google/url', requireAuth, authController.getGoogleUrl);
router.get('/google/status', requireAuth, authController.getGoogleStatus);
router.post('/google/disconnect', requireAuth, authController.disconnectGoogle);

// Account deletion. Neither route takes a user id — the only account they can
// touch is the one the cookie belongs to, which is what stops the DELETE from
// being an admin backdoor.
router.get('/account/summary', requireAuth, authController.getAccountDeletionSummary);
router.delete('/account', requireAuth, validate(deleteAccountSchema), authController.deleteAccount);

// Users list (for sharing features)
router.get('/users', requireAuth, authController.listUsers);

// Email signature
router.get('/signature', requireAuth, authController.getSignature);
router.put('/signature', requireAuth, authController.updateSignature);

export { router as authRoutes };
