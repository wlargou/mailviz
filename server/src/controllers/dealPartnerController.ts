import { Response, NextFunction } from 'express';
import type { Req } from "../types/http.js";
import { dealPartnerService } from '../services/dealPartnerService.js';

export const dealPartnerController = {
  async findAll(req: Req, res: Response, next: NextFunction) {
    try {
      const partners = await dealPartnerService.findAll(req.user!.id);
      res.json({ data: partners });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Req, res: Response, next: NextFunction) {
    try {
      const partner = await dealPartnerService.create(req.user!.id, req.body);
      res.status(201).json({ data: partner });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Req, res: Response, next: NextFunction) {
    try {
      const partner = await dealPartnerService.update(req.user!.id, req.params.id, req.body);
      res.json({ data: partner });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Req, res: Response, next: NextFunction) {
    try {
      await dealPartnerService.delete(req.user!.id, req.params.id);
      res.json({ data: { success: true } });
    } catch (err) {
      next(err);
    }
  },
};
