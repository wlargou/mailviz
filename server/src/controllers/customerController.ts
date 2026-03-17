import { Request, Response, NextFunction } from 'express';
import { customerService } from '../services/customerService.js';

export const customerController = {
  async findAll(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await customerService.findAll(req.query as Record<string, string>);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async findById(req: Request, res: Response, next: NextFunction) {
    try {
      const customer = await customerService.findById(req.params.id);
      res.json({ data: customer });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const customer = await customerService.create(req.body);
      res.status(201).json({ data: customer });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const customer = await customerService.update(req.params.id, req.body);
      res.json({ data: customer });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await customerService.delete(req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  async findAttachments(req: Request, res: Response, next: NextFunction) {
    try {
      const attachments = await customerService.findAttachments(req.params.id);
      res.json({ data: attachments });
    } catch (err) {
      next(err);
    }
  },

  async findLinkedEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const events = await customerService.findLinkedEvents(req.params.id);
      res.json({ data: events });
    } catch (err) {
      next(err);
    }
  },
};
