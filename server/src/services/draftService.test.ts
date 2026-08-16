import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { getGmailClient } from '../lib/gmail.js';
import { draftService } from './draftService.js';
import { createUser, createTwoUsers, createDraft, createGoogleAuth, createEmail } from '../test/factories.js';
import {
  createGmailMock,
  draftEndpoints,
  draftsListPage,
  gmailDraft,
  stubDrafts,
  type GmailMock,
  type MessageIdParams,
} from '../test/gmailMock.js';

/**
 * Gmail drafts.
 *
 * Two things are under test here and they pull in different directions.
 *
 * The first is tenant isolation. Drafts are unsent mail — the most private
 * thing this app touches — and this codebase has already shipped two
 * cross-tenant leaks from where-clauses that stopped constraining by `userId`.
 * Every draft route addresses a mirror row by its uuid, so the only thing
 * standing between Bob and Alice's half-written mail is that every query says
 * `{ id, userId }`. The isolation cases below assert both halves of that: Bob
 * gets a 404, and Gmail is never called — because a leak that reached Gmail
 * would have leaked the draft id too, and a 404 arriving after the fact is not
 * containment.
 *
 * The second is cost. Gmail is the source of truth for drafts, so the mirror
 * has to be reconciled on a 60s scheduler, and a naive reconcile is one
 * `drafts.get` per draft per minute forever. `syncDrafts` leans on Gmail
 * minting a fresh message id on every edit to skip the unchanged ones; the
 * regression case pins that, because losing it is invisible in behaviour and
 * expensive in quota.
 */

vi.mock('../lib/gmail.js', () => ({ getGmailClient: vi.fn() }));

let gmail: GmailMock;

beforeEach(() => {
  gmail = createGmailMock();
  vi.mocked(getGmailClient).mockResolvedValue(gmail.client);
});

afterEach(() => {
  vi.mocked(getGmailClient).mockReset();
});

/**
 * Push a mirror row's `updatedAt` an hour into the past.
 *
 * `syncDrafts` only sweeps rows that predate the sync, and `updatedAt` has
 * millisecond resolution — a row written in the same millisecond the sync
 * starts is not "before" it. Backdating makes "this row is old enough to be
 * swept" a fact rather than a coin toss.
 */
async function backdate(id: string) {
  await prisma.$executeRaw`UPDATE email_drafts SET updated_at = NOW() - INTERVAL '1 hour' WHERE id = ${id}`;
}

/** Nothing in the drafts feature may have touched Gmail. */
function expectNoGmailCalls(mock: GmailMock) {
  for (const endpoint of draftEndpoints(mock)) {
    expect(endpoint).not.toHaveBeenCalled();
  }
}

const composeInput = (overrides: Partial<Parameters<typeof draftService.save>[1]> = {}) => ({
  to: ['someone@example.com'],
  cc: [],
  bcc: [],
  subject: 'Half a thought',
  htmlBody: '<p>I was going to say</p>',
  attachments: [],
  ...overrides,
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Tenant isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('draftService — tenant isolation', () => {
  it('lists only the caller’s drafts', async () => {
    const { alice, bob } = await createTwoUsers();
    await createDraft(alice.id, { subject: 'Alice draft' });
    await createDraft(bob.id, { subject: 'Bob draft' });

    const aliceDrafts = await draftService.list(alice.id);

    expect(aliceDrafts).toHaveLength(1);
    expect(aliceDrafts[0].subject).toBe('Alice draft');
  });

  it('does not let one user open another’s draft, and never asks Gmail for it', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceDraft = await createDraft(alice.id, { subject: 'Not for Bob' });

    await expect(draftService.open(aliceDraft.id, bob.id)).rejects.toMatchObject({ status: 404 });

    // The 404 has to come from the where-clause, not from Gmail: if the lookup
    // had found the row, it would already have handed Bob the Gmail draft id.
    expectNoGmailCalls(gmail);
  });

  it('does not let one user overwrite another’s draft', async () => {
    const { alice, bob } = await createTwoUsers();
    await createGoogleAuth(bob.id, { email: 'bob@example.com' });
    const aliceDraft = await createDraft(alice.id, { subject: 'Alice wrote this' });

    await expect(
      draftService.save(bob.id, composeInput({ subject: 'Bob overwrote it' }), aliceDraft.id)
    ).rejects.toMatchObject({ status: 404 });

    expectNoGmailCalls(gmail);
    const unchanged = await prisma.emailDraft.findUniqueOrThrow({ where: { id: aliceDraft.id } });
    expect(unchanged.subject).toBe('Alice wrote this');
  });

  it('does not let one user send another’s draft', async () => {
    const { alice, bob } = await createTwoUsers();
    await createGoogleAuth(bob.id, { email: 'bob@example.com' });
    const aliceDraft = await createDraft(alice.id);

    await expect(
      draftService.send(bob.id, aliceDraft.id, composeInput())
    ).rejects.toMatchObject({ status: 404 });

    expectNoGmailCalls(gmail);
    // Alice's draft is still hers, and still a draft.
    expect(await prisma.emailDraft.count({ where: { id: aliceDraft.id } })).toBe(1);
  });

  it('does not let one user discard another’s draft', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceDraft = await createDraft(alice.id);

    await expect(draftService.remove(bob.id, aliceDraft.id)).rejects.toMatchObject({ status: 404 });

    expectNoGmailCalls(gmail);
    expect(await prisma.emailDraft.count({ where: { id: aliceDraft.id } })).toBe(1);
  });

  it('reconciling one user’s drafts leaves another user’s mirror alone', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobDraft = await createDraft(bob.id, { subject: 'Bob draft' });
    // Squarely inside the window the sweep deletes from, so this case turns on
    // the userId constraint rather than on timestamp luck.
    await backdate(bobDraft.id);
    // Alice has nothing in Gmail, so her side of the reconcile is a full sweep.
    gmail.draftsList.mockResolvedValue(draftsListPage([]));

    await draftService.syncDrafts(alice.id);

    const bobDrafts = await prisma.emailDraft.findMany({ where: { userId: bob.id } });
    expect(bobDrafts).toHaveLength(1);
    expect(bobDrafts[0].subject).toBe('Bob draft');
  });

  it('cannot thread a draft onto another user’s email', async () => {
    const { alice, bob } = await createTwoUsers();
    await createGoogleAuth(bob.id, { email: 'bob@example.com' });
    const aliceEmail = await createEmail(alice.id, { threadId: 'alice-thread' });

    await draftService.save(bob.id, composeInput({ replyToEmailId: aliceEmail.id }));

    // Bob's draft is standalone: no threadId was borrowed from Alice's mail.
    const request = gmail.draftsCreate.mock.calls[0]?.[0] as { requestBody?: { message?: { threadId?: string } } };
    expect(request?.requestBody?.message?.threadId).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Sync
// ─────────────────────────────────────────────────────────────────────────────

describe('draftService.syncDrafts', () => {
  it('imports drafts written in Gmail', async () => {
    const user = await createUser();
    stubDrafts(gmail, [{
      id: 'draft-1',
      messageId: 'msg-1',
      to: ['someone@example.com'],
      cc: ['cc@example.com'],
      subject: 'Written in Gmail',
      htmlBody: '<p>Started elsewhere</p>',
      internalDate: Date.UTC(2026, 5, 1),
    }]);

    const result = await draftService.syncDrafts(user.id);

    expect(result.synced).toBe(1);
    const stored = await prisma.emailDraft.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.subject).toBe('Written in Gmail');
    expect(stored.to).toEqual(['someone@example.com']);
    expect(stored.cc).toEqual(['cc@example.com']);
    expect(stored.htmlBody).toBe('<p>Started elsewhere</p>');
    expect(stored.lastEditedAt.getTime()).toBe(Date.UTC(2026, 5, 1));
  });

  /**
   * The steady state of this feature is "nothing changed", once a minute,
   * forever. `drafts.list` already reports each draft's current message id, and
   * Gmail replaces that id on every edit — so an unchanged draft is knowable
   * without fetching it.
   *
   * Drop that check and the sync still behaves correctly, which is exactly why
   * it needs a test: the only symptom is a per-draft `drafts.get` every sync
   * tick against the same quota the rest of the app is sharing.
   */
  it('does not re-fetch a draft whose message id has not moved — REGRESSION', async () => {
    const user = await createUser();
    stubDrafts(gmail, [{ id: 'draft-1', messageId: 'msg-1', subject: 'First' }]);

    await draftService.syncDrafts(user.id);
    expect(gmail.draftsGet).toHaveBeenCalledTimes(1);

    // Second pass: same message id, so the body is known to be unchanged.
    await draftService.syncDrafts(user.id);
    expect(gmail.draftsGet).toHaveBeenCalledTimes(1);
    expect(gmail.draftsList).toHaveBeenCalledTimes(2);
  });

  it('re-fetches a draft once its message id moves', async () => {
    const user = await createUser();
    stubDrafts(gmail, [{ id: 'draft-1', messageId: 'msg-1', subject: 'First' }]);
    await draftService.syncDrafts(user.id);

    // The user edited it in Gmail: new message id, new content.
    stubDrafts(gmail, [{ id: 'draft-1', messageId: 'msg-2', subject: 'Edited in Gmail' }]);
    const result = await draftService.syncDrafts(user.id);

    expect(result.synced).toBe(1);
    const stored = await prisma.emailDraft.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.subject).toBe('Edited in Gmail');
    expect(await prisma.emailDraft.count({ where: { userId: user.id } })).toBe(1);
  });

  it('drops mirror rows for drafts that no longer exist in Gmail', async () => {
    const user = await createUser();
    const gone = await createDraft(user.id, { gmailDraftId: 'draft-gone', subject: 'Sent from the phone' });
    await backdate(gone.id);
    gmail.draftsList.mockResolvedValue(draftsListPage([]));

    const result = await draftService.syncDrafts(user.id);

    expect(result.removed).toBe(1);
    expect(await prisma.emailDraft.count({ where: { userId: user.id } })).toBe(0);
  });

  /**
   * A save and a sync can overlap: the `drafts.list` page was fetched before
   * the new draft existed, so the reconcile would see a mirror row Gmail
   * "doesn't have" and delete it — out from under an open compose window,
   * taking the id that window is holding. The `updatedAt` guard makes the
   * deletion apply only to rows that predate the sync.
   */
  it('does not delete a draft saved after the sync began — REGRESSION', async () => {
    const user = await createUser();
    const stale = await createDraft(user.id, { gmailDraftId: 'draft-gone' });
    await backdate(stale.id);

    gmail.draftsList.mockImplementation(async () => {
      // Mid-sync: another request saves a draft Gmail's list page cannot know about.
      await prisma.emailDraft.create({
        data: {
          userId: user.id,
          gmailDraftId: 'draft-just-saved',
          gmailMessageId: 'msg-just-saved',
          subject: 'Just saved',
          htmlBody: '<p>x</p>',
          to: [],
          lastEditedAt: new Date(),
        },
      });
      return draftsListPage([]);
    });

    await draftService.syncDrafts(user.id);

    const remaining = await prisma.emailDraft.findMany({ where: { userId: user.id } });
    expect(remaining.map((d) => d.gmailDraftId)).toEqual(['draft-just-saved']);
    expect(remaining.map((d) => d.id)).not.toContain(stale.id);
  });

  it('walks every page of drafts.list', async () => {
    const user = await createUser();
    gmail.draftsList
      .mockResolvedValueOnce(draftsListPage([{ id: 'draft-1', messageId: 'msg-1' }], 'page-2'))
      .mockResolvedValueOnce(draftsListPage([{ id: 'draft-2', messageId: 'msg-2' }]));
    gmail.draftsGet.mockImplementation(async (params: MessageIdParams) => ({
      data: gmailDraft({ id: params?.id ?? '', messageId: `msg-${params?.id}`, subject: `Subject ${params?.id}` }),
    }));

    const result = await draftService.syncDrafts(user.id);

    expect(result.synced).toBe(2);
    expect(await prisma.emailDraft.count({ where: { userId: user.id } })).toBe(2);
  });

  it('keeps going when one draft cannot be fetched', async () => {
    const user = await createUser();
    gmail.draftsList.mockResolvedValue(
      draftsListPage([{ id: 'draft-bad', messageId: 'msg-bad' }, { id: 'draft-ok', messageId: 'msg-ok' }])
    );
    gmail.draftsGet.mockImplementation(async (params: MessageIdParams) => {
      if (params?.id === 'draft-bad') throw new Error('gone');
      return { data: gmailDraft({ id: 'draft-ok', messageId: 'msg-ok', subject: 'Survivor' }) };
    });

    const result = await draftService.syncDrafts(user.id);

    expect(result.synced).toBe(1);
    const stored = await prisma.emailDraft.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.subject).toBe('Survivor');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Save
// ─────────────────────────────────────────────────────────────────────────────

describe('draftService.save', () => {
  it('creates a Gmail draft and mirrors it', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id, { email: 'me@example.com' });

    const saved = await draftService.save(user.id, composeInput());

    expect(gmail.draftsCreate).toHaveBeenCalledTimes(1);
    expect(gmail.draftsUpdate).not.toHaveBeenCalled();
    const stored = await prisma.emailDraft.findUniqueOrThrow({ where: { id: saved.id } });
    expect(stored.subject).toBe('Half a thought');
    expect(stored.gmailDraftId).toBe('draft-new');
  });

  /** The whole point of "save and return": a second save must not fork the draft. */
  it('updates the same draft on a second save rather than duplicating it', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id, { email: 'me@example.com' });

    const first = await draftService.save(user.id, composeInput());
    const second = await draftService.save(user.id, composeInput({ subject: 'Second thought' }), first.id);

    expect(second.id).toBe(first.id);
    expect(gmail.draftsCreate).toHaveBeenCalledTimes(1);
    expect(gmail.draftsUpdate).toHaveBeenCalledTimes(1);
    const updateArgs = gmail.draftsUpdate.mock.calls[0]?.[0] as { id?: string };
    expect(updateArgs?.id).toBe('draft-new');
    expect(await prisma.emailDraft.count({ where: { userId: user.id } })).toBe(1);
  });

  /**
   * The case the feature exists for: a message with nothing filled in yet. The
   * compose validator lets all of it through, so the MIME builder has to cope
   * with an empty To, an empty subject and an empty body without throwing.
   */
  it('saves a draft with no recipient, subject or body', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id, { email: 'me@example.com' });

    const saved = await draftService.save(
      user.id,
      { to: [], cc: [], bcc: [], subject: '', htmlBody: '', attachments: [] }
    );

    expect(gmail.draftsCreate).toHaveBeenCalledTimes(1);
    const stored = await prisma.emailDraft.findUniqueOrThrow({ where: { id: saved.id } });
    expect(stored.to).toEqual([]);
    expect(stored.subject).toBe('');
  });

  it('threads a reply draft onto the original message', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id, { email: 'me@example.com' });
    const original = await createEmail(user.id, { threadId: 'thread-abc' });

    await draftService.save(user.id, composeInput({ replyToEmailId: original.id }));

    const request = gmail.draftsCreate.mock.calls[0]?.[0] as { requestBody?: { message?: { threadId?: string } } };
    expect(request?.requestBody?.message?.threadId).toBe('thread-abc');
  });

  it('refuses to save when Google is not connected', async () => {
    const user = await createUser();

    await expect(draftService.save(user.id, composeInput())).rejects.toMatchObject({ status: 400 });
    expect(gmail.draftsCreate).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Send
// ─────────────────────────────────────────────────────────────────────────────

describe('draftService.send', () => {
  it('sends through drafts.send so Gmail consumes the draft', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id, { email: 'me@example.com' });
    const draft = await createDraft(user.id, { gmailDraftId: 'draft-42' });

    const result = await draftService.send(user.id, draft.id, composeInput());

    // The latest text is pushed first, then the draft itself is sent — never
    // send-then-delete, which leaves a stale draft behind whenever the delete
    // fails.
    expect(gmail.draftsUpdate).toHaveBeenCalledTimes(1);
    expect(gmail.draftsSend).toHaveBeenCalledTimes(1);
    expect(gmail.draftsDelete).not.toHaveBeenCalled();
    const sendArgs = gmail.draftsSend.mock.calls[0]?.[0] as { requestBody?: { id?: string } };
    expect(sendArgs?.requestBody?.id).toBe('draft-42');
    expect(result.messageId).toBe('sent-msg');
  });

  it('leaves no draft behind once it is sent', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id, { email: 'me@example.com' });
    const draft = await createDraft(user.id);

    await draftService.send(user.id, draft.id, composeInput());

    expect(await prisma.emailDraft.count({ where: { userId: user.id } })).toBe(0);
  });

  it('stores the sent message so it appears in Sent', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id, { email: 'me@example.com' });
    const draft = await createDraft(user.id);

    await draftService.send(user.id, draft.id, composeInput());

    expect(await prisma.email.count({ where: { userId: user.id } })).toBe(1);
  });

  it('keeps the draft when the send itself fails', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id, { email: 'me@example.com' });
    const draft = await createDraft(user.id);
    gmail.draftsSend.mockRejectedValue(new Error('Gmail is having a day'));

    await expect(draftService.send(user.id, draft.id, composeInput())).rejects.toThrow();

    // Nothing was sent, so the draft must survive — holding the newest text,
    // because the update went through before the send was attempted.
    expect(await prisma.emailDraft.count({ where: { id: draft.id } })).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Open and discard
// ─────────────────────────────────────────────────────────────────────────────

describe('draftService.open', () => {
  it('reads through to Gmail so an edit made there is picked up', async () => {
    const user = await createUser();
    const draft = await createDraft(user.id, { gmailDraftId: 'draft-7', subject: 'Stale mirror copy' });
    gmail.draftsGet.mockResolvedValue({
      data: gmailDraft({
        id: 'draft-7',
        messageId: 'msg-newer',
        subject: 'Newer Gmail copy',
        htmlBody: '<p>Rewritten in Gmail</p>',
        to: ['someone@example.com'],
      }),
    });

    const opened = await draftService.open(draft.id, user.id);

    expect(opened.subject).toBe('Newer Gmail copy');
    expect(opened.htmlBody).toBe('<p>Rewritten in Gmail</p>');
    // …and the mirror is corrected on the way past.
    const stored = await prisma.emailDraft.findUniqueOrThrow({ where: { id: draft.id } });
    expect(stored.subject).toBe('Newer Gmail copy');
  });

  it('rehydrates attachment bytes as standard base64', async () => {
    const user = await createUser();
    const draft = await createDraft(user.id, { gmailDraftId: 'draft-8' });
    gmail.draftsGet.mockResolvedValue({
      data: gmailDraft({
        id: 'draft-8',
        messageId: 'msg-8',
        attachments: [{ filename: 'notes.txt', mimeType: 'text/plain', size: 5, attachmentId: 'att-1' }],
      }),
    });
    // Gmail hands attachments back base64url-encoded; compose speaks base64.
    gmail.attachmentsGet.mockResolvedValue({
      data: { data: Buffer.from('hello', 'utf-8').toString('base64url') },
    });

    const opened = await draftService.open(draft.id, user.id);

    expect(opened.attachments).toHaveLength(1);
    expect(opened.attachments[0].filename).toBe('notes.txt');
    expect(Buffer.from(opened.attachments[0].content, 'base64').toString('utf-8')).toBe('hello');
  });

  it('falls back to the mirror when Gmail is unreachable', async () => {
    const user = await createUser();
    const draft = await createDraft(user.id, { subject: 'Local copy', htmlBody: '<p>Local body</p>' });
    gmail.draftsGet.mockRejectedValue(new Error('network is down'));

    const opened = await draftService.open(draft.id, user.id);

    expect(opened.subject).toBe('Local copy');
    expect(opened.htmlBody).toBe('<p>Local body</p>');
  });
});

describe('draftService.remove', () => {
  it('deletes in Gmail and drops the mirror row', async () => {
    const user = await createUser();
    const draft = await createDraft(user.id, { gmailDraftId: 'draft-9' });

    await draftService.remove(user.id, draft.id);

    const deleteArgs = gmail.draftsDelete.mock.calls[0]?.[0] as { id?: string };
    expect(deleteArgs?.id).toBe('draft-9');
    expect(await prisma.emailDraft.count({ where: { id: draft.id } })).toBe(0);
  });

  it('still drops the mirror row when the Gmail delete fails', async () => {
    const user = await createUser();
    const draft = await createDraft(user.id);
    gmail.draftsDelete.mockRejectedValue(new Error('gone already'));

    await draftService.remove(user.id, draft.id);

    expect(await prisma.emailDraft.count({ where: { id: draft.id } })).toBe(0);
  });
});
