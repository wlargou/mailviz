import { Request, Response, NextFunction } from 'express';
import { calendarService } from '../services/calendarService.js';
import { isCalendarSyncInProgress } from '../jobs/calendarSyncScheduler.js';

export const calendarController = {
  async findAll(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await calendarService.findAll(req.query as { start?: string; end?: string }, req.user!.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async findById(req: Request, res: Response, next: NextFunction) {
    try {
      const event = await calendarService.findById(req.params.id, req.user!.id);
      res.json({ data: event });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const event = await calendarService.create(req.body, req.user!.id);
      res.status(201).json({ data: event });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const event = await calendarService.update(req.params.id, req.body, req.user!.id);
      res.json({ data: event });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const mode = (req.query.mode as string) === 'all' ? 'all' : 'single';
      await calendarService.delete(req.params.id, req.user!.id, mode);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  async respond(req: Request, res: Response, next: NextFunction) {
    try {
      const event = await calendarService.respond(req.params.id, req.body.response, req.user!.id);
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
