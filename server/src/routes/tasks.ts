import { Router } from 'express';
import { taskController } from '../controllers/taskController.js';
import { validate } from '../middleware/validate.js';
import {
  createTaskSchema,
  updateTaskSchema,
  reorderSchema,
  createChecklistItemSchema,
  updateChecklistItemSchema,
  createCommentSchema,
  updateCommentSchema,
  addDependencySchema,
  addLinkSchema,
  logTimeSchema,
} from '../validators/taskValidator.js';

const router = Router();

router.get('/summary', taskController.getSummary);
// Before '/:id', or Express matches 'by-company' as an id.
router.get('/by-company', taskController.findGroupedByCompany);
router.get('/my-day', taskController.getMyDay);
// Before '/:id' as well: 'time' is not a task id.
router.get('/time/running', taskController.getRunningTimer);
router.get('/', taskController.findAll);
router.get('/:id', taskController.findById);
router.post('/', validate(createTaskSchema), taskController.create);
router.patch('/reorder', validate(reorderSchema), taskController.reorder);
router.patch('/:id', validate(updateTaskSchema), taskController.update);
router.delete('/:id', taskController.delete);
router.post('/:id/share', taskController.shareTask);
router.delete('/:id/shares/:recipientId', taskController.unshareTask);
router.get('/:id/shares', taskController.getTaskShares);
router.patch('/:id/assign', taskController.assignTask);
router.post('/:id/checklist', validate(createChecklistItemSchema), taskController.addChecklistItem);
router.patch('/:id/checklist/:itemId', validate(updateChecklistItemSchema), taskController.updateChecklistItem);
router.delete('/:id/checklist/:itemId', taskController.deleteChecklistItem);
router.get('/:id/activity', taskController.getActivity);
router.post('/:id/comments', validate(createCommentSchema), taskController.addComment);
router.patch('/:id/comments/:commentId', validate(updateCommentSchema), taskController.updateComment);
router.delete('/:id/comments/:commentId', taskController.deleteComment);
router.post('/:id/dependencies', validate(addDependencySchema), taskController.addDependency);
router.delete('/:id/dependencies/:blockerId', taskController.removeDependency);
router.post('/:id/links', validate(addLinkSchema), taskController.addLink);
router.delete('/:id/links/:entityType/:entityId', taskController.removeLink);
router.post('/:id/time/start', taskController.startTimer);
router.post('/:id/time/stop', taskController.stopTimer);
router.post('/:id/time', validate(logTimeSchema), taskController.logTime);
router.delete('/:id/time/:entryId', taskController.deleteTimeEntry);

export { router as taskRoutes };
