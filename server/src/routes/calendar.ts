import { Router } from 'express';
import { calendarController } from '../controllers/calendarController.js';
import { validate } from '../middleware/validate.js';
import { createEventSchema, updateEventSchema, respondEventSchema } from '../validators/calendarValidator.js';

const router = Router();

router.get('/', calendarController.findAll);
router.post('/sync', calendarController.sync);
router.get('/sync-status', calendarController.getSyncStatus);
router.get('/:id', calendarController.findById);
router.post('/', validate(createEventSchema), calendarController.create);
router.patch('/:id', validate(updateEventSchema), calendarController.update);
router.delete('/:id', calendarController.delete);
router.post('/:id/respond', validate(respondEventSchema), calendarController.respond);

export { router as calendarRoutes };
