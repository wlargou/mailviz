import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { getGmailClient } from '../lib/gmail.js';
import { createTwoUsers, createEmail } from '../test/factories.js';
import { createGmailMock, gmailError, stubMessagesGet, type GmailMock } from '../test/gmailMock.js';
import { backfillBodyText } from './backfillBodyText.js';

/**
 * The backfill for `emails.body_text`. It asks Gmail for every old message
 * and writes live rows, so what is pinned is: each mailbox is read with its
 * owner's client and only its owner's rows written; newest first; a message
 * Gmail no longer has, or one with no text, is recorded as '' and not asked
 * for again, while any other failure stays pending; a dry run writes nothing
 * and asks Gmail nothing; and `limit` holds.
 */

vi.mock('../lib/gmail.js', () => ({ getGmailClient: vi.fn() }));

const quiet = () => {};
let mailboxes: Map<string, GmailMock>;

beforeEach(() => {
  mailboxes = new Map();
  vi.mocked(getGmailClient).mockImplementation(async (userId?: string) => {
    const key = userId ?? '';
    if (!mailboxes.has(key)) mailboxes.set(key, createGmailMock());
    return mailboxes.get(key)!.client;
  });
});

afterEach(() => vi.mocked(getGmailClient).mockReset());

const bodyOf = async (id: string) =>
  (await prisma.email.findUniqueOrThrow({ where: { id }, select: { bodyText: true } })).bodyText;

describe('backfillBodyText', () => {
  it('fills each mailbox from its own Gmail, and writes only its owner’s rows', async () => {
    const { alice, bob } = await createTwoUsers();
    // The same Gmail id in both mailboxes: what each gets must be its own.
    const a = await createEmail(alice.id, { gmailMessageId: 'same-id' });
    const b = await createEmail(bob.id, { gmailMessageId: 'same-id' });
    const aliceGmail = createGmailMock();
    const bobGmail = createGmailMock();
    mailboxes.set(alice.id, aliceGmail).set(bob.id, bobGmail);
    stubMessagesGet(aliceGmail, [{ id: 'same-id', body: 'Alice’s text' }]);
    stubMessagesGet(bobGmail, [{ id: 'same-id', body: 'Bob’s text' }]);

    await backfillBodyText({ apply: true, log: quiet });

    expect(await bodyOf(a.id)).toBe('Alice’s text');
    expect(await bodyOf(b.id)).toBe('Bob’s text');
  });

  it('records \'\' for mail Gmail no longer has or with no text, and leaves other failures pending', async () => {
    const { alice } = await createTwoUsers();
    const gone = await createEmail(alice.id, { gmailMessageId: 'gone' });
    const blank = await createEmail(alice.id, { gmailMessageId: 'blank' });
    const flaky = await createEmail(alice.id, { gmailMessageId: 'flaky' });
    const gmail = createGmailMock();
    mailboxes.set(alice.id, gmail);
    stubMessagesGet(gmail, [{ id: 'blank' }], { flaky: gmailError(500, 'Backend Error') });

    const result = await backfillBodyText({ apply: true, log: quiet });

    expect(await bodyOf(gone.id)).toBe('');
    expect(await bodyOf(blank.id)).toBe('');
    expect(await bodyOf(flaky.id)).toBeNull();
    expect(result.mailboxes[0]).toMatchObject({ pending: 3, filled: 0, empty: 2, failed: 1 });
  });

  it('asks only for what is pending, so a second run asks for nothing', async () => {
    const { alice } = await createTwoUsers();
    const done = await createEmail(alice.id, { gmailMessageId: 'done', bodyText: 'Already here' });
    await createEmail(alice.id, { gmailMessageId: 'todo' });
    const gmail = createGmailMock();
    mailboxes.set(alice.id, gmail);
    stubMessagesGet(gmail, [{ id: 'todo', body: 'New' }, { id: 'done', body: 'Overwritten' }]);

    await backfillBodyText({ apply: true, log: quiet });
    expect(gmail.messagesGet.mock.calls.map(([p]) => p.id)).toEqual(['todo']);
    expect(await bodyOf(done.id)).toBe('Already here');

    expect(await backfillBodyText({ apply: true, log: quiet })).toEqual({ apply: true, mailboxes: [] });
    expect(gmail.messagesGet).toHaveBeenCalledTimes(1);
  });

  it('goes newest first and stops at the limit', async () => {
    const { alice } = await createTwoUsers();
    const old = await createEmail(alice.id, { gmailMessageId: 'old', receivedAt: new Date('2025-01-01') });
    const recent = await createEmail(alice.id, { gmailMessageId: 'recent', receivedAt: new Date('2026-09-01') });
    const gmail = createGmailMock();
    mailboxes.set(alice.id, gmail);
    stubMessagesGet(gmail, [{ id: 'old', body: 'Old' }, { id: 'recent', body: 'Recent' }]);

    await backfillBodyText({ apply: true, limit: 1, log: quiet });

    expect(await bodyOf(recent.id)).toBe('Recent');
    expect(await bodyOf(old.id)).toBeNull();
  });

  it('writes nothing and asks Gmail nothing on a dry run', async () => {
    const { alice } = await createTwoUsers();
    const e = await createEmail(alice.id, { gmailMessageId: 'todo' });

    const result = await backfillBodyText({ apply: false, log: quiet });

    expect(result).toEqual({ apply: false, mailboxes: [{ userId: alice.id, pending: 1 }] });
    expect(getGmailClient).not.toHaveBeenCalled();
    expect(await bodyOf(e.id)).toBeNull();
  });
});
