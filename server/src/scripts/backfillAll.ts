/**
 * Every data backfill, in order, in one command.
 *
 *     npm run backfill --workspace=server           # dry run, writes nothing
 *     npm run backfill --workspace=server -- --apply
 *
 * On Railway, run it *inside* the container — not with `railway run`, which
 * executes locally against an internal hostname that does not resolve from
 * outside the network:
 *
 *     railway ssh node /app/server/dist/scripts/backfillAll.js
 *     railway ssh node /app/server/dist/scripts/backfillAll.js --apply
 *
 * These exist as scripts rather than migrations on purpose: each encodes a
 * heuristic that will be tuned (a public-suffix list, a role vocabulary), and
 * re-running one after a change should be a deliberate act rather than a side
 * effect of deploying. That was the right call and it still cost something — the
 * steps were undocumented and easy to forget, so a freshly deployed environment
 * kept every column default and the contact filters looked broken: `kind`
 * defaults to `person`, so "people" matches everything, and `engagement` defaults
 * to `none`, so "has exchanged mail" matches nothing.
 *
 * One command with a summary is the fix. Order matters — domains are repaired
 * before anything derived from a contact's company is computed.
 *
 * Every step is idempotent, so running this on an already-backfilled database is
 * a no-op that reports zero changes.
 */

import { prisma } from '../lib/prisma.js';
import { repairJunkDomains } from './repairJunkDomains.js';
import { refileOwnDomainEmails } from './refileOwnDomainEmails.js';
import { classifyContactKinds } from './classifyContactKinds.js';
import { backfillContactEngagement } from './backfillContactEngagement.js';

const apply = process.argv.includes('--apply');

async function main() {
  console.log(
    apply
      ? 'Running every backfill. Each step is idempotent.'
      : 'DRY RUN — nothing will be written. Re-run with --apply.'
  );

  // 1. Domains first: customers get merged and re-pointed here, and the contact
  //    classifier reads a contact's company name.
  console.log('\n[1/4] Repairing customers created by the public-suffix bug');
  const domains = await repairJunkDomains({ apply });
  console.log(
    `      ${domains.junkCustomers} junk customers, ${domains.emailsRelinked} emails and ` +
      `${domains.contactsRelinked} contacts re-linked, ${domains.junkCustomersDeleted} removed`
  );

  // 2. Then outbound mail, which changes which customer an email belongs to.
  console.log('\n[2/4] Re-filing outbound mail onto the recipient company');
  const refiled = await refileOwnDomainEmails({ apply });
  console.log(`      ${refiled.refiled ?? 0} emails re-filed`);

  // 3. Contact kind, which reads the (now correct) company name.
  console.log('\n[3/4] Classifying contacts as person / role / automated');
  const kinds = await classifyContactKinds({ apply });
  console.log(
    `      ${kinds.counts.person} person, ${kinds.counts.role} role, ` +
      `${kinds.counts.automated} automated (${kinds.changed} rows to change)`
  );

  // 4. Engagement, derived from the mail as it now stands.
  console.log('\n[4/4] Computing which way mail has flowed');
  const engagement = await backfillContactEngagement({ apply });
  console.log(
    `      ${engagement.counts.both} both, ${engagement.counts.sender} sender, ` +
      `${engagement.counts.receiver} receiver, ${engagement.counts.none} none ` +
      `(${engagement.changed} rows to change)`
  );

  if (!apply) console.log('\nNothing was written. Re-run with --apply.');
  else console.log('\nDone.');
}

main()
  .catch((err) => {
    console.error('\nBackfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
