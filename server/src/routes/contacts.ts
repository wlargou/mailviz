import { Router } from 'express';
import { contactController } from '../controllers/contactController.js';
import { validate } from '../middleware/validate.js';
import { createContactSchema, updateContactSchema } from '../validators/contactValidator.js';

const router = Router();

router.get('/', contactController.findAll);
router.get('/lookup', contactController.findByEmail);
router.get('/:id', contactController.findById);
router.get('/:id/attachments', contactController.findAttachments);
router.get('/:id/events', contactController.findContactEvents);
router.post('/', validate(createContactSchema), contactController.create);
router.patch('/:id/vip', contactController.toggleVip);
router.patch('/:id', validate(updateContactSchema), contactController.update);
router.delete('/:id', contactController.delete);

export { router as contactRoutes };
