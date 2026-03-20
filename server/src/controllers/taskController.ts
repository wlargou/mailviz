import { Request, Response, NextFunction } from 'express';
import { taskService } from '../services/taskService.js';

export const taskController = {
  async findAll(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await taskService.findAll(req.user!.id, req.query as Record<string, string>);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async findById(req: Request, res: Response, next: NextFunction) {
    try {
      const task = await taskService.findById(req.user!.id, req.params.id);
      res.json({ data: task });
    } catch (err) {
      next(err);
    }
  },

  async getSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const summary = await taskService.getSummary(req.user!.id);
      res.json({ data: summary });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const task = await taskService.create(req.user!.id, req.body);
      res.status(201).json({ data: task });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const task = await taskService.update(req.user!.id, req.params.id, req.body);
      res.json({ data: task });
    } catch (err) {
      next(err);
    }
  },

  async reorder(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await taskService.reorder(req.user!.id, req.body);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await taskService.delete(req.user!.id, req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  async shareTask(req: Request, res: Response, next: NextFunction) {
    try {
      const { userIds } = req.body;
      if (!Array.isArray(userIds) || userIds.length === 0) {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'userIds array required' } });
        return;
      }
      const result = await taskService.shareTask(req.user!.id, req.params.id, userIds);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async unshareTask(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await taskService.unshareTask(req.user!.id, req.params.id, req.params.recipientId);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async getTaskShares(req: Request, res: Response, next: NextFunction) {
    try {
      const shares = await taskService.getTaskShares(req.user!.id, req.params.id);
      res.json({ data: shares });
    } catch (err) {
      next(err);
    }
  },

  async assignTask(req: Request, res: Response, next: NextFunction) {
    try {
      const { assignedToId } = req.body;
      const task = await taskService.assignTask(req.user!.id, req.params.id, assignedToId ?? null);
      res.json({ data: task });
    } catch (err) {
      next(err);
    }
  },
};
