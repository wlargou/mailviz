import { Router } from 'express';
import { onboardingController } from '../controllers/onboardingController.js';

const router = Router();

router.get('/status', onboardingController.getStatus);
router.post('/task-statuses', onboardingController.seedTaskStatuses);
router.post('/complete', onboardingController.complete);
router.post('/reset', onboardingController.reset);

export { router as onboardingRoutes };
