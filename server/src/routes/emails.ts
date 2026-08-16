import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { emailController } from '../controllers/emailController.js';
import { draftController } from '../controllers/draftController.js';
import { validate } from '../middleware/validate.js';
import { convertToTaskSchema } from '../validators/emailValidator.js';
import { sendEmailSchema, replyEmailSchema, forwardEmailSchema, scheduleEmailSchema, updateScheduledEmailSchema } from '../validators/composeValidator.js';
import { saveDraftSchema, sendDraftSchema } from '../validators/draftValidator.js';

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

// Saving a draft is one Gmail write, so it is budgeted like a write and not
// like a read — generously enough for deliberate saves, nowhere near enough for
// a per-keystroke autosave, which is the point.
const draftLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many draft saves. Try again later.' } },
});

router.get('/', emailController.findAllThreads);
router.get('/review-summary', emailController.getReviewSummary);
router.get('/unread-count', emailController.getUnreadCount);
router.get('/sync-status', emailController.getSyncStatus);
router.post('/send', sendLimiter, validate(sendEmailSchema), emailController.sendEmail);
router.post('/schedule', sendLimiter, validate(scheduleEmailSchema), emailController.scheduleEmail);
router.get('/scheduled', emailController.getScheduledEmails);
router.patch('/scheduled/:id', validate(updateScheduledEmailSchema), emailController.updateScheduledEmail);
router.delete('/scheduled/:id', emailController.cancelScheduledEmail);
// Drafts. Registered before `/:id` so `/drafts` is not swallowed by it.
router.get('/drafts', draftController.list);
router.post('/drafts', draftLimiter, validate(saveDraftSchema), draftController.create);
router.post('/drafts/sync', syncLimiter, draftController.sync);
router.get('/drafts/:id', draftController.open);
router.put('/drafts/:id', draftLimiter, validate(saveDraftSchema), draftController.update);
router.delete('/drafts/:id', draftController.remove);
router.post('/drafts/:id/send', sendLimiter, validate(sendDraftSchema), draftController.send);

router.get('/threads/:threadId', emailController.findThread);
router.post('/threads/:threadId/share', emailController.shareThread);
router.delete('/threads/:threadId/shares/:recipientId', emailController.unshareThread);
router.get('/threads/:threadId/shares', emailController.getThreadShares);
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
