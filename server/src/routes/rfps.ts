import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { rfpController } from '../controllers/rfpController.js';
import { validate } from '../middleware/validate.js';
import {
  createRfpSchema,
  updateRfpSchema,
  shareRfpSchema,
  createLotSchema,
  updateLotSchema,
  createFolderSchema,
  updateFolderSchema,
  createItemSchema,
  updateItemSchema,
  setVerifiersSchema,
  verificationSchema,
} from '../validators/rfpValidator.js';
import { rfpCompositionController as composition } from '../controllers/rfpCompositionController.js';
import { rfpUpload, MAX_DOCUMENT_BYTES } from '../services/rfpStorage.js';
import { AppError } from '../middleware/errorHandler.js';
import { z } from 'zod';
import type { Req } from '../types/http.js';
import { rfpThreadService } from '../services/rfpThreadService.js';

const router = Router();

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many uploads, please wait a moment' } },
});

/**
 * Multer reports its own failures through `next(err)` with a `MulterError`,
 * which `errorHandler` would otherwise render as a 500. The one that matters
 * is LIMIT_FILE_SIZE: a 30 MB dossier is a 400 the user can act on, not a
 * server fault.
 */
function upload(req: Request, res: Response, next: NextFunction) {
  rfpUpload(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? `File too large — the limit is ${Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB`
          : err.message;
      next(new AppError(400, err.code, message));
      return;
    }
    next(err);
  });
}

router.get('/', rfpController.findAll);
// Before `/:id`, or "catalogue" would be read as a tender id.
router.get('/catalogue', composition.catalogue);
router.get('/:id', rfpController.findById);
router.post('/', validate(createRfpSchema), rfpController.create);
router.patch('/:id', validate(updateRfpSchema), rfpController.update);
router.delete('/:id', rfpController.remove);

router.post('/:id/share', validate(shareRfpSchema), rfpController.share);
router.delete('/:id/shares/:recipientId', rfpController.unshare);
router.get('/:id/shares', rfpController.getShares);

// Lots — every tender has at least one; the budget is their total.
router.get('/:id/people', composition.people);
// Mail filed under the tender — see rfpThreadService.
const threadLinkSchema = z.object({ threadId: z.string().trim().min(1).max(255) });
router.get('/:id/threads', async (req, res, next) => {
  try {
    res.json({ data: await rfpThreadService.threads((req as Req).user!.id, String(req.params.id)) });
  } catch (err) {
    next(err);
  }
});
router.post('/:id/threads', validate(threadLinkSchema), async (req, res, next) => {
  try {
    res.status(201).json({ data: await rfpThreadService.link((req as Req).user!.id, String(req.params.id), req.body.threadId) });
  } catch (err) {
    next(err);
  }
});
router.delete('/:id/threads/:threadId', async (req, res, next) => {
  try {
    res.json({ data: await rfpThreadService.unlink((req as Req).user!.id, String(req.params.id), String(req.params.threadId)) });
  } catch (err) {
    next(err);
  }
});
router.post('/:id/lots', validate(createLotSchema), composition.createLot);
router.patch('/:id/lots/:lotId', validate(updateLotSchema), composition.updateLot);
router.delete('/:id/lots/:lotId', composition.deleteLot);

// The response's dossiers, and the pieces each needs.
router.post('/:id/folders', validate(createFolderSchema), composition.createFolder);
router.patch('/:id/folders/:folderId', validate(updateFolderSchema), composition.updateFolder);
router.delete('/:id/folders/:folderId', composition.deleteFolder);
router.post('/:id/folders/:folderId/items', validate(createItemSchema), composition.createItem);
router.patch('/:id/items/:itemId', validate(updateItemSchema), composition.updateItem);
router.delete('/:id/items/:itemId', composition.deleteItem);
router.put('/:id/verifiers', validate(setVerifiersSchema), composition.setVerifiers);
router.put('/:id/items/:itemId/verification', validate(verificationSchema), composition.decide);
router.delete('/:id/items/:itemId/verification', composition.withdraw);
// A prepared piece's file. Downloaded and deleted through /documents like
// the tender's own, since it is the same kind of row on the same volume.
router.post('/:id/items/:itemId/documents', uploadLimiter, upload, composition.addItemDocument);

router.post('/:id/documents', uploadLimiter, upload, rfpController.addDocument);
router.get('/:id/documents/:documentId', rfpController.downloadDocument);
router.delete('/:id/documents/:documentId', rfpController.removeDocument);

export { router as rfpRoutes };
