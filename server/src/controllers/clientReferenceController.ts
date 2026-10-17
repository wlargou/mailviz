import fs from 'node:fs';
import { pipeline } from 'node:stream';
import { Response, NextFunction } from 'express';
import type { Req } from '../types/http.js';
import { clientReferenceService } from '../services/clientReferenceService.js';
import { resolveStoragePath } from '../services/rfpStorage.js';
import { AppError } from '../middleware/errorHandler.js';
import { contentDisposition } from '../utils/contentDisposition.js';

export const clientReferenceController = {
  async findAll(req: Req, res: Response, next: NextFunction) {
    try {
      res.json(await clientReferenceService.findAll(req.user!.id, req.query as Record<string, string>));
    } catch (err) {
      next(err);
    }
  },

  async ids(req: Req, res: Response, next: NextFunction) {
    try {
      res.json({ data: await clientReferenceService.ids(req.user!.id, req.query as Record<string, string>) });
    } catch (err) {
      next(err);
    }
  },

  async facets(req: Req, res: Response, next: NextFunction) {
    try {
      res.json({ data: await clientReferenceService.facets(req.user!.id) });
    } catch (err) {
      next(err);
    }
  },

  async findById(req: Req, res: Response, next: NextFunction) {
    try {
      res.json({ data: await clientReferenceService.findById(req.user!.id, req.params.id) });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Req, res: Response, next: NextFunction) {
    try {
      res.status(201).json({ data: await clientReferenceService.create(req.user!.id, req.body) });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Req, res: Response, next: NextFunction) {
    try {
      res.json({ data: await clientReferenceService.update(req.user!.id, req.params.id, req.body) });
    } catch (err) {
      next(err);
    }
  },

  async remove(req: Req, res: Response, next: NextFunction) {
    try {
      await clientReferenceService.remove(req.user!.id, req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  /** A file multer has already written to the volume becomes the reference's document. */
  async replaceDocument(req: Req, res: Response, next: NextFunction) {
    const file = (req as Req & { file?: Express.Multer.File }).file;
    try {
      if (!file) throw new AppError(400, 'NO_FILE', 'No file uploaded');
      const data = await clientReferenceService.replaceDocument(req.user!.id, req.params.id, {
        filename: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        storageKey: `${req.user!.id}/${file.filename}`,
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  },

  async downloadDocument(req: Req, res: Response, next: NextFunction) {
    try {
      const doc = await clientReferenceService.getDocument(req.user!.id, req.params.id);
      const full = resolveStoragePath(doc.storageKey);
      if (!fs.existsSync(full)) {
        // The row outlived its bytes — say so rather than streaming nothing.
        throw new AppError(410, 'REFERENCE_DOCUMENT_GONE', 'The stored file is missing');
      }
      res.setHeader('Content-Type', doc.mimeType);
      res.setHeader('Content-Disposition', contentDisposition(req.query.inline === 'true' ? 'inline' : 'attachment', doc.filename));
      // pipeline, not pipe: a read error after the check above (the file
      // removed in between) must reach the error handler, not crash the
      // process with an unhandled 'error' event.
      pipeline(fs.createReadStream(full), res, (err) => {
        if (!err) return;
        if (!res.headersSent) next(err);
        else res.destroy(err);
      });
    } catch (err) {
      next(err);
    }
  },
};

