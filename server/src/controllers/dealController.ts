import { Response, NextFunction } from 'express';
import type { Req } from "../types/http.js";
import { dealService } from '../services/dealService.js';

export const dealController = {
  async findAll(req: Req, res: Response, next: NextFunction) {
    try {
      const result = await dealService.findAll(req.user!.id, req.query as Record<string, string>);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async findById(req: Req, res: Response, next: NextFunction) {
    try {
      const deal = await dealService.findById(req.user!.id, req.params.id);
      res.json({ data: deal });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Req, res: Response, next: NextFunction) {
    try {
      const deal = await dealService.create(req.user!.id, req.body);
      res.status(201).json({ data: deal });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Req, res: Response, next: NextFunction) {
    try {
      const deal = await dealService.update(req.user!.id, req.params.id, req.body);
      res.json({ data: deal });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Req, res: Response, next: NextFunction) {
    try {
      await dealService.delete(req.user!.id, req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  async shareDeal(req: Req, res: Response, next: NextFunction) {
    try {
      const { userIds } = req.body;
      if (!Array.isArray(userIds) || userIds.length === 0) {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'userIds array required' } });
        return;
      }
      const result = await dealService.shareDeal(req.user!.id, req.params.id, userIds);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async unshareDeal(req: Req, res: Response, next: NextFunction) {
    try {
      const result = await dealService.unshareDeal(req.user!.id, req.params.id, req.params.recipientId);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async getDealShares(req: Req, res: Response, next: NextFunction) {
    try {
      const shares = await dealService.getDealShares(req.user!.id, req.params.id);
      res.json({ data: shares });
    } catch (err) {
      next(err);
    }
  },
};
