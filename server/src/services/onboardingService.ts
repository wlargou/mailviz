import { prisma } from '../lib/prisma.js';
import { auditService } from './auditService.js';

/**
 * First-run setup.
 *
 * A new account is created by the Google login flow with nothing but an email,
 * a name and a token row (`authController.googleCallback`). Two of the gaps that
 * leaves are not cosmetic — they make features unusable rather than empty:
 *
 *  - **Task statuses.** The Kanban board renders its columns from
 *    `task_statuses`, which is per-user and seeded nowhere. A new user opens the
 *    board and finds no columns at all, so there is nowhere to put a task.
 *  - **Deal partners.** `Deal.partnerId` is required, so until one partner
 *    exists a deal cannot be created — the form has nothing to select.
 *
 * The rest (signature, labels) degrade gracefully and are offered, not required.
 * Mail and calendar need no setup: login *is* the Google consent, so the tokens
 * are already there and the schedulers pick the account up on their next tick.
 */

/**
 * The starting columns for the Kanban board.
 *
 * Deliberately three. The board is a horizontal scroll, and a first-run user
 * with eight columns has to curate before they can work; adding a column is one
 * click in Settings, removing eight is not.
 */
/**
 * The starter label vocabulary.
 *
 * Labels are the one part of a task this app never invents: nothing in the mail
 * sync can guess that a thread is about billing rather than presales. So an
 * account begins with none, every task renders without them, and the column
 * that shows them looks broken rather than empty.
 *
 * These four are the categories this account's work actually falls into, taken
 * from the design. They are a starting point to rename, not a taxonomy — which
 * is why seeding is all-or-nothing, like the statuses below.
 *
 * The hex values are Carbon palette tokens chosen so `LabelTag` maps each one
 * to a distinct tag colour rather than falling through to its
 * dominant-channel heuristic.
 */
export const DEFAULT_TASK_LABELS = [
  { name: 'Billing', color: '#d02670' },   // magenta60
  { name: 'Presales', color: '#0f62fe' },  // blue60
  { name: 'Contract', color: '#8a3ffc' },  // purple60
  { name: 'Support', color: '#007d79' },   // teal60
] as const;

export const DEFAULT_TASK_STATUSES = [
  { name: 'TODO', label: 'To do', color: '#4589ff', position: 0 },
  { name: 'IN_PROGRESS', label: 'In progress', color: '#f1c21b', position: 1 },
  // The only default that means "finished" — see utils/taskStatus.ts.
  { name: 'DONE', label: 'Done', color: '#24a148', position: 2, isTerminal: true },
] as const;

export interface OnboardingStatus {
  /** Null until the user finishes or dismisses the flow. */
  completedAt: Date | null;
  /** Whether the welcome and wizard should be shown on this login. */
  needsOnboarding: boolean;
  /**
   * True when the account is already working — no blocking gaps and mail has
   * arrived — so first-run guidance would be noise rather than help.
   */
  alreadyUpAndRunning: boolean;
  steps: {
    /** Always true in practice — login is the Google consent — but checked, not assumed. */
    googleConnected: boolean;
    taskStatusCount: number;
    dealPartnerCount: number;
    hasSignature: boolean;
    hasDisplayName: boolean;
    /** Whether any mail has arrived yet, so the wizard can say "sync is running". */
    emailCount: number;
  };
  /** The blocking gaps, in the order the wizard addresses them. */
  blocking: Array<'taskStatuses' | 'dealPartners'>;
}

export const onboardingService = {
  async getStatus(userId: string): Promise<OnboardingStatus> {
    const [user, googleAuth, taskStatusCount, dealPartnerCount, emailCount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { onboardingCompletedAt: true, signature: true, name: true },
      }),
      prisma.googleAuth.findUnique({ where: { userId }, select: { userId: true } }),
      prisma.taskStatus.count({ where: { userId } }),
      prisma.dealPartner.count({ where: { userId } }),
      prisma.email.count({ where: { userId } }),
    ]);

    if (!user) {
      throw Object.assign(new Error('User not found'), { status: 404 });
    }

    const blocking: OnboardingStatus['blocking'] = [];
    if (taskStatusCount === 0) blocking.push('taskStatuses');
    if (dealPartnerCount === 0) blocking.push('dealPartners');

    /**
     * The flag was added after this app already had accounts in use, so every
     * existing user starts on NULL. Reading that as "has not been onboarded"
     * would greet someone with a full mailbox and a configured board with a
     * first-run tour — the flow would correctly report that there is nothing to
     * do, which is exactly what makes showing it insulting.
     *
     * So an account that is demonstrably working is exempt. It stays reachable
     * from Settings for anyone who wants the tour.
     */
    const alreadyUpAndRunning = blocking.length === 0 && emailCount > 0;

    return {
      completedAt: user.onboardingCompletedAt,
      needsOnboarding: user.onboardingCompletedAt === null && !alreadyUpAndRunning,
      alreadyUpAndRunning,
      steps: {
        googleConnected: googleAuth !== null,
        taskStatusCount,
        dealPartnerCount,
        hasSignature: Boolean(user.signature?.trim()),
        hasDisplayName: Boolean(user.name?.trim()),
        emailCount,
      },
      blocking,
    };
  },

  /**
   * Create the default Kanban columns.
   *
   * Idempotent, and deliberately all-or-nothing: if the user already has *any*
   * status, this does nothing rather than topping up. Someone who renamed
   * "To do" to "Backlog" should not find "To do" reappearing beside it.
   */
  async seedDefaultTaskStatuses(userId: string) {
    const existing = await prisma.taskStatus.count({ where: { userId } });
    if (existing > 0) {
      return { created: 0, skipped: true };
    }
    const result = await prisma.taskStatus.createMany({
      data: DEFAULT_TASK_STATUSES.map((status) => ({ ...status, userId })),
    });
    return { created: result.count, skipped: false };
  },

  /**
   * Create the starter labels.
   *
   * Same all-or-nothing rule as the statuses: if the account already has any
   * label, this does nothing. Someone who renamed "Support" to "Run" should not
   * find "Support" reappearing next to it, and someone who deliberately deleted
   * the lot should not have them restored on their next visit.
   */
  async seedDefaultLabels(userId: string) {
    const existing = await prisma.label.count({ where: { userId } });
    if (existing > 0) {
      return { created: 0, skipped: true };
    }
    const result = await prisma.label.createMany({
      data: DEFAULT_TASK_LABELS.map((label) => ({ ...label, userId })),
    });
    return { created: result.count, skipped: false };
  },

  /**
   * Give an account the configuration it cannot work without.
   *
   * Seeded on sign-in rather than on finishing the wizard, because the wizard
   * is skippable: "Explore on my own" completes onboarding without ever
   * reaching the board step, and that account then had no task statuses — an
   * empty Kanban with no columns — and no labels, so the label picker on every
   * task form hid itself. Defaults that only arrive if you read the tour are
   * not defaults.
   *
   * Both seeders are all-or-nothing and idempotent, so this is two COUNT
   * queries on every login after the first and cannot disturb a set the user
   * has since curated. That is what makes it safe to run on a hot path.
   *
   * The wizard still calls them directly. It is the same operation, and a step
   * that reports what it found reads better than one that silently did nothing.
   */
  async ensureAccountDefaults(userId: string) {
    const [statuses, labels] = await Promise.all([
      this.seedDefaultTaskStatuses(userId),
      this.seedDefaultLabels(userId),
    ]);
    if (statuses.created > 0 || labels.created > 0) {
      console.log(
        `[Onboarding] Seeded defaults for ${userId}: ${statuses.created} statuses, ${labels.created} labels`
      );
    }
    return { statuses, labels };
  },

  /**
   * Mark first-run setup as done.
   *
   * Called both when the user completes the wizard and when they dismiss it —
   * the flow is guidance, not a gate, and nagging someone who chose to skip is
   * worse than an unconfigured board. `complete` is idempotent: re-running keeps
   * the original timestamp, so "when did this account get set up" stays true.
   */
  async complete(userId: string, { skipped = false }: { skipped?: boolean } = {}) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { onboardingCompletedAt: true },
    });
    if (!user) {
      throw Object.assign(new Error('User not found'), { status: 404 });
    }
    if (user.onboardingCompletedAt) {
      return { completedAt: user.onboardingCompletedAt, alreadyComplete: true };
    }
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { onboardingCompletedAt: new Date() },
      select: { onboardingCompletedAt: true },
    });
    auditService.log({
      userId,
      action: skipped ? 'ONBOARDING_SKIPPED' : 'ONBOARDING_COMPLETED',
      entityType: 'auth',
      entityId: userId,
    });
    return { completedAt: updated.onboardingCompletedAt, alreadyComplete: false };
  },

  /**
   * Clear the flag so the flow can be replayed from Settings.
   *
   * Configuration already made is untouched — this replays the guidance, it does
   * not reset the account.
   */
  async reset(userId: string) {
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { onboardingCompletedAt: null },
      select: { onboardingCompletedAt: true },
    });
    return { completedAt: updated.onboardingCompletedAt };
  },
};
