import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { createUser, createTwoUsers, createGoogleAuth, createEmail } from '../test/factories.js';
import { onboardingService, DEFAULT_TASK_STATUSES } from './onboardingService.js';

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
