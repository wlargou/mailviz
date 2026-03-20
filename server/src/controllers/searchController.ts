import { Request, Response, NextFunction } from 'express';
import { searchService } from '../services/searchService.js';

export const searchController = {
  async search(req: Request, res: Response, next: NextFunction) {
    try {
      const q = (req.query.q as string) || '';
      const results = await searchService.search(q, req.user!.id);
      res.json({ data: results });
    } catch (err) {
      next(err);
    }
  },
};
