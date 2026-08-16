import { Response } from 'express';
import type { Req } from "../types/http.js";
import { notificationService } from '../services/notificationService.js';

export const notificationController = {
  async list(req: Req, res: Response) {
    const page = req.query.page ? Number(req.query.page) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const unreadOnly = req.query.unreadOnly === 'true';

    const result = await notificationService.findAll(req.user!.id, { page, limit, unreadOnly });
    res.json(result);
  },

  async getUnreadCount(req: Req, res: Response) {
    const count = await notificationService.getUnreadCount(req.user!.id);
    res.json({ count });
  },

  async markRead(req: Req, res: Response) {
    await notificationService.markRead(req.user!.id, req.params.id);
    res.json({ success: true });
  },

  async markAllRead(req: Req, res: Response) {
    await notificationService.markAllRead(req.user!.id);
    res.json({ success: true });
  },

  async dismiss(req: Req, res: Response) {
    await notificationService.dismiss(req.user!.id, req.params.id);
    res.json({ success: true });
  },

  async dismissAll(req: Req, res: Response) {
    await notificationService.dismissAll(req.user!.id);
    res.json({ success: true });
  },
};
