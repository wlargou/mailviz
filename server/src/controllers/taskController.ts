import { Response, NextFunction } from 'express';
import type { Req } from "../types/http.js";
import { taskService, TASK_GROUP_SORTS, type TaskGroupSort } from '../services/taskService.js';
import { taskActivityService } from '../services/taskActivityService.js';

export const taskController = {
  async findAll(req: Req, res: Response, next: NextFunction) {
    try {
      const result = await taskService.findAll(req.user!.id, req.query as Record<string, string>);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async findById(req: Req, res: Response, next: NextFunction) {
    try {
      const task = await taskService.findById(req.user!.id, req.params.id);
      res.json({ data: task });
    } catch (err) {
      next(err);
    }
  },

  async findGroupedByCompany(req: Req, res: Response, next: NextFunction) {
    try {
      const { search, status, priority, labelId, includeCompleted, sort } = req.query as Record<string, string>;
      res.json(
        await taskService.findGroupedByCompany(req.user!.id, {
          search,
          status,
          priority,
          labelId,
          // Whitelisted rather than cast: `sort` indexes a comparator table, and
          // an unknown value would select `undefined` and throw inside .sort().
          // Anything unrecognised falls back to the default.
          sort: TASK_GROUP_SORTS.includes(sort as TaskGroupSort) ? (sort as TaskGroupSort) : undefined,
          // Query strings carry no booleans; anything other than the literal
          // 'true' means the default (hide completed).
          includeCompleted: includeCompleted === 'true',
        })
      );
    } catch (err) {
      next(err);
    }
  },

  async getMyDay(req: Req, res: Response, next: NextFunction) {
    try {
      res.json(await taskService.findMyDay(req.user!.id));
    } catch (err) {
      next(err);
    }
  },

  async getSummary(req: Req, res: Response, next: NextFunction) {
    try {
      const summary = await taskService.getSummary(req.user!.id);
      res.json({ data: summary });
    } catch (err) {
      next(err);
    }
  },

  async create(req: Req, res: Response, next: NextFunction) {
    try {
      const task = await taskService.create(req.user!.id, req.body);
      res.status(201).json({ data: task });
    } catch (err) {
      next(err);
    }
  },

  async update(req: Req, res: Response, next: NextFunction) {
    try {
      const task = await taskService.update(req.user!.id, req.params.id, req.body);
      res.json({ data: task });
    } catch (err) {
      next(err);
    }
  },

  async reorder(req: Req, res: Response, next: NextFunction) {
    try {
      const result = await taskService.reorder(req.user!.id, req.body);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async delete(req: Req, res: Response, next: NextFunction) {
    try {
      await taskService.delete(req.user!.id, req.params.id);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  async shareTask(req: Req, res: Response, next: NextFunction) {
    try {
      const { userIds } = req.body;
      if (!Array.isArray(userIds) || userIds.length === 0) {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'userIds array required' } });
        return;
      }
      const result = await taskService.shareTask(req.user!.id, req.params.id, userIds);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async unshareTask(req: Req, res: Response, next: NextFunction) {
    try {
      const result = await taskService.unshareTask(req.user!.id, req.params.id, req.params.recipientId);
      res.json({ data: result });
    } catch (err) {
      next(err);
    }
  },

  async getTaskShares(req: Req, res: Response, next: NextFunction) {
    try {
      const shares = await taskService.getTaskShares(req.user!.id, req.params.id);
      res.json({ data: shares });
    } catch (err) {
      next(err);
    }
  },

  async addChecklistItem(req: Req, res: Response, next: NextFunction) {
    try {
      const item = await taskService.addChecklistItem(req.user!.id, req.params.id, req.body);
      res.status(201).json({ data: item });
    } catch (err) {
      next(err);
    }
  },

  async updateChecklistItem(req: Req, res: Response, next: NextFunction) {
    try {
      const item = await taskService.updateChecklistItem(req.user!.id, req.params.id, req.params.itemId, req.body);
      res.json({ data: item });
    } catch (err) {
      next(err);
    }
  },

  async deleteChecklistItem(req: Req, res: Response, next: NextFunction) {
    try {
      await taskService.deleteChecklistItem(req.user!.id, req.params.id, req.params.itemId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  async getActivity(req: Req, res: Response, next: NextFunction) {
    try {
      const result = await taskActivityService.listActivity(req.user!.id, req.params.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },

  async addComment(req: Req, res: Response, next: NextFunction) {
    try {
      const comment = await taskActivityService.addComment(req.user!.id, req.params.id, req.body);
      res.status(201).json({ data: comment });
    } catch (err) {
      next(err);
    }
  },

  async updateComment(req: Req, res: Response, next: NextFunction) {
    try {
      const comment = await taskActivityService.updateComment(req.user!.id, req.params.id, req.params.commentId, req.body);
      res.json({ data: comment });
    } catch (err) {
      next(err);
    }
  },

  async deleteComment(req: Req, res: Response, next: NextFunction) {
    try {
      await taskActivityService.deleteComment(req.user!.id, req.params.id, req.params.commentId);
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  async addDependency(req: Req, res: Response, next: NextFunction) {
    try {
      const task = await taskService.addDependency(req.user!.id, req.params.id, req.body.blockerId);
      res.status(201).json({ data: task });
    } catch (err) {
      next(err);
    }
  },

  async removeDependency(req: Req, res: Response, next: NextFunction) {
    try {
      const task = await taskService.removeDependency(req.user!.id, req.params.id, req.params.blockerId);
      res.json({ data: task });
    } catch (err) {
      next(err);
    }
  },

  async assignTask(req: Req, res: Response, next: NextFunction) {
    try {
      const { assignedToId } = req.body;
      const task = await taskService.assignTask(req.user!.id, req.params.id, assignedToId ?? null);
      res.json({ data: task });
    } catch (err) {
      next(err);
    }
  },
};
