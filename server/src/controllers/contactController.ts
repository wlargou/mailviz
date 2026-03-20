import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { contactService } from '../services/contactService.js';

export const contactController = {
  async findAll(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await contactService.findAll(req.user!.id, req.query as Record<string, string>);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async findById(req: Request, res: Response, next: NextFunction) {
    try {
      const contact = await contactService.findById(req.user!.id, req.params.id);
      res.json({ data: contact });
    } catch (err) {
      next(err);
    }
  },

  async findAttachments(req: Request, res: Response, next: NextFunction) {
    try {
      const attachments = await contactService.findAttachments(req.user!.id, req.params.id);
      res.json({ data: attachments });
    } catch (err) {
      next(err);
    }
  },

  async findContactEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const events = await contactService.findContactEvents(req.user!.id, req.params.id);
      res.json({ data: events });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const contact = await contactService.create(req.user!.id, req.body);
      res.status(201).json({ data: contact });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const contact = await contactService.update(req.user!.id, req.params.id, req.body);
      res.json({ data: contact });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await contactService.delete(req.user!.id, req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  async toggleVip(req: Request, res: Response, next: NextFunction) {
    try {
      const contact = await prisma.contact.findFirst({ where: { id: req.params.id, customer: { userId: req.user!.id } } });
      if (!contact) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Contact not found' } });
        return;
      }
      const updated = await prisma.contact.update({
        where: { id: req.params.id },
        data: { isVip: !contact.isVip },
        include: { customer: { select: { id: true, name: true, domain: true, logoUrl: true } } },
      });
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
};
