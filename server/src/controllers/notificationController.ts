import { Request, Response } from 'express';
import { notificationService } from '../services/notificationService.js';

export const notificationController = {
  async list(req: Request, res: Response) {
    const page = req.query.page ? Number(req.query.page) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const unreadOnly = req.query.unreadOnly === 'true';

    const result = await notificationService.findAll(req.user!.id, { page, limit, unreadOnly });
    res.json(result);
  },

  async getUnreadCount(req: Request, res: Response) {
    const count = await notificationService.getUnreadCount(req.user!.id);
    res.json({ count });
  },

  async markRead(req: Request, res: Response) {
    await notificationService.markRead(req.user!.id, req.params.id);
    res.json({ success: true });
  },

  async markAllRead(req: Request, res: Response) {
    await notificationService.markAllRead(req.user!.id);
    res.json({ success: true });
  },

  async dismiss(req: Request, res: Response) {
    await notificationService.dismiss(req.user!.id, req.params.id);
    res.json({ success: true });
  },

  async dismissAll(req: Request, res: Response) {
    await notificationService.dismissAll(req.user!.id);
    res.json({ success: true });
  },
};
