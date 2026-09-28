import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createRfp, createEmail, shareThreadWith } from '../test/factories.js';
import { rfpThreadService } from './rfpThreadService.js';

/**
 * Mail filed under a tender. Pinned: a thread quoting a tender's reference is
 * suggested (live tenders first, short references never), filing and
 * unfiling need access to both sides, and a colleague sees a filed thread
 * only if they can read it.
 */

const shareRfp = (rfpId: string, from: string, to: string) =>
  prisma.rfpShare.create({ data: { rfpId, sharedByUserId: from, sharedWithUserId: to } });

describe('rfpThreadService.forThread', () => {
  it('suggests the tenders a thread quotes, live ones first, ignoring spacing and case', async () => {
    const { alice } = await createTwoUsers();
    const live = await createRfp(alice.id, { name: 'Refonte AIX', reference: '70/AOO/BKAM/2026', deadlineAt: new Date('2026-10-01') });
    const won = await createRfp(alice.id, { name: 'Old', reference: '12/AOO/DGI/2025', status: 'WON', deadlineAt: new Date('2025-01-01') });
    await createRfp(alice.id, { name: 'Unrelated', reference: '99/AOO/ONEE/2026' });
    await createRfp(alice.id, { name: 'Too short', reference: '2026' });
    await createEmail(alice.id, { threadId: 'th', subject: 'RE: AO 70 / AOO / BKAM / 2026 — clarification', snippet: 'Suite à 12/aoo/dgi/2025 …' });

    const { linked, suggested } = await rfpThreadService.forThread(alice.id, 'th');

    expect(linked).toEqual([]);
    expect(suggested.map((r) => r.id)).toEqual([live.id, won.id]);
  });

  it('lists a filed tender as linked, not as a suggestion', async () => {
    const { alice } = await createTwoUsers();
    const rfp = await createRfp(alice.id, { reference: '70/AOO/BKAM/2026' });
    await createEmail(alice.id, { threadId: 'th', subject: 'AO 70/AOO/BKAM/2026' });
    await rfpThreadService.link(alice.id, rfp.id, 'th');

    const { linked, suggested } = await rfpThreadService.forThread(alice.id, 'th');
    expect(linked.map((r) => r.id)).toEqual([rfp.id]);
    expect(suggested).toEqual([]);
  });

  it("never suggests another user's tender, and 404s on a thread the caller cannot read", async () => {
    const { alice, bob } = await createTwoUsers();
    await createRfp(bob.id, { reference: '70/AOO/BKAM/2026' });
    await createEmail(alice.id, { threadId: 'th', subject: 'AO 70/AOO/BKAM/2026' });
    await createEmail(bob.id, { threadId: 'bobs', subject: 'AO 70/AOO/BKAM/2026' });

    expect((await rfpThreadService.forThread(alice.id, 'th')).suggested).toEqual([]);
    await expect(rfpThreadService.forThread(alice.id, 'bobs')).rejects.toMatchObject({ statusCode: 404 });
  });

  it("reads only the caller's copy of a thread — not another mailbox's under the same id", async () => {
    const { alice, bob } = await createTwoUsers();
    await createRfp(alice.id, { reference: '70/AOO/BKAM/2026' });
    await createEmail(alice.id, { threadId: 'same-id', subject: 'Lunch?' });
    await createEmail(bob.id, { threadId: 'same-id', subject: 'AO 70/AOO/BKAM/2026' });

    expect((await rfpThreadService.forThread(alice.id, 'same-id')).suggested).toEqual([]);
  });
});

describe('rfpThreadService.link / threads', () => {
  it('files a thread once, shows its latest message, and unfiles it', async () => {
    const { alice } = await createTwoUsers();
    const rfp = await createRfp(alice.id);
    await createEmail(alice.id, { threadId: 'th', subject: 'Question', receivedAt: new Date('2026-09-20') });
    await createEmail(alice.id, { threadId: 'th', subject: 'RE: Question', from: 'buyer@bkam.ma', receivedAt: new Date('2026-09-22') });

    await rfpThreadService.link(alice.id, rfp.id, 'th');
    const { threads, hidden } = await rfpThreadService.link(alice.id, rfp.id, 'th');

    expect(hidden).toBe(0);
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({ threadId: 'th', subject: 'RE: Question', from: 'buyer@bkam.ma', messages: 2, linkedBy: null });

    expect((await rfpThreadService.unlink(alice.id, rfp.id, 'th')).threads).toEqual([]);
  });

  it('needs access to both the tender and the thread', async () => {
    const { alice, bob } = await createTwoUsers();
    const alicesRfp = await createRfp(alice.id);
    const bobsRfp = await createRfp(bob.id);
    await createEmail(alice.id, { threadId: 'th' });
    await createEmail(bob.id, { threadId: 'bobs' });

    await expect(rfpThreadService.link(alice.id, bobsRfp.id, 'th')).rejects.toMatchObject({ statusCode: 404, code: 'RFP_NOT_FOUND' });
    await expect(rfpThreadService.link(alice.id, alicesRfp.id, 'bobs')).rejects.toMatchObject({ statusCode: 404, code: 'THREAD_NOT_FOUND' });
    expect(await prisma.rfpThread.count()).toBe(0);
    // Filed by Alice; Bob cannot unfile it.
    await rfpThreadService.link(alice.id, alicesRfp.id, 'th');
    await expect(rfpThreadService.unlink(bob.id, alicesRfp.id, 'th')).rejects.toMatchObject({ statusCode: 404 });
    expect(await prisma.rfpThread.count()).toBe(1);
  });

  it('shows a colleague the threads they can read, and counts the rest', async () => {
    const { alice, bob } = await createTwoUsers();
    const rfp = await createRfp(alice.id);
    await shareRfp(rfp.id, alice.id, bob.id);
    await createEmail(alice.id, { threadId: 'private', subject: 'Internal pricing' });
    await createEmail(alice.id, { threadId: 'shared', subject: 'Buyer answer' });
    await shareThreadWith('shared', alice.id, bob.id);
    await rfpThreadService.link(alice.id, rfp.id, 'private');
    await rfpThreadService.link(alice.id, rfp.id, 'shared');

    const seen = await rfpThreadService.threads(bob.id, rfp.id);

    expect(seen.threads.map((t) => t.subject)).toEqual(['Buyer answer']);
    expect(seen.threads[0].linkedBy).toBe('Alice');
    expect(seen.hidden).toBe(1);
  });
});
