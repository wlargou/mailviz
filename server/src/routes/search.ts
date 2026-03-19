import { Router } from 'express';
import { searchController } from '../controllers/searchController.js';

const router = Router();

router.get('/', searchController.search);

export { router as searchRoutes };
