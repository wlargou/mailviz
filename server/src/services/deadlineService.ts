import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { getSharedRfpIds, getSharedTaskIds } from '../utils/accessControl.js';
import { terminalStatusNames, notTerminal } from '../utils/taskStatus.js';
import { RFP_TERMINAL_STATUSES } from '../utils/rfp.js';

export const DEADLINE_KINDS = ['RFP_DEADLINE', 'RFP_QUESTIONS', 'PIECE_DUE', 'TASK_DUE'] as const;
export type DeadlineKind = (typeof DEADLINE_KINDS)[number];

export interface Deadline {
  kind: DeadlineKind;
  /** Stable across fetches: kind plus the record's id. */
  id: string;
  title: string;
  /** What it belongs to — the tender for a piece, the company for a task. */
  context: string | null;
  at: Date;
  /** Where the calendar sends a click. */
  href: string;
}

/** Longer ranges are a mistake or an abuse; a month view spans six weeks. */
const MAX_RANGE_DAYS = 100;

/**
 * Everything with a date on it that is not a meeting: tender deadlines and
 * question cut-offs, pieces the caller must prepare, and their open tasks.
 *
 * The calendar showed meetings only, so the one date that mattered most in a
 * week — a submission deadline — was on another page. Finished work is left
 * out: a won tender's date and a done task's due date are history, not load.
 */
export const deadlineService = {
  async forRange(userId: string, startIso: string, endIso: string): Promise<Deadline[]> {
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw new AppError(400, 'INVALID_RANGE', 'start and end must be ISO dates with end after start');
    }
    if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * 86_400_000) {
      throw new AppError(400, 'RANGE_TOO_LONG', `The range may span at most ${MAX_RANGE_DAYS} days`);
    }
    const inRange = { gte: start, lt: end };

    const [sharedRfpIds, sharedTaskIds, terminal] = await Promise.all([
      getSharedRfpIds(userId),
      getSharedTaskIds(userId),
      terminalStatusNames(userId),
    ]);
    const rfpAccess = { OR: [{ userId }, ...(sharedRfpIds.length ? [{ id: { in: sharedRfpIds } }] : [])] };
    const live = { status: { notIn: [...RFP_TERMINAL_STATUSES] } };

    const [rfpDeadlines, rfpQuestions, pieces, tasks] = await Promise.all([
      prisma.rfp.findMany({
        where: { AND: [rfpAccess, live, { deadlineAt: inRange }] },
        select: { id: true, name: true, reference: true, deadlineAt: true },
      }),
      prisma.rfp.findMany({
        where: { AND: [rfpAccess, live, { questionsDeadlineAt: inRange }] },
        select: { id: true, name: true, reference: true, questionsDeadlineAt: true },
      }),
      // Only the caller's own pieces: a colleague's due dates are theirs.
      prisma.rfpFolderItem.findMany({
        where: {
          assigneeId: userId,
          dueDate: inRange,
          status: { notIn: ['READY', 'NOT_APPLICABLE'] },
          folder: { rfp: { AND: [rfpAccess, live] } },
        },
        select: { id: true, title: true, dueDate: true, folder: { select: { rfp: { select: { id: true, name: true } } } } },
      }),
      prisma.task.findMany({
        where: {
          AND: [
            { OR: [{ userId }, { assignedToId: userId }, ...(sharedTaskIds.length ? [{ id: { in: sharedTaskIds } }] : [])] },
            notTerminal(terminal),
            { dueDate: inRange },
          ],
        },
        select: { id: true, title: true, dueDate: true, customer: { select: { name: true } } },
      }),
    ]);

    const out: Deadline[] = [
      ...rfpDeadlines.map((r) => ({
        kind: 'RFP_DEADLINE' as const,
        id: `RFP_DEADLINE:${r.id}`,
        title: r.name,
        context: r.reference,
        at: r.deadlineAt,
        href: `/rfps/${r.id}`,
      })),
      ...rfpQuestions.map((r) => ({
        kind: 'RFP_QUESTIONS' as const,
        id: `RFP_QUESTIONS:${r.id}`,
        title: `Questions close · ${r.name}`,
        context: r.reference,
        at: r.questionsDeadlineAt!,
        href: `/rfps/${r.id}`,
      })),
      ...pieces.map((p) => ({
        kind: 'PIECE_DUE' as const,
        id: `PIECE_DUE:${p.id}`,
        title: p.title,
        context: p.folder.rfp.name,
        at: p.dueDate!,
        href: `/rfps/${p.folder.rfp.id}`,
      })),
      ...tasks.map((t) => ({
        kind: 'TASK_DUE' as const,
        id: `TASK_DUE:${t.id}`,
        title: t.title,
        context: t.customer?.name ?? null,
        at: t.dueDate!,
        href: `/tasks?task=${t.id}`,
      })),
    ];
    return out.sort((a, b) => a.at.getTime() - b.at.getTime());
  },
};
