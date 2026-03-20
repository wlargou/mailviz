import { Router } from 'express';
import { dealController } from '../controllers/dealController.js';
import { validate } from '../middleware/validate.js';
import { createDealSchema, updateDealSchema } from '../validators/dealValidator.js';

const router = Router();

router.get('/', dealController.findAll);
router.get('/:id', dealController.findById);
router.post('/', validate(createDealSchema), dealController.create);
router.patch('/:id', validate(updateDealSchema), dealController.update);
router.delete('/:id', dealController.delete);

export { router as dealRoutes };
