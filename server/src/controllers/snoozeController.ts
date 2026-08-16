import type { Response, NextFunction } from 'express';
import type { Req } from '../types/http.js';
import { snoozeService } from '../services/snoozeService.js';
import type { CreateReminderInput } from '../validators/snoozeValidator.js';

export const snoozeController = {
  /** Everything still pending, so the mail list can badge the rows it renders. */
  async list(req: Req, res: Response, next: NextFunction) {
    try {
      const reminders = await snoozeService.listArmed(req.user!.id);
      res.json({ data: reminders });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Req, res: Response, next: NextFunction) {
    try {
      const body = req.body as CreateReminderInput;
      const reminder = await snoozeService.create(req.user!.id, {
        threadId: body.threadId,
        kind: body.kind,
        remindAt: new Date(body.remindAt),
      });
      res.status(201).json({ data: reminder });
    } catch (err) {
      next(err);
    }
  },

  /** Unsnooze now, or forget a follow-up. */
  async cancel(req: Req, res: Response, next: NextFunction) {
    try {
      const result = await snoozeService.cancel(req.user!.id, req.params.id);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },
};
