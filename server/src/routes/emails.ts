import { Router } from 'express';
import { emailController } from '../controllers/emailController.js';
import { validate } from '../middleware/validate.js';
import { convertToTaskSchema } from '../validators/emailValidator.js';

const router = Router();

router.get('/', emailController.findAllThreads);
router.get('/unread-count', emailController.getUnreadCount);
router.get('/sync-status', emailController.getSyncStatus);
router.get('/threads/:threadId', emailController.findThread);
router.get('/:id', emailController.findById);
router.get('/:id/attachments/:aid', emailController.getAttachment);
router.post('/sync', emailController.sync);
router.patch('/:id/read', emailController.markAsRead);
router.patch('/:id/unread', emailController.markAsUnread);
router.patch('/:id/star', emailController.toggleStar);
router.patch('/:id/archive', emailController.archive);
router.patch('/:id/unarchive', emailController.unarchive);
router.patch('/:id/trash', emailController.trash);
router.patch('/:id/untrash', emailController.untrash);
router.post('/:id/convert-to-task', validate(convertToTaskSchema), emailController.convertToTask);

export { router as emailRoutes };
