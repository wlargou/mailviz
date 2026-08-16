import { Response, NextFunction } from 'express';
import type { Req } from '../types/http.js';
import { draftService } from '../services/draftService.js';

export const draftController = {
  async list(req: Req, res: Response, next: NextFunction) {
    try {
      const drafts = await draftService.list(req.user!.id);
      res.json({ data: drafts });
    } catch (err) {
      next(err);
    }
  },

  async sync(req: Req, res: Response, next: NextFunction) {
    try {
      const result = await draftService.syncDrafts(req.user!.id);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async open(req: Req, res: Response, next: NextFunction) {
    try {
      const draft = await draftService.open(req.params.id, req.user!.id);
      res.json({ data: draft });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Req, res: Response, next: NextFunction) {
    try {
      const draft = await draftService.save(req.user!.id, req.body);
      res.status(201).json({ data: draft });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Req, res: Response, next: NextFunction) {
    try {
      const draft = await draftService.save(req.user!.id, req.body, req.params.id);
      res.json({ data: draft });
    } catch (err) {
      next(err);
    }
  },

  async send(req: Req, res: Response, next: NextFunction) {
    try {
      const result = await draftService.send(req.user!.id, req.params.id, req.body);
      res.status(201).json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async remove(req: Req, res: Response, next: NextFunction) {
    try {
      await draftService.remove(req.user!.id, req.params.id);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
};
