import { Request, Response, NextFunction } from 'express';
import { taskService } from '../services/taskService.js';

export const taskController = {
  async findAll(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await taskService.findAll(req.query as Record<string, string>);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async findById(req: Request, res: Response, next: NextFunction) {
    try {
      const task = await taskService.findById(req.params.id);
      res.json({ data: task });
    } catch (err) {
      next(err);
    }
  },

  async getSummary(_req: Request, res: Response, next: NextFunction) {
    try {
      const summary = await taskService.getSummary();
      res.json({ data: summary });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const task = await taskService.create(req.body);
      res.status(201).json({ data: task });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const task = await taskService.update(req.params.id, req.body);
      res.json({ data: task });
    } catch (err) {
      next(err);
    }
  },

  async reorder(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await taskService.reorder(req.body);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await taskService.delete(req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
};
