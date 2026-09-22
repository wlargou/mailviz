import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rfpService } from './rfpService.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createRfp, createCustomer } from '../test/factories.js';

/**
 * The RFP register.
 *
 * Two properties carry the feature. The first is the tenant boundary, which
 * here has a twist the other list services do not have: `reference` is the
 * buyer's own numbering and is unique per ACCOUNT, so two users must both be
 * able to track `27/2026/DGI` while one user cannot enter it twice.
 *
 * The second is that documents are the first bytes this app has ever stored
 * on disk. A row and its file have to be created and destroyed together —
 * an orphaned row is a 404 the user cannot clear, an orphaned file is waste
 * that nothing will ever reclaim.
 */
let storageDir: string;

beforeAll(async () => {
  storageDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mailviz-rfp-'));
  process.env.RFP_STORAGE_DIR = storageDir;
});

afterAll(async () => {
  delete process.env.RFP_STORAGE_DIR;
  await fs.promises.rm(storageDir, { recursive: true, force: true });
});

/** A file on the volume, as multer would have left it. */
async function writeStoredFile(userId: string, name = 'cps.pdf') {
  const dir = path.join(storageDir, userId);
  await fs.promises.mkdir(dir, { recursive: true });
  const stored = `${Math.random().toString(36).slice(2)}.pdf`;
  await fs.promises.writeFile(path.join(dir, stored), 'PDF-bytes');
  return { filename: name, mimeType: 'application/pdf', size: 9, storageKey: `${userId}/${stored}` };
}

const base = {
  name: 'Refonte AIX',
  deadlineAt: '2026-09-09T10:00:00.000Z',
  submissionFormat: 'PORTAL' as const,
};

describe('rfpService — tenant isolation', () => {
  it('lists, reads, updates and deletes only the caller\'s tenders', async () => {
    const { alice, bob } = await createTwoUsers();
    await createRfp(alice.id, { name: 'Alice tender' });
    const bobs = await createRfp(bob.id, { name: 'Bob tender' });

    const list = await rfpService.findAll(alice.id, {});
    expect(list.data.map((r) => r.name)).toEqual(['Alice tender']);
    expect(list.meta.total).toBe(1);

    await expect(rfpService.findById(alice.id, bobs.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(rfpService.update(alice.id, bobs.id, { name: 'Hijacked' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(rfpService.remove(alice.id, bobs.id)).rejects.toMatchObject({ statusCode: 404 });

    // The refusals were refusals, not silent no-ops on someone else's row.
    expect((await prisma.rfp.findUniqueOrThrow({ where: { id: bobs.id } })).name).toBe('Bob tender');
  });

  it('scopes the reference to the account: shared between users, unique within one', async () => {
    const { alice, bob } = await createTwoUsers();

    await rfpService.create(alice.id, { ...base, reference: '27/2026/DGI' });
    // The same tender, tracked by another account. A global unique would have
    // made the second account unable to enter it at all.
    const bobsCopy = await rfpService.create(bob.id, { ...base, reference: '27/2026/DGI' });
    expect(bobsCopy.reference).toBe('27/2026/DGI');

    await expect(rfpService.create(alice.id, { ...base, reference: '27/2026/DGI' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'RFP_REFERENCE_TAKEN',
    });
    expect(await prisma.rfp.count({ where: { userId: alice.id } })).toBe(1);
  });
});

describe('rfpService — the register view', () => {
  it('orders by deadline, soonest first, without being asked', async () => {
    const { alice } = await createTwoUsers();
    await createRfp(alice.id, { name: 'Later', deadlineAt: new Date('2026-12-01T10:00:00.000Z') });
    await createRfp(alice.id, { name: 'Soonest', deadlineAt: new Date('2026-09-09T10:00:00.000Z') });
    await createRfp(alice.id, { name: 'Middle', deadlineAt: new Date('2026-10-15T09:00:00.000Z') });

    expect((await rfpService.findAll(alice.id, {})).data.map((r) => r.name)).toEqual(['Soonest', 'Middle', 'Later']);
    // An explicit direction still wins over the default.
    expect((await rfpService.findAll(alice.id, { sortOrder: 'desc' })).data.map((r) => r.name)).toEqual(['Later', 'Middle', 'Soonest']);
    // A column the service does not order on falls back rather than throwing.
    expect((await rfpService.findAll(alice.id, { sortBy: 'notes' })).data.map((r) => r.name)).toEqual(['Soonest', 'Middle', 'Later']);
  });

  it('hides finished tenders behind scope=open, and filters on status, format, GOE and text', async () => {
    const { alice } = await createTwoUsers();
    await createRfp(alice.id, { name: 'Live one', status: 'WORKING', isGoe: true, submissionFormat: 'PORTAL' });
    await createRfp(alice.id, { name: 'Paper one', status: 'OPEN', isGoe: false, submissionFormat: 'PAPER' });
    await createRfp(alice.id, { name: 'Won one', status: 'WON' });
    await createRfp(alice.id, { name: 'Lost one', status: 'LOST' });
    await createRfp(alice.id, { name: 'Declined', status: 'NO_BID' });
    await createRfp(alice.id, { name: 'Pulled', status: 'CANCELLED' });

    const names = async (q: Parameters<typeof rfpService.findAll>[1]) =>
      (await rfpService.findAll(alice.id, q)).data.map((r) => r.name).sort();

    expect(await names({ scope: 'open' })).toEqual(['Live one', 'Paper one']);
    expect(await names({})).toHaveLength(6);
    expect(await names({ status: 'WON' })).toEqual(['Won one']);
    expect(await names({ submissionFormat: 'PAPER' })).toEqual(['Paper one']);
    expect(await names({ isGoe: 'true' })).toEqual(['Live one']);
    expect(await names({ isGoe: 'false' })).toHaveLength(5);
    expect(await names({ search: 'paper' })).toEqual(['Paper one']);
  });

  it('returns the budget as a number, not a Decimal that stringifies', async () => {
    // `Decimal(14,2)` comes back from Prisma as an object whose JSON form is
    // a string, so the client would receive "12500000.5" where it formats a
    // number — and `toLocaleString` on a string silently does nothing.
    const { alice } = await createTwoUsers();
    const created = await rfpService.create(alice.id, { ...base, reference: 'B/1', isGoe: true, budget: 12500000.5 });

    expect(created.budget).toBe(12500000.5);
    expect(typeof created.budget).toBe('number');
    expect(typeof (await rfpService.findAll(alice.id, {})).data[0].budget).toBe('number');
    expect(typeof (await rfpService.findById(alice.id, created.id)).budget).toBe('number');
    expect(JSON.parse(JSON.stringify(created)).budget).toBe(12500000.5);

    // No budget stays null rather than becoming 0.
    const noBudget = await rfpService.create(alice.id, { ...base, reference: 'B/2' });
    expect(noBudget.budget).toBeNull();
  });

  it('a PATCH changes what it names and nothing else', async () => {
    const { alice } = await createTwoUsers();
    const rfp = await rfpService.create(alice.id, {
      ...base, reference: 'P/1', status: 'WORKING', isGoe: true, budget: 5000, portalUrl: 'https://portal.test', notes: 'Lot unique',
    });

    const updated = await rfpService.update(alice.id, rfp.id, { name: 'Renamed' });

    expect(updated.name).toBe('Renamed');
    expect(updated.status).toBe('WORKING');
    expect(updated.isGoe).toBe(true);
    expect(updated.budget).toBe(5000);
    expect(updated.portalUrl).toBe('https://portal.test');
    expect(updated.notes).toBe('Lot unique');
    expect(updated.deadlineAt.toISOString()).toBe(base.deadlineAt);

    // An empty string is an explicit clear, which null is how the row holds it.
    const cleared = await rfpService.update(alice.id, rfp.id, { portalUrl: '', notes: '', budget: null });
    expect(cleared.portalUrl).toBeNull();
    expect(cleared.notes).toBeNull();
    expect(cleared.budget).toBeNull();
  });
});

describe('rfpService — documents', () => {
  it('keeps the row and the file together, in both directions', async () => {
    const { alice } = await createTwoUsers();
    const rfp = await rfpService.create(alice.id, { ...base, reference: 'D/1' });
    const file = await writeStoredFile(alice.id, 'CPS AO 70.pdf');

    const doc = await rfpService.addDocument(alice.id, rfp.id, file, 'RFP');
    expect(doc.filename).toBe('CPS AO 70.pdf');
    expect(fs.existsSync(path.join(storageDir, file.storageKey))).toBe(true);
    expect((await rfpService.findById(alice.id, rfp.id)).documents).toHaveLength(1);

    await rfpService.removeDocument(alice.id, rfp.id, doc.id);
    expect(await prisma.rfpDocument.count({ where: { id: doc.id } })).toBe(0);
    expect(fs.existsSync(path.join(storageDir, file.storageKey))).toBe(false);
  });

  it('deleting a tender takes its documents and their bytes with it', async () => {
    const { alice } = await createTwoUsers();
    const rfp = await rfpService.create(alice.id, { ...base, reference: 'D/2' });
    const rc = await writeStoredFile(alice.id, 'RC.pdf');
    const avis = await writeStoredFile(alice.id, 'Avis.pdf');
    await rfpService.addDocument(alice.id, rfp.id, rc, 'RFP');
    await rfpService.addDocument(alice.id, rfp.id, avis, 'AVIS');

    await rfpService.remove(alice.id, rfp.id);

    expect(await prisma.rfpDocument.count({ where: { rfpId: rfp.id } })).toBe(0);
    expect(fs.existsSync(path.join(storageDir, rc.storageKey))).toBe(false);
    expect(fs.existsSync(path.join(storageDir, avis.storageKey))).toBe(false);
  });

  it('will not attach to, read from or delete from another account\'s tender', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobsRfp = await rfpService.create(bob.id, { ...base, reference: 'X/1' });
    const bobsFile = await writeStoredFile(bob.id, 'Bobs secret.pdf');
    const bobsDoc = await rfpService.addDocument(bob.id, bobsRfp.id, bobsFile, 'RFP');
    const alicesFile = await writeStoredFile(alice.id);

    await expect(rfpService.addDocument(alice.id, bobsRfp.id, alicesFile, 'RFP')).rejects.toMatchObject({ statusCode: 404 });
    await expect(rfpService.getDocument(alice.id, bobsRfp.id, bobsDoc.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(rfpService.removeDocument(alice.id, bobsRfp.id, bobsDoc.id)).rejects.toMatchObject({ statusCode: 404 });

    expect(await prisma.rfpDocument.count({ where: { rfpId: bobsRfp.id } })).toBe(1);
    expect(fs.existsSync(path.join(storageDir, bobsFile.storageKey))).toBe(true);
  });
});

describe('rfpService — the buying company', () => {
  it('links a company, reads it back, and filters on it', async () => {
    const { alice } = await createTwoUsers();
    const bkam = await createCustomer(alice.id, { name: 'Bank Al-Maghrib' });
    const dgi = await createCustomer(alice.id, { name: 'DGI' });

    const rfp = await rfpService.create(alice.id, { ...base, reference: 'C/1', customerId: bkam.id });
    expect(rfp.customer).toMatchObject({ id: bkam.id, name: 'Bank Al-Maghrib' });

    await rfpService.create(alice.id, { ...base, reference: 'C/2', customerId: dgi.id });
    await rfpService.create(alice.id, { ...base, reference: 'C/3' });

    const forBkam = await rfpService.findAll(alice.id, { customerId: bkam.id });
    expect(forBkam.data.map((r) => r.reference)).toEqual(['C/1']);
    expect((await rfpService.findAll(alice.id, {})).data).toHaveLength(3);

    // The company's name is searchable — it is how a tender is recognised
    // when its reference means nothing to anyone outside the buyer.
    const found = await rfpService.findAll(alice.id, { search: 'Maghrib' });
    expect(found.data.map((r) => r.reference)).toEqual(['C/1']);
  });

  it("refuses another account's company on create and on update", async () => {
    const { alice, bob } = await createTwoUsers();
    const bobsCompany = await createCustomer(bob.id, { name: 'BobsSecretCompany' });

    await expect(rfpService.create(alice.id, { ...base, reference: 'X/1', customerId: bobsCompany.id })).rejects.toMatchObject({
      statusCode: 404,
      code: 'CUSTOMER_NOT_FOUND',
    });
    expect(await prisma.rfp.count({ where: { userId: alice.id } })).toBe(0);

    const mine = await rfpService.create(alice.id, { ...base, reference: 'X/2' });
    await expect(rfpService.update(alice.id, mine.id, { customerId: bobsCompany.id })).rejects.toMatchObject({ statusCode: 404 });
    expect((await rfpService.findById(alice.id, mine.id)).customerId).toBeNull();
  });

  it('keeps the tender when its company is deleted', async () => {
    // The tender still happened; only the link to a company we no longer
    // track goes away.
    const { alice } = await createTwoUsers();
    const company = await createCustomer(alice.id, { name: 'Gone' });
    const rfp = await rfpService.create(alice.id, { ...base, reference: 'D/9', customerId: company.id });

    await prisma.customer.delete({ where: { id: company.id } });

    const after = await rfpService.findById(alice.id, rfp.id);
    expect(after.customerId).toBeNull();
    expect(after.customer).toBeNull();
    expect(after.reference).toBe('D/9');
  });
});
