import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rfpService } from './rfpService.js';
import { rfpCompositionService as composition } from './rfpCompositionService.js';
import { rfpVerificationService as verification } from './rfpVerificationService.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createUser } from '../test/factories.js';

/**
 * Versions of a piece, and the verifiers who must approve them.
 *
 * The property under test throughout: with verifiers, a piece that has a
 * file is Ready exactly when every verifier has approved its *current*
 * version — and every path that can change either side keeps it so.
 */
let storageDir: string;

beforeAll(async () => {
  storageDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mailviz-rfp-verif-'));
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

let seq = 0;
/** A tender owned by `owner`, shared with `recipients`, with one empty piece. */
async function tenderWithPiece(ownerId: string, recipients: string[] = []) {
  const rfp = await rfpService.create(ownerId, {
    name: 'Maintenance SIMPL',
    reference: `V/${++seq}`,
    deadlineAt: '2026-11-09T10:00:00.000Z',
    submissionFormat: 'PORTAL',
    composition: { kinds: ['ADMINISTRATIF'], prefill: false },
  });
  for (const id of recipients) {
    await prisma.rfpShare.create({ data: { rfpId: rfp.id, sharedByUserId: ownerId, sharedWithUserId: id } });
  }
  const item = await composition.createItem(ownerId, rfp.id, rfp.folders[0].id, { title: 'Attestation fiscale' });
  return { rfpId: rfp.id, itemId: item.id };
}

const statusOf = async (itemId: string) => (await prisma.rfpFolderItem.findUniqueOrThrow({ where: { id: itemId } })).status;
const upload = async (userId: string, rfpId: string, itemId: string, name?: string) =>
  composition.addItemDocument(userId, rfpId, itemId, await storedFile(userId, name));
const approve = (userId: string, rfpId: string, itemId: string) =>
  verification.decide(userId, rfpId, itemId, { decision: 'APPROVED' });

describe('rfpVerification — versions', () => {
  it('numbers each upload of a piece, and records who uploaded it', async () => {
    const { alice, bob } = await createTwoUsers();
    const { rfpId, itemId } = await tenderWithPiece(alice.id, [bob.id]);

    await upload(alice.id, rfpId, itemId, 'v1.pdf');
    await upload(bob.id, rfpId, itemId, 'v2.pdf');

    const detail = await rfpService.findById(alice.id, rfpId);
    const docs = detail.folders[0].items[0].documents;
    expect(docs.map((d) => [d.version, d.filename, d.uploadedBy?.id])).toEqual([
      [1, 'v1.pdf', alice.id],
      [2, 'v2.pdf', bob.id],
    ]);
  });

  it('gives racing uploads different numbers rather than two of the same', async () => {
    const { alice } = await createTwoUsers();
    const { rfpId, itemId } = await tenderWithPiece(alice.id);
    const files = await Promise.all([storedFile(alice.id), storedFile(alice.id), storedFile(alice.id)]);

    await Promise.all(files.map((f) => composition.addItemDocument(alice.id, rfpId, itemId, f)));

    const versions = (await prisma.rfpDocument.findMany({ where: { itemId }, orderBy: { version: 'asc' } })).map((d) => d.version);
    expect(versions).toEqual([1, 2, 3]);
  });

  it('puts the piece back in progress on every upload, whatever it was', async () => {
    const { alice } = await createTwoUsers();
    const { rfpId, itemId } = await tenderWithPiece(alice.id);

    for (const from of ['TODO', 'READY', 'NOT_APPLICABLE'] as const) {
      await prisma.rfpFolderItem.update({ where: { id: itemId }, data: { status: from } });
      await upload(alice.id, rfpId, itemId);
      expect(await statusOf(itemId)).toBe('IN_PROGRESS');
    }
  });

  it("records the uploader of the tender's own documents too", async () => {
    const { alice } = await createTwoUsers();
    const { rfpId } = await tenderWithPiece(alice.id);

    const doc = await rfpService.addDocument(alice.id, rfpId, await storedFile(alice.id, 'RC.pdf'), 'RFP');

    expect(doc.uploadedById).toBe(alice.id);
    // Not a piece, so not a version.
    expect(doc.version).toBeNull();
  });
});

describe('rfpVerification — Ready is the verifiers\' to give', () => {
  it('leaves Ready to the user when the tender has no verifiers', async () => {
    const { alice } = await createTwoUsers();
    const { rfpId, itemId } = await tenderWithPiece(alice.id);
    await upload(alice.id, rfpId, itemId);

    await composition.updateItem(alice.id, rfpId, itemId, { status: 'READY' });

    expect(await statusOf(itemId)).toBe('READY');
  });

  it('refuses a manual Ready until every verifier has approved', async () => {
    const { alice, bob } = await createTwoUsers();
    const { rfpId, itemId } = await tenderWithPiece(alice.id, [bob.id]);
    await verification.setVerifiers(alice.id, rfpId, [alice.id, bob.id]);
    await upload(alice.id, rfpId, itemId);
    await approve(alice.id, rfpId, itemId);

    await expect(composition.updateItem(alice.id, rfpId, itemId, { status: 'READY' })).rejects.toMatchObject({
      statusCode: 409,
      code: 'VERIFICATION_PENDING',
    });
    expect(await statusOf(itemId)).toBe('IN_PROGRESS');
  });

  it('makes the piece Ready on the last approval, and not before', async () => {
    const { alice, bob } = await createTwoUsers();
    const { rfpId, itemId } = await tenderWithPiece(alice.id, [bob.id]);
    await verification.setVerifiers(alice.id, rfpId, [alice.id, bob.id]);
    await upload(bob.id, rfpId, itemId);

    await approve(alice.id, rfpId, itemId);
    expect(await statusOf(itemId)).toBe('IN_PROGRESS');

    await approve(bob.id, rfpId, itemId);
    expect(await statusOf(itemId)).toBe('READY');
  });

  it('does not carry approvals over to a new version', async () => {
    const { alice, bob } = await createTwoUsers();
    const { rfpId, itemId } = await tenderWithPiece(alice.id, [bob.id]);
    await verification.setVerifiers(alice.id, rfpId, [bob.id]);
    await upload(alice.id, rfpId, itemId);
    await approve(bob.id, rfpId, itemId);
    expect(await statusOf(itemId)).toBe('READY');

    await upload(alice.id, rfpId, itemId);

    expect(await statusOf(itemId)).toBe('IN_PROGRESS');
    // And Ready stays refused until bob looks at the new one.
    await expect(composition.updateItem(alice.id, rfpId, itemId, { status: 'READY' })).rejects.toMatchObject({ statusCode: 409 });
    await approve(bob.id, rfpId, itemId);
    expect(await statusOf(itemId)).toBe('READY');
  });

  it('takes Ready away when a verifier asks for changes or withdraws', async () => {
    const { alice, bob } = await createTwoUsers();
    const { rfpId, itemId } = await tenderWithPiece(alice.id, [bob.id]);
    await verification.setVerifiers(alice.id, rfpId, [bob.id]);
    await upload(alice.id, rfpId, itemId);

    await approve(bob.id, rfpId, itemId);
    await verification.decide(bob.id, rfpId, itemId, { decision: 'CHANGES_REQUESTED', comment: 'Attestation expirée' });
    expect(await statusOf(itemId)).toBe('IN_PROGRESS');
    const row = await prisma.rfpItemVerification.findUniqueOrThrow({ where: { itemId_userId: { itemId, userId: bob.id } } });
    expect([row.decision, row.comment]).toEqual(['CHANGES_REQUESTED', 'Attestation expirée']);

    await approve(bob.id, rfpId, itemId);
    expect(await statusOf(itemId)).toBe('READY');
    await verification.withdraw(bob.id, rfpId, itemId);
    expect(await statusOf(itemId)).toBe('IN_PROGRESS');
  });

  it('counts the previous version again when the current one is deleted', async () => {
    const { alice, bob } = await createTwoUsers();
    const { rfpId, itemId } = await tenderWithPiece(alice.id, [bob.id]);
    await verification.setVerifiers(alice.id, rfpId, [bob.id]);
    await upload(alice.id, rfpId, itemId);
    await approve(bob.id, rfpId, itemId);
    const v2 = await upload(alice.id, rfpId, itemId);
    expect(await statusOf(itemId)).toBe('IN_PROGRESS');

    // v2 was a mistake: v1, which bob approved, is current again.
    await rfpService.removeDocument(alice.id, rfpId, v2.id);

    expect(await statusOf(itemId)).toBe('READY');
  });

  it('leaves Ready to the user for a piece with no file, verifiers or not', async () => {
    const { alice, bob } = await createTwoUsers();
    const { rfpId, itemId } = await tenderWithPiece(alice.id, [bob.id]);
    await verification.setVerifiers(alice.id, rfpId, [bob.id]);

    // A cautionnement handed in on paper has nothing to upload.
    await composition.updateItem(alice.id, rfpId, itemId, { status: 'READY' });

    expect(await statusOf(itemId)).toBe('READY');
  });

  it('leaves a not-applicable piece alone', async () => {
    const { alice, bob } = await createTwoUsers();
    const { rfpId, itemId } = await tenderWithPiece(alice.id, [bob.id]);
    await verification.setVerifiers(alice.id, rfpId, [bob.id]);
    await upload(alice.id, rfpId, itemId);
    await composition.updateItem(alice.id, rfpId, itemId, { status: 'NOT_APPLICABLE' });

    await approve(bob.id, rfpId, itemId);

    expect(await statusOf(itemId)).toBe('NOT_APPLICABLE');
  });
});

describe('rfpVerification — who decides', () => {
  it('lets only a verifier decide, on a piece that has a file', async () => {
    const { alice, bob } = await createTwoUsers();
    const stranger = await createUser();
    const { rfpId, itemId } = await tenderWithPiece(alice.id, [bob.id]);
    await verification.setVerifiers(alice.id, rfpId, [alice.id]);

    await expect(approve(alice.id, rfpId, itemId)).rejects.toMatchObject({ statusCode: 409, code: 'NOTHING_TO_VERIFY' });
    await upload(alice.id, rfpId, itemId);
    // Bob can open it, but was not asked to verify it.
    await expect(approve(bob.id, rfpId, itemId)).rejects.toMatchObject({ statusCode: 403, code: 'NOT_A_VERIFIER' });
    await expect(approve(stranger.id, rfpId, itemId)).rejects.toMatchObject({ statusCode: 404 });
    expect(await prisma.rfpItemVerification.count({ where: { itemId } })).toBe(0);
  });

  it('records a decision against the version it was made on', async () => {
    const { alice } = await createTwoUsers();
    const { rfpId, itemId } = await tenderWithPiece(alice.id);
    await verification.setVerifiers(alice.id, rfpId, [alice.id]);
    await upload(alice.id, rfpId, itemId);
    const v2 = await upload(alice.id, rfpId, itemId);

    const row = await approve(alice.id, rfpId, itemId);

    expect(row.documentId).toBe(v2.id);
  });

  it('refuses a piece of another tender through this one', async () => {
    const { alice, bob } = await createTwoUsers();
    const mine = await tenderWithPiece(alice.id);
    const theirs = await tenderWithPiece(bob.id);
    await verification.setVerifiers(alice.id, mine.rfpId, [alice.id]);
    await upload(bob.id, theirs.rfpId, theirs.itemId);

    await expect(approve(alice.id, mine.rfpId, theirs.itemId)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('rfpVerification — the verifiers', () => {
  it("is the owner's list to set, from the people the tender is shared with", async () => {
    const { alice, bob } = await createTwoUsers();
    const outsider = await createUser();
    const { rfpId } = await tenderWithPiece(alice.id, [bob.id]);

    await expect(verification.setVerifiers(bob.id, rfpId, [bob.id])).rejects.toMatchObject({ statusCode: 404 });
    await expect(verification.setVerifiers(alice.id, rfpId, [outsider.id])).rejects.toMatchObject({
      statusCode: 400,
      code: 'VERIFIER_WITHOUT_ACCESS',
    });

    const set = await verification.setVerifiers(alice.id, rfpId, [alice.id, bob.id]);
    expect(set.map((v) => v.user.id).sort()).toEqual([alice.id, bob.id].sort());
  });

  it('un-readies what a new verifier has not seen, and readies what only they were missing', async () => {
    const { alice, bob } = await createTwoUsers();
    const { rfpId, itemId } = await tenderWithPiece(alice.id, [bob.id]);
    await verification.setVerifiers(alice.id, rfpId, [alice.id]);
    await upload(alice.id, rfpId, itemId);
    await approve(alice.id, rfpId, itemId);
    expect(await statusOf(itemId)).toBe('READY');

    await verification.setVerifiers(alice.id, rfpId, [alice.id, bob.id]);
    expect(await statusOf(itemId)).toBe('IN_PROGRESS');

    await verification.setVerifiers(alice.id, rfpId, [alice.id]);
    expect(await statusOf(itemId)).toBe('READY');
  });

  it("drops a removed verifier's decisions, so they stop counting if re-added", async () => {
    const { alice, bob } = await createTwoUsers();
    const { rfpId, itemId } = await tenderWithPiece(alice.id, [bob.id]);
    await verification.setVerifiers(alice.id, rfpId, [bob.id]);
    await upload(alice.id, rfpId, itemId);
    await approve(bob.id, rfpId, itemId);

    await verification.setVerifiers(alice.id, rfpId, [alice.id]);
    expect(await prisma.rfpItemVerification.count({ where: { itemId, userId: bob.id } })).toBe(0);

    await verification.setVerifiers(alice.id, rfpId, [bob.id]);
    expect(await statusOf(itemId)).toBe('IN_PROGRESS');
  });

  it('removes a colleague as verifier, with their approvals, when the tender is unshared', async () => {
    const { alice, bob } = await createTwoUsers();
    const { rfpId, itemId } = await tenderWithPiece(alice.id, [bob.id]);
    await verification.setVerifiers(alice.id, rfpId, [alice.id, bob.id]);
    await upload(alice.id, rfpId, itemId);
    await approve(bob.id, rfpId, itemId);

    await rfpService.unshare(alice.id, rfpId, bob.id);

    expect(await prisma.rfpVerifier.count({ where: { rfpId, userId: bob.id } })).toBe(0);
    expect(await prisma.rfpItemVerification.count({ where: { itemId, userId: bob.id } })).toBe(0);
    // Alice alone remains, and has not approved.
    expect(await statusOf(itemId)).toBe('IN_PROGRESS');
    await approve(alice.id, rfpId, itemId);
    expect(await statusOf(itemId)).toBe('READY');
  });

  it('keeps a verifier when someone other than the sharer tries to unshare them', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser();
    const { rfpId } = await tenderWithPiece(alice.id, [bob.id, carol.id]);
    await verification.setVerifiers(alice.id, rfpId, [bob.id]);

    await rfpService.unshare(carol.id, rfpId, bob.id);

    expect(await prisma.rfpVerifier.count({ where: { rfpId, userId: bob.id } })).toBe(1);
  });

  it('shows the verifiers and each decision on the tender', async () => {
    const { alice, bob } = await createTwoUsers();
    const { rfpId, itemId } = await tenderWithPiece(alice.id, [bob.id]);
    await verification.setVerifiers(alice.id, rfpId, [bob.id]);
    await upload(alice.id, rfpId, itemId);
    await approve(bob.id, rfpId, itemId);

    // Read by the recipient, who is who needs to see it.
    const detail = await rfpService.findById(bob.id, rfpId);

    expect(detail.verifiers.map((v) => v.user.email)).toEqual([bob.email]);
    const piece = detail.folders[0].items[0];
    expect(piece.verifications.map((v) => [v.user.id, v.decision, v.documentId])).toEqual([
      [bob.id, 'APPROVED', piece.documents[0].id],
    ]);
  });
});
