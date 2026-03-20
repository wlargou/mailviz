import { Request, Response, NextFunction } from 'express';
import { taskStatusService } from '../services/taskStatusService.js';

export const taskStatusController = {
  async findAll(req: Request, res: Response, next: NextFunction) {
    try {
      const statuses = await taskStatusService.findAll(req.user!.id);
      res.json({ data: statuses });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      // Body already validated by Zod middleware (A3)
      const { label, color } = req.body;
      const name = label.toUpperCase().replace(/\s+/g, '_');
      const status = await taskStatusService.create(req.user!.id, { name, label, color });
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
      const status = await taskStatusService.update(req.user!.id, id as string, { label, color });
      res.json({ data: status });
    } catch (err) {
      next(err);
    }
  },

  async reorder(req: Request, res: Response, next: NextFunction) {
    try {
      // Body already validated by Zod middleware (A3)
      await taskStatusService.reorder(req.user!.id, req.body.items);
      res.json({ data: { success: true } });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await taskStatusService.delete(req.user!.id, id as string);
      res.json({ data: { success: true } });
    } catch (err) {
      next(err);
    }
  },
};
