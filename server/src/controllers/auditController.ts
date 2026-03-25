import type { Request, Response } from 'express';
import { auditService } from '../services/auditService.js';

export const auditController = {
  async findAll(req: Request, res: Response) {
    const userId = req.user!.id;
    const result = await auditService.findAll(userId, {
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      action: req.query.action as string | undefined,
      entityType: req.query.entityType as string | undefined,
      entityId: req.query.entityId as string | undefined,
      search: req.query.search as string | undefined,
      dateFrom: req.query.dateFrom as string | undefined,
      dateTo: req.query.dateTo as string | undefined,
    });
    res.json(result);
  },

  async findById(req: Request, res: Response) {
    const userId = req.user!.id;
    const log = await auditService.findById(userId, req.params.id);
    if (!log) {
      res.status(404).json({ error: 'Audit log entry not found' });
      return;
    }
    res.json(log);
  },
};
