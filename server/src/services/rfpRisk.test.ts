import { describe, it, expect } from 'vitest';
import { rfpService } from './rfpService.js';
import { rfpCompositionService as composition } from './rfpCompositionService.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createUser } from '../test/factories.js';

/**
 * What step 1 of the UI review added to a tender: when it was published and
 * when questions close (the clock readiness is measured against), who
 * prepares each piece and by when, and the register's readiness count.
 */
let seq = 0;
const base = () => ({
  name: 'Refonte AIX',
  reference: `RISK/${++seq}`,
  deadlineAt: '2026-11-20T10:00:00.000Z',
  submissionFormat: 'PORTAL' as const,
});

describe('rfp dates', () => {
  it('keeps the publication date and the questions deadline', async () => {
    const { alice } = await createTwoUsers();
    const rfp = await rfpService.create(alice.id, {
      ...base(),
      publishedAt: '2026-10-01T00:00:00.000Z',
      questionsDeadlineAt: '2026-11-13T10:00:00.000Z',
    });
    expect(rfp.publishedAt?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(rfp.questionsDeadlineAt?.toISOString()).toBe('2026-11-13T10:00:00.000Z');
  });

  it('refuses questions closing, or publication, after the deadline', async () => {
    const { alice } = await createTwoUsers();
    await expect(rfpService.create(alice.id, { ...base(), questionsDeadlineAt: '2026-11-21T10:00:00.000Z' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'QUESTIONS_AFTER_DEADLINE',
    });
    await expect(rfpService.create(alice.id, { ...base(), publishedAt: '2026-12-01T00:00:00.000Z' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'PUBLISHED_AFTER_DEADLINE',
    });
  });

  it('checks the order against what is stored when only one date moves', async () => {
    const { alice } = await createTwoUsers();
    const rfp = await rfpService.create(alice.id, { ...base(), questionsDeadlineAt: '2026-11-13T10:00:00.000Z' });

    // Moving the deadline before the existing questions date.
    await expect(rfpService.update(alice.id, rfp.id, { deadlineAt: '2026-11-10T10:00:00.000Z' })).rejects.toMatchObject({
      code: 'QUESTIONS_AFTER_DEADLINE',
    });
    // Clearing the questions date makes the same move fine.
    await rfpService.update(alice.id, rfp.id, { questionsDeadlineAt: null });
    const moved = await rfpService.update(alice.id, rfp.id, { deadlineAt: '2026-11-10T10:00:00.000Z' });
    expect(moved.deadlineAt.toISOString()).toBe('2026-11-10T10:00:00.000Z');
  });
});

describe('rfp register readiness', () => {
  it('counts ready pieces out of those that apply, per tender', async () => {
    const { alice } = await createTwoUsers();
    const a = await rfpService.create(alice.id, { ...base(), composition: { kinds: ['ADMINISTRATIF'], prefill: false } });
    const b = await rfpService.create(alice.id, { ...base() });
    const folderId = a.folders[0].id;
    const items = await Promise.all(['one', 'two', 'three', 'four'].map((t) => composition.createItem(alice.id, a.id, folderId, { title: t })));
    await prisma.rfpFolderItem.update({ where: { id: items[0].id }, data: { status: 'READY' } });
    await prisma.rfpFolderItem.update({ where: { id: items[1].id }, data: { status: 'NOT_APPLICABLE' } });

    const { data } = await rfpService.findAll(alice.id, {});
    const byId = new Map(data.map((r) => [r.id, r.readiness]));

    expect(byId.get(a.id)).toEqual({ ready: 1, total: 3 });
    expect(byId.get(b.id)).toEqual({ ready: 0, total: 0 });
  });
});

describe('piece owners and due dates', () => {
  async function tenderWithPiece(ownerId: string, recipients: string[] = []) {
    const rfp = await rfpService.create(ownerId, { ...base(), composition: { kinds: ['ADMINISTRATIF'], prefill: false } });
    for (const id of recipients) {
      await prisma.rfpShare.create({ data: { rfpId: rfp.id, sharedByUserId: ownerId, sharedWithUserId: id } });
    }
    const item = await composition.createItem(ownerId, rfp.id, rfp.folders[0].id, { title: 'Attestation CNSS' });
    return { rfpId: rfp.id, itemId: item.id };
  }

  it('assigns a piece to someone who can open the tender, with a due date', async () => {
    const { alice, bob } = await createTwoUsers();
    const { rfpId, itemId } = await tenderWithPiece(alice.id, [bob.id]);

    await composition.updateItem(alice.id, rfpId, itemId, { assigneeId: bob.id, dueDate: '2026-11-18T17:00:00.000Z' });

    const detail = await rfpService.findById(alice.id, rfpId);
    const piece = detail.folders[0].items[0];
    expect(piece.assignee?.id).toBe(bob.id);
    expect(piece.dueDate?.toISOString()).toBe('2026-11-18T17:00:00.000Z');
  });

  it('refuses an assignee who cannot open the tender', async () => {
    const { alice } = await createTwoUsers();
    const outsider = await createUser();
    const { rfpId, itemId } = await tenderWithPiece(alice.id);

    await expect(composition.updateItem(alice.id, rfpId, itemId, { assigneeId: outsider.id })).rejects.toMatchObject({
      statusCode: 400,
      code: 'ASSIGNEE_WITHOUT_ACCESS',
    });
    expect((await prisma.rfpFolderItem.findUniqueOrThrow({ where: { id: itemId } })).assigneeId).toBeNull();
  });

  it('unassigns a colleague when the tender is unshared from them', async () => {
    const { alice, bob } = await createTwoUsers();
    const { rfpId, itemId } = await tenderWithPiece(alice.id, [bob.id]);
    await composition.updateItem(alice.id, rfpId, itemId, { assigneeId: bob.id });
    const other = await tenderWithPiece(alice.id, [bob.id]);
    await composition.updateItem(alice.id, other.rfpId, other.itemId, { assigneeId: bob.id });

    await rfpService.unshare(alice.id, rfpId, bob.id);

    expect((await prisma.rfpFolderItem.findUniqueOrThrow({ where: { id: itemId } })).assigneeId).toBeNull();
    // Only on the tender that was unshared.
    expect((await prisma.rfpFolderItem.findUniqueOrThrow({ where: { id: other.itemId } })).assigneeId).toBe(bob.id);
  });
});
