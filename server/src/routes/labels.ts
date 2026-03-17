import { Router } from 'express';
import { labelController } from '../controllers/labelController.js';
import { validate } from '../middleware/validate.js';
import { createLabelSchema, updateLabelSchema } from '../validators/labelValidator.js';

const router = Router();

router.get('/', labelController.findAll);
router.post('/', validate(createLabelSchema), labelController.create);
router.patch('/:id', validate(updateLabelSchema), labelController.update);
router.delete('/:id', labelController.delete);

export { router as labelRoutes };
