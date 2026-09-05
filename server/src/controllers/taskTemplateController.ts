import { Response, NextFunction } from 'express';
import type { Req } from '../types/http.js';
import { taskTemplateService } from '../services/taskTemplateService.js';

export const taskTemplateController = {
  async findAll(req: Req, res: Response, next: NextFunction) {
    try {
      res.json({ data: await taskTemplateService.findAll(req.user!.id) });
    } catch (err) {
      next(err);
    }
  },
  async findById(req: Req, res: Response, next: NextFunction) {
    try {
      res.json({ data: await taskTemplateService.findById(req.user!.id, req.params.id) });
    } catch (err) {
      next(err);
    }
  },
  async create(req: Req, res: Response, next: NextFunction) {
    try {
      res.status(201).json({ data: await taskTemplateService.create(req.user!.id, req.body) });
    } catch (err) {
      next(err);
    }
  },
  async fromTask(req: Req, res: Response, next: NextFunction) {
    try {
      const { taskId, name, description } = req.body;
      res.status(201).json({ data: await taskTemplateService.fromTask(req.user!.id, taskId, name, description) });
    } catch (err) {
      next(err);
    }
  },
  async update(req: Req, res: Response, next: NextFunction) {
    try {
      res.json({ data: await taskTemplateService.update(req.user!.id, req.params.id, req.body) });
    } catch (err) {
      next(err);
    }
  },
  async delete(req: Req, res: Response, next: NextFunction) {
    try {
      await taskTemplateService.delete(req.user!.id, req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
  async instantiate(req: Req, res: Response, next: NextFunction) {
    try {
      res.status(201).json({ data: await taskTemplateService.instantiate(req.user!.id, req.params.id, req.body) });
    } catch (err) {
      next(err);
    }
  },
};
