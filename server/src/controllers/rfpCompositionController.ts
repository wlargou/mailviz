import { Response, NextFunction } from 'express';
import type { Req } from '../types/http.js';
import { rfpCompositionService } from '../services/rfpCompositionService.js';
import { rfpVerificationService } from '../services/rfpVerificationService.js';
import { AppError } from '../middleware/errorHandler.js';

/** Wraps a handler so each one below is its call and nothing else. */
const handle =
  (fn: (req: Req) => Promise<unknown>, status = 200) =>
  async (req: Req, res: Response, next: NextFunction) => {
    try {
      const data = await fn(req);
      if (status === 204) res.status(204).send();
      else res.status(status).json({ data });
    } catch (err) {
      next(err);
    }
  };

export const rfpCompositionController = {
  catalogue: handle(async () => rfpCompositionService.catalogue()),

  createLot: handle((req) => rfpCompositionService.createLot(req.user!.id, req.params.id, req.body), 201),
  updateLot: handle((req) => rfpCompositionService.updateLot(req.user!.id, req.params.id, req.params.lotId, req.body)),
  deleteLot: handle((req) => rfpCompositionService.deleteLot(req.user!.id, req.params.id, req.params.lotId), 204),

  createFolder: handle((req) => rfpCompositionService.createFolder(req.user!.id, req.params.id, req.body), 201),
  updateFolder: handle((req) => rfpCompositionService.updateFolder(req.user!.id, req.params.id, req.params.folderId, req.body)),
  deleteFolder: handle((req) => rfpCompositionService.deleteFolder(req.user!.id, req.params.id, req.params.folderId), 204),

  createItem: handle((req) => rfpCompositionService.createItem(req.user!.id, req.params.id, req.params.folderId, req.body), 201),
  updateItem: handle((req) => rfpCompositionService.updateItem(req.user!.id, req.params.id, req.params.itemId, req.body)),
  deleteItem: handle((req) => rfpCompositionService.deleteItem(req.user!.id, req.params.id, req.params.itemId), 204),

  setVerifiers: handle((req) => rfpVerificationService.setVerifiers(req.user!.id, req.params.id, req.body.userIds)),
  decide: handle((req) => rfpVerificationService.decide(req.user!.id, req.params.id, req.params.itemId, req.body)),
  withdraw: handle((req) => rfpVerificationService.withdraw(req.user!.id, req.params.id, req.params.itemId), 204),

  /** A file multer has already written to the volume, recorded against a piece. */
  addItemDocument: handle(async (req) => {
    const file = (req as Req & { file?: Express.Multer.File }).file;
    if (!file) throw new AppError(400, 'NO_FILE', 'No file uploaded');
    return rfpCompositionService.addItemDocument(req.user!.id, req.params.id, req.params.itemId, {
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      storageKey: `${req.user!.id}/${file.filename}`,
    });
  }, 201),
};
