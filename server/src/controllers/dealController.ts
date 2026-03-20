import { Request, Response, NextFunction } from 'express';
import { dealService } from '../services/dealService.js';

export const dealController = {
  async findAll(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await dealService.findAll(req.user!.id, req.query as Record<string, string>);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async findById(req: Request, res: Response, next: NextFunction) {
    try {
      const deal = await dealService.findById(req.user!.id, req.params.id);
      res.json({ data: deal });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const deal = await dealService.create(req.user!.id, req.body);
      res.status(201).json({ data: deal });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const deal = await dealService.update(req.user!.id, req.params.id, req.body);
      res.json({ data: deal });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await dealService.delete(req.user!.id, req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
};
