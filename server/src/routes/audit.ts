import { Router } from 'express';
import { auditController } from '../controllers/auditController.js';

const router = Router();

router.get('/', auditController.findAll);
router.get('/:id', auditController.findById);

export default router;
