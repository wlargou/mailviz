import { Router } from 'express';
import { notificationController } from '../controllers/notificationController.js';

const router = Router();

router.get('/', notificationController.list);
router.get('/count', notificationController.getUnreadCount);
router.patch('/:id/read', notificationController.markRead);
router.post('/read-all', notificationController.markAllRead);
router.delete('/:id', notificationController.dismiss);
router.post('/dismiss-all', notificationController.dismissAll);

export { router as notificationRoutes };
