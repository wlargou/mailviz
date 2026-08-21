import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../lib/prisma.js';
import {
  createUser,
  createTwoUsers,
  createCustomer,
  createContact,
  createEmail,
  createTask,
  createDeal,
  createDraft,
  createGoogleAuth,
  shareTaskWith,
  shareDealWith,
  shareThreadWith,
} from '../test/factories.js';
import { accountService } from './accountService.js';
import { googleAuthService } from './googleAuthService.js';

/**
 * Account deletion.
 *
 * The whole operation is a single `prisma.user.delete`, which makes the schema
 * — not this service — the thing under test. Every assertion here is really
 * asking whether the cascade graph is what we believe it is, and the two that
 * matter most are about rows the deletion must NOT take with it:
 *
 *  - a task owned by somebody else but assigned to the departing user
 *    (`Task.assignedTo` is SetNull), and
 *  - the far side of anything shared, which survives while the share row goes.
 *
 * Getting either wrong means one user leaving destroys another user's work, and
 * there is no undo. So these are written as "Bob still has everything" rather
 * than "Alice is gone", which is the easy half.
 */

vi.mock('./googleAuthService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./googleAuthService.js')>()),
  googleAuthService: {
    ...(await importOriginal<typeof import('./googleAuthService.js')>()).googleAuthService,
    revokeTokens: vi.fn(async () => {}),
  },
}));

beforeEach(() => {
  vi.mocked(googleAuthService.revokeTokens).mockClear();
  vi.mocked(googleAuthService.revokeTokens).mockResolvedValue(undefined);
});

/** Everything one account owns, enough to prove each table is reached. */
async function seedAccount(userId: string, tag: string) {
  const customer = await createCustomer(userId, { name: `${tag} Co` });
  const contact = await createContact(customer.id, { firstName: tag });
  const email = await createEmail(userId, { customerId: customer.id, subject: `${tag} mail` });
  const task = await createTask(userId, { title: `${tag} task` });
  const deal = await createDeal(userId, { title: `${tag} deal` });
  const draft = await createDraft(userId, { subject: `${tag} draft` });
  const event = await prisma.calendarEvent.create({
    data: {
      userId,
      title: `${tag} standup`,
      startTime: new Date('2026-09-01T09:00:00.000Z'),
      endTime: new Date('2026-09-01T09:30:00.000Z'),
    },
  });
  const label = await prisma.label.create({
    data: { userId, name: `${tag}-label`, color: '#4589ff' },
  });
  const template = await prisma.emailTemplate.create({
    data: { userId, name: `${tag} template`, subject: 's', body: 'b' },
  });
  return { customer, contact, email, task, deal, draft, event, label, template };
}

describe('accountService.getDeletionSummary', () => {
  it('reports the real counts, not a fixed list', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id);
    await createContact(customer.id);
    await createContact(customer.id);
    await createEmail(alice.id);
    await createEmail(alice.id);
    await createEmail(alice.id);
    await createTask(alice.id);

    const summary = await accountService.getDeletionSummary(alice.id);

    expect(summary).toMatchObject({
      email: alice.email,
      emails: 3,
      contacts: 2,
      companies: 1,
      tasks: 1,
      googleConnected: false,
    });
  });

  it('counts only this account, never another', async () => {
    const { alice, bob } = await createTwoUsers();
    await createEmail(bob.id);
    await createEmail(bob.id);
    await createTask(bob.id);

    expect(await accountService.getDeletionSummary(alice.id)).toMatchObject({
      emails: 0,
      tasks: 0,
    });
  });

  it('reports a connected Google account', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);

    expect((await accountService.getDeletionSummary(user.id)).googleConnected).toBe(true);
  });

  it("counts other people's tasks assigned to this account separately", async () => {
    const { alice, bob } = await createTwoUsers();
    const bobsTask = await createTask(bob.id, { title: 'Bob owns this' });
    await prisma.task.update({ where: { id: bobsTask.id }, data: { assignedToId: alice.id } });

    const summary = await accountService.getDeletionSummary(alice.id);

    // Reported apart from `tasks` because the outcome differs: Alice's own
    // tasks are deleted, this one is merely unassigned.
    expect(summary.assignedByOthers).toBe(1);
    expect(summary.tasks).toBe(0);
  });

  it('does not double-count a task the account owns and is assigned to', async () => {
    const { alice } = await createTwoUsers();
    const own = await createTask(alice.id);
    await prisma.task.update({ where: { id: own.id }, data: { assignedToId: alice.id } });

    const summary = await accountService.getDeletionSummary(alice.id);

    expect(summary.tasks).toBe(1);
    expect(summary.assignedByOthers).toBe(0);
  });

  it('404s for an account that does not exist', async () => {
    await expect(
      accountService.getDeletionSummary('3f2504e0-4f89-41d3-9a0c-0305e82c3301')
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('accountService.deleteAccount — confirmation', () => {
  it('refuses a confirmation that does not match the account', async () => {
    const { alice } = await createTwoUsers();
    await createEmail(alice.id);

    await expect(accountService.deleteAccount(alice.id, 'someone-else@example.com')).rejects.toMatchObject(
      { status: 400 }
    );

    // Nothing may have been removed on the way to refusing.
    expect(await prisma.user.findUnique({ where: { id: alice.id } })).not.toBeNull();
    expect(await prisma.email.count({ where: { userId: alice.id } })).toBe(1);
  });

  it('accepts the address regardless of case or padding', async () => {
    const user = await createUser({ email: 'Mixed.Case@Example.com' });

    await accountService.deleteAccount(user.id, '  mixed.case@example.COM  ');

    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
  });
});

describe('accountService.deleteAccount — what it removes', () => {
  it('removes the account and everything hanging off it', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    const data = await seedAccount(user.id, 'Solo');
    const attachment = await prisma.emailAttachment.create({
      data: {
        emailId: data.email.id,
        gmailAttachmentId: 'att-1',
        filename: 'x.pdf',
        mimeType: 'application/pdf',
        size: 10,
      },
    });
    const link = await prisma.mailToTask.create({
      data: { emailId: data.email.id, taskId: data.task.id },
    });

    await accountService.deleteAccount(user.id, user.email);

    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await prisma.googleAuth.findFirst({ where: { userId: user.id } })).toBeNull();
    expect(await prisma.email.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.task.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.deal.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.customer.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.calendarEvent.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.emailDraft.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.label.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.emailTemplate.count({ where: { userId: user.id } })).toBe(0);
    // Two levels down — these have no userId of their own and are reached only
    // through the relation that does.
    expect(await prisma.contact.findUnique({ where: { id: data.contact.id } })).toBeNull();
    expect(await prisma.emailAttachment.findUnique({ where: { id: attachment.id } })).toBeNull();
    expect(await prisma.mailToTask.findUnique({ where: { id: link.id } })).toBeNull();
  });

  it('revokes the Google grant before deleting the row that holds the token', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    let hadAuthRow = false;
    vi.mocked(googleAuthService.revokeTokens).mockImplementation(async (id: string) => {
      // Once the user is gone the token is unrecoverable, so a revoke attempted
      // afterwards could never run at all.
      hadAuthRow = (await prisma.googleAuth.findFirst({ where: { userId: id } })) !== null;
    });

    await accountService.deleteAccount(user.id, user.email);

    expect(googleAuthService.revokeTokens).toHaveBeenCalledWith(user.id);
    expect(hadAuthRow).toBe(true);
  });

  it('deletes the account even when Google will not take the revoke', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    vi.mocked(googleAuthService.revokeTokens).mockRejectedValue(new Error('google is down'));

    await accountService.deleteAccount(user.id, user.email);

    // A user asking to be forgotten must not be held hostage by a third party.
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
  });

  it('does not call Google at all when no account is connected', async () => {
    const user = await createUser();

    await accountService.deleteAccount(user.id, user.email);

    expect(googleAuthService.revokeTokens).not.toHaveBeenCalled();
  });
});

describe('accountService.deleteAccount — what it must NOT remove', () => {
  it("leaves another account's data completely intact", async () => {
    const { alice, bob } = await createTwoUsers();
    await seedAccount(alice.id, 'Alice');
    const bobs = await seedAccount(bob.id, 'Bob');

    await accountService.deleteAccount(alice.id, alice.email);

    expect(await prisma.user.findUnique({ where: { id: bob.id } })).not.toBeNull();
    expect(await prisma.email.findUnique({ where: { id: bobs.email.id } })).not.toBeNull();
    expect(await prisma.task.findUnique({ where: { id: bobs.task.id } })).not.toBeNull();
    expect(await prisma.deal.findUnique({ where: { id: bobs.deal.id } })).not.toBeNull();
    expect(await prisma.customer.findUnique({ where: { id: bobs.customer.id } })).not.toBeNull();
    expect(await prisma.contact.findUnique({ where: { id: bobs.contact.id } })).not.toBeNull();
    expect(await prisma.calendarEvent.findUnique({ where: { id: bobs.event.id } })).not.toBeNull();
    expect(await prisma.emailDraft.findUnique({ where: { id: bobs.draft.id } })).not.toBeNull();
    expect(await prisma.label.findUnique({ where: { id: bobs.label.id } })).not.toBeNull();
    expect(await prisma.emailTemplate.findUnique({ where: { id: bobs.template.id } })).not.toBeNull();
  });

  it("unassigns another user's task instead of deleting it — REGRESSION", async () => {
    // Task.assignedTo is SetNull, not Cascade. If that ever changes, one user
    // closing their account silently destroys work belonging to someone who is
    // still using the product, with no error and nothing to restore from.
    const { alice, bob } = await createTwoUsers();
    const bobsTask = await createTask(bob.id, { title: 'Bob owns this' });
    await prisma.task.update({ where: { id: bobsTask.id }, data: { assignedToId: alice.id } });

    await accountService.deleteAccount(alice.id, alice.email);

    const after = await prisma.task.findUnique({ where: { id: bobsTask.id } });
    expect(after).not.toBeNull();
    expect(after!.title).toBe('Bob owns this');
    expect(after!.assignedToId).toBeNull();
  });

  it('drops shares it gave, and leaves the shared rows with their owners', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceTask = await createTask(alice.id);
    const bobTask = await createTask(bob.id, { title: 'Bob task' });
    const bobDeal = await createDeal(bob.id, { title: 'Bob deal' });
    await createEmail(bob.id, { threadId: 'bob-thread' });

    // Shares in both directions: one Alice gave away, three she received.
    await shareTaskWith(aliceTask.id, alice.id, bob.id);
    await shareTaskWith(bobTask.id, bob.id, alice.id);
    await shareDealWith(bobDeal.id, bob.id, alice.id);
    await shareThreadWith('bob-thread', bob.id, alice.id);

    await accountService.deleteAccount(alice.id, alice.email);

    // Every share row involving Alice is gone, from either side.
    expect(await prisma.taskShare.count()).toBe(0);
    expect(await prisma.dealShare.count()).toBe(0);
    expect(await prisma.emailThreadShare.count()).toBe(0);

    // But the things that were shared still belong to Bob.
    expect(await prisma.task.findUnique({ where: { id: bobTask.id } })).not.toBeNull();
    expect(await prisma.deal.findUnique({ where: { id: bobDeal.id } })).not.toBeNull();
    expect(await prisma.email.count({ where: { userId: bob.id } })).toBe(1);
  });
});
