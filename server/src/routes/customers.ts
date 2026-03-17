import { Router } from 'express';
import { customerController } from '../controllers/customerController.js';
import { validate } from '../middleware/validate.js';
import { createCustomerSchema, updateCustomerSchema } from '../validators/customerValidator.js';

const router = Router();

router.get('/', customerController.findAll);
router.get('/:id', customerController.findById);
router.get('/:id/attachments', customerController.findAttachments);
router.get('/:id/events', customerController.findLinkedEvents);
router.post('/', validate(createCustomerSchema), customerController.create);
router.patch('/:id', validate(updateCustomerSchema), customerController.update);
router.delete('/:id', customerController.delete);

export { router as customerRoutes };
