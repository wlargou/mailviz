import { Request, Response, NextFunction } from 'express';
import { companyCategoryService } from '../services/companyCategoryService.js';

export const companyCategoryController = {
  async findAll(req: Request, res: Response, next: NextFunction) {
    try {
      const categories = await companyCategoryService.findAll(req.user!.id);
      res.json({ data: categories });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      // Body already validated by Zod middleware (A3)
      const { label, color } = req.body;
      const name = label.toUpperCase().replace(/\s+/g, '_');
      const category = await companyCategoryService.create(req.user!.id, { name, label, color });
      res.status(201).json({ data: category });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        res.status(409).json({ error: { code: 'CONFLICT', message: 'Category with this name already exists' } });
        return;
      }
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { label, color } = req.body;
      const category = await companyCategoryService.update(req.user!.id, id as string, { label, color });
      res.json({ data: category });
    } catch (err) {
      next(err);
    }
  },

  async reorder(req: Request, res: Response, next: NextFunction) {
    try {
      // Body already validated by Zod middleware (A3)
      await companyCategoryService.reorder(req.user!.id, req.body.items);
      res.json({ data: { success: true } });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await companyCategoryService.delete(req.user!.id, id as string);
      res.json({ data: { success: true } });
    } catch (err) {
      next(err);
    }
  },
};
