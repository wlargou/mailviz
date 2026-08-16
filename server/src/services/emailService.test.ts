import { describe, it, expect } from 'vitest';
import { emailService } from './emailService.js';
import { createTwoUsers, createUser, createEmail, createCustomer, shareThreadWith } from '../test/factories.js';

/**
 * Multi-tenant isolation for the database-backed email queries.
 *
 * The search case here is a regression test for a REAL cross-tenant leak,
 * identical in shape to the one found in `dealService.findAll`.
 * `findAllThreads` built its where-clause as `{ ...ownershipFilter }`, and
 * `ownershipFilter` is `{ OR: [{ userId }, { threadId: { in: shared } }] }`
 * whenever the user has any shared thread — so the search branch's
 * `where.OR = [...]` replaced the ownership constraint outright. Any user with
 * a single shared thread who typed anything into the mail search box received
 * every user's mail: subjects, senders, snippets, attachment metadata.
 *
 * The fix mirrors dealService: the ownership filter now lives under `AND`,
 * where no later branch can assign over it.
 *
 * Only the DB-backed paths are covered (`findAllThreads`, `findThread`,
 * `findById`, `getUnreadCount`). Anything that reaches the Gmail API is out of
 * scope; `findById` is only ever called here for mail the caller does not own,
 * which is the branch that never triggers the on-demand body fetch.
 */

describe('emailService.findAllThreads — tenant isolation', () => {
  it('returns only threads the caller owns', async () => {
    const { alice, bob } = await createTwoUsers();
    await createEmail(alice.id, { subject: 'Alice mail' });
    await createEmail(bob.id, { subject: 'Bob mail' });

    const result = await emailService.findAllThreads({}, alice.id);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].latestEmail?.subject).toBe('Alice mail');
  });

  it('includes threads explicitly shared with the caller', async () => {
    const { alice, bob } = await createTwoUsers();
    await createEmail(bob.id, { threadId: 'thread-shared', subject: 'Shared with Alice' });
    await createEmail(bob.id, { threadId: 'thread-private', subject: 'Bob keeps this' });
    await shareThreadWith('thread-shared', bob.id, alice.id);

    const subjects = (await emailService.findAllThreads({}, alice.id)).data.map(
      (t) => t.latestEmail?.subject
    );

    expect(subjects).toContain('Shared with Alice');
    expect(subjects).not.toContain('Bob keeps this');
  });

  it('does not leak other users’ mail when searching — REGRESSION', async () => {
    const { alice, bob } = await createTwoUsers();

    // The trigger: Alice needs one shared thread, which turns the ownership
    // filter into an OR that the search branch used to overwrite.
    await createEmail(bob.id, { threadId: 'thread-shared', subject: 'Shared widget mail' });
    await shareThreadWith('thread-shared', bob.id, alice.id);

    await createEmail(alice.id, { threadId: 'thread-alice', subject: 'Alice widget mail' });
    await createEmail(bob.id, { threadId: 'thread-bob', subject: 'Bob secret widget mail' });

    const result = await emailService.findAllThreads({ search: 'widget' }, alice.id);
    const subjects = result.data.map((t) => t.latestEmail?.subject);

    expect(subjects).toContain('Alice widget mail');
    expect(subjects).toContain('Shared widget mail');
    // The bug: this used to appear.
    expect(subjects).not.toContain('Bob secret widget mail');
    expect(result.meta.total).toBe(2);
  });

  it('does not leak other users’ mail when search is combined with other filters', async () => {
    const { alice, bob } = await createTwoUsers();
    await createEmail(bob.id, { threadId: 'thread-shared', subject: 'Shared alpha', from: 'x@corp.test' });
    await shareThreadWith('thread-shared', bob.id, alice.id);
    await createEmail(alice.id, { threadId: 'thread-alice', subject: 'Alice alpha', from: 'x@corp.test' });
    await createEmail(bob.id, { threadId: 'thread-bob', subject: 'Bob alpha', from: 'x@corp.test' });

    type EmailQuery = Parameters<typeof emailService.findAllThreads>[0];
    const combinations: EmailQuery[] = [
      { search: 'alpha' },
      { search: 'alpha', folder: 'inbox' },
      { search: 'alpha', isRead: 'false' },
      { search: 'alpha', from: 'corp.test' },
      { search: 'alpha', subject: 'alpha' },
      { search: 'alpha', dateAfter: '2000-01-01T00:00:00.000Z' },
      { search: 'alpha', folder: 'trash' },
      { search: 'alpha', hasAttachment: 'true' },
      { search: 'alpha', from: 'corp.test', isRead: 'false', dateAfter: '2000-01-01T00:00:00.000Z' },
    ];

    for (const query of combinations) {
      const subjects = (await emailService.findAllThreads(query, alice.id)).data.map(
        (t) => t.latestEmail?.subject
      );
      expect(subjects, `leaked with query ${JSON.stringify(query)}`).not.toContain('Bob alpha');
    }
  });

  it('does not leak a third user’s mail to either party of a share', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser({ name: 'Carol' });
    await createEmail(bob.id, { threadId: 'thread-shared', subject: 'Bob shares report' });
    await shareThreadWith('thread-shared', bob.id, alice.id);
    await createEmail(carol.id, { threadId: 'thread-carol', subject: 'Carol private report' });

    const subjects = (await emailService.findAllThreads({ search: 'report' }, alice.id)).data.map(
      (t) => t.latestEmail?.subject
    );

    expect(subjects).toEqual(['Bob shares report']);
  });

  it('does not count another user’s messages in a shared thread’s message count', async () => {
    // Two users can hold their own Email rows for the same Gmail thread id.
    // The share is by thread id, so the thread aggregate must still respect
    // who owns which message.
    const { alice, bob } = await createTwoUsers();
    await createEmail(alice.id, { threadId: 'thread-x', subject: 'Alice copy' });
    await createEmail(bob.id, { threadId: 'thread-y', subject: 'Bob other thread' });

    const result = await emailService.findAllThreads({}, alice.id);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].messageCount).toBe(1);
  });

  it('excludes trashed mail by default and never widens past ownership in the trash folder', async () => {
    const { alice, bob } = await createTwoUsers();
    await createEmail(alice.id, { threadId: 'thread-a', subject: 'Alice trashed', isTrashed: true });
    await createEmail(bob.id, { threadId: 'thread-b', subject: 'Bob trashed', isTrashed: true });

    const inbox = await emailService.findAllThreads({}, alice.id);
    expect(inbox.data).toHaveLength(0);

    const trash = (await emailService.findAllThreads({ folder: 'trash' }, alice.id)).data.map(
      (t) => t.latestEmail?.subject
    );
    expect(trash).toEqual(['Alice trashed']);
  });
});

/**
 * The review flow (`ReviewMailView`) used to fetch `limit=500` once and then
 * group and unread-filter in the browser. `parsePagination` caps `limit` at
 * 100, so a wide review was quietly cut to the newest 100 threads, and the
 * unread toggle — applied after the fetch — could never recover a thread the
 * cap had already dropped. The flow now asks the server per company, with
 * `isRead=false` for the unread view and a real page number, which put three
 * things under test: the `none` sentinel for mail with no customer, that the
 * new branch cannot widen past ownership, and that paging returns every thread.
 */
describe('emailService.findAllThreads — customer scoping for the review flow', () => {
  it('returns only the caller’s uncategorized threads for customerId=none', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceCustomer = await createCustomer(alice.id);
    await createEmail(alice.id, { threadId: 'thread-a1', subject: 'Alice linked', customerId: aliceCustomer.id });
    await createEmail(alice.id, { threadId: 'thread-a2', subject: 'Alice unlinked' });
    await createEmail(bob.id, { threadId: 'thread-b1', subject: 'Bob unlinked' });

    const subjects = (await emailService.findAllThreads({ customerId: 'none' }, alice.id)).data.map(
      (t) => t.latestEmail?.subject
    );

    expect(subjects).toEqual(['Alice unlinked']);
  });

  it('does not hand over another user’s mail when asked for their customer id', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobCustomer = await createCustomer(bob.id);
    await createEmail(bob.id, { threadId: 'thread-b1', subject: 'Bob linked', customerId: bobCustomer.id });

    const result = await emailService.findAllThreads({ customerId: bobCustomer.id }, alice.id);

    expect(result.data).toHaveLength(0);
    expect(result.meta.total).toBe(0);
  });

  it('does not leak another user’s mail through the uncategorized bucket', async () => {
    const { alice, bob } = await createTwoUsers();
    // The trigger for the ownership-clobbering bug class: Alice holds a share,
    // so the ownership filter is itself an OR.
    await createEmail(bob.id, { threadId: 'thread-shared', subject: 'Shared unlinked' });
    await shareThreadWith('thread-shared', bob.id, alice.id);
    await createEmail(alice.id, { threadId: 'thread-alice', subject: 'Alice unlinked' });
    await createEmail(bob.id, { threadId: 'thread-bob', subject: 'Bob unlinked' });

    const aliceCustomer = await createCustomer(alice.id);
    type EmailQuery = Parameters<typeof emailService.findAllThreads>[0];
    const combinations: EmailQuery[] = [
      { customerId: 'none' },
      { customerId: 'none', isRead: 'false' },
      { customerId: `${aliceCustomer.id},none` },
      { customerId: `${aliceCustomer.id},none`, search: 'unlinked' },
      { customerId: `${aliceCustomer.id},none`, isRead: 'false', dateAfter: '2000-01-01T00:00:00.000Z' },
    ];

    for (const query of combinations) {
      const subjects = (await emailService.findAllThreads(query, alice.id)).data.map(
        (t) => t.latestEmail?.subject
      );
      expect(subjects, `leaked with query ${JSON.stringify(query)}`).not.toContain('Bob unlinked');
    }
  });

  it('keeps the customer scope when a search is also present — REGRESSION', async () => {
    // The uncategorized branch needs its own OR. Assigning it to `where.OR`
    // would work in isolation and then be overwritten by the search branch
    // further down, quietly widening the review to every company. It is pushed
    // onto the AND list instead.
    const { alice } = await createTwoUsers();
    const wanted = await createCustomer(alice.id);
    const other = await createCustomer(alice.id);
    await createEmail(alice.id, { threadId: 'thread-1', subject: 'Wanted widget', customerId: wanted.id });
    await createEmail(alice.id, { threadId: 'thread-2', subject: 'Other widget', customerId: other.id });
    await createEmail(alice.id, { threadId: 'thread-3', subject: 'Unlinked widget' });

    const subjects = (
      await emailService.findAllThreads({ customerId: `${wanted.id},none`, search: 'widget' }, alice.id)
    ).data.map((t) => t.latestEmail?.subject);

    expect(subjects.sort()).toEqual(['Unlinked widget', 'Wanted widget']);
    // The bug: this used to come back too.
    expect(subjects).not.toContain('Other widget');
  });

  it('filters unread server-side rather than over an already-paged result', async () => {
    const { alice } = await createTwoUsers();
    await createEmail(alice.id, { threadId: 'thread-read', subject: 'Read one', isRead: true });
    await createEmail(alice.id, { threadId: 'thread-unread', subject: 'Unread one', isRead: false });

    const result = await emailService.findAllThreads({ isRead: 'false' }, alice.id);

    expect(result.data.map((t) => t.latestEmail?.subject)).toEqual(['Unread one']);
    expect(result.meta.total).toBe(1);
  });
});

describe('emailService.findAllThreads — pagination', () => {
  it('reports the full total and reaches every thread across pages', async () => {
    const { alice } = await createTwoUsers();
    const base = new Date('2024-03-01T00:00:00.000Z').getTime();
    for (let i = 0; i < 5; i++) {
      await createEmail(alice.id, {
        threadId: `thread-${i}`,
        subject: `Mail ${i}`,
        receivedAt: new Date(base + i * 60_000),
      });
    }

    const first = await emailService.findAllThreads({ limit: '2', page: '1' }, alice.id);
    expect(first.data).toHaveLength(2);
    // The count is of all matching threads, not of the page — this is what the
    // "showing X of Y" line in the review header reads.
    expect(first.meta.total).toBe(5);
    expect(first.meta.totalPages).toBe(3);

    const seen = new Set<string | null>(first.data.map((t) => t.threadId));
    for (const page of ['2', '3']) {
      const res = await emailService.findAllThreads({ limit: '2', page }, alice.id);
      res.data.forEach((t) => seen.add(t.threadId));
    }

    expect(seen.size).toBe(5);
  });

  it('caps limit at 100 — the review’s old limit=500 was never honoured', async () => {
    const { alice } = await createTwoUsers();
    await createEmail(alice.id, { subject: 'Only one' });

    const result = await emailService.findAllThreads({ limit: '500' }, alice.id);

    expect(result.meta.limit).toBe(100);
  });

  it('does not leak another user’s threads on a later page', async () => {
    const { alice, bob } = await createTwoUsers();
    for (let i = 0; i < 3; i++) {
      await createEmail(alice.id, { threadId: `alice-${i}`, subject: `Alice ${i}` });
      await createEmail(bob.id, { threadId: `bob-${i}`, subject: `Bob ${i}` });
    }

    for (const page of ['1', '2', '3']) {
      const subjects = (await emailService.findAllThreads({ limit: '1', page }, alice.id)).data.map(
        (t) => t.latestEmail?.subject
      );
      expect(subjects.every((s) => s?.startsWith('Alice')), `page ${page}: ${subjects}`).toBe(true);
    }
  });
});

describe('emailService.getReviewSummary', () => {
  const WINDOW = {
    after: '2024-01-01T00:00:00.000Z',
    before: '2024-12-31T23:59:59.999Z',
  };
  const inWindow = new Date('2024-06-01T12:00:00.000Z');

  it('counts only the caller’s mail', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceCustomer = await createCustomer(alice.id, { name: 'Acme' });
    const bobCustomer = await createCustomer(bob.id, { name: 'Initech' });
    await createEmail(alice.id, { customerId: aliceCustomer.id, receivedAt: inWindow });
    await createEmail(bob.id, { customerId: bobCustomer.id, receivedAt: inWindow });
    await createEmail(bob.id, { receivedAt: inWindow });

    const summary = await emailService.getReviewSummary(WINDOW.after, WINDOW.before, alice.id);

    expect(summary.data.map((c) => c.customerName)).toEqual(['Acme']);
    expect(summary.uncategorized.totalEmails).toBe(0);
    expect(summary.uncategorized.totalThreads).toBe(0);
  });

  it('counts distinct threads separately from messages', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { name: 'Acme' });
    // One three-message thread, one of them unread.
    await createEmail(alice.id, { threadId: 'thread-x', customerId: customer.id, isRead: true, receivedAt: inWindow });
    await createEmail(alice.id, { threadId: 'thread-x', customerId: customer.id, isRead: true, receivedAt: inWindow });
    await createEmail(alice.id, { threadId: 'thread-x', customerId: customer.id, isRead: false, receivedAt: inWindow });

    const summary = await emailService.getReviewSummary(WINDOW.after, WINDOW.before, alice.id);
    const acme = summary.data.find((c) => c.customerName === 'Acme');

    expect(acme?.totalEmails).toBe(3);
    expect(acme?.totalThreads).toBe(1);
    expect(acme?.unreadEmails).toBe(1);
    expect(acme?.unreadThreads).toBe(1);
  });

  it('thread counts match what the paged list reports as its total', async () => {
    // Requirement of the grouped review view: the per-company header count and
    // the "showing X of Y" line must be the same aggregate, or the header is a
    // lie the moment paging starts.
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { name: 'Acme' });
    for (let i = 0; i < 4; i++) {
      await createEmail(alice.id, {
        threadId: `acme-${i}`,
        customerId: customer.id,
        isRead: i % 2 === 0,
        receivedAt: inWindow,
      });
      // Second message in the same thread — must not inflate the thread count.
      await createEmail(alice.id, { threadId: `acme-${i}`, customerId: customer.id, isRead: true, receivedAt: inWindow });
    }
    for (let i = 0; i < 2; i++) {
      await createEmail(alice.id, { threadId: `loose-${i}`, isRead: false, receivedAt: inWindow });
    }

    const summary = await emailService.getReviewSummary(WINDOW.after, WINDOW.before, alice.id);
    const acme = summary.data.find((c) => c.customerName === 'Acme');

    const listed = await emailService.findAllThreads(
      { customerId: customer.id, dateAfter: WINDOW.after, dateBefore: WINDOW.before, limit: '2' },
      alice.id
    );
    const listedUnread = await emailService.findAllThreads(
      { customerId: customer.id, dateAfter: WINDOW.after, dateBefore: WINDOW.before, isRead: 'false', limit: '2' },
      alice.id
    );
    const listedUncategorized = await emailService.findAllThreads(
      { customerId: 'none', dateAfter: WINDOW.after, dateBefore: WINDOW.before, limit: '1' },
      alice.id
    );

    expect(acme?.totalThreads).toBe(listed.meta.total);
    expect(acme?.unreadThreads).toBe(listedUnread.meta.total);
    expect(summary.uncategorized.totalThreads).toBe(listedUncategorized.meta.total);
    // …and the page itself is smaller than the total, which is the case the
    // header count exists to describe.
    expect(listed.data.length).toBeLessThan(listed.meta.total);
  });

  it('ignores mail outside the window and mail in the trash', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { name: 'Acme' });
    await createEmail(alice.id, { threadId: 'keep', customerId: customer.id, receivedAt: inWindow });
    await createEmail(alice.id, { threadId: 'old', customerId: customer.id, receivedAt: new Date('2023-01-01T00:00:00.000Z') });
    await createEmail(alice.id, { threadId: 'gone', customerId: customer.id, isTrashed: true, receivedAt: inWindow });

    const summary = await emailService.getReviewSummary(WINDOW.after, WINDOW.before, alice.id);
    const acme = summary.data.find((c) => c.customerName === 'Acme');

    expect(acme?.totalEmails).toBe(1);
    expect(acme?.totalThreads).toBe(1);
  });
});

describe('emailService.findThread — tenant isolation', () => {
  it('refuses to return another user’s thread', async () => {
    const { alice, bob } = await createTwoUsers();
    await createEmail(bob.id, { threadId: 'thread-bob', subject: 'Bob only' });

    await expect(emailService.findThread('thread-bob', alice.id)).rejects.toThrow(/not found/i);
  });

  it('returns a thread shared with the caller', async () => {
    const { alice, bob } = await createTwoUsers();
    await createEmail(bob.id, { threadId: 'thread-shared', subject: 'Shared' });
    await shareThreadWith('thread-shared', bob.id, alice.id);

    const emails = await emailService.findThread('thread-shared', alice.id);

    expect(emails.map((e) => e.subject)).toEqual(['Shared']);
  });

  it('a share to one user does not grant access to a third user', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser({ name: 'Carol' });
    await createEmail(bob.id, { threadId: 'thread-shared', subject: 'Shared' });
    await shareThreadWith('thread-shared', bob.id, alice.id);

    await expect(emailService.findThread('thread-shared', carol.id)).rejects.toThrow(/not found/i);
  });
});

describe('emailService.findById — tenant isolation', () => {
  it('refuses to return another user’s email', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobEmail = await createEmail(bob.id, { subject: 'Bob only' });

    await expect(emailService.findById(bobEmail.id, alice.id)).rejects.toThrow(/not found/i);
  });

  it('returns an email whose thread was shared with the caller', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobEmail = await createEmail(bob.id, { threadId: 'thread-shared', subject: 'Shared' });
    await shareThreadWith('thread-shared', bob.id, alice.id);

    const email = await emailService.findById(bobEmail.id, alice.id);

    expect(email.subject).toBe('Shared');
  });
});

describe('emailService.getUnreadCount — tenant isolation', () => {
  it('counts only mail the caller can see', async () => {
    const { alice, bob } = await createTwoUsers();
    await createEmail(alice.id, { subject: 'Alice unread', isRead: false });
    await createEmail(bob.id, { subject: 'Bob unread one', isRead: false });
    await createEmail(bob.id, { subject: 'Bob unread two', isRead: false });

    const count = await emailService.getUnreadCount(alice.id);

    expect(count).toBe(1);
  });
});
