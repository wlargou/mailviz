import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { calendarController } from '../controllers/calendarController.js';
import { validate } from '../middleware/validate.js';
import { createEventSchema, updateEventSchema, respondEventSchema } from '../validators/calendarValidator.js';

const router = Router();

/**
 * Same budget as the mail sync, and more necessary here.
 *
 * Gmail calls are throttled per user inside `getGmailClient`, because Gmail's
 * quota is charged per user. Calendar's is charged per PROJECT and the client
 * is deliberately unthrottled, so there is nothing between a held-down Sync
 * button and a quota every account shares — one user degrades all of them.
 *
 * The in-flight guard added alongside this refuses a *concurrent* sync with a
 * 409, which is cheap. This bounds the other shape: repeated sequential
 * clicks, each starting a real sync once the last one finished.
 */
const syncLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many sync requests. Try again later.' } },
});

router.get('/', calendarController.findAll);
router.post('/sync', syncLimiter, calendarController.sync);
router.get('/sync-status', calendarController.getSyncStatus);
router.get('/:id', calendarController.findById);
router.post('/', validate(createEventSchema), calendarController.create);
router.patch('/:id', validate(updateEventSchema), calendarController.update);
router.delete('/:id', calendarController.delete);
router.post('/:id/respond', validate(respondEventSchema), calendarController.respond);

export { router as calendarRoutes };
