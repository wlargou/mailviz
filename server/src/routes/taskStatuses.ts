import { Router } from 'express';
import { taskStatusController } from '../controllers/taskStatusController.js';

const router = Router();

router.get('/', taskStatusController.findAll);
router.post('/', taskStatusController.create);
router.patch('/reorder', taskStatusController.reorder);
router.patch('/:id', taskStatusController.update);
router.delete('/:id', taskStatusController.delete);

export { router as taskStatusRoutes };
