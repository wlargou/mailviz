import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { customerService } from '../services/customerService.js';

export const customerController = {
  async findAll(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await customerService.findAll(req.user!.id, req.query as Record<string, string>);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async findById(req: Request, res: Response, next: NextFunction) {
    try {
      const customer = await customerService.findById(req.user!.id, req.params.id);
      res.json({ data: customer });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const customer = await customerService.create(req.user!.id, req.body);
      res.status(201).json({ data: customer });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const customer = await customerService.update(req.user!.id, req.params.id, req.body);
      res.json({ data: customer });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await customerService.delete(req.user!.id, req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  async findAttachments(req: Request, res: Response, next: NextFunction) {
    try {
      const attachments = await customerService.findAttachments(req.user!.id, req.params.id);
      res.json({ data: attachments });
    } catch (err) {
      next(err);
    }
  },

  async findLinkedEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const events = await customerService.findLinkedEvents(req.user!.id, req.params.id);
      res.json({ data: events });
    } catch (err) {
      next(err);
    }
  },

  async toggleVip(req: Request, res: Response, next: NextFunction) {
    try {
      const customer = await prisma.customer.findFirst({ where: { id: req.params.id, userId: req.user!.id } });
      if (!customer) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Customer not found' } });
        return;
      }
      const updated = await prisma.customer.update({
        where: { id: req.params.id },
        data: { isVip: !customer.isVip },
        include: { category: true, _count: { select: { contacts: true, tasks: true, emails: true } } },
      });
      res.json({ data: updated });
    } catch (err) {
      next(err);
    }
  },
};
