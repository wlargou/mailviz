import { Request, Response, NextFunction } from 'express';
import { calendarService } from '../services/calendarService.js';
import { isCalendarSyncInProgress } from '../jobs/calendarSyncScheduler.js';

export const calendarController = {
  async findAll(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await calendarService.findAll(req.user!.id, req.query as { start?: string; end?: string });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async findById(req: Request, res: Response, next: NextFunction) {
    try {
      const event = await calendarService.findById(req.user!.id, req.params.id);
      res.json({ data: event });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const event = await calendarService.create(req.user!.id, req.body);
      res.status(201).json({ data: event });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const event = await calendarService.update(req.user!.id, req.params.id, req.body);
      res.json({ data: event });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const mode = (req.query.mode as string) === 'all' ? 'all' : 'single';
      await calendarService.delete(req.user!.id, req.params.id, mode);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  async respond(req: Request, res: Response, next: NextFunction) {
    try {
      const event = await calendarService.respond(req.user!.id, req.params.id, req.body.response);
      res.json({ data: event });
    } catch (err) {
      next(err);
    }
  },

  async sync(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await calendarService.syncFromGoogle(false, req.user!.id);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async getSyncStatus(_req: Request, res: Response) {
    res.json({ data: { syncing: isCalendarSyncInProgress() } });
  },
};
