import { Response, NextFunction } from 'express';
import type { Req } from "../types/http.js";
import { taskStatusService } from '../services/taskStatusService.js';

export const taskStatusController = {
  async findAll(req: Req, res: Response, next: NextFunction) {
    try {
      const statuses = await taskStatusService.findAll(req.user!.id);
      res.json({ data: statuses });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Req, res: Response, next: NextFunction) {
    try {
      // Body already validated by Zod middleware (A3)
      const { label, color, isTerminal } = req.body;
      const name = label.toUpperCase().replace(/\s+/g, '_');
      const status = await taskStatusService.create(req.user!.id, { name, label, color, isTerminal });
      res.status(201).json({ data: status });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        res.status(409).json({ error: { code: 'CONFLICT', message: 'Status with this name already exists' } });
        return;
      }
      next(err);
    }
  },

  async update(req: Req, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      // `isTerminal` absent means "leave it alone" — Prisma ignores undefined —
      // which is why the update schema deliberately gives it no default.
      const { label, color, isTerminal } = req.body;
      const status = await taskStatusService.update(req.user!.id, id as string, { label, color, isTerminal });
      res.json({ data: status });
    } catch (err) {
      next(err);
    }
  },

  async reorder(req: Req, res: Response, next: NextFunction) {
    try {
      // Body already validated by Zod middleware (A3)
      await taskStatusService.reorder(req.user!.id, req.body.items);
      res.json({ data: { success: true } });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Req, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      await taskStatusService.delete(req.user!.id, id as string);
      res.json({ data: { success: true } });
    } catch (err) {
      next(err);
    }
  },
};
