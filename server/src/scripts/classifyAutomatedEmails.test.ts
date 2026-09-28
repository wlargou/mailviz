import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createUser, createEmail } from '../test/factories.js';
import { classifyAutomatedEmails } from './classifyAutomatedEmails.js';

/**
 * The backfill for `emails.is_automated`. It rewrites live rows, so what is
 * pinned is: it flags machine senders and only them, never the account's own
 * mail, clears a flag the vocabulary no longer supports, writes nothing on a
 * dry run, and is a no-op the second time.
 */

const flagOf = async (id: string) =>
  (await prisma.email.findUniqueOrThrow({ where: { id } })).isAutomated;

describe('classifyAutomatedEmails', () => {
  it('flags mail from machines, clears a stale flag, and leaves people and the account alone', async () => {
    const { alice } = await createTwoUsers();
    const bot = await createEmail(alice.id, { from: 'noreply@bank.test' });
    const bot2 = await createEmail(alice.id, { from: 'noreply@bank.test' });
    const person = await createEmail(alice.id, { from: 'nadia.alami@client.test' });
    const stale = await createEmail(alice.id, { from: 'karim@client.test', isAutomated: true });
    const own = await createEmail(alice.id, { from: alice.email });

    const result = await classifyAutomatedEmails({ apply: true });

    expect(result).toMatchObject({ toFlag: 2, toClear: 1 });
    expect(await flagOf(bot.id)).toBe(true);
    expect(await flagOf(bot2.id)).toBe(true);
    expect(await flagOf(person.id)).toBe(false);
    expect(await flagOf(stale.id)).toBe(false);
    expect(await flagOf(own.id)).toBe(false);

    expect(await classifyAutomatedEmails({ apply: true })).toMatchObject({ toFlag: 0, toClear: 0 });
  });

  it('never flags the account\u2019s own mail, even when its address reads like a machine', async () => {
    const user = await createUser({ email: 'no-reply@powerm.test' });
    const sent = await createEmail(user.id, { from: 'no-reply@powerm.test' });

    const result = await classifyAutomatedEmails({ apply: true });

    expect(result.toFlag).toBe(0);
    expect(await flagOf(sent.id)).toBe(false);
  });

  it('flags a system display name, and only under that name', async () => {
    const { alice } = await createTwoUsers();
    const cron = await createEmail(alice.id, { from: 'ess.dgm@meteo.test', fromName: 'root', subject: 'TSM report' });
    const person = await createEmail(alice.id, { from: 'ess.dgm@meteo.test', fromName: 'Driss El Ghali' });

    await classifyAutomatedEmails({ apply: true });

    expect(await flagOf(cron.id)).toBe(true);
    expect(await flagOf(person.id)).toBe(false);
  });

  it('writes nothing on a dry run', async () => {
    const { alice } = await createTwoUsers();
    const bot = await createEmail(alice.id, { from: 'notifications@saas.test' });

    const result = await classifyAutomatedEmails({ apply: false });

    expect(result.toFlag).toBe(1);
    expect(await flagOf(bot.id)).toBe(false);
  });
});
