import { Router } from 'express';
import type { Req } from '../types/http.js';
import { todayService } from '../services/todayService.js';

const router = Router();

/** The Today page, in one request — see todayService. */
router.get('/', async (req, res, next) => {
  try {
    res.json({ data: await todayService.forUser((req as Req).user!.id) });
  } catch (err) {
    next(err);
  }
});

export { router as todayRoutes };
