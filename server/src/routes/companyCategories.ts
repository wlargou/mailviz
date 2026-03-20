import { Router } from 'express';
import { companyCategoryController } from '../controllers/companyCategoryController.js';

const router = Router();

router.get('/', companyCategoryController.findAll);
router.post('/', companyCategoryController.create);
router.patch('/reorder', companyCategoryController.reorder);
router.patch('/:id', companyCategoryController.update);
router.delete('/:id', companyCategoryController.delete);

export { router as companyCategoryRoutes };
