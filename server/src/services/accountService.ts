import { prisma } from '../lib/prisma.js';
import { googleAuthService } from './googleAuthService.js';

/**
 * Deleting an account, and telling the user what that means first.
 *
 * The whole deletion is a single `prisma.user.delete`. That is not laziness —
 * every relation that hangs off `User` is declared `onDelete: Cascade` in the
 * schema, and the two-level relations (Contact off Customer, EmailAttachment
 * and MailToTask off Email, ContactEmailAlias off Contact, TaskLabel off Task,
 * CalendarEventCustomer off both) cascade from their own parents. Postgres
 * therefore removes all 26 tables' worth of rows in one statement, in the right
 * order, atomically. Reimplementing that as a hand-ordered transaction would be
 * strictly worse: more code, and a second definition of the object graph that
 * can drift from the schema.
 *
 * Two details in the schema do the real work, and both are worth knowing before
 * changing anything here:
 *
 *  - **`Task.assignedTo` is `SetNull`, not `Cascade`.** A task belonging to
 *    *another* user that happens to be assigned to this one is unassigned, not
 *    destroyed. Deleting an account must never take somebody else's work with
 *    it.
 *  - **Share rows cascade from both sides.** `EmailThreadShare`, `DealShare`
 *    and `TaskShare` each cascade from `sharedBy` and `sharedWith`, so a share
 *    disappears whether the sender or the recipient leaves — and the shared
 *    task or deal itself survives on the other side.
 */

export interface DeletionSummary {
  email: string;
  emails: number;
  calendarEvents: number;
  companies: number;
  contacts: number;
  tasks: number;
  deals: number;
  drafts: number;
  scheduledEmails: number;
  templates: number;
  labels: number;
  /** Tasks owned by other people that are assigned to this account. Unassigned, never deleted. */
  assignedByOthers: number;
  /** Threads, deals and tasks this account has shared with other people. */
  sharesGiven: number;
  googleConnected: boolean;
}

export const accountService = {
  /**
   * What deleting this account would remove.
   *
   * The UI shows these counts before asking for confirmation, so they must be
   * the real numbers rather than a plausible-looking list — a user agreeing to
   * "delete my data" deserves to know it is 25,000 emails.
   */
  async getDeletionSummary(userId: string): Promise<DeletionSummary> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user) {
      throw Object.assign(new Error('User not found'), { status: 404 });
    }

    const [
      emails,
      calendarEvents,
      companies,
      contacts,
      tasks,
      deals,
      drafts,
      scheduledEmails,
      templates,
      labels,
      assignedByOthers,
      emailSharesGiven,
      dealSharesGiven,
      taskSharesGiven,
      googleAuth,
    ] = await Promise.all([
      prisma.email.count({ where: { userId } }),
      prisma.calendarEvent.count({ where: { userId } }),
      prisma.customer.count({ where: { userId } }),
      prisma.contact.count({ where: { customer: { userId } } }),
      prisma.task.count({ where: { userId } }),
      prisma.deal.count({ where: { userId } }),
      prisma.emailDraft.count({ where: { userId } }),
      prisma.scheduledEmail.count({ where: { userId } }),
      prisma.emailTemplate.count({ where: { userId } }),
      prisma.label.count({ where: { userId } }),
      // `userId: { not: userId }` matters: a task the account both owns and is
      // assigned to is already counted under `tasks`, and would otherwise be
      // reported twice under two different outcomes.
      prisma.task.count({ where: { assignedToId: userId, userId: { not: userId } } }),
      prisma.emailThreadShare.count({ where: { sharedByUserId: userId } }),
      prisma.dealShare.count({ where: { sharedByUserId: userId } }),
      prisma.taskShare.count({ where: { sharedByUserId: userId } }),
      prisma.googleAuth.findFirst({ where: { userId }, select: { id: true } }),
    ]);

    return {
      email: user.email,
      emails,
      calendarEvents,
      companies,
      contacts,
      tasks,
      deals,
      drafts,
      scheduledEmails,
      templates,
      labels,
      assignedByOthers,
      sharesGiven: emailSharesGiven + dealSharesGiven + taskSharesGiven,
      googleConnected: googleAuth !== null,
    };
  },

  /**
   * Delete the account and everything belonging to it.
   *
   * `confirmEmail` must match the account's own address. The check lives here
   * rather than only in the controller because this is the last place that can
   * refuse, and a mismatch means the caller is not looking at what they think
   * they are looking at.
   */
  async deleteAccount(userId: string, confirmEmail: string): Promise<DeletionSummary> {
    const summary = await this.getDeletionSummary(userId);

    if (confirmEmail.trim().toLowerCase() !== summary.email.toLowerCase()) {
      throw Object.assign(new Error('Confirmation email does not match this account'), {
        status: 400,
      });
    }

    /**
     * Revoke at Google before deleting locally, and do not let a failure stop
     * the deletion.
     *
     * Order matters: once the GoogleAuth row is gone the refresh token is
     * unrecoverable, so a revoke attempted afterwards could never happen at
     * all. But a user asking to be deleted must not be blocked because Google
     * is unreachable or the token already expired — the grant can be removed
     * from their Google account page either way.
     */
    if (summary.googleConnected) {
      try {
        await googleAuthService.revokeTokens(userId);
      } catch (err: unknown) {
        console.warn(
          '[AccountDelete] Could not revoke Google token, continuing:',
          err instanceof Error ? err.message : err
        );
      }
    }

    // One statement. See the note at the top of this file for why that is
    // sufficient — and why hand-rolling the order would be worse.
    await prisma.user.delete({ where: { id: userId } });

    // The audit trail cascades away with the account, so there is nowhere left
    // to write this. The log line is deliberately the only record.
    console.log(
      `[AccountDelete] Deleted ${summary.email}: ${summary.emails} emails, ` +
        `${summary.calendarEvents} events, ${summary.companies} companies, ` +
        `${summary.contacts} contacts, ${summary.tasks} tasks, ${summary.deals} deals`
    );

    return summary;
  },
};
