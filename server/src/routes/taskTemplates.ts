import { Router } from 'express';
import { taskTemplateController } from '../controllers/taskTemplateController.js';
import { validate } from '../middleware/validate.js';
import {
  createTaskTemplateSchema,
  updateTaskTemplateSchema,
  templateFromTaskSchema,
  instantiateTemplateSchema,
} from '../validators/taskTemplateValidator.js';

const router = Router();

router.get('/', taskTemplateController.findAll);
router.post('/', validate(createTaskTemplateSchema), taskTemplateController.create);
// Before '/:id', or Express reads 'from-task' as an id.
router.post('/from-task', validate(templateFromTaskSchema), taskTemplateController.fromTask);
router.get('/:id', taskTemplateController.findById);
router.patch('/:id', validate(updateTaskTemplateSchema), taskTemplateController.update);
router.delete('/:id', taskTemplateController.delete);
router.post('/:id/instantiate', validate(instantiateTemplateSchema), taskTemplateController.instantiate);

export { router as taskTemplateRoutes };
