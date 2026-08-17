/**
 * Re-files messages that were linked to the account's own company.
 *
 * `upsertMessage` used to pick the first non-personal domain among from/to/cc,
 * which for outbound mail is the sender — the user. Every message the user sent
 * was therefore filed under the user's own company. On the development database
 * that made "Powerm" the largest customer in the system at 33,309 emails, 32,359
 * of them the user's own sent mail, while the recipient's company showed none of
 * it.
 *
 * The resolver is fixed; this moves what is already stored. A script rather than
 * a migration for the same reason as `repairJunkDomains`: deciding the correct
 * customer means running the real address logic over each message, and a second
 * copy of that logic in migration SQL is exactly the kind of drift being
 * repaired here.
 *
 *     npx tsx src/scripts/refileOwnDomainEmails.ts            # dry run
 *     npx tsx src/scripts/refileOwnDomainEmails.ts --apply
 *
 * Idempotent: once nothing is linked to an own-domain customer there is no work
 * left to find.
 */

import { prisma } from '../lib/prisma.js';
import { customerService } from '../services/customerService.js';
import {
  extractDomain,
  isPersonalDomain,
  normalizeDomain,
} from '../utils/domainResolver.js';

interface Summary {
  usersConsidered: number;
  /** Emails moved onto the counterparty's company. */
  refiled: number;
  /** Emails with no counterparty at all — internal mail, now unlinked. */
  unlinked: number;
  customersCreated: number;
  /** Own-domain customers left in place, and why. */
  ownCustomersKept: Array<{ domain: string; contacts: number }>;
}

export async function refileOwnDomainEmails({ apply }: { apply: boolean }): Promise<Summary> {
  const summary: Summary = {
    usersConsidered: 0,
    refiled: 0,
    unlinked: 0,
    customersCreated: 0,
    ownCustomersKept: [],
  };

  const users = await prisma.user.findMany({ select: { id: true, email: true } });

  for (const user of users) {
    const rawOwn = extractDomain(user.email);
    if (!rawOwn || isPersonalDomain(rawOwn)) continue;
    const ownDomain = normalizeDomain(rawOwn);

    const ownCustomer = await prisma.customer.findUnique({
      where: { userId_domain: { userId: user.id, domain: ownDomain } },
      select: { id: true, domain: true },
    });
    if (!ownCustomer) continue;
    summary.usersConsidered++;

    const emails = await prisma.email.findMany({
      where: { customerId: ownCustomer.id },
      select: { id: true, from: true, to: true, cc: true },
    });

    const resolved = new Map<string, string>();
    async function customerIdFor(domain: string): Promise<string | null> {
      const hit = resolved.get(domain);
      if (hit) return hit;
      if (!apply) {
        const existing = await prisma.customer.findUnique({
          where: { userId_domain: { userId: user.id, domain } },
          select: { id: true },
        });
        if (!existing) summary.customersCreated++;
        const id = existing?.id ?? `would-create:${domain}`;
        resolved.set(domain, id);
        return id;
      }
      const { customer, created } = await customerService.findOrCreateByDomain(user.id, domain);
      if (created) summary.customersCreated++;
      resolved.set(domain, customer.id);
      return customer.id;
    }

    for (const email of emails) {
      // The counterparty: the first address that resolves to a company which is
      // not the account's own. Mirrors the fixed logic in `upsertMessage` so the
      // repair and the sync agree about where a message belongs.
      let target: string | null = null;
      for (const address of [email.from, ...email.to, ...email.cc]) {
        if (!address) continue;
        const raw = extractDomain(address);
        if (!raw || isPersonalDomain(raw)) continue;
        const domain = normalizeDomain(raw);
        if (domain === ownDomain) continue;
        target = await customerIdFor(domain);
        break;
      }

      if (target) {
        summary.refiled++;
        if (apply) {
          await prisma.email.update({ where: { id: email.id }, data: { customerId: target } });
        }
      } else {
        // Purely internal. Unlinked rather than left pointing at the user's own
        // company, which is not a customer relationship.
        summary.unlinked++;
        if (apply) {
          await prisma.email.update({ where: { id: email.id }, data: { customerId: null } });
        }
      }
    }

    // The own-domain customer itself is kept, not deleted: its contacts are the
    // user's colleagues, which are worth having. It simply stops holding mail.
    const contacts = await prisma.contact.count({ where: { customerId: ownCustomer.id } });
    summary.ownCustomersKept.push({ domain: ownCustomer.domain!, contacts });
  }

  return summary;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const apply = process.argv.includes('--apply');
  console.log(apply ? 'Re-filing own-domain mail…' : 'DRY RUN — nothing will be written.');
  refileOwnDomainEmails({ apply })
    .then(async (s) => {
      console.log('');
      console.log('  accounts with an own-domain customer', s.usersConsidered);
      console.log('  emails re-filed to the counterparty  ', s.refiled);
      console.log('  emails unlinked (internal only)      ', s.unlinked);
      console.log('  customers created                    ', s.customersCreated);
      for (const kept of s.ownCustomersKept) {
        console.log(`  kept ${kept.domain} for its ${kept.contacts} colleague contact(s)`);
      }
      if (!apply) console.log('\nRe-run with --apply to perform the change.');
      await prisma.$disconnect();
    })
    .catch(async (err) => {
      console.error('Re-filing failed:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
