import { Request, Response, NextFunction } from 'express';
import { taskStatusService } from '../services/taskStatusService.js';

export const taskStatusController = {
  async findAll(_req: Request, res: Response, next: NextFunction) {
    try {
      const statuses = await taskStatusService.findAll();
      res.json({ data: statuses });
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
      const status = await taskStatusService.create({ name, label: label.trim(), color });
      res.status(201).json({ data: status });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        res.status(409).json({ error: { code: 'CONFLICT', message: 'Status with this name already exists' } });
        return;
      }
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { label, color } = req.body;
      const status = await taskStatusService.update(id as string, { label, color });
      res.json({ data: status });
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
      await taskStatusService.reorder(items);
      res.json({ data: { success: true } });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await taskStatusService.delete(id as string);
      res.json({ data: { success: true } });
    } catch (err) {
      next(err);
    }
  },
};
