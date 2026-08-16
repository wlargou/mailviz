import { Response, NextFunction } from 'express';
import type { Req } from "../types/http.js";
import { labelService } from '../services/labelService.js';

export const labelController = {
  async findAll(req: Req, res: Response, next: NextFunction) {
    try {
      const labels = await labelService.findAll(req.user!.id);
      res.json({ data: labels });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Req, res: Response, next: NextFunction) {
    try {
      const label = await labelService.create(req.user!.id, req.body);
      res.status(201).json({ data: label });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Req, res: Response, next: NextFunction) {
    try {
      const label = await labelService.update(req.user!.id, req.params.id, req.body);
      res.json({ data: label });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Req, res: Response, next: NextFunction) {
    try {
      await labelService.delete(req.user!.id, req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
};
