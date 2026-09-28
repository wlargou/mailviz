import { Router } from 'express';
import type { Req } from '../types/http.js';
import { customerController } from '../controllers/customerController.js';
import { accountOverviewService } from '../services/accountOverviewService.js';
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
// The account at a glance, and everything that happened with it.
router.get('/:id/overview', async (req, res, next) => {
  try {
    res.json({ data: await accountOverviewService.overview((req as Req).user!.id, String(req.params.id)) });
  } catch (err) {
    next(err);
  }
});
router.get('/:id/timeline', async (req, res, next) => {
  try {
    const before = typeof req.query.before === 'string' ? req.query.before : undefined;
    res.json({ data: await accountOverviewService.timeline((req as Req).user!.id, String(req.params.id), before) });
  } catch (err) {
    next(err);
  }
});
router.post('/', validate(createCustomerSchema), customerController.create);
router.patch('/:id/vip', customerController.toggleVip);
router.patch('/:id', validate(updateCustomerSchema), customerController.update);
router.delete('/:id', customerController.delete);

export { router as customerRoutes };
