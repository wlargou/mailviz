import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { createUser } from '../test/factories.js';
import { decodeTaskEntities } from './decodeTaskEntities.js';

/**
 * The repair rewrites live rows, so what is worth pinning is the destructive
 * side: it must not touch a row it does not improve, must not corrupt a title
 * someone typed by hand, and must be safe to run twice.
 */

async function task(userId: string, title: string, description: string | null = null) {
  return prisma.task.create({ data: { userId, title, description } });
}

describe('decodeTaskEntities', () => {
  it('decodes the entities Gmail left in a converted task', async () => {
    const user = await createUser();
    const row = await task(user.id, 'R&amp;D suivi', 'Merci d&#39;avance pour votre &lt;retour&gt;');

    const result = await decodeTaskEntities({ apply: true });

    expect(result.changed).toBe(1);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.title).toBe('R&D suivi');
    expect(after.description).toBe("Merci d'avance pour votre <retour>");
  });

  it('leaves a row alone when decoding would not change it', async () => {
    // "R&D" matches the `contains: '&'` pre-filter but decodes to itself. The
    // per-row comparison is what decides, so this must not be counted or
    // written — an UPDATE here would bump `updatedAt` on rows nothing is wrong
    // with, which is exactly the noise that makes a repair hard to audit.
    const user = await createUser();
    const row = await task(user.id, 'R&D pipeline', 'plain & simple');
    const before = await prisma.task.findUniqueOrThrow({ where: { id: row.id } });

    const result = await decodeTaskEntities({ apply: true });

    expect(result.scanned).toBe(1);
    expect(result.changed).toBe(0);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });

  it('refuses a double-encoded row rather than guessing how many layers to peel', async () => {
    // `&amp;lt;` is Gmail escaping text whose literal content was `&lt;`. One
    // decode gives `&lt;` — correct — and a second gives `<`, which is wrong
    // and irreversible. Since the script has to survive being re-run, the only
    // safe answer for a value whose decode is unstable is to leave it and say
    // so.
    const user = await createUser();
    const row = await task(user.id, 'A &amp;lt;b&amp;gt; C', 'x &amp;amp; y');

    const result = await decodeTaskEntities({ apply: true });

    expect(result.ambiguous).toBe(1);
    expect(result.changed).toBe(0);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.title).toBe('A &amp;lt;b&amp;gt; C');
  });

  it('is safe to run twice', async () => {
    const user = await createUser();
    const row = await task(user.id, 'R&amp;D suivi', 'Merci d&#39;avance');

    await decodeTaskEntities({ apply: true });
    const once = await prisma.task.findUniqueOrThrow({ where: { id: row.id } });

    const second = await decodeTaskEntities({ apply: true });
    const twice = await prisma.task.findUniqueOrThrow({ where: { id: row.id } });

    expect(once.title).toBe('R&D suivi');
    expect(twice.title).toBe(once.title);
    expect(twice.description).toBe(once.description);
    expect(second.changed).toBe(0);
  });

  it('writes nothing on a dry run', async () => {
    const user = await createUser();
    const row = await task(user.id, 'R&amp;D suivi');

    const result = await decodeTaskEntities({ apply: false });

    expect(result.changed).toBe(1);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.title).toBe('R&amp;D suivi');
  });

  it('leaves a task with no entities untouched and unscanned', async () => {
    const user = await createUser();
    await task(user.id, 'Renew the maintenance contract', 'no entities here');

    const result = await decodeTaskEntities({ apply: true });

    expect(result.scanned).toBe(0);
    expect(result.changed).toBe(0);
  });
});
