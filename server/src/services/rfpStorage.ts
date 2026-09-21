import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Where tender documents live.
 *
 * The app stored no file bytes at all before this: Gmail attachments are
 * streamed from Gmail on demand and never kept. Tender documents are
 * different — they are downloaded from a buyer's portal, the portal closes
 * after the deadline, and nothing else holds a copy. So they go on disk.
 *
 * On Railway that path must be a MOUNTED VOLUME. A container's own filesystem
 * is recreated on every deploy, so an unmounted path would lose every document
 * at the next push — silently, because uploads would keep working.
 *
 * Read from `process.env` on each call rather than captured at import: the
 * tests point it at a temporary directory, and a module-load capture would
 * have been fixed before they could.
 */
export function storageRoot(): string {
  return process.env.RFP_STORAGE_DIR || path.resolve(process.cwd(), 'uploads/rfp');
}

/**
 * What may be uploaded, and the extension each type is stored under.
 *
 * A whitelist because the extension is taken from THIS table and never from
 * the uploaded filename — which is user input, may contain `../`, and is kept
 * only as a label to show and to download as.
 */
const ALLOWED_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

/** The biggest of the sample dossiers is 7.3 MB; 25 MB leaves room. */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export function isAllowedType(mimeType: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED_TYPES, mimeType);
}

/**
 * The key a file is stored under: `<userId>/<random>.<ext>`.
 *
 * Per user so one account's documents can be found and removed as a unit, and
 * random so an uploaded name can never decide where bytes land.
 */
function makeStorageKey(userId: string, mimeType: string): string {
  return path.posix.join(userId, `${crypto.randomUUID()}${ALLOWED_TYPES[mimeType]}`);
}

/**
 * Resolve a stored key to an absolute path, refusing anything that escapes the
 * root. We generate every key, so this cannot trigger today — it is here so
 * that a future key built from anything user-supplied fails closed.
 */
export function resolveStoragePath(storageKey: string): string {
  const root = path.resolve(storageRoot());
  const full = path.resolve(root, storageKey);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new AppError(400, 'INVALID_STORAGE_KEY', 'Invalid storage key');
  }
  return full;
}

/** Best effort: a missing file must not stop a row from being deleted. */
export async function removeStoredFile(storageKey: string): Promise<void> {
  try {
    await fs.promises.unlink(resolveStoragePath(storageKey));
  } catch {
    /* already gone, or never written */
  }
}

/**
 * The upload middleware. Streams straight to the volume rather than buffering:
 * a 25 MB file held in memory per concurrent upload is a needless way to run
 * the container out of heap.
 */
export const rfpUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const userId = (req as { user?: { id: string } }).user?.id;
      if (!userId) return cb(new AppError(401, 'UNAUTHORIZED', 'Unauthorized'), '');
      const dir = path.join(path.resolve(storageRoot()), userId);
      fs.promises
        .mkdir(dir, { recursive: true })
        .then(() => cb(null, dir))
        .catch((err) => cb(err as Error, ''));
    },
    filename: (req, file, cb) => {
      const userId = (req as { user?: { id: string } }).user?.id;
      if (!userId) return cb(new AppError(401, 'UNAUTHORIZED', 'Unauthorized'), '');
      cb(null, path.basename(makeStorageKey(userId, file.mimetype)));
    },
  }),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!isAllowedType(file.mimetype)) {
      cb(new AppError(400, 'UNSUPPORTED_FILE_TYPE', `Unsupported file type: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
}).single('file');

/** The key for a file multer has already written, relative to the root. */
export function storageKeyFor(userId: string, storedFilename: string): string {
  return path.posix.join(userId, storedFilename);
}
