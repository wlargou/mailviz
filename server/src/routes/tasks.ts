import { Router } from 'express';
import { taskController } from '../controllers/taskController.js';
import { validate } from '../middleware/validate.js';
import { createTaskSchema, updateTaskSchema, reorderSchema } from '../validators/taskValidator.js';

const router = Router();

router.get('/summary', taskController.getSummary);
router.get('/', taskController.findAll);
router.get('/:id', taskController.findById);
router.post('/', validate(createTaskSchema), taskController.create);
router.patch('/reorder', validate(reorderSchema), taskController.reorder);
router.patch('/:id', validate(updateTaskSchema), taskController.update);
router.delete('/:id', taskController.delete);

export { router as taskRoutes };
