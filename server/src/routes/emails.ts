import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { emailController } from '../controllers/emailController.js';
import { validate } from '../middleware/validate.js';
import { convertToTaskSchema } from '../validators/emailValidator.js';
import { sendEmailSchema, replyEmailSchema, forwardEmailSchema } from '../validators/composeValidator.js';

const router = Router();

// Rate limit email sending — 10 per minute
const sendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many emails sent. Try again later.' } },
});

// Rate limit bulk operations — 20 per minute
const bulkLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many bulk operations. Try again later.' } },
});

// Rate limit sync trigger — 5 per minute
const syncLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many sync requests. Try again later.' } },
});

router.get('/', emailController.findAllThreads);
router.get('/unread-count', emailController.getUnreadCount);
router.get('/sync-status', emailController.getSyncStatus);
router.post('/send', sendLimiter, validate(sendEmailSchema), emailController.sendEmail);
router.get('/threads/:threadId', emailController.findThread);
router.get('/:id', emailController.findById);
router.get('/:id/attachments/:aid', emailController.getAttachment);
router.post('/sync', syncLimiter, emailController.sync);
router.post('/batch/read', bulkLimiter, emailController.batchMarkAsRead);
router.post('/batch/unread', bulkLimiter, emailController.batchMarkAsUnread);
router.post('/batch/archive', bulkLimiter, emailController.batchArchive);
router.post('/batch/trash', bulkLimiter, emailController.batchTrash);
router.patch('/:id/read', emailController.markAsRead);
router.patch('/:id/unread', emailController.markAsUnread);
router.patch('/:id/star', emailController.toggleStar);
router.patch('/:id/archive', emailController.archive);
router.patch('/:id/unarchive', emailController.unarchive);
router.patch('/:id/trash', emailController.trash);
router.patch('/:id/untrash', emailController.untrash);
router.post('/:id/reply', validate(replyEmailSchema), emailController.replyToEmail);
router.post('/:id/forward', validate(forwardEmailSchema), emailController.forwardEmail);
router.post('/:id/convert-to-task', validate(convertToTaskSchema), emailController.convertToTask);

export { router as emailRoutes };
