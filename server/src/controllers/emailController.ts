import { Request, Response, NextFunction } from 'express';
import { emailService } from '../services/emailService.js';
import { isSyncInProgress } from '../jobs/emailSyncScheduler.js';

export const emailController = {
  async findAllThreads(req: Request, res: Response, next: NextFunction) {
    try {
      const { search, customerId, contactEmail, isRead, hasAttachment, folder, from, to, subject, dateAfter, dateBefore, page, limit } = req.query as Record<string, string>;
      const result = await emailService.findAllThreads({ search, customerId, contactEmail, isRead, hasAttachment, folder, from, to, subject, dateAfter, dateBefore, page, limit });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async findThread(req: Request, res: Response, next: NextFunction) {
    try {
      const emails = await emailService.findThread(req.params.threadId);
      res.json({ data: emails });
    } catch (err) {
      next(err);
    }
  },

  async findById(req: Request, res: Response, next: NextFunction) {
    try {
      const email = await emailService.findById(req.params.id);
      res.json({ data: email });
    } catch (err) {
      next(err);
    }
  },

  async getAttachment(req: Request, res: Response, next: NextFunction) {
    try {
      const { data, mimeType, filename } = await emailService.getAttachment(
        req.params.id,
        req.params.aid
      );
      const disposition = req.query.inline === 'true' ? 'inline' : 'attachment';
      // Sanitize filename to prevent header injection (S3)
      const safeFilename = filename.replace(/["\r\n\\]/g, '_');
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `${disposition}; filename="${safeFilename}"`);
      res.send(data);
    } catch (err) {
      next(err);
    }
  },

  async sync(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await emailService.syncFromGmail();
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async markAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      await emailService.markAsRead(req.params.id);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },

  async markAsUnread(req: Request, res: Response, next: NextFunction) {
    try {
      await emailService.markAsUnread(req.params.id);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },

  async toggleStar(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await emailService.toggleStar(req.params.id);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async archive(req: Request, res: Response, next: NextFunction) {
    try {
      await emailService.archive(req.params.id);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },

  async unarchive(req: Request, res: Response, next: NextFunction) {
    try {
      await emailService.unarchive(req.params.id);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },

  async trash(req: Request, res: Response, next: NextFunction) {
    try {
      await emailService.trash(req.params.id);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },

  async untrash(req: Request, res: Response, next: NextFunction) {
    try {
      await emailService.untrash(req.params.id);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },

  async batchMarkAsRead(req: Request, res: Response, next: NextFunction) {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'ids array required' } });
        return;
      }
      const result = await emailService.batchMarkAsRead(ids);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async batchMarkAsUnread(req: Request, res: Response, next: NextFunction) {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'ids array required' } });
        return;
      }
      const result = await emailService.batchMarkAsUnread(ids);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async batchArchive(req: Request, res: Response, next: NextFunction) {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'ids array required' } });
        return;
      }
      const result = await emailService.batchArchive(ids);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async batchTrash(req: Request, res: Response, next: NextFunction) {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'ids array required' } });
        return;
      }
      const result = await emailService.batchTrash(ids);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async convertToTask(req: Request, res: Response, next: NextFunction) {
    try {
      const task = await emailService.convertToTask(req.params.id, req.body);
      res.status(201).json({ data: task });
    } catch (err) {
      next(err);
    }
  },

  async getUnreadCount(req: Request, res: Response, next: NextFunction) {
    try {
      const count = await emailService.getUnreadCount();
      res.json({ data: { count } });
    } catch (err) {
      next(err);
    }
  },

  async getSyncStatus(_req: Request, res: Response) {
    res.json({ data: { syncing: isSyncInProgress() } });
  },

  async sendEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await emailService.sendEmail(req.body);
      res.status(201).json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async replyToEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await emailService.replyToEmail(req.params.id, req.body);
      res.status(201).json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async forwardEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await emailService.forwardEmail(req.params.id, req.body);
      res.status(201).json({ data: result });
    } catch (err) {
      next(err);
    }
  },
};
