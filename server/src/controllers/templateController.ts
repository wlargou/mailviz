import { Response, NextFunction } from 'express';
import type { Req } from '../types/http.js';
import { templateService, TEMPLATE_VARIABLES } from '../services/templateService.js';

export const templateController = {
  async findAll(req: Req, res: Response, next: NextFunction) {
    try {
      const templates = await templateService.findAll(req.user!.id, {
        kind: req.query.kind as string | undefined,
        search: req.query.search as string | undefined,
      });
      res.json({ data: templates });
    } catch (err) {
      next(err);
    }
  },

  /** The closed catalogue of placeholders, so Settings can list them without hardcoding. */
  variables(_req: Req, res: Response) {
    res.json({ data: TEMPLATE_VARIABLES });
  },

  async create(req: Req, res: Response, next: NextFunction) {
    try {
      const template = await templateService.create(req.user!.id, req.body);
      res.status(201).json({ data: template });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Req, res: Response, next: NextFunction) {
    try {
      const template = await templateService.update(req.user!.id, req.params.id, req.body);
      res.json({ data: template });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Req, res: Response, next: NextFunction) {
    try {
      await templateService.delete(req.user!.id, req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  async render(req: Req, res: Response, next: NextFunction) {
    try {
      const rendered = await templateService.render(req.user!.id, req.params.id, req.body);
      res.json({ data: rendered });
    } catch (err) {
      next(err);
    }
  },
};
