import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { canAccessRfp, canAccessThread, getSharedRfpIds, getSharedThreadIds } from '../utils/accessControl.js';
import { RFP_TERMINAL_STATUSES } from '../utils/rfp.js';
import { auditService } from './auditService.js';

/**
 * Mail filed under a tender.
 *
 * A buyer's clarifications and the avis de report arrive as ordinary mail,
 * and their subjects quote the tender's reference verbatim
 * ("RE: AO 70/AOO/BKAM/2026"). So a thread that quotes the reference of a
 * tender you can open is offered for filing, and a filed thread shows on the
 * tender's page. Filing is a click, never automatic: a reference can be
 * quoted in passing.
 */

/** Shorter references ("12/2026") match too much prose to suggest on. */
const MIN_REFERENCE_LENGTH = 6;
const MAX_SUGGESTIONS = 3;

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '');

async function accessibleRfpWhere(userId: string) {
  const shared = await getSharedRfpIds(userId);
  return { OR: [{ userId }, ...(shared.length ? [{ id: { in: shared } }] : [])] };
}

export const rfpThreadService = {
  /** The tenders a thread is filed under, and those it quotes but is not. */
  async forThread(userId: string, threadId: string) {
    if (!(await canAccessThread(threadId, userId))) {
      throw new AppError(404, 'THREAD_NOT_FOUND', 'Thread not found');
    }
    const [access, sharedThreadIds] = await Promise.all([accessibleRfpWhere(userId), getSharedThreadIds(userId)]);
    // Only messages the caller can read: their own copy, or the owner's when
    // the thread is shared with them.
    const readable = sharedThreadIds.includes(threadId) ? { threadId } : { threadId, userId };
    const [links, messages, candidates] = await Promise.all([
      prisma.rfpThread.findMany({
        where: { threadId, rfp: access },
        select: { rfp: { select: { id: true, name: true, reference: true, status: true } } },
      }),
      prisma.email.findMany({
        where: readable,
        select: { subject: true, snippet: true },
        take: 50,
      }),
      prisma.rfp.findMany({
        where: access,
        select: { id: true, name: true, reference: true, status: true, deadlineAt: true },
      }),
    ]);

    const linkedIds = new Set(links.map((l) => l.rfp.id));
    const text = squash(messages.map((m) => `${m.subject} ${m.snippet ?? ''}`).join(' '));
    const suggested = candidates
      .filter((r) => !linkedIds.has(r.id) && r.reference.trim().length >= MIN_REFERENCE_LENGTH && text.includes(squash(r.reference)))
      // Live tenders first, then the nearest deadline.
      .sort((a, b) => {
        const liveA = !(RFP_TERMINAL_STATUSES as readonly string[]).includes(a.status);
        const liveB = !(RFP_TERMINAL_STATUSES as readonly string[]).includes(b.status);
        if (liveA !== liveB) return liveA ? -1 : 1;
        return a.deadlineAt.getTime() - b.deadlineAt.getTime();
      })
      .slice(0, MAX_SUGGESTIONS)
      .map(({ id, name, reference, status }) => ({ id, name, reference, status }));

    return { linked: links.map((l) => l.rfp), suggested };
  },

  async link(userId: string, rfpId: string, threadId: string) {
    if (!(await canAccessRfp(rfpId, userId))) throw new AppError(404, 'RFP_NOT_FOUND', 'RFP not found');
    if (!(await canAccessThread(threadId, userId))) throw new AppError(404, 'THREAD_NOT_FOUND', 'Thread not found');
    await prisma.rfpThread.createMany({ data: [{ rfpId, threadId, linkedById: userId }], skipDuplicates: true });
    auditService.log({ userId, action: 'RFP_THREAD_LINKED', entityType: 'rfp', entityId: rfpId, details: { threadId } });
    return this.threads(userId, rfpId);
  },

  async unlink(userId: string, rfpId: string, threadId: string) {
    if (!(await canAccessRfp(rfpId, userId))) throw new AppError(404, 'RFP_NOT_FOUND', 'RFP not found');
    const { count } = await prisma.rfpThread.deleteMany({ where: { rfpId, threadId } });
    if (count > 0) {
      auditService.log({ userId, action: 'RFP_THREAD_UNLINKED', entityType: 'rfp', entityId: rfpId, details: { threadId } });
    }
    return this.threads(userId, rfpId);
  },

  /**
   * A tender's threads, as the caller can read them: the latest message of
   * each from their own mailbox or a thread shared with them. Threads filed
   * by someone else that the caller cannot read are counted, not shown.
   */
  async threads(userId: string, rfpId: string) {
    if (!(await canAccessRfp(rfpId, userId))) throw new AppError(404, 'RFP_NOT_FOUND', 'RFP not found');
    const [links, sharedThreadIds] = await Promise.all([
      prisma.rfpThread.findMany({
        where: { rfpId },
        orderBy: { createdAt: 'desc' },
        select: { threadId: true, createdAt: true, linkedBy: { select: { id: true, name: true, email: true } } },
      }),
      getSharedThreadIds(userId),
    ]);
    if (links.length === 0) return { threads: [], hidden: 0 };

    const threadIds = links.map((l) => l.threadId);
    const shared = new Set(sharedThreadIds);
    const messages = await prisma.email.findMany({
      where: {
        threadId: { in: threadIds },
        OR: [{ userId }, ...(sharedThreadIds.length ? [{ threadId: { in: threadIds.filter((t) => shared.has(t)) } }] : [])],
      },
      orderBy: { receivedAt: 'desc' },
      select: { threadId: true, subject: true, from: true, fromName: true, receivedAt: true },
    });

    const latest = new Map<string, (typeof messages)[number]>();
    const counts = new Map<string, number>();
    for (const m of messages) {
      if (!m.threadId) continue;
      counts.set(m.threadId, (counts.get(m.threadId) ?? 0) + 1);
      if (!latest.has(m.threadId)) latest.set(m.threadId, m);
    }

    const threads = links.flatMap((l) => {
      const m = latest.get(l.threadId);
      if (!m) return [];
      return [{
        threadId: l.threadId,
        subject: m.subject,
        from: m.fromName || m.from,
        receivedAt: m.receivedAt,
        messages: counts.get(l.threadId) ?? 1,
        linkedBy: l.linkedBy.id === userId ? null : l.linkedBy.name || l.linkedBy.email,
      }];
    });
    threads.sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
    return { threads, hidden: links.length - threads.length };
  },
};
