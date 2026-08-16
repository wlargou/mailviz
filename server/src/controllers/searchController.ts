import { Response, NextFunction } from 'express';
import type { Req } from "../types/http.js";
import { searchService } from '../services/searchService.js';

export const searchController = {
  async search(req: Req, res: Response, next: NextFunction) {
    try {
      const q = (req.query.q as string) || '';
      const results = await searchService.search(q, req.user!.id);
      res.json({ data: results });
    } catch (err) {
      next(err);
    }
  },
};
