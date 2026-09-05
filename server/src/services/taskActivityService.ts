import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { canAccessTask, isTaskOwner } from '../utils/accessControl.js';
import { wsEmitToUsers } from '../websocket.js';
import { auditService } from './auditService.js';
import { notificationService } from './notificationService.js';
import type { CommentInput } from '../validators/taskValidator.js';

/** How much of a task's history one request returns, per source. */
const ACTIVITY_LIMIT = 100;

const AUTHOR_SELECT = { id: true, name: true, email: true, avatarUrl: true } as const;

const COMMENT_INCLUDE = { user: { select: AUTHOR_SELECT } } as const;

/**
 * A task's activity and its comments.
 *
 * The timeline is the audit log read sideways. `auditService.findAll` answers
 * "what did this user do"; a task's history is "what happened to this task",
 * whoever did it — the owner's edits and a share recipient's sit in the same
 * list. Access is the task's access: anyone who can open the task can read
 * everything that happened to it, which is what a timeline is for.
 */
export const taskActivityService = {
  async listActivity(userId: string, taskId: string) {
    if (!(await canAccessTask(taskId, userId))) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }

    const [events, comments, replies] = await Promise.all([
      prisma.auditLog.findMany({
        where: { entityType: 'task', entityId: taskId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: ACTIVITY_LIMIT,
        select: {
          id: true,
          action: true,
          details: true,
          createdAt: true,
          user: { select: AUTHOR_SELECT },
        },
      }),
      prisma.taskComment.findMany({
        where: { taskId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: ACTIVITY_LIMIT,
        include: COMMENT_INCLUDE,
      }),
      repliesOnLinkedThreads(taskId),
    ]);

    // Comment rows already have their own audit entry (TASK_COMMENTED); the
    // timeline shows the comment itself and not the fact that it was posted.
    const HIDDEN = new Set(['TASK_COMMENTED', 'TASK_COMMENT_EDITED', 'TASK_COMMENT_DELETED']);

    const entries = [
      ...events
        .filter((e) => !HIDDEN.has(e.action))
        .map((e) => ({
          kind: 'event' as const,
          id: e.id,
          at: e.createdAt,
          actor: e.user,
          action: e.action,
          details: e.details,
        })),
      ...comments.map((c) => ({
        kind: 'comment' as const,
        id: c.id,
        at: c.createdAt,
        actor: c.user,
        body: c.body,
        mentions: c.mentions,
        editedAt: c.editedAt,
      })),
      ...replies,
    ].sort((a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : -1));

    return { data: entries };
  },

  async addComment(userId: string, taskId: string, input: CommentInput) {
    if (!(await canAccessTask(taskId, userId))) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    const mentions = await validMentions(userId, input.mentions);

    const comment = await prisma.taskComment.create({
      data: { taskId, userId, body: input.body, mentions },
      include: COMMENT_INCLUDE,
    });

    auditService.log({ userId, action: 'TASK_COMMENTED', entityType: 'task', entityId: taskId, details: { commentId: comment.id, mentions } });
    await notifyAboutComment(userId, taskId, comment.id, mentions, input.body);

    return comment;
  },

  /**
   * Only the author may edit. Anyone newly mentioned is told; anyone already
   * mentioned is not told twice.
   */
  async updateComment(userId: string, taskId: string, commentId: string, input: CommentInput) {
    if (!(await canAccessTask(taskId, userId))) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    const existing = await prisma.taskComment.findFirst({ where: { id: commentId, taskId } });
    if (!existing || existing.userId !== userId) {
      throw new AppError(404, 'COMMENT_NOT_FOUND', 'Comment not found');
    }
    const mentions = await validMentions(userId, input.mentions);

    const comment = await prisma.taskComment.update({
      where: { id: commentId },
      data: { body: input.body, mentions, editedAt: new Date() },
      include: COMMENT_INCLUDE,
    });

    auditService.log({ userId, action: 'TASK_COMMENT_EDITED', entityType: 'task', entityId: taskId, details: { commentId } });
    const fresh = mentions.filter((id) => !existing.mentions.includes(id));
    await notifyMentioned(userId, taskId, commentId, fresh, input.body);

    return comment;
  },

  /** The author, or the task's owner — a moderator's power on their own task. */
  async deleteComment(userId: string, taskId: string, commentId: string) {
    if (!(await canAccessTask(taskId, userId))) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    const existing = await prisma.taskComment.findFirst({ where: { id: commentId, taskId } });
    if (!existing) {
      throw new AppError(404, 'COMMENT_NOT_FOUND', 'Comment not found');
    }
    if (existing.userId !== userId && !(await isTaskOwner(taskId, userId))) {
      throw new AppError(404, 'COMMENT_NOT_FOUND', 'Comment not found');
    }
    await prisma.taskComment.delete({ where: { id: commentId } });
    auditService.log({ userId, action: 'TASK_COMMENT_DELETED', entityType: 'task', entityId: taskId, details: { commentId } });
    return { success: true };
  },
};

/**
 * Mail that arrived on a linked thread after the link was made — the replies
 * to the message a task was born from. Shown on the timeline as their own
 * kind, with the sender as the actor, so "Sam replied" sits between "moved
 * to In progress" and a comment without anyone opening Mail.
 */
async function repliesOnLinkedThreads(taskId: string) {
  const links = await prisma.mailToTask.findMany({
    where: { taskId },
    select: { emailId: true, createdAt: true, email: { select: { threadId: true, userId: true } } },
  });
  if (links.length === 0) return [];
  const earliestByThread = new Map<string, { since: Date; userId: string }>();
  for (const l of links) {
    if (!l.email.threadId) continue;
    const seen = earliestByThread.get(l.email.threadId);
    if (!seen || l.createdAt < seen.since) earliestByThread.set(l.email.threadId, { since: l.createdAt, userId: l.email.userId });
  }
  if (earliestByThread.size === 0) return [];
  const linkedIds = new Set(links.map((l) => l.emailId));
  const emails = await prisma.email.findMany({
    where: {
      OR: [...earliestByThread].map(([threadId, { since, userId }]) => ({ threadId, userId, receivedAt: { gt: since } })),
    },
    orderBy: { receivedAt: 'desc' },
    take: ACTIVITY_LIMIT,
    select: { id: true, threadId: true, subject: true, from: true, fromName: true, snippet: true, receivedAt: true, isRead: true },
  });
  return emails
    .filter((e) => !linkedIds.has(e.id))
    .map((e) => ({
      kind: 'email' as const,
      id: e.id,
      at: e.receivedAt,
      actor: { id: e.from, name: e.fromName, email: e.from, avatarUrl: null },
      subject: e.subject,
      snippet: e.snippet,
      threadId: e.threadId,
      isRead: e.isRead,
    }));
}

/**
 * The mention list, reduced to real users other than the author.
 *
 * The ids arrive from the client. An id that is not a user would otherwise
 * be stored and notified into nothing; the author mentioning themself is
 * noise. Unknown ids are dropped rather than rejected — a mention that no
 * longer resolves should not block the comment it sits in.
 */
async function validMentions(authorId: string, ids: string[] | undefined): Promise<string[]> {
  const unique = [...new Set(ids ?? [])].filter((id) => id !== authorId);
  if (unique.length === 0) return [];
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true } });
  const known = new Set(users.map((u) => u.id));
  return unique.filter((id) => known.has(id));
}

/**
 * Who hears about a new comment.
 *
 * Everyone mentioned, as a mention. Then the task's owner and its assignee,
 * as a comment — unless they wrote it or were already mentioned, so nobody is
 * told twice about one line.
 */
async function notifyAboutComment(authorId: string, taskId: string, commentId: string, mentions: string[], body: string) {
  await notifyMentioned(authorId, taskId, commentId, mentions, body);

  const task = await prisma.task.findUnique({ where: { id: taskId }, select: { userId: true, assignedToId: true, title: true } });
  if (!task) return;
  const author = await authorLabel(authorId);
  const told = new Set([authorId, ...mentions]);
  const audience = [task.userId, task.assignedToId].filter((id): id is string => !!id && !told.has(id));

  for (const recipient of new Set(audience)) {
    await notificationService.create(recipient, {
      type: 'TASK_COMMENTED',
      title: `New comment: ${task.title}`,
      message: `${author} commented: ${excerpt(body)}`,
      entityType: 'task',
      entityId: taskId,
    });
  }
  wsEmitToUsers([...new Set([...audience, ...mentions])], 'task:commented', { taskId, commentId });
}

async function notifyMentioned(authorId: string, taskId: string, commentId: string, mentions: string[], body: string) {
  if (mentions.length === 0) return;
  const [task, author] = await Promise.all([
    prisma.task.findUnique({ where: { id: taskId }, select: { title: true } }),
    authorLabel(authorId),
  ]);
  for (const recipient of mentions) {
    await notificationService.create(recipient, {
      type: 'TASK_MENTIONED',
      title: `${author} mentioned you: ${task?.title ?? 'a task'}`,
      message: excerpt(body),
      entityType: 'task',
      entityId: taskId,
    });
  }
  wsEmitToUsers(mentions, 'task:mentioned', { taskId, commentId });
}

async function authorLabel(id: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id }, select: { name: true, email: true } });
  return u?.name || u?.email || 'Someone';
}

function excerpt(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 140 ? `${flat.slice(0, 139)}…` : flat;
}
