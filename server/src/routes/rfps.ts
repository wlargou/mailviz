import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { rfpController } from '../controllers/rfpController.js';
import { validate } from '../middleware/validate.js';
import { createRfpSchema, updateRfpSchema } from '../validators/rfpValidator.js';
import { rfpUpload, MAX_DOCUMENT_BYTES } from '../services/rfpStorage.js';
import { AppError } from '../middleware/errorHandler.js';

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
router.get('/:id', rfpController.findById);
router.post('/', validate(createRfpSchema), rfpController.create);
router.patch('/:id', validate(updateRfpSchema), rfpController.update);
router.delete('/:id', rfpController.remove);

router.post('/:id/documents', uploadLimiter, upload, rfpController.addDocument);
router.get('/:id/documents/:documentId', rfpController.downloadDocument);
router.delete('/:id/documents/:documentId', rfpController.removeDocument);

export { router as rfpRoutes };
