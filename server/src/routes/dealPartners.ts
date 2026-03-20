import { Router } from 'express';
import { dealPartnerController } from '../controllers/dealPartnerController.js';
import { validate } from '../middleware/validate.js';
import { createDealPartnerSchema, updateDealPartnerSchema } from '../validators/dealPartnerValidator.js';

const router = Router();

router.get('/', dealPartnerController.findAll);
router.post('/', validate(createDealPartnerSchema), dealPartnerController.create);
router.patch('/:id', validate(updateDealPartnerSchema), dealPartnerController.update);
router.delete('/:id', dealPartnerController.delete);

export { router as dealPartnerRoutes };
