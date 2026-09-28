import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { repliesOwed, addressOf } from './repliesOwedService.js';
import { createTwoUsers } from '../test/factories.js';

const NOW = new Date('2026-09-28T09:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

let n = 0;
async function mail(userId: string, over: { thread: string; from: string; to?: string[]; at: Date; labels?: string[]; archived?: boolean; trashed?: boolean; subject?: string }) {
  return prisma.email.create({
    data: {
      userId,
      gmailMessageId: `g-${++n}`,
      threadId: over.thread,
      subject: over.subject ?? over.thread,
      from: over.from,
      to: over.to ?? [],
      receivedAt: over.at,
      labelIds: over.labels ?? ['INBOX'],
      isArchived: over.archived ?? false,
      isTrashed: over.trashed ?? false,
    },
  });
}

describe('repliesOwed', () => {
  it('lists threads whose last message is from a person, to me, still in the inbox — oldest wait first', async () => {
    const { alice } = await createTwoUsers();
    const me = alice.email;
    await mail(alice.id, { thread: 'a', from: 'Omar <omar@bkam.ma>', to: [me], at: hoursAgo(5) });
    await mail(alice.id, { thread: 'b', from: 'salma@dgi.gov.ma', to: [`Alice <${me}>`], at: hoursAgo(30) });

    const owed = await repliesOwed(alice.id, NOW);

    expect(owed.map((o) => o.threadId)).toEqual(['b', 'a']);
    expect(owed[1]).toMatchObject({ from: 'Omar <omar@bkam.ma>', subject: 'a' });
  });

  it('drops a thread I answered last, even from another of my addresses', async () => {
    const { alice } = await createTwoUsers();
    const me = alice.email;
    await mail(alice.id, { thread: 'a', from: 'omar@bkam.ma', to: [me], at: hoursAgo(5) });
    await mail(alice.id, { thread: 'a', from: `Alice <${me}>`, to: ['omar@bkam.ma'], at: hoursAgo(4), labels: ['SENT'] });
    // Replied from an alias the user has sent from before.
    await mail(alice.id, { thread: 'old', from: 'alias@powerm.ma', to: ['x@y.ma'], at: hoursAgo(200), labels: ['SENT'] });
    await mail(alice.id, { thread: 'b', from: 'salma@dgi.gov.ma', to: ['alias@powerm.ma'], at: hoursAgo(6) });
    // In the inbox rather than Sent, and copied to the login address — only
    // knowing the alias is the user's own keeps it off the list.
    await mail(alice.id, { thread: 'b', from: 'alias@powerm.ma', to: ['salma@dgi.gov.ma', me], at: hoursAgo(3), labels: ['INBOX'] });

    expect(await repliesOwed(alice.id, NOW)).toEqual([]);
  });

  it('ignores automated senders, the other tabs, CC-only mail, archived, trashed and old threads', async () => {
    const { alice } = await createTwoUsers();
    const me = alice.email;
    await mail(alice.id, { thread: 'bot', from: 'noreply@bank.ma', to: [me], at: hoursAgo(2) });
    await mail(alice.id, { thread: 'promo', from: 'omar@shop.ma', to: [me], at: hoursAgo(2), labels: ['INBOX', 'CATEGORY_PROMOTIONS'] });
    await mail(alice.id, { thread: 'cc', from: 'omar@bkam.ma', to: ['someone@bkam.ma'], at: hoursAgo(2) });
    await mail(alice.id, { thread: 'arch', from: 'omar@bkam.ma', to: [me], at: hoursAgo(2), archived: true });
    await mail(alice.id, { thread: 'trash', from: 'omar@bkam.ma', to: [me], at: hoursAgo(2), trashed: true });
    await mail(alice.id, { thread: 'old', from: 'omar@bkam.ma', to: [me], at: hoursAgo(24 * 15) });
    await mail(alice.id, { thread: 'kept', from: 'omar@bkam.ma', to: [me], at: hoursAgo(2) });

    expect((await repliesOwed(alice.id, NOW)).map((o) => o.threadId)).toEqual(['kept']);
  });

  it('survives a message with no recipients or labels recorded', async () => {
    const { alice } = await createTwoUsers();
    await prisma.$executeRaw`INSERT INTO emails (id, user_id, gmail_message_id, thread_id, subject, "from", received_at, "to", label_ids, created_at)
      VALUES (gen_random_uuid()::text, ${alice.id}, 'g-null', 'nulls', 'x', 'omar@bkam.ma', ${hoursAgo(1)}, NULL, NULL, NOW())`;
    expect(await repliesOwed(alice.id, NOW)).toEqual([]);
  });

  it("never reads another user's mail", async () => {
    const { alice, bob } = await createTwoUsers();
    await mail(bob.id, { thread: 'bobs', from: 'omar@bkam.ma', to: [alice.email], at: hoursAgo(2) });
    expect(await repliesOwed(alice.id, NOW)).toEqual([]);
  });

  it('reads the address out of a display name', () => {
    expect(addressOf('Omar Aly <Omar@BKAM.ma>')).toBe('omar@bkam.ma');
    expect(addressOf(' salma@dgi.gov.ma ')).toBe('salma@dgi.gov.ma');
  });
});
