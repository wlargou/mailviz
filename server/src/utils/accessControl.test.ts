import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';
import {
  canAccessTask,
  canAccessDeal,
  canAccessThread,
  isTaskOwner,
  isDealOwner,
  getSharedTaskIds,
  getSharedDealIds,
  getSharedThreadIds,
} from './accessControl.js';
import {
  createTwoUsers,
  createUser,
  createTask,
  createDeal,
  createEmail,
  shareTaskWith,
  shareDealWith,
  shareThreadWith,
} from '../test/factories.js';

/**
 * The authorization predicates every service leans on.
 *
 * These are the last line of defence for the single-row endpoints — `findById`,
 * `update`, `delete` all call one of them and return 404 on false. A predicate
 * that returns true too readily is a direct object reference vulnerability, and
 * one that confuses "can access" with "owns" would let a share recipient delete
 * the owner's row. So each is checked against all three relationships: owner,
 * share recipient, and an unrelated third user.
 *
 * The unrelated-user case matters most. It is the one that a test suite built
 * around a single user would never exercise, and it is exactly the case an
 * attacker occupies.
 */
describe('canAccessTask', () => {
  it('is true for the owner', async () => {
    const { alice } = await createTwoUsers();
    const task = await createTask(alice.id);

    expect(await canAccessTask(task.id, alice.id)).toBe(true);
  });

  it('is true for a share recipient', async () => {
    const { alice, bob } = await createTwoUsers();
    const task = await createTask(bob.id);
    await shareTaskWith(task.id, bob.id, alice.id);

    expect(await canAccessTask(task.id, alice.id)).toBe(true);
  });

  it('is true for the assignee even without a share', async () => {
    const { alice, bob } = await createTwoUsers();
    const task = await createTask(bob.id, { assignedToId: alice.id });

    expect(await canAccessTask(task.id, alice.id)).toBe(true);
  });

  it('is false for an unrelated user', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser({ name: 'Carol' });
    const task = await createTask(bob.id);
    await shareTaskWith(task.id, bob.id, alice.id);

    expect(await canAccessTask(task.id, carol.id)).toBe(false);
  });

  it('is false for a task id that does not exist', async () => {
    const { alice } = await createTwoUsers();

    expect(await canAccessTask('00000000-0000-0000-0000-000000000000', alice.id)).toBe(false);
  });

  it('is false once the share is revoked', async () => {
    const { alice, bob } = await createTwoUsers();
    const task = await createTask(bob.id);
    const share = await shareTaskWith(task.id, bob.id, alice.id);
    expect(await canAccessTask(task.id, alice.id)).toBe(true);

    await prisma.taskShare.delete({ where: { id: share.id } });

    expect(await canAccessTask(task.id, alice.id)).toBe(false);
  });
});

describe('isTaskOwner', () => {
  it('is true only for the owner — a share recipient does not own the task', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser({ name: 'Carol' });
    const task = await createTask(bob.id, { assignedToId: carol.id });
    await shareTaskWith(task.id, bob.id, alice.id);

    expect(await isTaskOwner(task.id, bob.id)).toBe(true);
    // Sharing grants read/update, never ownership — delete() gates on this.
    expect(await isTaskOwner(task.id, alice.id)).toBe(false);
    // Nor does being the assignee.
    expect(await isTaskOwner(task.id, carol.id)).toBe(false);
  });
});

describe('canAccessDeal', () => {
  it('is true for the owner', async () => {
    const { alice } = await createTwoUsers();
    const deal = await createDeal(alice.id);

    expect(await canAccessDeal(deal.id, alice.id)).toBe(true);
  });

  it('is true for a share recipient', async () => {
    const { alice, bob } = await createTwoUsers();
    const deal = await createDeal(bob.id);
    await shareDealWith(deal.id, bob.id, alice.id);

    expect(await canAccessDeal(deal.id, alice.id)).toBe(true);
  });

  it('is false for an unrelated user', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser({ name: 'Carol' });
    const deal = await createDeal(bob.id);
    await shareDealWith(deal.id, bob.id, alice.id);

    expect(await canAccessDeal(deal.id, carol.id)).toBe(false);
  });

  it('is false for a deal id that does not exist', async () => {
    const { alice } = await createTwoUsers();

    expect(await canAccessDeal('00000000-0000-0000-0000-000000000000', alice.id)).toBe(false);
  });
});

describe('isDealOwner', () => {
  it('is true only for the owner — a share recipient does not own the deal', async () => {
    const { alice, bob } = await createTwoUsers();
    const deal = await createDeal(bob.id);
    await shareDealWith(deal.id, bob.id, alice.id);

    expect(await isDealOwner(deal.id, bob.id)).toBe(true);
    expect(await isDealOwner(deal.id, alice.id)).toBe(false);
  });
});

describe('canAccessThread', () => {
  it('is true for the owner of any message in the thread', async () => {
    const { alice } = await createTwoUsers();
    await createEmail(alice.id, { threadId: 'thread-alice' });

    expect(await canAccessThread('thread-alice', alice.id)).toBe(true);
  });

  it('is true for a share recipient', async () => {
    const { alice, bob } = await createTwoUsers();
    await createEmail(bob.id, { threadId: 'thread-bob' });
    await shareThreadWith('thread-bob', bob.id, alice.id);

    expect(await canAccessThread('thread-bob', alice.id)).toBe(true);
  });

  it('is false for an unrelated user', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser({ name: 'Carol' });
    await createEmail(bob.id, { threadId: 'thread-bob' });
    await shareThreadWith('thread-bob', bob.id, alice.id);

    expect(await canAccessThread('thread-bob', carol.id)).toBe(false);
  });

  it('is false for a thread id that does not exist', async () => {
    const { alice } = await createTwoUsers();

    expect(await canAccessThread('thread-nonexistent', alice.id)).toBe(false);
  });

  it('a share of one thread does not grant access to another', async () => {
    const { alice, bob } = await createTwoUsers();
    await createEmail(bob.id, { threadId: 'thread-shared' });
    await createEmail(bob.id, { threadId: 'thread-other' });
    await shareThreadWith('thread-shared', bob.id, alice.id);

    expect(await canAccessThread('thread-shared', alice.id)).toBe(true);
    expect(await canAccessThread('thread-other', alice.id)).toBe(false);
  });
});

describe('getShared*Ids', () => {
  it('return only ids shared *with* the caller, not ids the caller shared out', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser({ name: 'Carol' });

    const inbound = await createTask(bob.id);
    await shareTaskWith(inbound.id, bob.id, alice.id);
    const outbound = await createTask(alice.id);
    await shareTaskWith(outbound.id, alice.id, carol.id);

    const inboundDeal = await createDeal(bob.id);
    await shareDealWith(inboundDeal.id, bob.id, alice.id);
    const outboundDeal = await createDeal(alice.id);
    await shareDealWith(outboundDeal.id, alice.id, carol.id);

    await createEmail(bob.id, { threadId: 'thread-inbound' });
    await shareThreadWith('thread-inbound', bob.id, alice.id);
    await createEmail(alice.id, { threadId: 'thread-outbound' });
    await shareThreadWith('thread-outbound', alice.id, carol.id);

    // Outbound shares must not appear: the caller already reaches those rows by
    // ownership, and including them here would widen every `id IN (...)` filter
    // that is built from this list.
    expect(await getSharedTaskIds(alice.id)).toEqual([inbound.id]);
    expect(await getSharedDealIds(alice.id)).toEqual([inboundDeal.id]);
    expect(await getSharedThreadIds(alice.id)).toEqual(['thread-inbound']);
  });

  it('return empty lists for a user with no shares', async () => {
    const { alice, bob } = await createTwoUsers();
    await createTask(bob.id);
    await createDeal(bob.id);
    await createEmail(bob.id, { threadId: 'thread-bob' });

    expect(await getSharedTaskIds(alice.id)).toEqual([]);
    expect(await getSharedDealIds(alice.id)).toEqual([]);
    expect(await getSharedThreadIds(alice.id)).toEqual([]);
  });
});
