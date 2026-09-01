import { Router } from 'express';
import { taskStatusController } from '../controllers/taskStatusController.js';
import { validate } from '../middleware/validate.js';
import { createTaskStatusSchema, updateTaskStatusSchema, reorderSchema } from '../validators/settingsValidator.js';

const router = Router();

router.get('/', taskStatusController.findAll);
router.post('/', validate(createTaskStatusSchema), taskStatusController.create);
router.patch('/reorder', validate(reorderSchema), taskStatusController.reorder);
router.patch('/:id', validate(updateTaskStatusSchema), taskStatusController.update);
router.delete('/:id', taskStatusController.delete);

export { router as taskStatusRoutes };
