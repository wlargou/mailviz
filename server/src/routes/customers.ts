import { Router } from 'express';
import { customerController } from '../controllers/customerController.js';
import { validate } from '../middleware/validate.js';
import { createCustomerSchema, setCompanyStatusSchema, updateCustomerSchema } from '../validators/customerValidator.js';

const router = Router();

router.get('/', customerController.findAll);
// Before `/:id`, or "status-counts" would be read as a company id.
router.get('/status-counts', customerController.statusCounts);
router.post('/status', validate(setCompanyStatusSchema), customerController.setStatus);
router.get('/:id', customerController.findById);
router.get('/:id/attachments', customerController.findAttachments);
router.get('/:id/events', customerController.findLinkedEvents);
router.post('/', validate(createCustomerSchema), customerController.create);
router.patch('/:id/vip', customerController.toggleVip);
router.patch('/:id', validate(updateCustomerSchema), customerController.update);
router.delete('/:id', customerController.delete);

export { router as customerRoutes };
