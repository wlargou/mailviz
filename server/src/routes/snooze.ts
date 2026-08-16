import { Router } from 'express';
import { snoozeController } from '../controllers/snoozeController.js';
import { validate } from '../middleware/validate.js';
import { createReminderSchema } from '../validators/snoozeValidator.js';

const router = Router();

router.get('/', snoozeController.list);
router.post('/', validate(createReminderSchema), snoozeController.create);
router.delete('/:id', snoozeController.cancel);

export { router as snoozeRoutes };
