import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { clientReferenceController as controller } from '../controllers/clientReferenceController.js';
import { validate } from '../middleware/validate.js';
import { createClientReferenceSchema, updateClientReferenceSchema } from '../validators/clientReferenceValidator.js';
import { referenceUpload, MAX_DOCUMENT_BYTES } from '../services/rfpStorage.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many uploads, please wait a moment' } },
});

/** Multer's own failures as 400s the user can act on, as for tender documents. */
function upload(req: Request, res: Response, next: NextFunction) {
  referenceUpload(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE' ? `File too large — the limit is ${Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB` : err.message;
      next(new AppError(400, err.code, message));
      return;
    }
    next(err);
  });
}

router.get('/', controller.findAll);
// Before `/:id`, or these would be read as reference ids.
router.get('/ids', controller.ids);
router.get('/facets', controller.facets);
router.get('/:id', controller.findById);
router.post('/', validate(createClientReferenceSchema), controller.create);
router.patch('/:id', validate(updateClientReferenceSchema), controller.update);
router.delete('/:id', controller.remove);

// One document per reference: a new upload replaces it.
router.put('/:id/document', uploadLimiter, upload, controller.replaceDocument);
router.get('/:id/document', controller.downloadDocument);

export { router as clientReferenceRoutes };
