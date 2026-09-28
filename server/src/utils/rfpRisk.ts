import { RFP_TERMINAL_STATUSES } from './rfp.js';

/**
 * Whether a tender is behind — readiness trailing the share of its time used
 * since publication (or registration). The same rule as `tenderRisk` on the
 * client, kept in step by the tests on both sides; the sidebar counts with
 * this one.
 */
export function isAtRisk(
  rfp: { status: string; deadlineAt: Date; createdAt: Date; publishedAt: Date | null },
  readiness: { ready: number; total: number },
  now = Date.now(),
): boolean {
  const preparing = !(RFP_TERMINAL_STATUSES as readonly string[]).includes(rfp.status) && rfp.status !== 'SUBMITTED';
  if (!preparing || readiness.total === 0) return false;
  const deadline = rfp.deadlineAt.getTime();
  if (now > deadline) return true;
  const start = (rfp.publishedAt ?? rfp.createdAt).getTime();
  const timeUsed = Math.min(1, Math.max(0, (now - start) / Math.max(deadline - start, 1)));
  return timeUsed >= 0.1 && readiness.ready / readiness.total < timeUsed;
}
