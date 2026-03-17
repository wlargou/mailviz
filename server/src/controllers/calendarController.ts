import { Request, Response, NextFunction } from 'express';
import { calendarService } from '../services/calendarService.js';

export const calendarController = {
  async findAll(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await calendarService.findAll(req.query as { start?: string; end?: string });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async findById(req: Request, res: Response, next: NextFunction) {
    try {
      const event = await calendarService.findById(req.params.id);
      res.json({ data: event });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const event = await calendarService.create(req.body);
      res.status(201).json({ data: event });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const event = await calendarService.update(req.params.id, req.body);
      res.json({ data: event });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const mode = (req.query.mode as string) === 'all' ? 'all' : 'single';
      await calendarService.delete(req.params.id, mode);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  async respond(req: Request, res: Response, next: NextFunction) {
    try {
      const event = await calendarService.respond(req.params.id, req.body.response);
      res.json({ data: event });
    } catch (err) {
      next(err);
    }
  },

  async sync(_req: Request, res: Response, next: NextFunction) {
    try {
      const result = await calendarService.syncFromGoogle();
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
};
