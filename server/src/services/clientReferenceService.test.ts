import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clientReferenceService } from './clientReferenceService.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createCustomer, createClientReference } from '../test/factories.js';

/**
 * The client references register.
 *
 * Three things carry it. The tenant boundary, as everywhere: a bid team's
 * references, amounts and customers are the most confidential list in the
 * app. The derived columns — the amount HT, the date "the last N years" is
 * measured on, the standard tags — because every filter compares on them and
 * nothing but `derive` writes them. And the search, which must find "Sécurité"
 * from "securite" and never reach another account's rows.
 */
let storageDir: string;

beforeAll(async () => {
  storageDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mailviz-refs-'));
  process.env.RFP_STORAGE_DIR = storageDir;
});

afterAll(async () => {
  delete process.env.RFP_STORAGE_DIR;
  await fs.promises.rm(storageDir, { recursive: true, force: true });
});

/** A file on the volume, as multer would have left it. */
async function storedFile(userId: string, content = '%PDF-1.4') {
  const dir = path.join(storageDir, userId);
  await fs.promises.mkdir(dir, { recursive: true });
  const stored = `${Math.random().toString(36).slice(2)}.pdf`;
  await fs.promises.writeFile(path.join(dir, stored), content);
  return { filename: 'attestation.pdf', mimeType: 'application/pdf', size: content.length, storageKey: `${userId}/${stored}` };
}

const onDisk = (key: string) => fs.existsSync(path.join(storageDir, key));
const NOW = new Date('2026-10-17T12:00:00Z');
const names = (rows: Array<{ customerName: string }>) => rows.map((r) => r.customerName).sort();

describe('clientReferenceService — tenant isolation', () => {
  it('lists only the caller’s references', async () => {
    const { alice, bob } = await createTwoUsers();
    await createClientReference(alice.id, { customerName: 'Alice Bank' });
    await createClientReference(bob.id, { customerName: 'Bob Bank' });

    const res = await clientReferenceService.findAll(alice.id, {});

    expect(names(res.data)).toEqual(['Alice Bank']);
    expect(res.meta.total).toBe(1);
  });

  it('a search never reaches another account’s references', async () => {
    const { alice, bob } = await createTwoUsers();
    await createClientReference(alice.id, { customerName: 'Alice Sauvegarde' });
    await createClientReference(bob.id, { customerName: 'Bob Sauvegarde' });

    const res = await clientReferenceService.findAll(alice.id, { search: 'sauvegarde' });

    expect(names(res.data)).toEqual(['Alice Sauvegarde']);
    expect(await clientReferenceService.ids(alice.id, { search: 'sauvegarde' })).toHaveLength(1);
  });

  it('every :id operation on another account’s reference is a 404 and changes nothing', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobs = await createClientReference(bob.id, { customerName: 'Bob Secret' });

    await expect(clientReferenceService.findById(alice.id, bobs.id)).rejects.toMatchObject({ statusCode: 404, code: 'REFERENCE_NOT_FOUND' });
    await expect(clientReferenceService.update(alice.id, bobs.id, { customerName: 'Hijacked' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(clientReferenceService.remove(alice.id, bobs.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(clientReferenceService.getDocument(alice.id, bobs.id)).rejects.toMatchObject({ statusCode: 404, code: 'REFERENCE_NOT_FOUND' });

    expect((await prisma.clientReference.findUniqueOrThrow({ where: { id: bobs.id } })).customerName).toBe('Bob Secret');
  });

  it('refuses to link another account’s company, on create and on update', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobsCompany = await createCustomer(bob.id, { name: 'Bob Co' });

    await expect(createClientReference(alice.id, { customerId: bobsCompany.id })).rejects.toMatchObject({ statusCode: 404, code: 'CUSTOMER_NOT_FOUND' });
    const mine = await createClientReference(alice.id);
    await expect(clientReferenceService.update(alice.id, mine.id, { customerId: bobsCompany.id })).rejects.toMatchObject({ statusCode: 404 });
    expect((await prisma.clientReference.findUniqueOrThrow({ where: { id: mine.id } })).customerId).toBeNull();
  });

  it('counts facets over the caller’s references only', async () => {
    const { alice, bob } = await createTwoUsers();
    await createClientReference(alice.id, { technologies: ['IBM Power 10'], partners: ['IBM'] });
    await createClientReference(bob.id, { technologies: ['IBM Power 10', 'VMware vSphere'], partners: ['ibm', 'VMware'] });

    const facets = await clientReferenceService.facets(alice.id);

    expect(facets.total).toBe(1);
    expect(facets.technologyTags.find((t) => t.tag === 'IBM Power')?.count).toBe(1);
    expect(facets.technologyTags.find((t) => t.tag === 'VMware')?.count).toBe(0);
    expect(facets.partners).toEqual([{ name: 'IBM', count: 1 }]);
  });
});

describe('clientReferenceService — derived columns', () => {
  it('compares a TTC amount over 1.2, an HT amount as is, and an unstated one as written', async () => {
    const { alice } = await createTwoUsers();
    const ttc = await createClientReference(alice.id, { amount: 1_200_000, amountType: 'TTC' });
    const ht = await createClientReference(alice.id, { amount: 1_000_000, amountType: 'HT' });
    const unstated = await createClientReference(alice.id, { amount: 6_653_280 });

    expect(ttc.amountHt).toBe(1_000_000);
    expect(ttc.amount).toBe(1_200_000);
    expect(ht.amountHt).toBe(1_000_000);
    expect(unstated.amountHt).toBe(6_653_280);
  });

  it('recomputes the HT amount when only the type changes', async () => {
    const { alice } = await createTwoUsers();
    const ref = await createClientReference(alice.id, { amount: 12_000_000, amountType: 'HT' });

    const updated = await clientReferenceService.update(alice.id, ref.id, { amountType: 'TTC' });

    expect(updated.amountHt).toBe(10_000_000);
    expect(updated.amount).toBe(12_000_000);
  });

  it('keeps dates at the precision the letter gave them', async () => {
    const { alice } = await createTwoUsers();
    const ref = await createClientReference(alice.id, { projectStart: '2025', projectEnd: '2026-03', signedAt: '2026-09-17' });

    expect(ref.projectStart).toBe('2025');
    expect(ref.projectEnd).toBe('2026-03');
    expect(ref.signedAt).toBe('2026-09-17');
    const row = await prisma.clientReference.findUniqueOrThrow({ where: { id: ref.id } });
    expect(row.projectStartPrecision).toBe('YEAR');
    expect(row.projectEndPrecision).toBe('MONTH');
  });

  it('measures the effective date on the end of the end period, then the start’s, then the signature', async () => {
    const { alice } = await createTwoUsers();
    const ended = await createClientReference(alice.id, { projectStart: '2022', projectEnd: '2023', signedAt: '2024-02-08' });
    const startOnly = await createClientReference(alice.id, { projectStart: '2025-07', signedAt: '2026-01-30' });
    const signedOnly = await createClientReference(alice.id, { signedAt: '2024-11-21' });
    const undated = await createClientReference(alice.id);

    // "2023" may mean December, so it is counted to its last day.
    expect(ended.effectiveDate).toBe('2023-12-31');
    expect(startOnly.effectiveDate).toBe('2025-07-31');
    expect(signedOnly.effectiveDate).toBe('2024-11-21');
    expect(undated.effectiveDate).toBeNull();
  });

  it('refuses a project that ends before it starts, comparing whole periods', async () => {
    const { alice } = await createTwoUsers();

    await expect(createClientReference(alice.id, { projectStart: '2024-05-10', projectEnd: '2023' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'PROJECT_END_BEFORE_START',
    });
    // Same year at two precisions is not "before".
    const ok = await createClientReference(alice.id, { projectStart: '2024-05-10', projectEnd: '2024' });
    expect(ok.projectEnd).toBe('2024');
    // And the check holds against the stored start on an update.
    await expect(clientReferenceService.update(alice.id, ok.id, { projectEnd: '2023-12' })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('tags from the wording, and re-tags when the wording changes', async () => {
    const { alice } = await createTwoUsers();
    const ref = await createClientReference(alice.id, {
      technologies: ['BM Power System E1050', 'DELL EMC PowerEdge R630', 'Robot de sauvegarde TS4300'],
      prestations: ['Installation et configuration', 'Migration des LPAR'],
    });

    expect(ref.technologyTags).toEqual(expect.arrayContaining(['IBM Power', 'IBM Power 10', 'x86 servers', 'Backup']));
    expect(ref.prestationTags).toEqual(['Installation & configuration', 'Migration']);

    const updated = await clientReferenceService.update(alice.id, ref.id, { technologies: ['VMware vSphere'] });
    expect(updated.technologyTags).toEqual(['VMware']);
    // A PATCH that does not touch the list keeps its tags.
    const untouched = await clientReferenceService.update(alice.id, ref.id, { city: 'Rabat' });
    expect(untouched.technologyTags).toEqual(['VMware']);
  });

  it('writes partners in one spelling per vendor', async () => {
    const { alice } = await createTwoUsers();
    const ref = await createClientReference(alice.id, { partners: ['ibm', 'IBM', 'Dell EMC', 'EMC', 'RedHat'] });
    expect(ref.partners).toEqual(['IBM', 'Dell Technologies', 'Red Hat']);
  });
});

describe('clientReferenceService — signatories', () => {
  it('keeps them in the letter’s order, and replaces the list on an update', async () => {
    const { alice } = await createTwoUsers();
    const ref = await createClientReference(alice.id, {
      signatories: [
        { name: 'BAKI NEZHA', role: 'Ordonnateur' },
        { name: 'KHADI RACHID', role: 'Achats Groupe' },
        { name: null, role: 'Directeur Général' },
      ],
    });
    expect(ref.signatories.map((s) => s.name)).toEqual(['BAKI NEZHA', 'KHADI RACHID', null]);

    const updated = await clientReferenceService.update(alice.id, ref.id, { signatories: [{ name: 'Reda Loudiyi', role: 'Managing Director' }] });
    expect(updated.signatories.map((s) => s.name)).toEqual(['Reda Loudiyi']);
    expect(await prisma.clientReferenceSignatory.count({ where: { referenceId: ref.id } })).toBe(1);

    // Absent leaves them alone.
    const kept = await clientReferenceService.update(alice.id, ref.id, { city: 'Casablanca' });
    expect(kept.signatories).toHaveLength(1);
  });
});

describe('clientReferenceService — filters', () => {
  it('finds Power references above a million HT in the last three years — the bid team’s question', async () => {
    const { alice } = await createTwoUsers();
    await createClientReference(alice.id, { customerName: 'Hit', technologies: ['Serveurs IBM Power10'], amount: 1_320_000, amountType: 'TTC', projectEnd: '2024' });
    // 1.1M TTC is 916k HT: below a million once the VAT is out.
    await createClientReference(alice.id, { customerName: 'Too small HT', technologies: ['IBM Power 9 S922'], amount: 1_100_000, amountType: 'TTC', projectEnd: '2025' });
    await createClientReference(alice.id, { customerName: 'Too old', technologies: ['IBM POWER8 E880C'], amount: 9_000_000, amountType: 'HT', projectEnd: '2022' });
    await createClientReference(alice.id, { customerName: 'Not Power', technologies: ['DELL PowerEdge R740'], amount: 9_000_000, amountType: 'HT', projectEnd: '2025' });

    const res = await clientReferenceService.findAll(alice.id, { tags: 'IBM Power', minAmount: '1000000', sinceYears: '3' }, NOW);

    expect(names(res.data)).toEqual(['Hit']);
  });

  it('counts "the last N years" back from today, to the day', async () => {
    const { alice } = await createTwoUsers();
    await createClientReference(alice.id, { customerName: 'Inside', projectEnd: '2023-10-17' });
    await createClientReference(alice.id, { customerName: 'Outside', projectEnd: '2023-10-16' });
    await createClientReference(alice.id, { customerName: 'Undated' });

    const res = await clientReferenceService.findAll(alice.id, { sinceYears: '3' }, NOW);

    expect(names(res.data)).toEqual(['Inside']);
  });

  it('filters on appreciation, a stated signer role, type, status and the review flag', async () => {
    const { alice } = await createTwoUsers();
    await createClientReference(alice.id, { customerName: 'Satisfied', appreciation: 'SATISFACTION', signatories: [{ name: 'A', role: 'DSI' }] });
    await createClientReference(alice.id, { customerName: 'Conform', appreciation: 'GOOD_EXECUTION', signatories: [{ name: 'B' }], documentType: 'ATTESTATION_EXECUTION' });
    await createClientReference(alice.id, { customerName: 'Sheet', documentType: 'FICHE_PROJET', workStatus: 'IN_PROGRESS', needsReview: true });

    const q = (query: Record<string, string>) => clientReferenceService.findAll(alice.id, query).then((r) => names(r.data));

    expect(await q({ appreciation: 'SATISFACTION' })).toEqual(['Satisfied']);
    expect(await q({ appreciation: 'POSITIVE' })).toEqual(['Conform', 'Satisfied']);
    expect(await q({ appreciation: 'NONE' })).toEqual(['Sheet']);
    // B signed without a role, so only A's letter qualifies.
    expect(await q({ signerRole: 'true' })).toEqual(['Satisfied']);
    expect(await q({ appreciation: 'SATISFACTION', signerRole: 'true' })).toEqual(['Satisfied']);
    expect(await q({ documentType: 'FICHE_PROJET' })).toEqual(['Sheet']);
    expect(await q({ workStatus: 'IN_PROGRESS' })).toEqual(['Sheet']);
    expect(await q({ needsReview: 'true' })).toEqual(['Sheet']);
    expect(await q({ needsReview: 'false' })).toEqual(['Conform', 'Satisfied']);
    // An unknown value is no filter, not an empty list.
    expect(await q({ documentType: 'NONSENSE' })).toHaveLength(3);
  });

  it('filters on a company, a partner, a service tag and an amount ceiling', async () => {
    const { alice } = await createTwoUsers();
    const company = await createCustomer(alice.id, { name: 'CMI' });
    await createClientReference(alice.id, { customerName: 'Linked', customerId: company.id, partners: ['IBM'], prestations: ['Migration AIX'], amount: 500_000, amountType: 'HT' });
    await createClientReference(alice.id, { customerName: 'Other', partners: ['Oracle'], prestations: ['Formation'], amount: 5_000_000, amountType: 'HT' });

    const q = (query: Record<string, string>) => clientReferenceService.findAll(alice.id, query).then((r) => names(r.data));

    expect(await q({ customerId: company.id })).toEqual(['Linked']);
    expect(await q({ partner: 'IBM' })).toEqual(['Linked']);
    expect(await q({ services: 'Migration' })).toEqual(['Linked']);
    expect(await q({ services: 'Migration,Training & skills transfer' })).toEqual(['Linked', 'Other']);
    expect(await q({ maxAmount: '1000000' })).toEqual(['Linked']);
    expect(await q({ minAmount: 'abc' })).toHaveLength(2);
  });
});

describe('clientReferenceService — search', () => {
  it('matches every word, in any field, without regard to case or accents', async () => {
    const { alice } = await createTwoUsers();
    await createClientReference(alice.id, { customerName: 'Tanger Med', projectName: 'Plateforme de stockage et de sauvegarde', details: 'Lot 2 : sécurité' });
    await createClientReference(alice.id, { customerName: 'CFG Bank', projectName: 'Refonte de la plateforme', signatories: [{ name: 'Idriss Écrivain', role: 'Directeur des Systèmes' }] });

    const q = (search: string) => clientReferenceService.findAll(alice.id, { search }).then((r) => names(r.data));

    expect(await q('SAUVEGARDE')).toEqual(['Tanger Med']);
    expect(await q('securite')).toEqual(['Tanger Med']);
    expect(await q('plateforme tanger')).toEqual(['Tanger Med']);
    expect(await q('plateforme')).toEqual(['CFG Bank', 'Tanger Med']);
    // The signatories are searched too.
    expect(await q('ecrivain')).toEqual(['CFG Bank']);
    expect(await q('sauvegarde cfg')).toEqual([]);
  });

  it('finds a reference by its linked company’s name and by a standard tag', async () => {
    const { alice } = await createTwoUsers();
    const company = await createCustomer(alice.id, { name: 'Marocmeteo' });
    await createClientReference(alice.id, { customerName: 'Direction Générale de la Météorologie', customerId: company.id, technologies: ['Serveurs IBM Power10'] });

    expect((await clientReferenceService.findAll(alice.id, { search: 'marocmeteo' })).data).toHaveLength(1);
    expect((await clientReferenceService.findAll(alice.id, { search: 'IBM Power 10' })).data).toHaveLength(1);
  });

  it('treats % and _ as themselves', async () => {
    const { alice } = await createTwoUsers();
    await createClientReference(alice.id, { customerName: 'Plain' });
    await createClientReference(alice.id, { customerName: '100% Cloud' });

    expect(names((await clientReferenceService.findAll(alice.id, { search: '%' })).data)).toEqual(['100% Cloud']);
    expect((await clientReferenceService.findAll(alice.id, { search: '_' })).data).toHaveLength(0);
  });
});

describe('clientReferenceService — order', () => {
  it('sorts by the HT amount, largest first, with no amount last — and ids follow the same order', async () => {
    const { alice } = await createTwoUsers();
    await createClientReference(alice.id, { customerName: 'None' });
    await createClientReference(alice.id, { customerName: 'Small', amount: 100, amountType: 'HT' });
    await createClientReference(alice.id, { customerName: 'Big TTC', amount: 1200, amountType: 'TTC' });
    await createClientReference(alice.id, { customerName: 'Mid', amount: 500, amountType: 'HT' });

    const res = await clientReferenceService.findAll(alice.id, {});
    expect(res.data.map((r) => r.customerName)).toEqual(['Big TTC', 'Mid', 'Small', 'None']);
    const asc = await clientReferenceService.findAll(alice.id, { sortOrder: 'asc' });
    expect(asc.data.map((r) => r.customerName)).toEqual(['Small', 'Mid', 'Big TTC', 'None']);

    expect(await clientReferenceService.ids(alice.id, {})).toEqual(res.data.map((r) => r.id));
  });

  it('falls back to the amount on an unknown sort field', async () => {
    const { alice } = await createTwoUsers();
    await createClientReference(alice.id, { customerName: 'Small', amount: 1, amountType: 'HT' });
    await createClientReference(alice.id, { customerName: 'Big', amount: 2, amountType: 'HT' });

    const res = await clientReferenceService.findAll(alice.id, { sortBy: 'userId' });
    expect(res.data.map((r) => r.customerName)).toEqual(['Big', 'Small']);
  });
});

describe('clientReferenceService — document', () => {
  it('replacing the document removes the old file and serves the new one', async () => {
    const { alice } = await createTwoUsers();
    const ref = await createClientReference(alice.id);
    const first = await storedFile(alice.id, 'first');
    const second = await storedFile(alice.id, 'second');

    const withFirst = await clientReferenceService.replaceDocument(alice.id, ref.id, first);
    expect(withFirst.hasDocument).toBe(true);
    expect(withFirst).not.toHaveProperty('documentStorageKey');

    await clientReferenceService.replaceDocument(alice.id, ref.id, second);

    expect(onDisk(first.storageKey)).toBe(false);
    expect(onDisk(second.storageKey)).toBe(true);
    expect((await clientReferenceService.getDocument(alice.id, ref.id)).storageKey).toBe(second.storageKey);
  });

  it('an upload onto another account’s reference is refused and leaves no file behind', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobs = await createClientReference(bob.id);
    const upload = await storedFile(alice.id);

    await expect(clientReferenceService.replaceDocument(alice.id, bobs.id, upload)).rejects.toMatchObject({ statusCode: 404 });

    expect(onDisk(upload.storageKey)).toBe(false);
    expect((await prisma.clientReference.findUniqueOrThrow({ where: { id: bobs.id } })).documentStorageKey).toBeNull();
  });

  it('deleting a reference deletes its file', async () => {
    const { alice } = await createTwoUsers();
    const ref = await createClientReference(alice.id);
    const file = await storedFile(alice.id);
    await clientReferenceService.replaceDocument(alice.id, ref.id, file);

    await clientReferenceService.remove(alice.id, ref.id);

    expect(onDisk(file.storageKey)).toBe(false);
    expect(await prisma.clientReference.count({ where: { id: ref.id } })).toBe(0);
  });

  it('a reference without a document says so', async () => {
    const { alice } = await createTwoUsers();
    const ref = await createClientReference(alice.id);
    await expect(clientReferenceService.getDocument(alice.id, ref.id)).rejects.toMatchObject({ statusCode: 404, code: 'REFERENCE_DOCUMENT_NOT_FOUND' });
  });
});

describe('clientReferenceService — companies', () => {
  it('linking a reference makes the company an account', async () => {
    const { alice } = await createTwoUsers();
    const sender = await createCustomer(alice.id, { name: 'Portnet' });
    expect(sender.status).toBe('SENDER');

    await createClientReference(alice.id, { customerId: sender.id });

    expect((await prisma.customer.findUniqueOrThrow({ where: { id: sender.id } })).status).toBe('ACCOUNT');
  });

  it('linking on an update promotes too, and deleting the company keeps the reference', async () => {
    const { alice } = await createTwoUsers();
    const ref = await createClientReference(alice.id, { customerName: 'ADM' });
    const sender = await createCustomer(alice.id, { name: 'ADM' });

    await clientReferenceService.update(alice.id, ref.id, { customerId: sender.id });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: sender.id } })).status).toBe('ACCOUNT');

    await prisma.customer.delete({ where: { id: sender.id } });
    const after = await clientReferenceService.findById(alice.id, ref.id);
    expect(after.customerId).toBeNull();
    expect(after.customerName).toBe('ADM');
  });
});
