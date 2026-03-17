import { Request, Response, NextFunction } from 'express';
import { contactService } from '../services/contactService.js';

export const contactController = {
  async findAll(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await contactService.findAll(req.query as Record<string, string>);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async findById(req: Request, res: Response, next: NextFunction) {
    try {
      const contact = await contactService.findById(req.params.id);
      res.json({ data: contact });
    } catch (err) {
      next(err);
    }
  },

  async findAttachments(req: Request, res: Response, next: NextFunction) {
    try {
      const attachments = await contactService.findAttachments(req.params.id);
      res.json({ data: attachments });
    } catch (err) {
      next(err);
    }
  },

  async findContactEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const events = await contactService.findContactEvents(req.params.id);
      res.json({ data: events });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const contact = await contactService.create(req.body);
      res.status(201).json({ data: contact });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const contact = await contactService.update(req.params.id, req.body);
      res.json({ data: contact });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await contactService.delete(req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
};
