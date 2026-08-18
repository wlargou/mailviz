/**
 * Classifies existing contacts as person / role / automated.
 *
 * New contacts are classified at creation; this is for the ~11.7k that predate
 * the column and default to `person`.
 *
 *     npx tsx src/scripts/classifyContactKinds.ts            # dry run
 *     npx tsx src/scripts/classifyContactKinds.ts --apply
 *
 * A script rather than a migration for the same reason as the domain repair: the
 * vocabulary is a heuristic, it will be tuned, and re-running it after a change
 * should be a deliberate act rather than something that happens on deploy. It is
 * idempotent, so re-running after tuning is exactly the intended use.
 *
 * Contacts whose kind was set by hand are not preserved — there is no such edit
 * in the UI yet. When there is, this needs a `kindSetManually` flag to respect.
 */

import { prisma } from '../lib/prisma.js';
import { classifyContactKind, type ContactKind } from '../utils/contactKind.js';

export async function classifyContactKinds({ apply }: { apply: boolean }) {
  const contacts = await prisma.contact.findMany({
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      kind: true,
      customer: { select: { name: true } },
    },
  });

  const counts: Record<ContactKind, number> = { person: 0, role: 0, automated: 0 };
  const changes: Array<{ id: string; kind: ContactKind }> = [];

  for (const contact of contacts) {
    const kind = classifyContactKind({
      email: contact.email,
      firstName: contact.firstName,
      lastName: contact.lastName,
      companyName: contact.customer?.name ?? null,
    });
    counts[kind]++;
    if (kind !== contact.kind) changes.push({ id: contact.id, kind });
  }

  if (apply && changes.length > 0) {
    // Grouped by kind: three UPDATEs rather than one per row.
    for (const kind of ['person', 'role', 'automated'] as const) {
      const ids = changes.filter((c) => c.kind === kind).map((c) => c.id);
      if (ids.length === 0) continue;
      await prisma.contact.updateMany({ where: { id: { in: ids } }, data: { kind } });
    }
  }

  return { total: contacts.length, counts, changed: changes.length };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const apply = process.argv.includes('--apply');
  console.log(apply ? 'Classifying contacts…' : 'DRY RUN — nothing will be written.');
  classifyContactKinds({ apply })
    .then(async (result) => {
      console.log('');
      console.log('  contacts        ', result.total);
      console.log('  person          ', result.counts.person);
      console.log('  role            ', result.counts.role);
      console.log('  automated       ', result.counts.automated);
      console.log('  rows to update  ', result.changed);
      if (!apply) console.log('\nRe-run with --apply to write.');
      await prisma.$disconnect();
    })
    .catch(async (err) => {
      console.error('Failed:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
