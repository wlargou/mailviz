import { Request, Response, NextFunction } from 'express';
import { companyCategoryService } from '../services/companyCategoryService.js';

export const companyCategoryController = {
  async findAll(_req: Request, res: Response, next: NextFunction) {
    try {
      const categories = await companyCategoryService.findAll();
      res.json({ data: categories });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { label, color } = req.body;
      if (!label || typeof label !== 'string' || !label.trim()) {
        res.status(400).json({ error: { code: 'VALIDATION', message: 'Label is required' } });
        return;
      }
      const name = label.trim().toUpperCase().replace(/\s+/g, '_');
      const category = await companyCategoryService.create({ name, label: label.trim(), color });
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
      const category = await companyCategoryService.update(id as string, { label, color });
      res.json({ data: category });
    } catch (err) {
      next(err);
    }
  },

  async reorder(req: Request, res: Response, next: NextFunction) {
    try {
      const { items } = req.body;
      if (!Array.isArray(items)) {
        res.status(400).json({ error: { code: 'VALIDATION', message: 'Items array required' } });
        return;
      }
      await companyCategoryService.reorder(items);
      res.json({ data: { success: true } });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await companyCategoryService.delete(id as string);
      res.json({ data: { success: true } });
    } catch (err) {
      next(err);
    }
  },
};
