import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { createUser, createTwoUsers, createGoogleAuth, createEmail } from '../test/factories.js';
import { onboardingService, DEFAULT_TASK_STATUSES, DEFAULT_TASK_LABELS} from './onboardingService.js';

describe('onboardingService.getStatus', () => {
  it('reports a brand-new account as needing setup, with both blocking gaps', async () => {
    const user = await createUser();

    const status = await onboardingService.getStatus(user.id);

    expect(status.needsOnboarding).toBe(true);
    expect(status.completedAt).toBeNull();
    // These two are what make features unusable rather than merely empty: the
    // Kanban renders no columns, and a deal cannot be created without a partner.
    expect(status.blocking).toEqual(['taskStatuses', 'dealPartners']);
    expect(status.steps.taskStatusCount).toBe(0);
    expect(status.steps.dealPartnerCount).toBe(0);
  });

  it('stops reporting a gap once it is filled', async () => {
    const user = await createUser();
    await onboardingService.seedDefaultTaskStatuses(user.id);
    await prisma.dealPartner.create({ data: { userId: user.id, name: 'A partner' } });

    const status = await onboardingService.getStatus(user.id);

    expect(status.blocking).toEqual([]);
    expect(status.steps.taskStatusCount).toBe(DEFAULT_TASK_STATUSES.length);
    expect(status.steps.dealPartnerCount).toBe(1);
  });

  it('checks the Google connection rather than assuming login implies it', async () => {
    const user = await createUser();
    expect((await onboardingService.getStatus(user.id)).steps.googleConnected).toBe(false);

    await createGoogleAuth(user.id);
    expect((await onboardingService.getStatus(user.id)).steps.googleConnected).toBe(true);
  });

  it('reports signature and mail so the wizard can say what is already working', async () => {
    const user = await createUser();
    await createEmail(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { signature: '  ' } });

    const status = await onboardingService.getStatus(user.id);

    // Whitespace is not a signature.
    expect(status.steps.hasSignature).toBe(false);
    expect(status.steps.emailCount).toBe(1);
  });

  it('counts only the asking account, never another tenant', async () => {
    const { alice, bob } = await createTwoUsers();
    await onboardingService.seedDefaultTaskStatuses(bob.id);
    await prisma.dealPartner.create({ data: { userId: bob.id, name: 'Bob partner' } });
    await createEmail(bob.id);

    const status = await onboardingService.getStatus(alice.id);

    expect(status.steps.taskStatusCount).toBe(0);
    expect(status.steps.dealPartnerCount).toBe(0);
    expect(status.steps.emailCount).toBe(0);
    expect(status.blocking).toEqual(['taskStatuses', 'dealPartners']);
  });

  it('does not interrupt an account that is already working', async () => {
    // The flag was added to a schema that already had accounts in use, so every
    // established user starts on NULL. Greeting someone with a full mailbox and
    // a configured board with a first-run tour is the bug this prevents.
    const user = await createUser();
    await onboardingService.seedDefaultTaskStatuses(user.id);
    await prisma.dealPartner.create({ data: { userId: user.id, name: 'A partner' } });
    await createEmail(user.id);

    const status = await onboardingService.getStatus(user.id);

    expect(status.completedAt).toBeNull();
    expect(status.alreadyUpAndRunning).toBe(true);
    expect(status.needsOnboarding).toBe(false);
  });

  it('still onboards a configured account that has no mail yet', async () => {
    // Configured but empty means the very first sync has not landed — a genuinely
    // new account, which is precisely who the flow is for.
    const user = await createUser();
    await onboardingService.seedDefaultTaskStatuses(user.id);
    await prisma.dealPartner.create({ data: { userId: user.id, name: 'A partner' } });

    const status = await onboardingService.getStatus(user.id);

    expect(status.alreadyUpAndRunning).toBe(false);
    expect(status.needsOnboarding).toBe(true);
  });

  it('404s for a user that does not exist', async () => {
    await expect(
      onboardingService.getStatus('00000000-0000-0000-0000-000000000000')
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('onboardingService.seedDefaultTaskStatuses', () => {
  it('creates the starting columns in board order', async () => {
    const user = await createUser();

    const result = await onboardingService.seedDefaultTaskStatuses(user.id);

    expect(result).toEqual({ created: 3, skipped: false });
    const statuses = await prisma.taskStatus.findMany({
      where: { userId: user.id },
      orderBy: { position: 'asc' },
      select: { name: true, label: true, position: true },
    });
    expect(statuses).toEqual([
      { name: 'TODO', label: 'To do', position: 0 },
      { name: 'IN_PROGRESS', label: 'In progress', position: 1 },
      { name: 'DONE', label: 'Done', position: 2 },
    ]);
  });

  it('does nothing when the user already has statuses, rather than topping up', async () => {
    const user = await createUser();
    await prisma.taskStatus.create({
      data: { userId: user.id, name: 'BACKLOG', label: 'Backlog', position: 0 },
    });

    const result = await onboardingService.seedDefaultTaskStatuses(user.id);

    expect(result).toEqual({ created: 0, skipped: true });
    // Someone who renamed their columns must not find "To do" reappearing.
    const names = await prisma.taskStatus.findMany({
      where: { userId: user.id },
      select: { name: true },
    });
    expect(names).toEqual([{ name: 'BACKLOG' }]);
  });

  it('is safe to call twice', async () => {
    const user = await createUser();
    await onboardingService.seedDefaultTaskStatuses(user.id);
    await onboardingService.seedDefaultTaskStatuses(user.id);

    expect(await prisma.taskStatus.count({ where: { userId: user.id } })).toBe(3);
  });

  it('seeds each user their own columns', async () => {
    const { alice, bob } = await createTwoUsers();
    await onboardingService.seedDefaultTaskStatuses(alice.id);
    await onboardingService.seedDefaultTaskStatuses(bob.id);

    expect(await prisma.taskStatus.count({ where: { userId: alice.id } })).toBe(3);
    expect(await prisma.taskStatus.count({ where: { userId: bob.id } })).toBe(3);
  });
});

describe('onboardingService.complete', () => {
  it('marks setup done so the flow does not reappear', async () => {
    const user = await createUser();

    const result = await onboardingService.complete(user.id);

    expect(result.alreadyComplete).toBe(false);
    expect(result.completedAt).toBeInstanceOf(Date);
    expect((await onboardingService.getStatus(user.id)).needsOnboarding).toBe(false);
  });

  it('keeps the original timestamp when called again', async () => {
    const user = await createUser();
    const first = await onboardingService.complete(user.id);

    const second = await onboardingService.complete(user.id);

    expect(second.alreadyComplete).toBe(true);
    expect(second.completedAt).toEqual(first.completedAt);
  });

  it('treats a skip as complete — the flow is guidance, not a gate', async () => {
    const user = await createUser();

    await onboardingService.complete(user.id, { skipped: true });

    const status = await onboardingService.getStatus(user.id);
    expect(status.needsOnboarding).toBe(false);
    // Skipping records nothing as configured; the gaps are still reported so
    // Settings can surface them later.
    expect(status.blocking).toEqual(['taskStatuses', 'dealPartners']);
  });

  it('does not complete one user by completing another', async () => {
    const { alice, bob } = await createTwoUsers();

    await onboardingService.complete(alice.id);

    expect((await onboardingService.getStatus(bob.id)).needsOnboarding).toBe(true);
  });

  it('404s for a user that does not exist', async () => {
    await expect(
      onboardingService.complete('00000000-0000-0000-0000-000000000000')
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('onboardingService.reset', () => {
  it('replays the guidance without undoing configuration', async () => {
    const user = await createUser();
    await onboardingService.seedDefaultTaskStatuses(user.id);
    await onboardingService.complete(user.id);

    await onboardingService.reset(user.id);

    const status = await onboardingService.getStatus(user.id);
    expect(status.needsOnboarding).toBe(true);
    // The columns the user already has must survive a replay.
    expect(status.steps.taskStatusCount).toBe(3);
  });
});

/**
 * The starter label vocabulary.
 *
 * Labels are the one field the mail sync can never infer — nothing about a
 * thread says "billing" rather than "presales" — so an account starts with
 * none and every task renders label-less. Seeding gives the By Company view
 * something to show and the user something to rename.
 *
 * Same all-or-nothing rule as the statuses, for the same reason: topping up a
 * customised set is worse than leaving it alone.
 */
describe('onboardingService.seedDefaultLabels', () => {
  it('creates the starter set for an account with none', async () => {
    const user = await createUser();

    const result = await onboardingService.seedDefaultLabels(user.id);

    expect(result).toEqual({ created: DEFAULT_TASK_LABELS.length, skipped: false });
    const names = (await prisma.label.findMany({ where: { userId: user.id }, orderBy: { name: 'asc' } }))
      .map((l) => l.name);
    expect(names).toEqual(['Billing', 'Contract', 'Presales', 'Support']);
  });

  it('gives each label a distinct colour', async () => {
    // They are rendered side by side on one row; two labels the same colour
    // makes the column decorative rather than informative.
    const user = await createUser();
    await onboardingService.seedDefaultLabels(user.id);

    const colors = (await prisma.label.findMany({ where: { userId: user.id } })).map((l) => l.color);

    expect(new Set(colors).size).toBe(DEFAULT_TASK_LABELS.length);
  });

  it('does nothing when the account already has a label', async () => {
    // Someone who renamed or deleted these should not find them back.
    const user = await createUser();
    await prisma.label.create({ data: { userId: user.id, name: 'Run', color: '#007d79' } });

    const result = await onboardingService.seedDefaultLabels(user.id);

    expect(result).toEqual({ created: 0, skipped: true });
    expect(await prisma.label.count({ where: { userId: user.id } })).toBe(1);
  });

  it('is idempotent across repeated calls', async () => {
    const user = await createUser();

    await onboardingService.seedDefaultLabels(user.id);
    await onboardingService.seedDefaultLabels(user.id);

    expect(await prisma.label.count({ where: { userId: user.id } })).toBe(DEFAULT_TASK_LABELS.length);
  });

  it('seeds only the asking account', async () => {
    const { alice, bob } = await createTwoUsers();

    await onboardingService.seedDefaultLabels(alice.id);

    expect(await prisma.label.count({ where: { userId: bob.id } })).toBe(0);
  });
});

/**
 * Defaults arrive on sign-in, not on finishing the tour.
 *
 * The wizard is skippable — "Explore on my own" completes onboarding without
 * ever reaching the board step — and that account was left with no task
 * statuses (an empty Kanban) and no labels (a picker that hides itself). A
 * default that only arrives if you read the tour is not a default.
 *
 * This runs on a hot path, so the idempotence cases matter as much as the
 * seeding one: it must be two COUNT queries and nothing else once an account
 * is set up, and it must never disturb a set the user has curated since.
 */
describe('onboardingService.ensureAccountDefaults', () => {
  it('gives a brand-new account both statuses and labels', async () => {
    const user = await createUser();

    const result = await onboardingService.ensureAccountDefaults(user.id);

    expect(result.statuses.created).toBe(DEFAULT_TASK_STATUSES.length);
    expect(result.labels.created).toBe(DEFAULT_TASK_LABELS.length);
  });

  it('leaves an account that skipped the wizard fully configured', async () => {
    // The exact path that was broken: onboarding marked complete without the
    // board step ever running.
    const user = await createUser();
    await onboardingService.complete(user.id, { skipped: true });

    await onboardingService.ensureAccountDefaults(user.id);

    expect(await prisma.taskStatus.count({ where: { userId: user.id } }))
      .toBe(DEFAULT_TASK_STATUSES.length);
    expect(await prisma.label.count({ where: { userId: user.id } }))
      .toBe(DEFAULT_TASK_LABELS.length);
    // And the account no longer reports a blocking gap it cannot fix itself.
    expect((await onboardingService.getStatus(user.id)).blocking).not.toContain('taskStatuses');
  });

  it('creates nothing on a second sign-in', async () => {
    // It runs on every login, so this is the case that happens thousands of
    // times and the one that must stay cheap.
    const user = await createUser();
    await onboardingService.ensureAccountDefaults(user.id);

    const again = await onboardingService.ensureAccountDefaults(user.id);

    expect(again.statuses).toEqual({ created: 0, skipped: true });
    expect(again.labels).toEqual({ created: 0, skipped: true });
  });

  it('does not restore what the user deliberately removed', async () => {
    // Someone who deleted "Support" and renamed the rest should not find their
    // decisions undone by logging in tomorrow.
    const user = await createUser();
    await prisma.label.create({ data: { userId: user.id, name: 'Run', color: '#007d79' } });
    await prisma.taskStatus.create({ data: { userId: user.id, name: 'BACKLOG', label: 'Backlog' } });

    await onboardingService.ensureAccountDefaults(user.id);

    expect((await prisma.label.findMany({ where: { userId: user.id } })).map((l) => l.name))
      .toEqual(['Run']);
    expect((await prisma.taskStatus.findMany({ where: { userId: user.id } })).map((s) => s.name))
      .toEqual(['BACKLOG']);
  });

  it('seeds only the account signing in', async () => {
    const { alice, bob } = await createTwoUsers();

    await onboardingService.ensureAccountDefaults(alice.id);

    expect(await prisma.label.count({ where: { userId: bob.id } })).toBe(0);
    expect(await prisma.taskStatus.count({ where: { userId: bob.id } })).toBe(0);
  });

  it('still seeds labels when statuses already exist', async () => {
    // Every account that predates the label feature. Seeding the two together
    // must not make one depend on the other.
    const user = await createUser();
    await onboardingService.seedDefaultTaskStatuses(user.id);

    const result = await onboardingService.ensureAccountDefaults(user.id);

    expect(result.statuses.created).toBe(0);
    expect(result.labels.created).toBe(DEFAULT_TASK_LABELS.length);
  });
});
