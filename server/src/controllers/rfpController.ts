import fs from 'node:fs';
import { Response, NextFunction } from 'express';
import type { Req } from '../types/http.js';
import { rfpService } from '../services/rfpService.js';
import { resolveStoragePath } from '../services/rfpStorage.js';
import { AppError } from '../middleware/errorHandler.js';
import { rfpDocumentKindSchema } from '../validators/rfpValidator.js';

export const rfpController = {
  async findAll(req: Req, res: Response, next: NextFunction) {
    try {
      res.json(await rfpService.findAll(req.user!.id, req.query as Record<string, string>));
    } catch (err) {
      next(err);
    }
  },

  async findById(req: Req, res: Response, next: NextFunction) {
    try {
      res.json({ data: await rfpService.findById(req.user!.id, req.params.id) });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Req, res: Response, next: NextFunction) {
    try {
      res.status(201).json({ data: await rfpService.create(req.user!.id, req.body) });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Req, res: Response, next: NextFunction) {
    try {
      res.json({ data: await rfpService.update(req.user!.id, req.params.id, req.body) });
    } catch (err) {
      next(err);
    }
  },

  async remove(req: Req, res: Response, next: NextFunction) {
    try {
      await rfpService.remove(req.user!.id, req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  /**
   * Record a file multer has already written to the volume.
   *
   * `kind` rides in the multipart body, so it is parsed here rather than by
   * the `validate` middleware — which runs before multer and would see an
   * empty body.
   */
  async addDocument(req: Req, res: Response, next: NextFunction) {
    try {
      const file = (req as Req & { file?: Express.Multer.File }).file;
      if (!file) throw new AppError(400, 'NO_FILE', 'No file uploaded');
      const kind = rfpDocumentKindSchema.catch('RFP').parse((req.body as { kind?: string })?.kind);
      const doc = await rfpService.addDocument(
        req.user!.id,
        req.params.id,
        { filename: file.originalname, mimeType: file.mimetype, size: file.size, storageKey: `${req.user!.id}/${file.filename}` },
        kind
      );
      res.status(201).json({ data: doc });
    } catch (err) {
      next(err);
    }
  },

  async downloadDocument(req: Req, res: Response, next: NextFunction) {
    try {
      const doc = await rfpService.getDocument(req.user!.id, req.params.id, req.params.documentId);
      const full = resolveStoragePath(doc.storageKey);
      if (!fs.existsSync(full)) {
        // The row outlived its bytes — a volume that was not mounted, or a
        // restore that missed the disk. Say so rather than streaming nothing.
        throw new AppError(410, 'RFP_DOCUMENT_GONE', 'The stored file is missing');
      }
      const disposition = req.query.inline === 'true' ? 'inline' : 'attachment';
      // Same sanitising as the email attachments: a quote or a newline in the
      // filename would otherwise split the header.
      const safeFilename = doc.filename.replace(/["\r\n\\]/g, '_');
      res.setHeader('Content-Type', doc.mimeType);
      res.setHeader('Content-Disposition', `${disposition}; filename="${safeFilename}"`);
      fs.createReadStream(full).pipe(res);
    } catch (err) {
      next(err);
    }
  },

  async share(req: Req, res: Response, next: NextFunction) {
    try {
      const { userIds } = req.body as { userIds: string[] };
      res.json({ data: await rfpService.share(req.user!.id, req.params.id, userIds) });
    } catch (err) {
      next(err);
    }
  },

  async unshare(req: Req, res: Response, next: NextFunction) {
    try {
      res.json({ data: await rfpService.unshare(req.user!.id, req.params.id, req.params.recipientId) });
    } catch (err) {
      next(err);
    }
  },

  async getShares(req: Req, res: Response, next: NextFunction) {
    try {
      res.json({ data: await rfpService.getShares(req.user!.id, req.params.id) });
    } catch (err) {
      next(err);
    }
  },

  async removeDocument(req: Req, res: Response, next: NextFunction) {
    try {
      await rfpService.removeDocument(req.user!.id, req.params.id, req.params.documentId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
};
