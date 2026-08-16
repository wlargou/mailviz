import { describe, it, expect } from 'vitest';
import { contactMergeService } from './contactMergeService.js';
import { contactService } from './contactService.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createCustomer, createContact, createEmail } from '../test/factories.js';

/**
 * Duplicate detection and contact merging.
 *
 * Two reasons this file is long. First, a merge deletes rows irreversibly and
 * nothing in the schema points at a contact by foreign key — the link to mail is
 * the email *string* — so "what survives a merge" can only be established by
 * doing one against a real database and looking.
 *
 * Second, contacts have no user column. Ownership is reachable only through
 * `contact.customer.userId`, which is exactly the shape of where-clause that has
 * already leaked across tenants twice in this codebase. Detection and merge are
 * therefore both asserted against a second user's identical-looking data.
 */

/** A contact whose company gives it a real domain, so the matching rules apply. */
async function contactAt(
  customerId: string,
  email: string,
  firstName: string,
  lastName: string,
  overrides: { phone?: string; role?: string; isVip?: boolean } = {}
) {
  return prisma.contact.create({
    data: { customerId, email, firstName, lastName, ...overrides },
  });
}

function groupWith(
  groups: Awaited<ReturnType<typeof contactMergeService.findDuplicates>>['data'],
  ...emails: string[]
) {
  return groups.find((g) => emails.every((e) => g.contacts.some((c) => c.email === e)));
}

describe('contactMergeService.findDuplicates — detection rules', () => {
  it('groups two rows holding the same address', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { domain: 'atlascs.ma' });
    await contactAt(customer.id, 'chaymae.aitahmed@atlascs.ma', 'Chaymae', 'Aitahmed');
    await contactAt(customer.id, 'chaymae.aitahmed@atlascs.ma', 'Chaymae', 'Aitahmed');

    const { data } = await contactMergeService.findDuplicates(alice.id, {});

    expect(data).toHaveLength(1);
    expect(data[0].confidence).toBe('high');
    expect(data[0].rules).toContain('exact_email');
    expect(data[0].contacts).toHaveLength(2);
  });

  it('groups separator variants of one address when the names agree', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { domain: 'dell.com' });
    await contactAt(customer.id, 'ahmed.bouna@dell.com', 'Ahmed', 'Bouna');
    await contactAt(customer.id, 'ahmed_bouna@dell.com', 'Ahmed', 'Bouna');

    const { data } = await contactMergeService.findDuplicates(alice.id, {});

    expect(data).toHaveLength(1);
    expect(data[0].confidence).toBe('medium');
    expect(data[0].rules).toEqual(['alias_local_part']);
  });

  it('matches a name written in the other order', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { domain: 'dell.com' });
    await contactAt(customer.id, 'salma.semlali@dell.com', 'Semlali,', 'Salma');
    await contactAt(customer.id, 'salma_semlali@dell.com', 'Salma', 'Semlali');

    const { data } = await contactMergeService.findDuplicates(alice.id, {});

    expect(data).toHaveLength(1);
  });

  it('groups an abbreviated address with its spelled-out form', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { domain: 'acme.com' });
    await contactAt(customer.id, 'john.smith@acme.com', 'John', 'Smith');
    await contactAt(customer.id, 'jsmith@acme.com', 'John', 'Smith');

    const { data } = await contactMergeService.findDuplicates(alice.id, {});

    expect(data).toHaveLength(1);
    expect(data[0].rules).toEqual(['initial_form']);
  });

  it('does not group addresses whose display names disagree', async () => {
    // Straight from production: one ESP no-reply address used by four unrelated
    // senders. The differing display name is the only thing telling them apart.
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { domain: 'eventbrite.com' });
    await contactAt(customer.id, 'noreply@eventbrite.com', 'Nutanix', '');
    await contactAt(customer.id, 'no-reply@eventbrite.com', 'Slurm', 'User Group');

    const { data } = await contactMergeService.findDuplicates(alice.id, {});

    expect(data).toHaveLength(0);
  });

  it('never groups on display name alone', async () => {
    // Two different people at Dataiku, both stored as "Barbara Rainho" because
    // of how the display name was captured. Name-only matching would merge them.
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { domain: 'dataiku.com' });
    await contactAt(customer.id, 'barbara.rainho@dataiku.com', 'Barbara', 'Rainho');
    await contactAt(customer.id, 'marissa.creatore@dataiku.com', 'Barbara', 'Rainho');

    const { data } = await contactMergeService.findDuplicates(alice.id, {});

    expect(data).toHaveLength(0);
  });

  it('keeps two organisations under one company apart', async () => {
    // `domainToCompanyName` files every *.co.ma sender under a company called
    // "CO", so same-company is not same-organisation. Only the domain guard
    // stops these two `contact@` addresses becoming one contact.
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { domain: 'co.ma' });
    await contactAt(customer.id, 'contact@intelcom.co.ma', 'Contact', '');
    await contactAt(customer.id, 'contact@lydec.co.ma', 'Contact', '');

    const { data } = await contactMergeService.findDuplicates(alice.id, {});

    expect(data).toHaveLength(0);
  });

  it('does not reach across companies', async () => {
    const { alice } = await createTwoUsers();
    const one = await createCustomer(alice.id, { domain: 'dell.com' });
    const two = await createCustomer(alice.id, { domain: 'dell.example' });
    await contactAt(one.id, 'ahmed.bouna@dell.com', 'Ahmed', 'Bouna');
    await contactAt(two.id, 'ahmed_bouna@dell.com', 'Ahmed', 'Bouna');

    const { data } = await contactMergeService.findDuplicates(alice.id, {});

    expect(data).toHaveLength(0);
  });

  it('joins transitively linked rows into one group', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { domain: 'acme.com' });
    await contactAt(customer.id, 'john.smith@acme.com', 'John', 'Smith');
    await contactAt(customer.id, 'john_smith@acme.com', 'John', 'Smith');
    await contactAt(customer.id, 'jsmith@acme.com', 'John', 'Smith');

    const { data } = await contactMergeService.findDuplicates(alice.id, {});

    expect(data).toHaveLength(1);
    expect(data[0].contacts).toHaveLength(3);
    expect(data[0].rules.sort()).toEqual(['alias_local_part', 'initial_form']);
  });

  it('suggests keeping the row with the most mail behind it', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { domain: 'dell.com' });
    await contactAt(customer.id, 'sara.maach@dell.com', 'Sara', 'Maach');
    const busy = await contactAt(customer.id, 'sara_maach@dell.com', 'Sara', 'Maach');
    await createEmail(alice.id, { from: 'sara_maach@dell.com' });
    await createEmail(alice.id, { from: 'sara_maach@dell.com' });

    const { data } = await contactMergeService.findDuplicates(alice.id, {});

    expect(data[0].suggestedPrimaryId).toBe(busy.id);
    expect(data[0].contacts.find((c) => c.id === busy.id)?.emailCount).toBe(2);
  });

  it('paginates groups', async () => {
    const { alice } = await createTwoUsers();
    for (const domain of ['a.example', 'b.example', 'c.example']) {
      const customer = await createCustomer(alice.id, { domain });
      await contactAt(customer.id, `jane.doe@${domain}`, 'Jane', 'Doe');
      await contactAt(customer.id, `jane_doe@${domain}`, 'Jane', 'Doe');
    }

    const first = await contactMergeService.findDuplicates(alice.id, { page: '1', limit: '2' });
    const second = await contactMergeService.findDuplicates(alice.id, { page: '2', limit: '2' });

    expect(first.data).toHaveLength(2);
    expect(second.data).toHaveLength(1);
    expect(first.meta.total).toBe(3);
  });
});

describe('contactMergeService.findDuplicates — tenant isolation', () => {
  it('never returns another user’s contacts', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobCustomer = await createCustomer(bob.id, { domain: 'dell.com' });
    await contactAt(bobCustomer.id, 'ahmed.bouna@dell.com', 'Ahmed', 'Bouna');
    await contactAt(bobCustomer.id, 'ahmed_bouna@dell.com', 'Ahmed', 'Bouna');

    const { data } = await contactMergeService.findDuplicates(alice.id, {});

    expect(data).toHaveLength(0);
  });

  it('does not pair a caller’s contact with an identical one owned by someone else', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceCustomer = await createCustomer(alice.id, { domain: 'dell.com' });
    const bobCustomer = await createCustomer(bob.id, { domain: 'dell.com' });
    await contactAt(aliceCustomer.id, 'ahmed.bouna@dell.com', 'Ahmed', 'Bouna');
    await contactAt(bobCustomer.id, 'ahmed_bouna@dell.com', 'Ahmed', 'Bouna');

    const { data } = await contactMergeService.findDuplicates(alice.id, {});

    expect(data).toHaveLength(0);
  });

  it('ignores a customerId belonging to another user', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobCustomer = await createCustomer(bob.id, { domain: 'dell.com' });
    await contactAt(bobCustomer.id, 'ahmed.bouna@dell.com', 'Ahmed', 'Bouna');
    await contactAt(bobCustomer.id, 'ahmed_bouna@dell.com', 'Ahmed', 'Bouna');
    const aliceCustomer = await createCustomer(alice.id, { domain: 'dell.com' });
    await contactAt(aliceCustomer.id, 'sara.maach@dell.com', 'Sara', 'Maach');
    await contactAt(aliceCustomer.id, 'sara_maach@dell.com', 'Sara', 'Maach');

    const { data } = await contactMergeService.findDuplicates(alice.id, {
      customerId: bobCustomer.id,
    });

    expect(data).toHaveLength(0);
  });

  it('counts only the caller’s mail for a shared sender address', async () => {
    const { alice, bob } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { domain: 'dell.com' });
    await contactAt(customer.id, 'sara.maach@dell.com', 'Sara', 'Maach');
    await contactAt(customer.id, 'sara_maach@dell.com', 'Sara', 'Maach');
    await createEmail(alice.id, { from: 'sara.maach@dell.com' });
    await createEmail(bob.id, { from: 'sara.maach@dell.com' });
    await createEmail(bob.id, { from: 'sara.maach@dell.com' });

    const { data } = await contactMergeService.findDuplicates(alice.id, {});

    const counted = data[0].contacts.find((c) => c.email === 'sara.maach@dell.com');
    expect(counted?.emailCount).toBe(1);
  });
});

describe('contactMergeService.merge', () => {
  it('deletes the source and keeps the target', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { domain: 'dell.com' });
    const target = await contactAt(customer.id, 'sara.maach@dell.com', 'Sara', 'Maach');
    const source = await contactAt(customer.id, 'sara_maach@dell.com', 'Sara', 'Maach');

    const result = await contactMergeService.merge(alice.id, {
      targetId: target.id,
      sourceIds: [source.id],
    });

    expect(result.mergedContactIds).toEqual([source.id]);
    expect(await prisma.contact.findUnique({ where: { id: source.id } })).toBeNull();
    expect(await prisma.contact.findUnique({ where: { id: target.id } })).not.toBeNull();
  });

  it('keeps the discarded address so its mail is not orphaned', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { domain: 'dell.com' });
    const target = await contactAt(customer.id, 'sara.maach@dell.com', 'Sara', 'Maach');
    const source = await contactAt(customer.id, 'Sara_Maach@dell.com', 'Sara', 'Maach');
    await createEmail(alice.id, { from: 'sara.maach@dell.com' });
    await createEmail(alice.id, { from: 'sara_maach@dell.com' });
    await createEmail(alice.id, { from: 'sara_maach@dell.com' });

    await contactMergeService.merge(alice.id, { targetId: target.id, sourceIds: [source.id] });

    const aliases = await prisma.contactEmailAlias.findMany({ where: { contactId: target.id } });
    expect(aliases.map((a) => a.email)).toEqual(['sara_maach@dell.com']);
    expect(aliases[0].mergedFromContactId).toBe(source.id);

    // The whole point: the surviving contact still accounts for all three messages.
    const { data } = await contactService.findAll(alice.id, {});
    const merged = data.find((c) => c.id === target.id);
    expect(merged?._emailCount).toBe(3);
  });

  it('does not record the survivor’s own address as an alias', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { domain: 'atlascs.ma' });
    const target = await contactAt(customer.id, 'chaymae.aitahmed@atlascs.ma', 'Chaymae', 'Aitahmed');
    const source = await contactAt(customer.id, 'chaymae.aitahmed@atlascs.ma', 'Chaymae', 'Aitahmed');

    await contactMergeService.merge(alice.id, { targetId: target.id, sourceIds: [source.id] });

    expect(await prisma.contactEmailAlias.count({ where: { contactId: target.id } })).toBe(0);
  });

  it('carries addresses forward through a second merge', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { domain: 'acme.com' });
    const target = await contactAt(customer.id, 'john.smith@acme.com', 'John', 'Smith');
    const second = await contactAt(customer.id, 'john_smith@acme.com', 'John', 'Smith');
    const third = await contactAt(customer.id, 'jsmith@acme.com', 'John', 'Smith');

    await contactMergeService.merge(alice.id, { targetId: second.id, sourceIds: [third.id] });
    await contactMergeService.merge(alice.id, { targetId: target.id, sourceIds: [second.id] });

    const aliases = await prisma.contactEmailAlias.findMany({ where: { contactId: target.id } });
    expect(aliases.map((a) => a.email).sort()).toEqual(['john_smith@acme.com', 'jsmith@acme.com']);
  });

  it('fills the survivor’s blanks without overwriting what it already has', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { domain: 'dell.com' });
    const target = await contactAt(customer.id, 'sara.maach@dell.com', 'Sara', 'Maach', {
      role: 'Account Manager',
    });
    const source = await contactAt(customer.id, 'sara_maach@dell.com', 'Sara', 'Maach', {
      role: 'Sales',
      phone: '+212600000000',
      isVip: true,
    });

    const { contact, fieldsAdopted } = await contactMergeService.merge(alice.id, {
      targetId: target.id,
      sourceIds: [source.id],
    });

    expect(contact.role).toBe('Account Manager');
    expect(contact.phone).toBe('+212600000000');
    expect(contact.isVip).toBe(true);
    expect(fieldsAdopted).toEqual({ phone: '+212600000000', isVip: 'true' });
  });

  it('takes a fuller name as a pair when the survivor has none', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { domain: 'attijariwafa.com' });
    const target = await contactAt(customer.id, 'ymouak@attijariwafa.com', 'Ymouak', '');
    const source = await contactAt(customer.id, 'y.mouak@attijariwafa.com', 'Youssef', 'Mouak');

    const { contact } = await contactMergeService.merge(alice.id, {
      targetId: target.id,
      sourceIds: [source.id],
    });

    expect(contact.firstName).toBe('Youssef');
    expect(contact.lastName).toBe('Mouak');
  });

  it('merges several sources at once', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { domain: 'acme.com' });
    const target = await contactAt(customer.id, 'john.smith@acme.com', 'John', 'Smith');
    const a = await contactAt(customer.id, 'john_smith@acme.com', 'John', 'Smith');
    const b = await contactAt(customer.id, 'jsmith@acme.com', 'John', 'Smith');

    await contactMergeService.merge(alice.id, { targetId: target.id, sourceIds: [a.id, b.id] });

    expect(await prisma.contact.count({ where: { customerId: customer.id } })).toBe(1);
    expect(await prisma.contactEmailAlias.count({ where: { contactId: target.id } })).toBe(2);
  });

  it('records what was destroyed in the audit log', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { domain: 'dell.com' });
    const target = await contactAt(customer.id, 'sara.maach@dell.com', 'Sara', 'Maach');
    const source = await contactAt(customer.id, 'sara_maach@dell.com', 'Sara', 'Maach', {
      role: 'Sales',
    });

    await contactMergeService.merge(alice.id, { targetId: target.id, sourceIds: [source.id] });

    const log = await prisma.auditLog.findFirst({ where: { userId: alice.id, action: 'CONTACT_MERGED' } });
    expect(log?.entityId).toBe(target.id);
    // The merged row no longer exists anywhere else, so the log has to carry it.
    const details = log?.details as {
      mergedContacts: Array<{ id: string; email: string; role: string; firstName: string }>;
      aliasEmailsAdded: string[];
    };
    expect(details.mergedContacts).toHaveLength(1);
    expect(details.mergedContacts[0]).toMatchObject({
      id: source.id,
      email: 'sara_maach@dell.com',
      role: 'Sales',
      firstName: 'Sara',
    });
    expect(details.aliasEmailsAdded).toEqual(['sara_maach@dell.com']);
  });

  it('refuses to merge a contact into itself', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id);
    const contact = await createContact(customer.id);

    await expect(
      contactMergeService.merge(alice.id, { targetId: contact.id, sourceIds: [contact.id] })
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(await prisma.contact.findUnique({ where: { id: contact.id } })).not.toBeNull();
  });

  it('refuses to merge across companies', async () => {
    const { alice } = await createTwoUsers();
    const one = await createCustomer(alice.id, { domain: 'old.example' });
    const two = await createCustomer(alice.id, { domain: 'new.example' });
    const target = await contactAt(one.id, 'jane@old.example', 'Jane', 'Doe');
    const source = await contactAt(two.id, 'jane@new.example', 'Jane', 'Doe');

    await expect(
      contactMergeService.merge(alice.id, { targetId: target.id, sourceIds: [source.id] })
    ).rejects.toMatchObject({ statusCode: 400, code: 'CONTACT_MERGE_CROSS_COMPANY' });

    expect(await prisma.contact.count()).toBe(2);
  });
});

describe('contactMergeService.merge — tenant isolation', () => {
  it('cannot absorb another user’s contact', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceCustomer = await createCustomer(alice.id, { domain: 'dell.com' });
    const bobCustomer = await createCustomer(bob.id, { domain: 'dell.com' });
    const target = await contactAt(aliceCustomer.id, 'sara.maach@dell.com', 'Sara', 'Maach');
    const bobContact = await contactAt(bobCustomer.id, 'sara_maach@dell.com', 'Sara', 'Maach');

    await expect(
      contactMergeService.merge(alice.id, { targetId: target.id, sourceIds: [bobContact.id] })
    ).rejects.toMatchObject({ statusCode: 404 });

    // Bob's row is untouched, and Alice gained nothing from it.
    expect(await prisma.contact.findUnique({ where: { id: bobContact.id } })).not.toBeNull();
    expect(await prisma.contactEmailAlias.count()).toBe(0);
  });

  it('cannot merge into another user’s contact', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceCustomer = await createCustomer(alice.id, { domain: 'dell.com' });
    const bobCustomer = await createCustomer(bob.id, { domain: 'dell.com' });
    const aliceContact = await contactAt(aliceCustomer.id, 'sara.maach@dell.com', 'Sara', 'Maach');
    const bobTarget = await contactAt(bobCustomer.id, 'sara_maach@dell.com', 'Sara', 'Maach');

    await expect(
      contactMergeService.merge(alice.id, { targetId: bobTarget.id, sourceIds: [aliceContact.id] })
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(await prisma.contact.count()).toBe(2);
    expect(await prisma.contactEmailAlias.count()).toBe(0);
  });

  it('does not partially apply a batch containing another user’s contact', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceCustomer = await createCustomer(alice.id, { domain: 'acme.com' });
    const bobCustomer = await createCustomer(bob.id, { domain: 'acme.com' });
    const target = await contactAt(aliceCustomer.id, 'john.smith@acme.com', 'John', 'Smith');
    const mine = await contactAt(aliceCustomer.id, 'john_smith@acme.com', 'John', 'Smith');
    const theirs = await contactAt(bobCustomer.id, 'jsmith@acme.com', 'John', 'Smith');

    await expect(
      contactMergeService.merge(alice.id, { targetId: target.id, sourceIds: [mine.id, theirs.id] })
    ).rejects.toMatchObject({ statusCode: 404 });

    // The legitimate half of the batch must not have gone through.
    expect(await prisma.contact.findUnique({ where: { id: mine.id } })).not.toBeNull();
    expect(await prisma.contactEmailAlias.count()).toBe(0);
  });
});

describe('contactMergeService.merge — transactionality', () => {
  /**
   * Proves the merge rolls back as a unit rather than leaving a half-merge.
   *
   * The audit row is written last, inside the same transaction, so a constraint
   * that rejects it fails the merge *after* the aliases have been inserted and
   * the source rows deleted. Everything must come back.
   */
  it('rolls back the deletion when a later step fails', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { domain: 'dell.com' });
    const target = await contactAt(customer.id, 'sara.maach@dell.com', 'Sara', 'Maach');
    const source = await contactAt(customer.id, 'sara_maach@dell.com', 'Sara', 'Maach');

    await prisma.$executeRawUnsafe(
      `ALTER TABLE audit_logs ADD CONSTRAINT tmp_reject_merge CHECK (action <> 'CONTACT_MERGED')`
    );
    try {
      await expect(
        contactMergeService.merge(alice.id, { targetId: target.id, sourceIds: [source.id] })
      ).rejects.toThrow();

      expect(await prisma.contact.findUnique({ where: { id: source.id } })).not.toBeNull();
      expect(await prisma.contact.findUnique({ where: { id: target.id } })).not.toBeNull();
      expect(await prisma.contactEmailAlias.count()).toBe(0);
      expect(await prisma.auditLog.count({ where: { action: 'CONTACT_MERGED' } })).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE audit_logs DROP CONSTRAINT tmp_reject_merge`);
    }
  });

  it('leaves no orphaned aliases behind when a contact is later deleted', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { domain: 'dell.com' });
    const target = await contactAt(customer.id, 'sara.maach@dell.com', 'Sara', 'Maach');
    const source = await contactAt(customer.id, 'sara_maach@dell.com', 'Sara', 'Maach');
    await contactMergeService.merge(alice.id, { targetId: target.id, sourceIds: [source.id] });

    await contactService.delete(alice.id, target.id);

    expect(await prisma.contactEmailAlias.count()).toBe(0);
  });
});
