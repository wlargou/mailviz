import { prisma } from '../lib/prisma.js';

/**
 * Which of a user's task statuses mean "finished".
 *
 * Task statuses are rows, not an enum — users rename them, add them and delete
 * them. Eight places nonetheless asked `status = 'DONE'`: the dashboard's
 * overdue count, the notification scheduler, the task summary. Rename that
 * status and every completed task became permanently overdue and the scheduler
 * nagged about it every five minutes; add a second finished state like
 * "Cancelled" and it was never treated as finished at all.
 *
 * The names are returned rather than ids because `Task.status` stores the name.
 */
export async function terminalStatusNames(userId: string): Promise<string[]> {
  const rows = await prisma.taskStatus.findMany({
    where: { userId, isTerminal: true },
    select: { name: true },
  });
  return rows.map((r) => r.name);
}

/**
 * A Prisma filter for "not finished", given the terminal names.
 *
 * `notIn: []` matches everything, which is the right answer when an account has
 * marked nothing as terminal: no task can be finished, so none are excluded.
 * Spelled out because an empty array reads like a bug at the call site.
 */
export function notTerminal(names: string[]) {
  return { status: { notIn: names } };
}

/** Whether a task's status is one of the finished ones. */
export function isTerminalStatus(status: string, names: string[]): boolean {
  return names.includes(status);
}
