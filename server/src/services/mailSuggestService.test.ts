import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createEmail, createCustomer, createContact } from '../test/factories.js';
import { suggestMail } from './mailSuggestService.js';

/**
 * The Mail search box's suggestions. Pinned: a person is found by name or
 * address whichever way mail went, named by their latest mail or a contact,
 * never you and never another user's correspondent; people rank before
 * machines; typed wildcards are literal; threads come once each, newest
 * first, never from the trash.
 */

const days = (n: number) => new Date(Date.now() - n * 86_400_000);

async function sent(userId: string, from: string, to: string[], cc: string[] = [], bcc: string[] = []) {
  const e = await createEmail(userId, { from, labelIds: ['SENT'] });
  return prisma.email.update({ where: { id: e.id }, data: { to, cc, bcc } });
}

describe('suggestMail — people', () => {
  it('finds a sender by name or address, named by their latest mail, and never you', async () => {
    const { alice } = await createTwoUsers();
    await createEmail(alice.id, { from: 'omar@bkam.test', fromName: 'OMAR', receivedAt: days(9) });
    await createEmail(alice.id, { from: 'omar@bkam.test', fromName: 'Omar Alami', receivedAt: days(1) });
    // Alice's own mail, with a name that matches: not a suggestion.
    await createEmail(alice.id, { from: alice.email, fromName: 'Omar fan club', labelIds: ['SENT'] });

    const byName = await suggestMail(alice.id, 'alami');
    expect(byName.people).toEqual([
      expect.objectContaining({ address: 'omar@bkam.test', name: 'Omar Alami', messages: 2, automated: false }),
    ]);
    const byAddress = await suggestMail(alice.id, 'bkam');
    expect(byAddress.people.map((p) => p.address)).toEqual(['omar@bkam.test']);
    expect((await suggestMail(alice.id, 'fan club')).people).toEqual([]);
  });

  it('finds someone you have only written to — to, cc or bcc — named from contacts', async () => {
    const { alice } = await createTwoUsers();
    const acme = await createCustomer(alice.id);
    await createContact(acme.id, { firstName: 'Nadia', lastName: 'Bennani', email: 'nadia@gmail.test' });
    await sent(alice.id, alice.email, ['nadia@gmail.test'], ['karim@x.test'], ['hidden@x.test']);

    expect((await suggestMail(alice.id, 'nadia')).people).toEqual([
      expect.objectContaining({ address: 'nadia@gmail.test', name: 'Nadia Bennani', messages: 1 }),
    ]);
    expect((await suggestMail(alice.id, 'karim')).people).toEqual([
      expect.objectContaining({ address: 'karim@x.test', name: null }),
    ]);
    expect((await suggestMail(alice.id, 'hidden')).people.map((p) => p.address)).toEqual(['hidden@x.test']);
  });

  it('counts mail both ways, and puts people before machines', async () => {
    const { alice } = await createTwoUsers();
    for (let i = 0; i < 5; i++) {
      await createEmail(alice.id, { from: 'noreply@omar-shop.test', fromName: 'Omar Shop', isAutomated: true });
    }
    await createEmail(alice.id, { from: 'omar@bkam.test', fromName: 'Omar Alami' });
    await sent(alice.id, alice.email, ['omar@bkam.test']);

    const { people } = await suggestMail(alice.id, 'omar');
    expect(people.map((p) => [p.address, p.messages, p.automated])).toEqual([
      ['omar@bkam.test', 2, false],
      ['noreply@omar-shop.test', 5, true],
    ]);
  });

  it('counts a machine-looking sender you have written to as a person', async () => {
    const { alice } = await createTwoUsers();
    await createEmail(alice.id, { from: 'support@vendor.test', fromName: 'Vendor Support', isAutomated: true });
    await sent(alice.id, alice.email, ['support@vendor.test']);

    expect((await suggestMail(alice.id, 'vendor')).people).toEqual([
      expect.objectContaining({ address: 'support@vendor.test', messages: 2, automated: false }),
    ]);
  });

  it('reads % and _ as themselves', async () => {
    const { alice } = await createTwoUsers();
    await createEmail(alice.id, { from: 'a_b@x.test' });
    await createEmail(alice.id, { from: 'axb@x.test' });

    expect((await suggestMail(alice.id, 'a_b')).people.map((p) => p.address)).toEqual(['a_b@x.test']);
    expect((await suggestMail(alice.id, '%%')).people).toEqual([]);
  });

  it('matches every word, in any order', async () => {
    const { alice } = await createTwoUsers();
    await createEmail(alice.id, { from: 'o.alami@bkam.test', fromName: 'ALAMI Omar' });
    await createEmail(alice.id, { from: 'omar@other.test', fromName: 'Omar Benali' });

    expect((await suggestMail(alice.id, 'omar alami')).people.map((p) => p.address)).toEqual(['o.alami@bkam.test']);
    expect((await suggestMail(alice.id, '  alami   bkam ')).people.map((p) => p.address)).toEqual(['o.alami@bkam.test']);
  });

  it("never suggests another user's correspondents", async () => {
    const { alice, bob } = await createTwoUsers();
    await createEmail(bob.id, { from: 'omar@secret.test', fromName: 'Omar Secret' });
    await sent(bob.id, bob.email, ['omar2@secret.test']);
    // The same correspondent writes to both: Bob's mail is not Alice's count.
    await createEmail(bob.id, { from: 'omar@bkam.test' });
    await createEmail(alice.id, { from: 'omar@bkam.test' });

    const { people } = await suggestMail(alice.id, 'omar');
    expect(people.map((p) => [p.address, p.messages])).toEqual([['omar@bkam.test', 1]]);
  });

  it("never lets another user's mail crowd yours out of the shortlist", async () => {
    // Matching senders are shortlisted fifty at a time, busiest first. Bob's
    // busier ones must not take the places — nothing of his would show, but
    // Alice's own correspondent would be gone.
    const { alice, bob } = await createTwoUsers();
    await prisma.email.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        userId: bob.id,
        gmailMessageId: `bob-${i}`,
        threadId: `bob-t${i}`,
        subject: 'x',
        from: `omar${i % 60}@crowd.test`,
        receivedAt: new Date(),
      })),
    });
    await createEmail(alice.id, { from: 'omar@bkam.test' });

    expect((await suggestMail(alice.id, 'omar')).people.map((p) => p.address)).toEqual(['omar@bkam.test']);
  });

  it('needs two characters', async () => {
    const { alice } = await createTwoUsers();
    await createEmail(alice.id, { from: 'o@x.test', subject: 'o' });
    expect(await suggestMail(alice.id, ' o ')).toEqual({ people: [], threads: [] });
  });
});

describe('suggestMail — threads', () => {
  it('suggests each thread once, by its newest message, newest first, not from the trash', async () => {
    const { alice, bob } = await createTwoUsers();
    await createEmail(alice.id, { threadId: 't1', subject: 'Offer for BKAM', receivedAt: days(5) });
    const newest = await createEmail(alice.id, { threadId: 't1', subject: 'Re: Offer for BKAM', receivedAt: days(1) });
    await createEmail(alice.id, { threadId: 't2', subject: 'Offer binned', receivedAt: days(2), isTrashed: true });
    await createEmail(alice.id, { threadId: 't3', subject: 'Old offer', receivedAt: days(20) });
    await createEmail(bob.id, { threadId: 't4', subject: "Bob's offer", receivedAt: days(1) });

    const { threads } = await suggestMail(alice.id, 'offer');
    expect(threads.map((t) => [t.threadId, t.subject])).toEqual([
      ['t1', 'Re: Offer for BKAM'],
      ['t3', 'Old offer'],
    ]);
    expect(threads[0].emailId).toBe(newest.id);
  });

  it('matches every word of a subject, in any order', async () => {
    const { alice } = await createTwoUsers();
    await createEmail(alice.id, { threadId: 't-yes', subject: 'Offre technique BKAM' });
    await createEmail(alice.id, { threadId: 't-no', subject: 'Offre financière' });

    expect((await suggestMail(alice.id, 'bkam offre')).threads.map((t) => t.threadId)).toEqual(['t-yes']);
  });

  it('matches a sender, and stops at five', async () => {
    const { alice } = await createTwoUsers();
    for (let i = 0; i < 7; i++) {
      await createEmail(alice.id, { threadId: `t${i}`, from: 'hicham@awb.test', fromName: 'GADI-ALAMI HICHAM', subject: `Point ${i}`, receivedAt: days(i) });
    }
    const { threads } = await suggestMail(alice.id, 'hicham');
    expect(threads.map((t) => t.threadId)).toEqual(['t0', 't1', 't2', 't3', 't4']);
  });
});
