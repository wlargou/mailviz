import { classifyContactKind } from './contactKind.js';

/**
 * Display names that are a machine, whatever address it sends from — a cron
 * job mailing as "root" from a real domain passes every address rule.
 */
export const SYSTEM_SENDER_NAMES = new Set(['root', 'cron', 'daemon', 'mailer-daemon', 'postmaster', 'nobody']);

export function isSystemSenderName(name: string | null | undefined): boolean {
  return SYSTEM_SENDER_NAMES.has((name ?? '').trim().toLowerCase());
}

/**
 * Mail from a machine: an automated address (noreply@, notifications@ …) by
 * the contact-kind vocabulary, or a system display name. What files a
 * message under Updates rather than Primary.
 */
export function isAutomatedSender(address: string, name?: string | null): boolean {
  return classifyContactKind({ email: address }) === 'automated' || isSystemSenderName(name);
}
