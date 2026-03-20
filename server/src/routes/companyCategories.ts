import { Router } from 'express';
import { companyCategoryController } from '../controllers/companyCategoryController.js';
import { validate } from '../middleware/validate.js';
import { createSettingsItemSchema, updateSettingsItemSchema, reorderSchema } from '../validators/settingsValidator.js';

const router = Router();

router.get('/', companyCategoryController.findAll);
router.post('/', validate(createSettingsItemSchema), companyCategoryController.create);
router.patch('/reorder', validate(reorderSchema), companyCategoryController.reorder);
router.patch('/:id', validate(updateSettingsItemSchema), companyCategoryController.update);
router.delete('/:id', companyCategoryController.delete);

export { router as companyCategoryRoutes };
