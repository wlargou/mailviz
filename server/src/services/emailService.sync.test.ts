import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { getGmailClient } from '../lib/gmail.js';
import { env } from '../config/env.js';
import { emailService } from './emailService.js';
import { createUser, createTwoUsers, createEmail, createGoogleAuth } from '../test/factories.js';
import {
  createGmailMock,
  gmailError,
  historyExpiredError,
  historyPage,
  historyParams,
  insufficientScopeError,
  labelsAdded,
  labelsRemoved,
  listParams,
  listPage,
  messageAdded,
  messageDeleted,
  calledMessageIds,
  rateLimitedError,
  stubMessagesGet,
  stubMessagesListPages,
  type GmailMock,
} from '../test/gmailMock.js';

/**
 * The Gmail-dependent paths of emailService: sync and the batch operations.
 *
 * These were the largest untested surface in the app, and the riskiest — they
 * are the only code that both talks to Google and writes to every user's
 * mailbox rows, and they run unattended on a 60s scheduler where nobody is
 * watching the result.
 *
 * The mock seam is `lib/gmail.ts#getGmailClient`. Every Gmail call in the app
 * goes through it (that is also where the per-user rate limiter is applied), so
 * replacing that single module swaps out the whole Google surface with no
 * production code aware of it. Everything below the seam — Prisma, customer
 * auto-linking, the label bookkeeping — is the real thing running against the
 * real test database, because the bugs worth catching here live in the
 * interaction between the API response and what gets written.
 *
 * The `— REGRESSION` case at the top is the reason this file exists.
 */

vi.mock('../lib/gmail.js', () => ({ getGmailClient: vi.fn() }));

let gmail: GmailMock;
const originalEnv = {
  EMAIL_SYNC_MONTHS: env.EMAIL_SYNC_MONTHS,
  SYNC_CATCHUP_DAYS: env.SYNC_CATCHUP_DAYS,
};

beforeEach(() => {
  gmail = createGmailMock();
  vi.mocked(getGmailClient).mockResolvedValue(gmail.client);
});

afterEach(() => {
  vi.mocked(getGmailClient).mockReset();
  env.EMAIL_SYNC_MONTHS = originalEnv.EMAIL_SYNC_MONTHS;
  env.SYNC_CATCHUP_DAYS = originalEnv.SYNC_CATCHUP_DAYS;
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. History expiry catch-up
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Gmail answers 404 when the stored `startHistoryId` is older than its history
 * retention window (roughly a week). That is routine — it happens after any
 * longish gap, a server restart, a paused account — and it is not a condition
 * this app controls.
 *
 * It used to fall through to a full `initialSync`. `initialSync` only applies a
 * date filter when `EMAIL_SYNC_MONTHS > 0`, and that variable defaults to 0,
 * meaning "the entire mailbox". So a routine, externally-triggered 404 caused a
 * re-list and re-fetch of every message on the account — 111k messages on the
 * real dataset, at Gmail quota cost, on a 60s scheduler.
 *
 * The fix bounds the catch-up with `env.SYNC_CATCHUP_DAYS`. The assertion that
 * matters is the shape of the `messages.list` query: it must carry a `q`, and
 * that `q` must be the day window.
 */
describe('emailService.incrementalSync — bounded history-expiry catch-up', () => {
  it('catches up over a bounded window instead of re-listing the whole mailbox — REGRESSION', async () => {
    const user = await createUser();
    // The exact configuration that made the old bug maximally expensive:
    // "sync everything, no date filter".
    env.EMAIL_SYNC_MONTHS = 0;

    gmail.historyList.mockRejectedValue(historyExpiredError());
    gmail.messagesList.mockResolvedValue(listPage([]));

    await emailService.incrementalSync(gmail.client, '900', user.id);

    expect(gmail.messagesList).toHaveBeenCalledTimes(1);
    expect(listParams(gmail.messagesList).q).toBe('newer_than:7d');

    // The regression itself: an unbounded list has no `q` at all. Not one call
    // may be missing it, however many pages the catch-up walks.
    for (const call of gmail.messagesList.mock.calls) {
      expect((call[0] as { q?: string })?.q).toBeDefined();
    }
  });

  it('does not let EMAIL_SYNC_MONTHS widen the catch-up window', async () => {
    const user = await createUser();
    // Even with a generous months setting, the catch-up stays at the day window
    // — it is recovering a lost history feed, not doing a first-time import.
    env.EMAIL_SYNC_MONTHS = 24;

    gmail.historyList.mockRejectedValue(historyExpiredError());
    gmail.messagesList.mockResolvedValue(listPage([]));

    await emailService.incrementalSync(gmail.client, '900', user.id);

    expect(listParams(gmail.messagesList).q).toBe('newer_than:7d');
    expect(listParams(gmail.messagesList).q).not.toBe('newer_than:24m');
  });

  it('honours SYNC_CATCHUP_DAYS', async () => {
    const user = await createUser();
    env.SYNC_CATCHUP_DAYS = 3;

    gmail.historyList.mockRejectedValue(historyExpiredError());
    gmail.messagesList.mockResolvedValue(listPage([]));

    await emailService.incrementalSync(gmail.client, '900', user.id);

    expect(listParams(gmail.messagesList).q).toBe('newer_than:3d');
  });

  it('actually imports the messages the catch-up finds', async () => {
    const user = await createUser();
    gmail.historyList.mockRejectedValue(historyExpiredError());
    gmail.messagesList.mockResolvedValue(listPage(['c1', 'c2']));
    stubMessagesGet(gmail, [
      { id: 'c1', subject: 'Caught up one' },
      { id: 'c2', subject: 'Caught up two' },
    ]);

    const result = await emailService.incrementalSync(gmail.client, '900', user.id);

    expect(result.synced).toBe(2);
    const subjects = (await prisma.email.findMany({ where: { userId: user.id } })).map((e) => e.subject);
    expect(subjects.sort()).toEqual(['Caught up one', 'Caught up two']);
  });

  it('rethrows non-404 history failures rather than falling back to a re-list', async () => {
    const user = await createUser();
    gmail.historyList.mockRejectedValue(gmailError(500, 'Backend error'));

    await expect(emailService.incrementalSync(gmail.client, '900', user.id)).rejects.toThrow(/backend error/i);
    expect(gmail.messagesList).not.toHaveBeenCalled();
  });

  it('counts mail imported before the history id expired — REGRESSION', async () => {
    // The 404 handler used to `return { ...result, labelsChanged: 0 }`, which
    // replaced the counters accumulated from earlier history pages with only the
    // catch-up's. The mail was in the database but `synced` came back 0.
    //
    // That mattered because jobs/emailSyncScheduler.ts only broadcasts
    // `emails:synced` when a counter is non-zero — so new mail landed and every
    // open client was told nothing had changed.
    const user = await createUser();
    gmail.historyList
      .mockResolvedValueOnce(historyPage([messageAdded('p1')], 'history-page-2'))
      .mockRejectedValueOnce(historyExpiredError());
    gmail.messagesList.mockResolvedValue(listPage([]));
    stubMessagesGet(gmail, [{ id: 'p1', subject: 'Imported before the expiry' }]);

    const result = await emailService.incrementalSync(gmail.client, '100', user.id);

    expect(await prisma.email.count({ where: { userId: user.id } })).toBe(1);
    // The bug: this used to be 0, so the scheduler stayed silent.
    expect(result.synced).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Incremental sync
// ─────────────────────────────────────────────────────────────────────────────

describe('emailService.incrementalSync', () => {
  it('upserts mail arriving via messagesAdded', async () => {
    const user = await createUser();
    gmail.historyList.mockResolvedValue(historyPage([messageAdded('m1')]));
    stubMessagesGet(gmail, [
      { id: 'm1', subject: 'Fresh mail', from: 'ops@acme-corp.test', threadId: 'thread-1' },
    ]);

    const result = await emailService.incrementalSync(gmail.client, '100', user.id);

    expect(result.synced).toBe(1);
    const stored = await prisma.email.findFirst({ where: { userId: user.id, gmailMessageId: 'm1' } });
    expect(stored?.subject).toBe('Fresh mail');
    expect(stored?.from).toBe('ops@acme-corp.test');
    expect(stored?.threadId).toBe('thread-1');
  });

  it('passes the stored history id and the label history types to Gmail', async () => {
    const user = await createUser();

    await emailService.incrementalSync(gmail.client, '4242', user.id);

    const params = historyParams(gmail.historyList);
    expect(params.startHistoryId).toBe('4242');
    expect(params.historyTypes).toEqual(
      expect.arrayContaining(['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'])
    );
  });

  it('applies labelAdded to read, starred and trashed state', async () => {
    const user = await createUser();
    await createEmail(user.id, {
      gmailMessageId: 'm1',
      isRead: true,
      isStarred: false,
      isTrashed: false,
      labelIds: ['INBOX'],
    });

    gmail.historyList.mockResolvedValue(
      historyPage([labelsAdded('m1', ['UNREAD', 'STARRED', 'TRASH'])])
    );

    const result = await emailService.incrementalSync(gmail.client, '100', user.id);

    const stored = await prisma.email.findFirstOrThrow({ where: { userId: user.id, gmailMessageId: 'm1' } });
    expect(stored.isRead).toBe(false);
    expect(stored.isStarred).toBe(true);
    expect(stored.isTrashed).toBe(true);
    expect(stored.labelIds).toEqual(expect.arrayContaining(['INBOX', 'UNREAD', 'STARRED', 'TRASH']));
    expect(result.labelsChanged).toBe(1);
  });

  it('applies labelRemoved to read, starred and archived state', async () => {
    const user = await createUser();
    await createEmail(user.id, {
      gmailMessageId: 'm1',
      isRead: false,
      isStarred: true,
      isArchived: false,
      labelIds: ['INBOX', 'UNREAD', 'STARRED'],
    });

    gmail.historyList.mockResolvedValue(
      historyPage([labelsRemoved('m1', ['UNREAD', 'STARRED', 'INBOX'])])
    );

    const result = await emailService.incrementalSync(gmail.client, '100', user.id);

    const stored = await prisma.email.findFirstOrThrow({ where: { userId: user.id, gmailMessageId: 'm1' } });
    expect(stored.isRead).toBe(true);
    expect(stored.isStarred).toBe(false);
    // Removing INBOX is how Gmail represents an archive.
    expect(stored.isArchived).toBe(true);
    expect(stored.labelIds).toEqual([]);
    expect(result.labelsChanged).toBe(1);
  });

  it('removes mail reported as deleted', async () => {
    const user = await createUser();
    await createEmail(user.id, { gmailMessageId: 'm1' });

    gmail.historyList.mockResolvedValue(historyPage([messageDeleted('m1')]));
    await emailService.incrementalSync(gmail.client, '100', user.id);

    expect(await prisma.email.count({ where: { userId: user.id, gmailMessageId: 'm1' } })).toBe(0);
  });

  it('never applies one user’s label history to another user’s copy of the message', async () => {
    // Two users can legitimately hold rows for the same Gmail message id — a
    // thread both were on. Alice's history feed must not rewrite Bob's row.
    const { alice, bob } = await createTwoUsers();
    await createEmail(alice.id, { gmailMessageId: 'shared-msg', isRead: true });
    await createEmail(bob.id, { gmailMessageId: 'shared-msg', isRead: true });

    gmail.historyList.mockResolvedValue(historyPage([labelsAdded('shared-msg', ['UNREAD'])]));
    await emailService.incrementalSync(gmail.client, '100', alice.id);

    const aliceCopy = await prisma.email.findFirstOrThrow({ where: { userId: alice.id } });
    const bobCopy = await prisma.email.findFirstOrThrow({ where: { userId: bob.id } });
    expect(aliceCopy.isRead).toBe(false);
    expect(bobCopy.isRead).toBe(true);
  });

  it('keeps going when one messages.get rejects', async () => {
    const user = await createUser();
    gmail.historyList.mockResolvedValue(
      historyPage([messageAdded('good-1'), messageAdded('gone'), messageAdded('good-2')])
    );
    stubMessagesGet(
      gmail,
      [
        { id: 'good-1', subject: 'Kept one' },
        { id: 'good-2', subject: 'Kept two' },
      ],
      { gone: gmailError(404, 'Requested entity was not found.', ['notFound']) }
    );

    const result = await emailService.incrementalSync(gmail.client, '100', user.id);

    expect(result.synced).toBe(2);
    const subjects = (await prisma.email.findMany({ where: { userId: user.id } })).map((e) => e.subject);
    expect(subjects.sort()).toEqual(['Kept one', 'Kept two']);
  });

  it('does not mistake a 404 from messages.get for an expired history id', async () => {
    // Both failures carry code 404. Only the one from `history.list` means the
    // history token expired; a per-message 404 just means that message is gone.
    // Confusing the two would trigger a full catch-up re-list on every deleted
    // message.
    const user = await createUser();
    gmail.historyList.mockResolvedValue(historyPage([messageAdded('gone')]));
    stubMessagesGet(gmail, [], { gone: gmailError(404, 'Not found', ['notFound']) });

    await emailService.incrementalSync(gmail.client, '100', user.id);

    expect(gmail.messagesList).not.toHaveBeenCalled();
  });

  it('follows nextPageToken through the history feed', async () => {
    const user = await createUser();
    gmail.historyList
      .mockResolvedValueOnce(historyPage([messageAdded('p1')], 'history-page-2'))
      .mockResolvedValueOnce(historyPage([messageAdded('p2')]));
    stubMessagesGet(gmail, [
      { id: 'p1', subject: 'Page one mail' },
      { id: 'p2', subject: 'Page two mail' },
    ]);

    const result = await emailService.incrementalSync(gmail.client, '100', user.id);

    expect(gmail.historyList).toHaveBeenCalledTimes(2);
    expect(historyParams(gmail.historyList, 0).pageToken).toBeUndefined();
    expect(historyParams(gmail.historyList, 1).pageToken).toBe('history-page-2');
    expect(result.synced).toBe(2);
    const subjects = (await prisma.email.findMany({ where: { userId: user.id } })).map((e) => e.subject);
    expect(subjects.sort()).toEqual(['Page one mail', 'Page two mail']);
  });

  it('agrees with upsertMessage about isArchived for trashed mail — REGRESSION', async () => {
    // Gmail expresses "trash this" as one history record that removes INBOX and
    // adds TRASH. The two code paths that translate labels into flags then
    // disagree:
    //
    //   upsertMessage (full sync):  isArchived = !INBOX && !TRASH  → false
    //   the labelsRemoved handler:  INBOX removed                  → true
    //
    // So the same message is archived-or-not depending on which path last
    // touched it. It stays hidden while `isTrashed` is true, but `untrash()`
    // clears only `isTrashed` — so a trash-then-restore round trip leaves the
    // message flagged archived and it never comes back to the inbox view,
    // even though Gmail itself restored the INBOX label.
    //
    // The fix is for the labelsRemoved handler to apply the same rule as
    // upsertMessage rather than setting isArchived from INBOX alone.
    const user = await createUser();
    await createEmail(user.id, { gmailMessageId: 'm1', labelIds: ['INBOX'], isArchived: false });

    gmail.historyList.mockResolvedValue(
      historyPage([
        {
          id: 'h1',
          labelsAdded: [{ message: { id: 'm1' }, labelIds: ['TRASH'] }],
          labelsRemoved: [{ message: { id: 'm1' }, labelIds: ['INBOX'] }],
        },
      ])
    );

    await emailService.incrementalSync(gmail.client, '100', user.id);

    const stored = await prisma.email.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.isTrashed).toBe(true);
    // The bug: this used to be true. A trashed message is not an archived one.
    expect(stored.isArchived).toBe(false);
  });

  it('restores a trashed message to the inbox, not to archive — REGRESSION', async () => {
    // The round trip the bug above actually broke. `untrash()` clears only
    // `isTrashed`, so once isArchived was wrongly stuck true the message never
    // reappeared in the inbox view even though Gmail had restored INBOX.
    const user = await createUser();
    await createEmail(user.id, { gmailMessageId: 'm1', labelIds: ['INBOX'], isArchived: false });

    gmail.historyList.mockResolvedValueOnce(
      historyPage([
        {
          id: 'h1',
          labelsAdded: [{ message: { id: 'm1' }, labelIds: ['TRASH'] }],
          labelsRemoved: [{ message: { id: 'm1' }, labelIds: ['INBOX'] }],
        },
      ])
    );
    await emailService.incrementalSync(gmail.client, '100', user.id);

    gmail.historyList.mockResolvedValueOnce(
      historyPage([
        {
          id: 'h2',
          labelsAdded: [{ message: { id: 'm1' }, labelIds: ['INBOX'] }],
          labelsRemoved: [{ message: { id: 'm1' }, labelIds: ['TRASH'] }],
        },
      ])
    );
    await emailService.incrementalSync(gmail.client, '101', user.id);

    const stored = await prisma.email.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.isTrashed).toBe(false);
    expect(stored.isArchived).toBe(false);
    expect(stored.labelIds).toContain('INBOX');
  });

  it('auto-links imported mail to a customer derived from the sender domain', async () => {
    const user = await createUser();
    gmail.historyList.mockResolvedValue(historyPage([messageAdded('m1')]));
    stubMessagesGet(gmail, [{ id: 'm1', from: 'billing@northwind-test.example', to: ['me@example.com'] }]);

    const result = await emailService.incrementalSync(gmail.client, '100', user.id);

    expect(result.customersCreated).toBeGreaterThanOrEqual(1);
    const stored = await prisma.email.findFirstOrThrow({ where: { userId: user.id, gmailMessageId: 'm1' } });
    expect(stored.customerId).not.toBeNull();
    const customer = await prisma.customer.findFirstOrThrow({ where: { userId: user.id } });
    expect(customer.domain).toBe('northwind-test.example');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Initial sync
// ─────────────────────────────────────────────────────────────────────────────

describe('emailService.initialSync', () => {
  it('omits the query entirely when EMAIL_SYNC_MONTHS is 0', async () => {
    const user = await createUser();
    env.EMAIL_SYNC_MONTHS = 0;

    await emailService.initialSync(gmail.client, user.id);

    // 0 means "the whole mailbox" — deliberate for a first-time import, and the
    // reason the history-expiry fallback above had to stop reaching this path.
    expect(listParams(gmail.messagesList).q).toBeUndefined();
  });

  it('honours EMAIL_SYNC_MONTHS when it is set', async () => {
    const user = await createUser();
    env.EMAIL_SYNC_MONTHS = 6;

    await emailService.initialSync(gmail.client, user.id);

    expect(listParams(gmail.messagesList).q).toBe('newer_than:6m');
  });

  it('lets an explicit windowDays override the months setting', async () => {
    const user = await createUser();
    env.EMAIL_SYNC_MONTHS = 6;

    await emailService.initialSync(gmail.client, user.id, 7);

    expect(listParams(gmail.messagesList).q).toBe('newer_than:7d');
  });

  it('walks every page of message ids and fetches all of them', async () => {
    const user = await createUser();
    stubMessagesListPages(gmail, [['a1', 'a2'], ['b1']]);
    stubMessagesGet(gmail, [
      { id: 'a1', subject: 'A one' },
      { id: 'a2', subject: 'A two' },
      { id: 'b1', subject: 'B one' },
    ]);

    const result = await emailService.initialSync(gmail.client, user.id);

    expect(gmail.messagesList).toHaveBeenCalledTimes(2);
    expect(listParams(gmail.messagesList, 1).pageToken).toBe('page-1');
    expect(result.synced).toBe(3);
    expect(calledMessageIds(gmail.messagesGet).sort()).toEqual(['a1', 'a2', 'b1']);
    expect(await prisma.email.count({ where: { userId: user.id } })).toBe(3);
  });

  it('skips messages whose fetch fails without aborting the import', async () => {
    const user = await createUser();
    stubMessagesListPages(gmail, [['ok', 'bad']]);
    stubMessagesGet(gmail, [{ id: 'ok', subject: 'Imported' }], {
      bad: gmailError(500, 'Backend error'),
    });

    const result = await emailService.initialSync(gmail.client, user.id);

    expect(result.synced).toBe(1);
    const subjects = (await prisma.email.findMany({ where: { userId: user.id } })).map((e) => e.subject);
    expect(subjects).toEqual(['Imported']);
  });

  it('translates Gmail labels into the stored read/starred/archived flags', async () => {
    const user = await createUser();
    stubMessagesListPages(gmail, [['m1', 'm2']]);
    stubMessagesGet(gmail, [
      { id: 'm1', labelIds: ['INBOX', 'UNREAD'] },
      { id: 'm2', labelIds: ['STARRED'] },
    ]);

    await emailService.initialSync(gmail.client, user.id);

    const inboxMail = await prisma.email.findFirstOrThrow({ where: { userId: user.id, gmailMessageId: 'm1' } });
    expect(inboxMail.isRead).toBe(false);
    expect(inboxMail.isArchived).toBe(false);

    const starred = await prisma.email.findFirstOrThrow({ where: { userId: user.id, gmailMessageId: 'm2' } });
    expect(starred.isStarred).toBe(true);
    expect(starred.isRead).toBe(true);
    // No INBOX and no TRASH label is what "archived" means in Gmail.
    expect(starred.isArchived).toBe(true);
  });

  it('stores the Gmail subject and snippet verbatim, entities and all', async () => {
    // The Email row is a mirror of a remote system of record, and that is the
    // invariant that makes the upsert safely re-runnable. Decoding here would
    // be irreversible — there is no raw column to recover from — and would put
    // ~132k production rows on the wrong side of a split that no single date
    // explains, because a history-id expiry silently re-syncs an arbitrary
    // week of old mail.
    //
    // Decoding belongs one step later, where Gmail's text becomes one of our
    // own rows: convertToTask, and the outgoing Subject header. This test is
    // the guard on that boundary — every other subject fixture in this file is
    // entity-free ASCII, so without it the suite stays green whether the rule
    // holds or not.
    const user = await createUser();
    gmail.messagesList.mockResolvedValue(listPage(['m1']));
    stubMessagesGet(gmail, [{ id: 'm1', subject: 'R&amp;D suivi', snippet: 'Merci d&#39;avance' }]);

    await emailService.initialSync(gmail.client, user.id);

    const row = await prisma.email.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.subject).toBe('R&amp;D suivi');
    expect(row.snippet).toBe('Merci d&#39;avance');
  });

  it('is idempotent — re-running does not duplicate rows', async () => {
    const user = await createUser();
    gmail.messagesList.mockResolvedValue(listPage(['m1']));
    stubMessagesGet(gmail, [{ id: 'm1', subject: 'Original' }]);
    await emailService.initialSync(gmail.client, user.id);

    stubMessagesGet(gmail, [{ id: 'm1', subject: 'Edited subject' }]);
    await emailService.initialSync(gmail.client, user.id);

    const rows = await prisma.email.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].subject).toBe('Edited subject');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. syncFromGmail orchestration
// ─────────────────────────────────────────────────────────────────────────────

describe('emailService.syncFromGmail — path selection and error translation', () => {
  it('takes the incremental path when a history id is stored', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id, { lastHistoryId: '5000' });

    await emailService.syncFromGmail(user.id);

    expect(gmail.historyList).toHaveBeenCalledTimes(1);
    expect(historyParams(gmail.historyList).startHistoryId).toBe('5000');
    expect(gmail.messagesList).not.toHaveBeenCalled();
  });

  it('takes the initial path when no history id is stored', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);

    await emailService.syncFromGmail(user.id);

    expect(gmail.messagesList).toHaveBeenCalledTimes(1);
    expect(gmail.historyList).not.toHaveBeenCalled();
  });

  it('persists the new history id and the sync timestamp', async () => {
    const user = await createUser();
    const auth = await createGoogleAuth(user.id, { lastHistoryId: '5000' });
    gmail.getProfile.mockResolvedValue({ data: { emailAddress: 'me@example.com', historyId: '6123' } });

    await emailService.syncFromGmail(user.id);

    const updated = await prisma.googleAuth.findUniqueOrThrow({ where: { id: auth.id } });
    expect(updated.lastHistoryId).toBe('6123');
    expect(updated.lastMailSyncAt).not.toBeNull();
  });

  it('keeps the previous history id when Gmail returns none', async () => {
    const user = await createUser();
    const auth = await createGoogleAuth(user.id, { lastHistoryId: '5000' });
    gmail.getProfile.mockResolvedValue({ data: { emailAddress: 'me@example.com' } });

    await emailService.syncFromGmail(user.id);

    const updated = await prisma.googleAuth.findUniqueOrThrow({ where: { id: auth.id } });
    expect(updated.lastHistoryId).toBe('5000');
  });

  it('rejects when the user has no Google connection', async () => {
    const user = await createUser();

    await expect(emailService.syncFromGmail(user.id)).rejects.toThrow(/google not connected/i);
  });

  it('turns a plain 403 into a reconnect instruction', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    gmail.messagesList.mockRejectedValue(insufficientScopeError());

    await expect(emailService.syncFromGmail(user.id)).rejects.toThrow(/reconnect google/i);
  });

  it('does not rewrite a rate-limited 403 into a reconnect instruction', async () => {
    // A 403 carrying reason=rateLimitExceeded is throttling that outlived the
    // limiter's retries. Telling the user their Gmail access was revoked would
    // send them to re-do an OAuth grant that is perfectly intact.
    const user = await createUser();
    await createGoogleAuth(user.id);
    gmail.messagesList.mockRejectedValue(rateLimitedError());

    await expect(emailService.syncFromGmail(user.id)).rejects.toThrow(/quota exceeded/i);
    await expect(emailService.syncFromGmail(user.id)).rejects.not.toThrow(/reconnect google/i);
  });

  it('translates a 403 raised by the trailing getProfile call — REGRESSION', async () => {
    // The try/catch that turns a 403 into the reconnect message wraps only the
    // sync itself. `gmail.users.getProfile` runs after it, unguarded, so a 403
    // from that call escapes raw: no `status` property, and the original
    // googleapis wording.
    //
    // That matters downstream: jobs/emailSyncScheduler.ts decides whether a
    // failure is expected via `err?.status === 400 || err?.status === 403`. An
    // untranslated error has no `status`, so the scheduler treats a revoked
    // Gmail grant as an unexpected failure and logs it every 60 seconds
    // forever, and the HTTP layer answers 500 instead of 403.
    const user = await createUser();
    await createGoogleAuth(user.id, { lastHistoryId: '5000' });
    gmail.getProfile.mockRejectedValue(insufficientScopeError());

    const error = await emailService.syncFromGmail(user.id).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    // The bug: this used to surface googleapis' raw wording with no `status`,
    // so the scheduler could not recognise it as expected.
    expect((error as Error).message).toMatch(/reconnect google/i);
    expect((error as { status?: number }).status).toBe(403);
  });

  it('leaves the stored history id untouched when the sync fails', async () => {
    const user = await createUser();
    const auth = await createGoogleAuth(user.id, { lastHistoryId: '5000' });
    gmail.historyList.mockRejectedValue(gmailError(500, 'Backend error'));
    gmail.getProfile.mockResolvedValue({ data: { historyId: '9999' } });

    await expect(emailService.syncFromGmail(user.id)).rejects.toThrow(/backend error/i);

    const updated = await prisma.googleAuth.findUniqueOrThrow({ where: { id: auth.id } });
    expect(updated.lastHistoryId).toBe('5000');
  });

  it('reports what the incremental sync did', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id, { lastHistoryId: '5000' });
    await createEmail(user.id, { gmailMessageId: 'existing', isRead: true });
    gmail.historyList.mockResolvedValue(
      historyPage([messageAdded('new-1'), labelsAdded('existing', ['UNREAD'])])
    );
    stubMessagesGet(gmail, [{ id: 'new-1', subject: 'Brand new' }]);

    const result = await emailService.syncFromGmail(user.id);

    expect(result.synced).toBe(1);
    expect(result.labelsChanged).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Batch operations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The documented pattern is `POST /emails/batch/{action}` with `{ ids }`:
 * the service resolves the *threads* those ids belong to and acts on every
 * message in them, so selecting one message in a conversation acts on the whole
 * conversation. It is also best-effort in a specific direction — the local
 * database is the source of truth for the UI and is updated regardless of
 * whether the Gmail call succeeds.
 */
describe('emailService batch operations — thread fan-out', () => {
  it('marks every message in the thread read when given one of them', async () => {
    const user = await createUser();
    const first = await createEmail(user.id, { threadId: 't1', gmailMessageId: 'g1', isRead: false });
    await createEmail(user.id, { threadId: 't1', gmailMessageId: 'g2', isRead: false });
    await createEmail(user.id, { threadId: 't2', gmailMessageId: 'g3', isRead: false });

    const result = await emailService.batchMarkAsRead([first.id], user.id);

    expect(result.count).toBe(1); // one thread affected
    const thread = await prisma.email.findMany({ where: { threadId: 't1' } });
    expect(thread.every((e) => e.isRead)).toBe(true);
    // The untouched thread stays untouched.
    const other = await prisma.email.findFirstOrThrow({ where: { threadId: 't2' } });
    expect(other.isRead).toBe(false);

    expect(calledMessageIds(gmail.messagesModify).sort()).toEqual(['g1', 'g2']);
  });

  it('marks every message in the thread unread when given one of them', async () => {
    const user = await createUser();
    const first = await createEmail(user.id, { threadId: 't1', gmailMessageId: 'g1', isRead: true });
    await createEmail(user.id, { threadId: 't1', gmailMessageId: 'g2', isRead: true });

    await emailService.batchMarkAsUnread([first.id], user.id);

    const thread = await prisma.email.findMany({ where: { threadId: 't1' } });
    expect(thread.every((e) => !e.isRead)).toBe(true);
  });

  it('archives the whole thread and strips INBOX from the stored labels', async () => {
    const user = await createUser();
    const first = await createEmail(user.id, {
      threadId: 't1', gmailMessageId: 'g1', labelIds: ['INBOX', 'IMPORTANT'],
    });
    await createEmail(user.id, { threadId: 't1', gmailMessageId: 'g2', labelIds: ['INBOX'] });

    await emailService.batchArchive([first.id], user.id);

    const thread = await prisma.email.findMany({ where: { threadId: 't1' } });
    expect(thread.every((e) => e.isArchived)).toBe(true);
    expect(thread.every((e) => !e.labelIds.includes('INBOX'))).toBe(true);
    // Unrelated labels survive.
    const kept = thread.find((e) => e.gmailMessageId === 'g1');
    expect(kept?.labelIds).toContain('IMPORTANT');
  });

  it('trashes the whole thread and rewrites the labels', async () => {
    const user = await createUser();
    const first = await createEmail(user.id, { threadId: 't1', gmailMessageId: 'g1', labelIds: ['INBOX'] });
    await createEmail(user.id, { threadId: 't1', gmailMessageId: 'g2', labelIds: ['INBOX'] });

    await emailService.batchTrash([first.id], user.id);

    const thread = await prisma.email.findMany({ where: { threadId: 't1' } });
    expect(thread.every((e) => e.isTrashed)).toBe(true);
    expect(thread.every((e) => e.labelIds.includes('TRASH'))).toBe(true);
    expect(thread.every((e) => !e.labelIds.includes('INBOX'))).toBe(true);
    expect(calledMessageIds(gmail.messagesTrash).sort()).toEqual(['g1', 'g2']);
  });

  it('does not accumulate duplicate TRASH labels when trashed twice — REGRESSION', async () => {
    // `batchTrash` rewrites labels as `[...labelIds.filter(l => l !== 'INBOX'), 'TRASH']`
    // — it strips INBOX idempotently but appends TRASH unconditionally, so the
    // array grows on every call. `batchArchive` does not have the problem
    // because it only ever removes.
    //
    // It is reachable without doing anything odd: the batch actions fan out
    // over the whole thread, so trashing a thread that already contains a
    // trashed message re-trashes that message. `trash()` has the same line.
    //
    // Both sites now dedupe via `[...new Set([...kept, 'TRASH'])]`.
    const user = await createUser();
    const email = await createEmail(user.id, { threadId: 't1', gmailMessageId: 'g1', labelIds: ['INBOX'] });

    await emailService.batchTrash([email.id], user.id);
    await emailService.batchTrash([email.id], user.id);

    const stored = await prisma.email.findUniqueOrThrow({ where: { id: email.id } });
    // The bug: this used to be ['TRASH', 'TRASH'], growing on every call.
    expect(stored.labelIds).toEqual(['TRASH']);
  });

  it('archiving twice is idempotent', async () => {
    const user = await createUser();
    const email = await createEmail(user.id, { threadId: 't1', gmailMessageId: 'g1', labelIds: ['INBOX'] });

    await emailService.batchArchive([email.id], user.id);
    await emailService.batchArchive([email.id], user.id);

    const stored = await prisma.email.findUniqueOrThrow({ where: { id: email.id } });
    expect(stored.labelIds).toEqual([]);
  });

  it('deduplicates threads when several ids from the same thread are selected', async () => {
    const user = await createUser();
    const a = await createEmail(user.id, { threadId: 't1', gmailMessageId: 'g1', isRead: false });
    const b = await createEmail(user.id, { threadId: 't1', gmailMessageId: 'g2', isRead: false });

    const result = await emailService.batchMarkAsRead([a.id, b.id], user.id);

    expect(result.count).toBe(1);
  });
});

describe('emailService batch operations — best-effort Gmail', () => {
  it('still updates the database when the Gmail modify rejects', async () => {
    const user = await createUser();
    const email = await createEmail(user.id, { threadId: 't1', gmailMessageId: 'g1', labelIds: ['INBOX'] });
    gmail.messagesModify.mockRejectedValue(gmailError(500, 'Backend error'));

    await emailService.batchArchive([email.id], user.id);

    const stored = await prisma.email.findUniqueOrThrow({ where: { id: email.id } });
    expect(stored.isArchived).toBe(true);
  });

  it('still updates the database when the Gmail trash rejects', async () => {
    const user = await createUser();
    const email = await createEmail(user.id, { threadId: 't1', gmailMessageId: 'g1' });
    gmail.messagesTrash.mockRejectedValue(gmailError(500, 'Backend error'));

    await emailService.batchTrash([email.id], user.id);

    const stored = await prisma.email.findUniqueOrThrow({ where: { id: email.id } });
    expect(stored.isTrashed).toBe(true);
  });

  it('still updates the database when the Gmail client cannot be obtained at all', async () => {
    const user = await createUser();
    const email = await createEmail(user.id, { threadId: 't1', gmailMessageId: 'g1', isRead: false });
    vi.mocked(getGmailClient).mockRejectedValue(
      Object.assign(new Error('Google not connected'), { status: 400 })
    );

    await emailService.batchMarkAsRead([email.id], user.id);

    const stored = await prisma.email.findUniqueOrThrow({ where: { id: email.id } });
    expect(stored.isRead).toBe(true);
  });

  it('keeps going after one message in the thread fails at Gmail', async () => {
    const user = await createUser();
    const first = await createEmail(user.id, { threadId: 't1', gmailMessageId: 'g1', isRead: false });
    await createEmail(user.id, { threadId: 't1', gmailMessageId: 'g2', isRead: false });
    gmail.messagesModify.mockImplementation(async (params: { id?: string }) => {
      if (params.id === 'g1') throw gmailError(404, 'Not found', ['notFound']);
      return { data: {} };
    });

    await emailService.batchMarkAsRead([first.id], user.id);

    expect(calledMessageIds(gmail.messagesModify).sort()).toEqual(['g1', 'g2']);
    const thread = await prisma.email.findMany({ where: { threadId: 't1' } });
    expect(thread.every((e) => e.isRead)).toBe(true);
  });
});

describe('emailService batch operations — tenant isolation', () => {
  it('cannot mark another user’s mail as read', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobEmail = await createEmail(bob.id, { threadId: 'bob-thread', gmailMessageId: 'bg1', isRead: false });

    const result = await emailService.batchMarkAsRead([bobEmail.id], alice.id);

    expect(result.count).toBe(0);
    const stored = await prisma.email.findUniqueOrThrow({ where: { id: bobEmail.id } });
    expect(stored.isRead).toBe(false);
    expect(gmail.messagesModify).not.toHaveBeenCalled();
  });

  it('cannot archive another user’s mail', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobEmail = await createEmail(bob.id, { threadId: 'bob-thread', gmailMessageId: 'bg1' });

    await emailService.batchArchive([bobEmail.id], alice.id);

    const stored = await prisma.email.findUniqueOrThrow({ where: { id: bobEmail.id } });
    expect(stored.isArchived).toBe(false);
    expect(gmail.messagesModify).not.toHaveBeenCalled();
  });

  it('cannot trash another user’s mail', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobEmail = await createEmail(bob.id, { threadId: 'bob-thread', gmailMessageId: 'bg1' });

    await emailService.batchTrash([bobEmail.id], alice.id);

    const stored = await prisma.email.findUniqueOrThrow({ where: { id: bobEmail.id } });
    expect(stored.isTrashed).toBe(false);
    expect(gmail.messagesTrash).not.toHaveBeenCalled();
  });

  it('does not reach into another user’s copy of a shared thread id', async () => {
    // Both users hold rows under the same Gmail thread id. Acting on Alice's
    // selection must stop at Alice's rows — the thread fan-out filters by
    // threadId, so the userId constraint alongside it is load-bearing.
    const { alice, bob } = await createTwoUsers();
    const aliceEmail = await createEmail(alice.id, { threadId: 'shared-t', gmailMessageId: 'ag1', isRead: false });
    const bobEmail = await createEmail(bob.id, { threadId: 'shared-t', gmailMessageId: 'bg1', isRead: false });

    await emailService.batchMarkAsRead([aliceEmail.id], alice.id);

    expect((await prisma.email.findUniqueOrThrow({ where: { id: aliceEmail.id } })).isRead).toBe(true);
    expect((await prisma.email.findUniqueOrThrow({ where: { id: bobEmail.id } })).isRead).toBe(false);
    expect(calledMessageIds(gmail.messagesModify)).toEqual(['ag1']);
  });

  it('acts only on the caller’s mail when the selection mixes both users', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceEmail = await createEmail(alice.id, { threadId: 'alice-t', gmailMessageId: 'ag1' });
    const bobEmail = await createEmail(bob.id, { threadId: 'bob-t', gmailMessageId: 'bg1' });

    const result = await emailService.batchTrash([aliceEmail.id, bobEmail.id], alice.id);

    expect(result.count).toBe(1);
    expect((await prisma.email.findUniqueOrThrow({ where: { id: aliceEmail.id } })).isTrashed).toBe(true);
    expect((await prisma.email.findUniqueOrThrow({ where: { id: bobEmail.id } })).isTrashed).toBe(false);
    expect(calledMessageIds(gmail.messagesTrash)).toEqual(['ag1']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. First-login correctness: the cursor, and messages that fail to fetch
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The two ways a first sync used to lose mail silently.
 *
 * Both are invisible in normal operation: nothing errors, nothing is logged, the
 * counts look right. The message simply never appears, and because the history
 * cursor has moved past it, nothing will ever fetch it again.
 */
describe('emailService.syncFromGmail — first sync does not lose mail', () => {
  it('takes the history cursor BEFORE listing, not after — REGRESSION', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);

    // The mailbox moves while the sync runs, so `historyId` depends on WHEN it is
    // read. Keyed off whether listing has happened rather than off call order, so
    // the assertion distinguishes the two orderings instead of just counting
    // calls — an earlier version of this test used mockResolvedValueOnce and
    // passed even with the fix reverted, because the broken path makes exactly
    // one call and consumed the same value.
    let listed = false;
    gmail.getProfile.mockImplementation(async () => ({
      data: { emailAddress: 'me@powerm.ma', historyId: listed ? '9000' : '1000' },
    }));
    gmail.messagesList.mockImplementation(async () => {
      listed = true;
      return listPage(['m1']);
    });
    stubMessagesGet(gmail, [{ id: 'm1', from: 'a@acme.com', subject: 'One' }]);

    await emailService.syncFromGmail(user.id);

    const auth = await prisma.googleAuth.findFirst({ where: { userId: user.id } });
    expect(auth?.lastHistoryId).toBe('1000');
  });

  it('records a message it could not fetch instead of dropping it — REGRESSION', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    stubMessagesListPages(gmail, [['ok1', 'boom', 'ok2']]);
    stubMessagesGet(
      gmail,
      [
        { id: 'ok1', from: 'a@acme.com', subject: 'First' },
        { id: 'ok2', from: 'b@acme.com', subject: 'Second' },
      ],
      { boom: gmailError(500, 'Backend error') }
    );

    const result = await emailService.syncFromGmail(user.id);

    // The good messages still land — one bad fetch must not abort the sync.
    expect(result.synced).toBe(2);
    expect(result.failed).toBe(1);
    const auth = await prisma.googleAuth.findFirst({ where: { userId: user.id } });
    expect(auth?.syncFailedMessageIds).toEqual(['boom']);
  });

  it('keeps a failure recorded during the same run as a retry — REGRESSION', async () => {
    // The erasure needed BOTH a pre-existing backlog and a new failure in one
    // run, which is why the existing coverage missed it: with an empty list
    // `retryFailedMessages` returns before it can overwrite anything.
    //
    // `auth` is read once before the sync, so its syncFailedMessageIds is a
    // pre-sync snapshot. The run records 'fresh' through addFailedMessageIds,
    // then the retry replaced the column with the survivors of the SNAPSHOT —
    // dropping 'fresh'. The history cursor advances in the same run, so that
    // message would never be fetched again.
    const user = await createUser();
    await createGoogleAuth(user.id);
    await prisma.googleAuth.updateMany({
      where: { userId: user.id },
      data: { syncFailedMessageIds: ['old-backlog'] },
    });

    stubMessagesListPages(gmail, [['ok1', 'fresh']]);
    stubMessagesGet(
      gmail,
      [{ id: 'ok1', from: 'a@acme.com', subject: 'Fine' }],
      {
        // Fails during this run, and stays failing on the retry that follows.
        fresh: gmailError(500, 'Backend error'),
        'old-backlog': gmailError(500, 'Still down'),
      }
    );

    await emailService.syncFromGmail(user.id);

    const auth = await prisma.googleAuth.findFirst({ where: { userId: user.id } });
    // Both survive: the backlog it was already tracking, and the one this run
    // discovered. Losing either means a message nothing will ever fetch again.
    expect([...(auth?.syncFailedMessageIds ?? [])].sort()).toEqual(['fresh', 'old-backlog']);
  });

  it('retries a recorded failure on the next sync and clears it once it lands', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id, { lastHistoryId: '500' });
    await prisma.googleAuth.updateMany({
      where: { userId: user.id },
      data: { syncFailedMessageIds: ['recovered'] },
    });
    gmail.historyList.mockResolvedValue(historyPage([]));
    stubMessagesGet(gmail, [{ id: 'recovered', from: 'c@acme.com', subject: 'Late arrival' }]);

    const result = await emailService.syncFromGmail(user.id);

    expect(result.synced).toBe(1);
    expect(
      await prisma.email.count({ where: { userId: user.id, gmailMessageId: 'recovered' } })
    ).toBe(1);
    const auth = await prisma.googleAuth.findFirst({ where: { userId: user.id } });
    expect(auth?.syncFailedMessageIds).toEqual([]);
  });

  it('stops retrying a message Gmail no longer has', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id, { lastHistoryId: '500' });
    await prisma.googleAuth.updateMany({
      where: { userId: user.id },
      data: { syncFailedMessageIds: ['gone'] },
    });
    gmail.historyList.mockResolvedValue(historyPage([]));
    // Nothing stubbed, so `messages.get` 404s — the message was deleted.
    stubMessagesGet(gmail, []);

    await emailService.syncFromGmail(user.id);

    const auth = await prisma.googleAuth.findFirst({ where: { userId: user.id } });
    expect(auth?.syncFailedMessageIds).toEqual([]);
  });

  it('keeps a still-failing message queued rather than giving up', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id, { lastHistoryId: '500' });
    await prisma.googleAuth.updateMany({
      where: { userId: user.id },
      data: { syncFailedMessageIds: ['stubborn'] },
    });
    gmail.historyList.mockResolvedValue(historyPage([]));
    stubMessagesGet(gmail, [], { stubborn: gmailError(500, 'Still broken') });

    await emailService.syncFromGmail(user.id);

    const auth = await prisma.googleAuth.findFirst({ where: { userId: user.id } });
    expect(auth?.syncFailedMessageIds).toEqual(['stubborn']);
  });

  it('advances the cursor after a catch-up so the next sync is not another catch-up — REGRESSION', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id, { lastHistoryId: 'expired' });
    gmail.historyList.mockRejectedValue(historyExpiredError());
    stubMessagesListPages(gmail, [[]]);
    gmail.getProfile.mockResolvedValue({
      data: { emailAddress: 'me@powerm.ma', historyId: '7777' },
    });

    await emailService.syncFromGmail(user.id);

    // The catch-up re-lists by date and cannot report a feed position. Left null,
    // the expired cursor would persist and every future sync would 404 into
    // another catch-up.
    const auth = await prisma.googleAuth.findFirst({ where: { userId: user.id } });
    expect(auth?.lastHistoryId).toBe('7777');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. A message is never filed against the account's own company
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `upsertMessage` files a message against the first non-personal domain among
 * from/to/cc. For outbound mail that is the sender — the user — so every message
 * the user sent was filed under the user's own company.
 *
 * On the real database that made "Powerm" the largest customer in the system:
 * 33,309 emails, of which 32,359 were the user's own sent mail, while the actual
 * recipient's company showed none of it. The per-company views, the dashboard's
 * top customers and Review's grouping all saw inbound only.
 *
 * The calendar importer already skips the account holder via the attendee `self`
 * flag. These are the mail-side equivalents.
 */
describe('emailService.upsertMessage — own-domain filing', () => {
  it('files a sent message against the recipient, not the sender — REGRESSION', async () => {
    const user = await createUser({ email: 'me@powerm.ma' });
    await createGoogleAuth(user.id);
    stubMessagesListPages(gmail, [['sent1']]);
    stubMessagesGet(gmail, [
      { id: 'sent1', from: 'me@powerm.ma', to: ['buyer@intelcom.co.ma'], subject: 'Our quote' },
    ]);

    await emailService.syncFromGmail(user.id);

    const email = await prisma.email.findFirst({
      where: { userId: user.id, gmailMessageId: 'sent1' },
      include: { customer: { select: { domain: true } } },
    });
    expect(email?.customer?.domain).toBe('intelcom.co.ma');
  });

  it('still records colleagues as contacts', async () => {
    const user = await createUser({ email: 'me@powerm.ma' });
    await createGoogleAuth(user.id);
    stubMessagesListPages(gmail, [['internal1']]);
    stubMessagesGet(gmail, [
      { id: 'internal1', from: 'colleague@powerm.ma', to: ['me@powerm.ma'], subject: 'Internal' },
    ]);

    await emailService.syncFromGmail(user.id);

    // An internal address is worth knowing about; it just must not become the
    // company a message is filed against.
    const contact = await prisma.contact.findFirst({
      where: { email: 'colleague@powerm.ma', customer: { userId: user.id } },
    });
    expect(contact).not.toBeNull();
  });

  it('leaves a purely internal message unlinked rather than misfiled', async () => {
    const user = await createUser({ email: 'me@powerm.ma' });
    await createGoogleAuth(user.id);
    stubMessagesListPages(gmail, [['internal2']]);
    stubMessagesGet(gmail, [
      { id: 'internal2', from: 'colleague@powerm.ma', to: ['me@powerm.ma'], subject: 'Standup' },
    ]);

    await emailService.syncFromGmail(user.id);

    const email = await prisma.email.findFirst({
      where: { userId: user.id, gmailMessageId: 'internal2' },
    });
    // No counterparty means no customer. Null is honest; the user's own company
    // is not.
    expect(email?.customerId).toBeNull();
  });

  it('still files an inbound message against its sender', async () => {
    const user = await createUser({ email: 'me@powerm.ma' });
    await createGoogleAuth(user.id);
    stubMessagesListPages(gmail, [['in1']]);
    stubMessagesGet(gmail, [
      { id: 'in1', from: 'seller@lydec.co.ma', to: ['me@powerm.ma'], subject: 'Renewal' },
    ]);

    await emailService.syncFromGmail(user.id);

    const email = await prisma.email.findFirst({
      where: { userId: user.id, gmailMessageId: 'in1' },
      include: { customer: { select: { domain: true } } },
    });
    expect(email?.customer?.domain).toBe('lydec.co.ma');
  });

  it('treats a personal-mailbox account as having no own domain to exclude', async () => {
    // A gmail.com account has no company domain, so nothing should be excluded
    // and normal inbound filing must still work.
    const user = await createUser({ email: 'someone@gmail.com' });
    await createGoogleAuth(user.id);
    stubMessagesListPages(gmail, [['p1']]);
    stubMessagesGet(gmail, [
      { id: 'p1', from: 'seller@lydec.co.ma', to: ['someone@gmail.com'], subject: 'Hello' },
    ]);

    await emailService.syncFromGmail(user.id);

    const email = await prisma.email.findFirst({
      where: { userId: user.id, gmailMessageId: 'p1' },
      include: { customer: { select: { domain: true } } },
    });
    expect(email?.customer?.domain).toBe('lydec.co.ma');
  });
});

describe('emailService.upsertMessage — what may become a company', () => {
  it('creates no company or contact for mail that arrived via a mailing list', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);

    stubMessagesListPages(gmail, [['m-list']]);
    stubMessagesGet(gmail, [
      {
        id: 'm-list',
        from: 'someone@acme-supplier.com',
        to: ['ibm-community@connectedcommunity.org'],
        // RFC 2919: this message was distributed by a list, which is the only
        // reason every participant's address is on it.
        listId: '<ibm-community.connectedcommunity.org>',
      },
    ]);

    const result = await emailService.syncFromGmail(user.id);

    expect(result.synced).toBe(1);
    // The message is kept — it is real mail. It just populates no CRM rows.
    expect(await prisma.email.count({ where: { userId: user.id } })).toBe(1);
    expect(await prisma.customer.count({ where: { userId: user.id } })).toBe(0);
  });

  it('does not turn a list host into a company even without List-Id', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);

    stubMessagesListPages(gmail, [['m-groups']]);
    stubMessagesGet(gmail, [
      { id: 'm-groups', from: 'discussion@googlegroups.com', to: ['me@powerm.ma'] },
    ]);

    await emailService.syncFromGmail(user.id);

    const domains = (
      await prisma.customer.findMany({ where: { userId: user.id }, select: { domain: true } })
    ).map((c) => c.domain);
    expect(domains).not.toContain('googlegroups.com');
  });

  it('still creates a company for an ordinary supplier', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);

    stubMessagesListPages(gmail, [['m-real']]);
    stubMessagesGet(gmail, [
      { id: 'm-real', from: 'sales@acme-supplier.com', to: ['me@powerm.ma'] },
    ]);

    await emailService.syncFromGmail(user.id);

    const domains = (
      await prisma.customer.findMany({ where: { userId: user.id }, select: { domain: true } })
    ).map((c) => c.domain);
    expect(domains).toContain('acme-supplier.com');
  });

  it('creates no company from an unparseable domain', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);

    stubMessagesListPages(gmail, [['m-mangled']]);
    stubMessagesGet(gmail, [
      // A real captured Exchange fragment. This used to become a customer called
      // "Powerm" on the domain `powerm.ma/o=`.
      { id: 'm-mangled', from: 'someone@powerm.ma/o=exchangelabs', to: ['me@powerm.ma'] },
    ]);

    await emailService.syncFromGmail(user.id);

    const domains = (
      await prisma.customer.findMany({ where: { userId: user.id }, select: { domain: true } })
    ).map((c) => c.domain);
    expect(domains.some((d) => d?.includes('/'))).toBe(false);
  });
});

describe('emailService — engagement follows the direction of the mail', () => {
  it('an inbound message makes its sender a sender, not its other recipients', async () => {
    const user = await createUser({ email: 'me@powerm.test' });
    await createGoogleAuth(user.id);

    stubMessagesListPages(gmail, [['m1']]);
    stubMessagesGet(gmail, [
      {
        id: 'm1',
        from: 'writer@acme-supplier.com',
        to: ['me@powerm.test'],
        cc: ['bystander@acme-supplier.com'],
      },
    ]);
    await emailService.syncFromGmail(user.id);

    const contacts = await prisma.contact.findMany({
      where: { customer: { userId: user.id } },
      select: { email: true, engagement: true },
    });
    const byEmail = Object.fromEntries(contacts.map((c) => [c.email, c.engagement]));

    expect(byEmail['writer@acme-supplier.com']).toBe('sender');
    // Being cc'd on someone else's message is not correspondence — this is the
    // 43% the filter exists to separate.
    expect(byEmail['bystander@acme-supplier.com']).toBe('none');
  });

  it('a message this account sent makes its recipients receivers', async () => {
    const user = await createUser({ email: 'me@powerm.test' });
    await createGoogleAuth(user.id);

    stubMessagesListPages(gmail, [['m2']]);
    stubMessagesGet(gmail, [
      { id: 'm2', from: 'me@powerm.test', to: ['client@acme-supplier.com'] },
    ]);
    await emailService.syncFromGmail(user.id);

    const contact = await prisma.contact.findFirst({
      where: { email: 'client@acme-supplier.com', customer: { userId: user.id } },
    });
    expect(contact?.engagement).toBe('receiver');
  });

  it('widens to both once mail has gone each way, and never narrows again', async () => {
    const user = await createUser({ email: 'me@powerm.test' });
    await createGoogleAuth(user.id);

    stubMessagesListPages(gmail, [['in1']]);
    stubMessagesGet(gmail, [
      { id: 'in1', from: 'peer@acme-supplier.com', to: ['me@powerm.test'] },
    ]);
    await emailService.syncFromGmail(user.id);

    // A later sync sees a message going the other way.
    await prisma.googleAuth.updateMany({ where: { userId: user.id }, data: { lastHistoryId: null } });
    stubMessagesListPages(gmail, [['out1']]);
    stubMessagesGet(gmail, [
      { id: 'out1', from: 'me@powerm.test', to: ['peer@acme-supplier.com'] },
    ]);
    await emailService.syncFromGmail(user.id);

    const contact = await prisma.contact.findFirst({
      where: { email: 'peer@acme-supplier.com', customer: { userId: user.id } },
    });
    expect(contact?.engagement).toBe('both');
  });
});
