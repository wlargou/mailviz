import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers } from '../test/factories.js';

/**
 * Every "unique" in this schema must be unique *per user*, not globally.
 *
 * REGRESSION. `20260320060000_add_user_scoping` set out to replace six global
 * uniques with compound `(user_id, x)` ones. It dropped the old ones with
 * `ALTER TABLE ... DROP CONSTRAINT IF EXISTS "<name>_key"` — but every one of
 * them had been created with `CREATE UNIQUE INDEX`, which in Postgres makes an
 * index and not a table constraint. DROP CONSTRAINT matched nothing, IF EXISTS
 * swallowed the miss, and all six global uniques survived the migration that
 * was named after removing them. `prisma migrate deploy` reported success and
 * schema.prisma showed only the compound uniques, so nothing pointed at it.
 *
 * The consequence is cross-tenant even though no data leaks: whichever user
 * gets there first takes the value away from everyone else. The second user to
 * sync a shared meeting, to name a label "Urgent", or to be assigned a company
 * domain another user already had, simply fails.
 *
 * `20260816120000_drop_pre_user_scoping_unique_indexes` drops them with DROP
 * INDEX. These tests are the check that they are actually gone — they assert
 * behaviour (two users, same value, both writes succeed) rather than reading
 * pg_index, because the behaviour is the thing that broke.
 */
describe('per-user uniqueness', () => {
  it('two users can each own a customer for the same domain', async () => {
    const { alice, bob } = await createTwoUsers();

    await prisma.customer.create({ data: { userId: alice.id, name: 'Alice Corp', domain: 'acme.test' } });
    await prisma.customer.create({ data: { userId: bob.id, name: 'Bob Corp', domain: 'acme.test' } });

    expect(await prisma.customer.count({ where: { domain: 'acme.test' } })).toBe(2);
  });

  it('rejects a duplicate domain within a single user', async () => {
    const { alice } = await createTwoUsers();
    await prisma.customer.create({ data: { userId: alice.id, name: 'One', domain: 'acme.test' } });

    await expect(
      prisma.customer.create({ data: { userId: alice.id, name: 'Two', domain: 'acme.test' } })
    ).rejects.toThrow();
  });

  it('two users can each have a task status with the same name', async () => {
    // This one blocks onboarding outright: the app creates the default
    // statuses ("TODO", "IN_PROGRESS", ...) per user, so under a global unique
    // every user after the first gets an unusable Kanban board.
    const { alice, bob } = await createTwoUsers();

    await prisma.taskStatus.create({ data: { userId: alice.id, name: 'TODO', label: 'To Do' } });
    await prisma.taskStatus.create({ data: { userId: bob.id, name: 'TODO', label: 'To Do' } });

    expect(await prisma.taskStatus.count({ where: { name: 'TODO' } })).toBe(2);
  });

  it('two users can each have a company category with the same name', async () => {
    const { alice, bob } = await createTwoUsers();

    await prisma.companyCategory.create({ data: { userId: alice.id, name: 'PARTNER', label: 'Partner' } });
    await prisma.companyCategory.create({ data: { userId: bob.id, name: 'PARTNER', label: 'Partner' } });

    expect(await prisma.companyCategory.count({ where: { name: 'PARTNER' } })).toBe(2);
  });

  it('two users can each have a label with the same name', async () => {
    const { alice, bob } = await createTwoUsers();

    await prisma.label.create({ data: { userId: alice.id, name: 'Urgent', color: '#da1e28' } });
    await prisma.label.create({ data: { userId: bob.id, name: 'Urgent', color: '#0f62fe' } });

    expect(await prisma.label.count({ where: { name: 'Urgent' } })).toBe(2);
  });

  it('two users can each sync the same Google calendar event', async () => {
    // googleEventId is shared by every attendee of a meeting, so this is the
    // ordinary case of two colleagues invited to the same event — not an edge.
    const { alice, bob } = await createTwoUsers();
    const start = new Date('2026-01-01T10:00:00.000Z');
    const end = new Date('2026-01-01T11:00:00.000Z');

    await prisma.calendarEvent.create({
      data: { userId: alice.id, googleEventId: 'evt-shared', title: 'Standup', startTime: start, endTime: end },
    });
    await prisma.calendarEvent.create({
      data: { userId: bob.id, googleEventId: 'evt-shared', title: 'Standup', startTime: start, endTime: end },
    });

    expect(await prisma.calendarEvent.count({ where: { googleEventId: 'evt-shared' } })).toBe(2);
  });

  it('two users can each hold a copy of the same Gmail message id', async () => {
    const { alice, bob } = await createTwoUsers();
    const base = { gmailMessageId: 'msg-shared', subject: 'Hello', from: 'x@corp.test', receivedAt: new Date() };

    await prisma.email.create({ data: { ...base, userId: alice.id } });
    await prisma.email.create({ data: { ...base, userId: bob.id } });

    expect(await prisma.email.count({ where: { gmailMessageId: 'msg-shared' } })).toBe(2);
  });
});
