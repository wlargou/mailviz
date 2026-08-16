import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { contactController } from '../controllers/contactController.js';
import { validate } from '../middleware/validate.js';
import { createContactSchema, mergeContactsSchema, updateContactSchema } from '../validators/contactValidator.js';

const router = Router();

// Merging deletes contacts irreversibly, so it is capped like the other
// destructive bulk operations — 20 per minute.
const mergeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many merges. Try again later.' } },
});

router.get('/', contactController.findAll);
router.get('/lookup', contactController.findByEmail);
// Must stay above `/:id` — Express would otherwise read "duplicates" as an id.
router.get('/duplicates', contactController.findDuplicates);
router.post('/merge', mergeLimiter, validate(mergeContactsSchema), contactController.merge);
router.get('/:id', contactController.findById);
router.get('/:id/attachments', contactController.findAttachments);
router.get('/:id/events', contactController.findContactEvents);
router.post('/', validate(createContactSchema), contactController.create);
router.patch('/:id/vip', contactController.toggleVip);
router.patch('/:id', validate(updateContactSchema), contactController.update);
router.delete('/:id', contactController.delete);

export { router as contactRoutes };
