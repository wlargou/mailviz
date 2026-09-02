import { Response, NextFunction } from 'express';
import type { Req } from "../types/http.js";
import { calendarService } from '../services/calendarService.js';
import { isCalendarSyncInProgress, runCalendarManualSync } from '../jobs/calendarSyncScheduler.js';

export const calendarController = {
  async findAll(req: Req, res: Response, next: NextFunction) {
    try {
      const result = await calendarService.findAll(req.query as { start?: string; end?: string }, req.user!.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async findById(req: Req, res: Response, next: NextFunction) {
    try {
      const event = await calendarService.findById(req.params.id, req.user!.id);
      res.json({ data: event });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Req, res: Response, next: NextFunction) {
    try {
      const { event, push } = await calendarService.create(req.body, req.user!.id);
      // `warning` is a sibling of `data`, the same shape `meta` already takes
      // elsewhere — the event really was created here, and saying so while
      // admitting it did not reach Google is the honest report. Only a genuine
      // failure warns; a user with no Google connected sees nothing.
      res.status(201).json({ data: event, ...(push.status === 'failed' ? { warning: push.failure } : {}) });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Req, res: Response, next: NextFunction) {
    try {
      const { event, push } = await calendarService.update(req.params.id, req.body, req.user!.id);
      res.json({ data: event, ...(push.status === 'failed' ? { warning: push.failure } : {}) });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Req, res: Response, next: NextFunction) {
    try {
      const mode = (req.query.mode as string) === 'all' ? 'all' : 'single';
      await calendarService.delete(req.params.id, req.user!.id, mode);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  async respond(req: Req, res: Response, next: NextFunction) {
    try {
      const event = await calendarService.respond(req.params.id, req.body.response, req.user!.id);
      res.json({ data: event });
    } catch (err) {
      next(err);
    }
  },

  async sync(req: Req, res: Response, next: NextFunction) {
    try {
      // Through the same guard the cron tick uses. Called directly, this could
      // overlap a scheduled sync for the account, and two concurrent full syncs
      // each run a reconciliation that deletes local rows missing from their own
      // listing — so one deletes what the other just wrote.
      const outcome = await runCalendarManualSync(req.user!.id, () =>
        calendarService.syncFromGoogle(false, req.user!.id)
      );
      if (!outcome.ran) {
        res.status(409).json({
          error: { code: 'SYNC_IN_PROGRESS', message: 'A sync is already running for this account' },
        });
        return;
      }
      res.json({ data: outcome.result });
    } catch (err) {
      next(err);
    }
  },

  async getSyncStatus(req: Req, res: Response) {
    res.json({ data: { syncing: isCalendarSyncInProgress(req.user!.id) } });
  },
};
