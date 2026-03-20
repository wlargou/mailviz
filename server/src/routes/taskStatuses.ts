import { Router } from 'express';
import { taskStatusController } from '../controllers/taskStatusController.js';
import { validate } from '../middleware/validate.js';
import { createSettingsItemSchema, updateSettingsItemSchema, reorderSchema } from '../validators/settingsValidator.js';

const router = Router();

router.get('/', taskStatusController.findAll);
router.post('/', validate(createSettingsItemSchema), taskStatusController.create);
router.patch('/reorder', validate(reorderSchema), taskStatusController.reorder);
router.patch('/:id', validate(updateSettingsItemSchema), taskStatusController.update);
router.delete('/:id', taskStatusController.delete);

export { router as taskStatusRoutes };
