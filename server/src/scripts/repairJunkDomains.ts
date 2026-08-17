/**
 * Repairs customers created by the public-suffix bug in `domainResolver`.
 *
 * Before that fix, `normalizeDomain('intelcom.co.ma')` returned the bare suffix
 * `co.ma`, so every organisation on a country second-level domain was filed
 * under one junk customer named "CO" (or "COM"). Fixing the resolver stops new
 * mail landing there; it does nothing for what already has.
 *
 * This is a script rather than a Prisma migration on purpose. Re-deriving the
 * correct domain means running the real resolver over each address, and
 * reimplementing that in migration SQL would create a second copy of the logic
 * that could silently drift from the first — which is exactly the bug being
 * repaired. Running it is therefore a deliberate, per-environment act:
 *
 *     npx tsx src/scripts/repairJunkDomains.ts            # dry run, writes nothing
 *     npx tsx src/scripts/repairJunkDomains.ts --apply    # perform the repair
 *
 * It is idempotent: once repaired there are no bare-suffix customers left, so a
 * second run finds nothing to do.
 */

import { prisma } from '../lib/prisma.js';
import { customerService } from '../services/customerService.js';
import {
  extractDomain,
  isBarePublicSuffix,
  isPersonalDomain,
  normalizeDomain,
} from '../utils/domainResolver.js';

interface RepairSummary {
  junkCustomers: number;
  emailsRelinked: number;
  emailsUnlinked: number;
  contactsRelinked: number;
  calendarLinksRewritten: number;
  customersCreated: number;
  junkCustomersDeleted: number;
  /** Junk customers still holding rows after the pass — never deleted blindly. */
  skipped: Array<{ domain: string; reason: string }>;
  /** Addresses that now collide with an existing contact under the right company. */
  possibleDuplicateContacts: number;
}

/**
 * The company domain for an address, or null when the address belongs to no
 * company (a personal mail host, or unparseable).
 */
function companyDomainFor(address: string | null | undefined): string | null {
  if (!address) return null;
  const raw = extractDomain(address);
  if (!raw || isPersonalDomain(raw)) return null;
  return normalizeDomain(raw);
}

/**
 * Which company a message belongs to, using the same precedence as
 * `emailService.upsertMessage`: the first address among from/to/cc that resolves
 * to a company. Mirroring the ingest path matters — a repair that files mail
 * differently from the sync would fight with it on the next pass.
 */
function companyDomainForEmail(email: {
  from: string | null;
  to: string[];
  cc: string[];
}): string | null {
  for (const address of [email.from, ...email.to, ...email.cc]) {
    const domain = companyDomainFor(address);
    if (domain) return domain;
  }
  return null;
}

export async function repairJunkDomains({ apply }: { apply: boolean }): Promise<RepairSummary> {
  const summary: RepairSummary = {
    junkCustomers: 0,
    emailsRelinked: 0,
    emailsUnlinked: 0,
    contactsRelinked: 0,
    calendarLinksRewritten: 0,
    customersCreated: 0,
    junkCustomersDeleted: 0,
    skipped: [],
    possibleDuplicateContacts: 0,
  };

  // Bare-suffix domains are short and few, so filtering in JS with the real
  // predicate beats trying to express the suffix list as SQL.
  const candidates = await prisma.customer.findMany({
    select: { id: true, userId: true, domain: true, name: true },
  });
  const junk = candidates.filter((c) => c.domain && isBarePublicSuffix(c.domain));
  summary.junkCustomers = junk.length;

  // Resolving a domain to a customer is the same lookup over and over; cache it
  // so a 700-email repair doesn't issue 700 identical queries.
  const resolved = new Map<string, string>();
  async function customerIdFor(userId: string, domain: string): Promise<string> {
    const key = `${userId}:${domain}`;
    const hit = resolved.get(key);
    if (hit) return hit;
    if (!apply) {
      // Dry run: report what would be created without writing.
      const existing = await prisma.customer.findUnique({
        where: { userId_domain: { userId, domain } },
        select: { id: true },
      });
      if (!existing) summary.customersCreated++;
      const id = existing?.id ?? `would-create:${domain}`;
      resolved.set(key, id);
      return id;
    }
    const { customer, created } = await customerService.findOrCreateByDomain(userId, domain);
    if (created) summary.customersCreated++;
    resolved.set(key, customer.id);
    return customer.id;
  }

  for (const customer of junk) {
    const { id: junkId, userId, domain: junkDomain } = customer;

    // --- emails -------------------------------------------------------------
    const emails = await prisma.email.findMany({
      where: { customerId: junkId },
      select: { id: true, from: true, to: true, cc: true },
    });
    for (const email of emails) {
      const domain = companyDomainForEmail(email);
      if (!domain || isBarePublicSuffix(domain)) {
        // No company owns this message. Leave it linked to nothing rather than
        // to a company it does not belong to; `customerId` is nullable.
        summary.emailsUnlinked++;
        if (apply) {
          await prisma.email.update({ where: { id: email.id }, data: { customerId: null } });
        }
        continue;
      }
      const targetId = await customerIdFor(userId!, domain);
      summary.emailsRelinked++;
      if (apply) {
        await prisma.email.update({ where: { id: email.id }, data: { customerId: targetId } });
      }
    }

    // --- contacts -----------------------------------------------------------
    const contacts = await prisma.contact.findMany({
      where: { customerId: junkId },
      select: { id: true, email: true },
    });
    for (const contact of contacts) {
      const domain = companyDomainFor(contact.email);
      if (!domain || isBarePublicSuffix(domain)) continue;
      const targetId = await customerIdFor(userId!, domain);

      // A contact at this address may already exist under the correct company.
      // Report it instead of merging: merging destroys rows and there is a
      // reviewed tool for that (`contactMergeService`).
      if (apply && contact.email) {
        const clash = await prisma.contact.findFirst({
          where: { customerId: targetId, email: contact.email },
          select: { id: true },
        });
        if (clash) summary.possibleDuplicateContacts++;
      }

      summary.contactsRelinked++;
      if (apply) {
        await prisma.contact.update({ where: { id: contact.id }, data: { customerId: targetId } });
      }
    }

    // --- calendar links -----------------------------------------------------
    // Recomputed from the event's attendees, the same way calendarService links
    // them on sync. The junk link itself disappears with the junk customer.
    const links = await prisma.calendarEventCustomer.findMany({
      where: { customerId: junkId },
      select: { calendarEventId: true, calendarEvent: { select: { attendees: true } } },
    });
    for (const link of links) {
      const attendees =
        (link.calendarEvent?.attendees as unknown as Array<{ email: string; self?: boolean }> | null) ?? [];
      const domains = new Set<string>();
      for (const attendee of attendees) {
        if (attendee.self) continue;
        const domain = companyDomainFor(attendee.email);
        if (domain && !isBarePublicSuffix(domain)) domains.add(domain);
      }
      for (const domain of domains) {
        const targetId = await customerIdFor(userId!, domain);
        // Most of these links already exist — calendarService created them on
        // sync for every attendee domain, and only the junk one was wrong. Skip
        // the ones already there so the reported count is real work, not the
        // number of no-op upserts.
        const existing = await prisma.calendarEventCustomer.findUnique({
          where: {
            calendarEventId_customerId: { calendarEventId: link.calendarEventId, customerId: targetId },
          },
          select: { customerId: true },
        });
        if (existing) continue;
        summary.calendarLinksRewritten++;
        if (apply) {
          await prisma.calendarEventCustomer.create({
            data: { calendarEventId: link.calendarEventId, customerId: targetId },
          });
        }
      }
    }

    // --- delete the junk customer, but only once it is genuinely empty -------
    if (!apply) continue;
    const [remainingEmails, remainingContacts, deals, tasks] = await Promise.all([
      prisma.email.count({ where: { customerId: junkId } }),
      prisma.contact.count({ where: { customerId: junkId } }),
      prisma.deal.count({ where: { customerId: junkId } }),
      prisma.task.count({ where: { customerId: junkId } }),
    ]);
    const blockers = [
      remainingEmails && `${remainingEmails} emails`,
      remainingContacts && `${remainingContacts} contacts`,
      deals && `${deals} deals`,
      tasks && `${tasks} tasks`,
    ].filter(Boolean) as string[];

    if (blockers.length > 0) {
      // Deleting would cascade and destroy them. Leave the customer in place.
      summary.skipped.push({ domain: junkDomain!, reason: `still holds ${blockers.join(', ')}` });
      continue;
    }
    await prisma.customer.delete({ where: { id: junkId } });
    summary.junkCustomersDeleted++;
  }

  return summary;
}

// Run only when invoked directly, so the test suite can import the function.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const apply = process.argv.includes('--apply');
  console.log(apply ? 'Repairing junk-domain customers…' : 'DRY RUN — nothing will be written.');
  repairJunkDomains({ apply })
    .then(async (s) => {
      console.log('');
      console.log('  junk customers found      ', s.junkCustomers);
      console.log('  correct customers created ', s.customersCreated);
      console.log('  emails re-linked          ', s.emailsRelinked);
      console.log('  emails unlinked (no company)', s.emailsUnlinked);
      console.log('  contacts re-linked        ', s.contactsRelinked);
      console.log('  calendar links rewritten  ', s.calendarLinksRewritten);
      console.log('  junk customers deleted    ', s.junkCustomersDeleted);
      if (s.possibleDuplicateContacts > 0) {
        console.log('');
        console.log(
          `  ${s.possibleDuplicateContacts} contact(s) now share an address with an existing contact ` +
            'under the correct company. Review them with the duplicates tool.'
        );
      }
      if (s.skipped.length > 0) {
        console.log('');
        console.log('  NOT deleted:');
        for (const skip of s.skipped) console.log(`    ${skip.domain} — ${skip.reason}`);
      }
      if (!apply) console.log('\nRe-run with --apply to perform the repair.');
      await prisma.$disconnect();
    })
    .catch(async (err) => {
      console.error('Repair failed:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
