import { Router } from 'express';
import { templateController } from '../controllers/templateController.js';
import { validate } from '../middleware/validate.js';
import {
  createTemplateSchema,
  renderTemplateSchema,
  updateTemplateSchema,
} from '../validators/templateValidator.js';

const router = Router();

// Ahead of any `/:id` route — otherwise "variables" is read as a template id.
router.get('/variables', templateController.variables);

router.get('/', templateController.findAll);
router.post('/', validate(createTemplateSchema), templateController.create);
router.patch('/:id', validate(updateTemplateSchema), templateController.update);
router.delete('/:id', templateController.delete);
router.post('/:id/render', validate(renderTemplateSchema), templateController.render);

export { router as templateRoutes };
