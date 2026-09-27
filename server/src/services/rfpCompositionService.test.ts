import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rfpService } from './rfpService.js';
import { rfpCompositionService as composition } from './rfpCompositionService.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createUser } from '../test/factories.js';

/**
 * Lots, and the dossiers of the response.
 *
 * Three properties carry this. The tender's budget is always its lots'
 * total — it is denormalised for sorting, so every path that changes a lot
 * must recompute it. The offers are per lot and the dossiers per tender,
 * which is how an allotted tender is actually answered. And a piece's files
 * live beside the tender's own documents without ever being counted as them,
 * and leave the disk with whatever owns them.
 */
let storageDir: string;

beforeAll(async () => {
  storageDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mailviz-rfp-comp-'));
  process.env.RFP_STORAGE_DIR = storageDir;
});

afterAll(async () => {
  delete process.env.RFP_STORAGE_DIR;
  await fs.promises.rm(storageDir, { recursive: true, force: true });
});

async function storedFile(userId: string, name = 'cv.pdf') {
  const dir = path.join(storageDir, userId);
  await fs.promises.mkdir(dir, { recursive: true });
  const stored = `${Math.random().toString(36).slice(2)}.pdf`;
  await fs.promises.writeFile(path.join(dir, stored), 'PDF');
  return { filename: name, mimeType: 'application/pdf', size: 3, storageKey: `${userId}/${stored}` };
}
const onDisk = (key: string) => fs.existsSync(path.join(storageDir, key));

const base = { name: 'Refonte AIX', deadlineAt: '2026-11-09T10:00:00.000Z', submissionFormat: 'PORTAL' as const };

describe('rfpComposition — lots and the budget', () => {
  it('gives a tender with no lots given a single "Lot unique", and no budget', async () => {
    const { alice } = await createTwoUsers();
    const rfp = await rfpService.create(alice.id, { ...base, reference: 'L/1' });

    expect(rfp.lots.map((l) => [l.number, l.title, l.budget])).toEqual([[1, 'Lot unique', null]]);
    expect(rfp.budget).toBeNull();
  });

  it('numbers the lots in order and totals their budgets — ignoring lots with none', async () => {
    const { alice } = await createTwoUsers();
    const rfp = await rfpService.create(alice.id, {
      ...base,
      reference: 'L/2',
      lots: [{ title: 'Serveurs', budget: 8000000 }, { title: 'Stockage', budget: 4500000.5 }, { title: 'Formation', budget: null }],
    });

    expect(rfp.lots.map((l) => [l.number, l.title])).toEqual([[1, 'Serveurs'], [2, 'Stockage'], [3, 'Formation']]);
    expect(rfp.budget).toBe(12500000.5);
    // And the register sees the same total, since it sorts on it.
    expect((await rfpService.findAll(alice.id, {})).data[0].budget).toBe(12500000.5);
  });

  it('recomputes the total on every lot change: add, edit, remove', async () => {
    const { alice } = await createTwoUsers();
    const rfp = await rfpService.create(alice.id, { ...base, reference: 'L/3', lots: [{ title: 'Lot 1', budget: 1000 }] });

    const lot2 = await composition.createLot(alice.id, rfp.id, { title: 'Lot 2', budget: 2500 });
    expect(lot2.number).toBe(2);
    expect((await rfpService.findById(alice.id, rfp.id)).budget).toBe(3500);

    await composition.updateLot(alice.id, rfp.id, lot2.id, { budget: 500 });
    expect((await rfpService.findById(alice.id, rfp.id)).budget).toBe(1500);

    await composition.deleteLot(alice.id, rfp.id, lot2.id);
    expect((await rfpService.findById(alice.id, rfp.id)).budget).toBe(1000);

    // Clearing the only budget is "no budget", not zero.
    const [lot1] = (await rfpService.findById(alice.id, rfp.id)).lots;
    await composition.updateLot(alice.id, rfp.id, lot1.id, { budget: null });
    expect((await rfpService.findById(alice.id, rfp.id)).budget).toBeNull();
  });

  it('never removes the last lot, and does not renumber the others', async () => {
    const { alice } = await createTwoUsers();
    const rfp = await rfpService.create(alice.id, { ...base, reference: 'L/4', lots: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] });
    const [a, b, c] = rfp.lots;

    await composition.deleteLot(alice.id, rfp.id, b.id);
    // Lot 3 stays lot 3: the buyer's documents still call it that.
    expect((await rfpService.findById(alice.id, rfp.id)).lots.map((l) => l.number)).toEqual([1, 3]);
    await composition.deleteLot(alice.id, rfp.id, c.id);

    await expect(composition.deleteLot(alice.id, rfp.id, a.id)).rejects.toMatchObject({ statusCode: 400, code: 'LAST_LOT' });
    expect(await prisma.rfpLot.count({ where: { rfpId: rfp.id } })).toBe(1);
  });
});

describe('rfpComposition — the dossiers', () => {
  it('prepares the dossiers once and the offers once per lot, pre-filled, in catalogue order', async () => {
    const { alice } = await createTwoUsers();
    const rfp = await rfpService.create(alice.id, {
      ...base,
      reference: 'C/1',
      lots: [{ title: 'Serveurs' }, { title: 'Stockage' }],
      // Deliberately out of order: the catalogue decides the order, not the request.
      composition: { kinds: ['OFFRE_FINANCIERE', 'ADMINISTRATIF', 'OFFRE_TECHNIQUE'], prefill: true },
    });

    expect(rfp.folders.map((f) => f.title)).toEqual([
      'Dossier administratif',
      'Offre technique — Lot 1',
      'Offre technique — Lot 2',
      'Offre financière — Lot 1',
      'Offre financière — Lot 2',
    ]);
    expect(rfp.folders.map((f) => f.lot?.number ?? null)).toEqual([null, 1, 2, 1, 2]);

    const admin = rfp.folders[0];
    expect(admin.items.map((i) => i.title)).toContain('Attestation fiscale');
    expect(admin.items.every((i) => i.status === 'TODO')).toBe(true);
    expect(admin.items.length).toBeGreaterThan(0);
    const techOffer = rfp.folders[1];
    expect(techOffer.items.map((i) => i.title)).toEqual(expect.arrayContaining(['CV des intervenants', 'Diplômes', 'Offre de support']));
  });

  it('creates empty dossiers when asked not to pre-fill', async () => {
    const { alice } = await createTwoUsers();
    const rfp = await rfpService.create(alice.id, {
      ...base,
      reference: 'C/2',
      composition: { kinds: ['ADMINISTRATIF', 'TECHNIQUE'], prefill: false },
    });

    expect(rfp.folders).toHaveLength(2);
    expect(rfp.folders.flatMap((f) => f.items)).toHaveLength(0);
  });

  it('gives a new lot its own copy of every per-lot dossier the tender prepares', async () => {
    const { alice } = await createTwoUsers();
    const rfp = await rfpService.create(alice.id, {
      ...base,
      reference: 'C/3',
      composition: { kinds: ['ADMINISTRATIF', 'OFFRE_FINANCIERE'], prefill: true },
    });

    await composition.createLot(alice.id, rfp.id, { title: 'Extension' });

    const folders = (await rfpService.findById(alice.id, rfp.id)).folders;
    expect(folders.map((f) => f.title)).toEqual(['Dossier administratif', 'Offre financière — Lot 1', 'Offre financière — Lot 2']);
    // Pre-filled like the first — a new lot's offer needs the same pieces.
    expect(folders[2].items.map((i) => i.title)).toEqual(folders[1].items.map((i) => i.title));
  });

  it('keeps the offers on a lot and the dossiers on the tender', async () => {
    const { alice } = await createTwoUsers();
    const rfp = await rfpService.create(alice.id, { ...base, reference: 'C/4' });
    const lotId = rfp.lots[0].id;

    await expect(composition.createFolder(alice.id, rfp.id, { kind: 'OFFRE_FINANCIERE' })).rejects.toMatchObject({ statusCode: 400, code: 'LOT_REQUIRED' });
    await expect(composition.createFolder(alice.id, rfp.id, { kind: 'ADMINISTRATIF', lotId })).rejects.toMatchObject({ statusCode: 400, code: 'LOT_NOT_ALLOWED' });
    // "Autre" may go either way.
    await composition.createFolder(alice.id, rfp.id, { kind: 'OTHER', lotId, title: 'Échantillons' });
    await composition.createFolder(alice.id, rfp.id, { kind: 'OTHER', title: 'Divers' });

    // A lot of ANOTHER tender is not a lot of this one.
    const other = await rfpService.create(alice.id, { ...base, reference: 'C/5' });
    await expect(composition.createFolder(alice.id, rfp.id, { kind: 'OFFRE_TECHNIQUE', lotId: other.lots[0].id })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('rfpComposition — pieces and their files', () => {
  it('adds, updates and removes pieces, appending in order', async () => {
    const { alice } = await createTwoUsers();
    const rfp = await rfpService.create(alice.id, { ...base, reference: 'P/1', composition: { kinds: ['TECHNIQUE'], prefill: true } });
    const folder = rfp.folders[0];
    const before = folder.items.length;

    const added = await composition.createItem(alice.id, rfp.id, folder.id, { title: 'Certification ISO 27001' });
    expect(added.position).toBe(before);

    const updated = await composition.updateItem(alice.id, rfp.id, added.id, { status: 'READY', notes: 'Valide jusqu’en 2027' });
    expect(updated).toMatchObject({ status: 'READY', notes: 'Valide jusqu’en 2027', title: 'Certification ISO 27001' });

    await composition.deleteItem(alice.id, rfp.id, added.id);
    expect((await rfpService.findById(alice.id, rfp.id)).folders[0].items).toHaveLength(before);
  });

  it('keeps a piece\'s files out of the tender\'s own dossier', async () => {
    const { alice } = await createTwoUsers();
    const rfp = await rfpService.create(alice.id, { ...base, reference: 'P/2', composition: { kinds: ['OFFRE_TECHNIQUE'], prefill: true } });
    const cv = rfp.folders[0].items.find((i) => i.title === 'CV des intervenants')!;

    await composition.addItemDocument(alice.id, rfp.id, cv.id, await storedFile(alice.id, 'CV chef de projet.pdf'));

    const detail = await rfpService.findById(alice.id, rfp.id);
    // Under the piece…
    expect(detail.folders[0].items.find((i) => i.id === cv.id)!.documents.map((d) => d.filename)).toEqual(['CV chef de projet.pdf']);
    // …and not in the tender's dossier, nor its count in the register.
    expect(detail.documents).toHaveLength(0);
    expect((await rfpService.findAll(alice.id, {})).data[0].documents).toHaveLength(0);
  });

  it('takes a piece\'s files off the disk with the piece, the dossier, the lot and the tender', async () => {
    const { alice } = await createTwoUsers();
    const rfp = await rfpService.create(alice.id, {
      ...base,
      reference: 'P/3',
      lots: [{ title: 'A' }, { title: 'B' }],
      composition: { kinds: ['ADMINISTRATIF', 'OFFRE_FINANCIERE'], prefill: true },
    });
    const [admin, finA, finB] = rfp.folders;
    const put = async (itemId: string) => {
      const f = await storedFile(alice.id);
      await composition.addItemDocument(alice.id, rfp.id, itemId, f);
      return f.storageKey;
    };

    const byItem = await put(admin.items[0].id);
    await composition.deleteItem(alice.id, rfp.id, admin.items[0].id);
    expect(onDisk(byItem)).toBe(false);

    const byFolder = await put(admin.items[1].id);
    await composition.deleteFolder(alice.id, rfp.id, admin.id);
    expect(onDisk(byFolder)).toBe(false);

    const byLot = await put(finB.items[0].id);
    await composition.deleteLot(alice.id, rfp.id, finB.lot!.id);
    expect(onDisk(byLot)).toBe(false);

    // The tender itself: its dossier AND every prepared piece.
    const byTender = await put(finA.items[0].id);
    await rfpService.remove(alice.id, rfp.id);
    expect(onDisk(byTender)).toBe(false);
    expect(await prisma.rfpDocument.count({ where: { rfpId: rfp.id } })).toBe(0);
  });
});

describe('rfpComposition — access', () => {
  it('lets a colleague the tender was shared with prepare its pieces', async () => {
    const { alice, bob } = await createTwoUsers();
    const rfp = await rfpService.create(alice.id, { ...base, reference: 'A/1', composition: { kinds: ['TECHNIQUE'], prefill: true } });
    await rfpService.share(alice.id, rfp.id, [bob.id]);

    const item = await composition.createItem(bob.id, rfp.id, rfp.folders[0].id, { title: 'Références bancaires' });
    await composition.updateItem(bob.id, rfp.id, item.id, { status: 'IN_PROGRESS' });
    await composition.addItemDocument(bob.id, rfp.id, item.id, await storedFile(bob.id));
    await composition.createLot(bob.id, rfp.id, { title: 'Lot 2' });

    const detail = await rfpService.findById(alice.id, rfp.id);
    expect(detail.lots).toHaveLength(2);
    expect(detail.folders[0].items.find((i) => i.id === item.id)).toMatchObject({ status: 'IN_PROGRESS' });
  });

  it('refuses everything to someone the tender was not shared with', async () => {
    const { alice } = await createTwoUsers();
    const stranger = await createUser();
    const rfp = await rfpService.create(alice.id, { ...base, reference: 'A/2', composition: { kinds: ['TECHNIQUE'], prefill: true } });
    const folder = rfp.folders[0];
    const item = folder.items[0];
    const lot = rfp.lots[0];

    // Thunks, not promises: a promise built here would reject before the
    // loop reached it, which Node reports as an unhandled rejection.
    const attempts = [
      () => composition.createLot(stranger.id, rfp.id, { title: 'x' }),
      () => composition.updateLot(stranger.id, rfp.id, lot.id, { budget: 1 }),
      () => composition.deleteLot(stranger.id, rfp.id, lot.id),
      () => composition.createFolder(stranger.id, rfp.id, { kind: 'ADDITIF' }),
      () => composition.updateFolder(stranger.id, rfp.id, folder.id, { title: 'x' }),
      () => composition.deleteFolder(stranger.id, rfp.id, folder.id),
      () => composition.createItem(stranger.id, rfp.id, folder.id, { title: 'x' }),
      () => composition.updateItem(stranger.id, rfp.id, item.id, { status: 'READY' }),
      () => composition.deleteItem(stranger.id, rfp.id, item.id),
    ];
    for (const attempt of attempts) {
      await expect(attempt()).rejects.toMatchObject({ statusCode: 404 });
    }

    // Nothing moved.
    const detail = await rfpService.findById(alice.id, rfp.id);
    expect(detail.lots).toHaveLength(1);
    expect(detail.folders).toHaveLength(1);
    expect(detail.folders[0].items.find((i) => i.id === item.id)!.status).toBe('TODO');
  });

  it('will not reach a piece of another tender through this one\'s id', async () => {
    // The route carries both ids; checking only the tender would let an
    // accessible tender's id vouch for any piece in the database.
    const { alice, bob } = await createTwoUsers();
    const mine = await rfpService.create(alice.id, { ...base, reference: 'A/3' });
    const theirs = await rfpService.create(bob.id, { ...base, reference: 'A/4', composition: { kinds: ['TECHNIQUE'], prefill: true } });
    const theirItem = theirs.folders[0].items[0];

    await expect(composition.updateItem(alice.id, mine.id, theirItem.id, { status: 'READY' })).rejects.toMatchObject({ statusCode: 404 });
    await expect(composition.deleteFolder(alice.id, mine.id, theirs.folders[0].id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(composition.updateLot(alice.id, mine.id, theirs.lots[0].id, { budget: 1 })).rejects.toMatchObject({ statusCode: 404 });
    expect((await rfpService.findById(bob.id, theirs.id)).folders[0].items[0].status).toBe('TODO');
  });
});
