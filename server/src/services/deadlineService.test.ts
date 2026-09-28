import { describe, it, expect } from 'vitest';
import { deadlineService } from './deadlineService.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createRfp, createTask, seedTaskStatuses } from '../test/factories.js';

const START = '2026-11-01T00:00:00.000Z';
const END = '2026-12-01T00:00:00.000Z';
const inNov = (d: number, h = 10) => new Date(Date.UTC(2026, 10, d, h));

async function piece(rfpId: string, title: string, data: { assigneeId?: string; dueDate?: Date; status?: string }) {
  const folder = await prisma.rfpFolder.create({ data: { rfpId, kind: 'ADMINISTRATIF', title: 'Dossier administratif' } });
  return prisma.rfpFolderItem.create({ data: { folderId: folder.id, title, ...data } });
}

describe('deadlineService.forRange', () => {
  it('lists tender deadlines, questions cut-offs, my pieces and my open tasks, in time order', async () => {
    const { alice } = await createTwoUsers();
    await seedTaskStatuses(alice.id);
    const rfp = await createRfp(alice.id, { name: 'Refonte AIX', reference: '70/AOO', deadlineAt: inNov(20) });
    await prisma.rfp.update({ where: { id: rfp.id }, data: { questionsDeadlineAt: inNov(13) } });
    await piece(rfp.id, 'Attestation CNSS', { assigneeId: alice.id, dueDate: inNov(18) });
    const task = await createTask(alice.id, { title: 'Relancer BKAM' });
    await prisma.task.update({ where: { id: task.id }, data: { dueDate: inNov(5) } });

    const got = await deadlineService.forRange(alice.id, START, END);

    expect(got.map((d) => [d.kind, d.title])).toEqual([
      ['TASK_DUE', 'Relancer BKAM'],
      ['RFP_QUESTIONS', 'Questions close · Refonte AIX'],
      ['PIECE_DUE', 'Attestation CNSS'],
      ['RFP_DEADLINE', 'Refonte AIX'],
    ]);
    expect(got.find((d) => d.kind === 'PIECE_DUE')).toMatchObject({ context: 'Refonte AIX', href: `/rfps/${rfp.id}` });
    expect(got.find((d) => d.kind === 'TASK_DUE')?.href).toBe(`/tasks?task=${task.id}`);
  });

  it('leaves out finished work: a won tender, a done task, a ready or N/A piece', async () => {
    const { alice } = await createTwoUsers();
    await seedTaskStatuses(alice.id);
    const won = await createRfp(alice.id, { reference: 'WON', deadlineAt: inNov(20), status: 'WON' });
    const live = await createRfp(alice.id, { reference: 'LIVE', deadlineAt: inNov(25) });
    await piece(live.id, 'Ready piece', { assigneeId: alice.id, dueDate: inNov(18), status: 'READY' });
    await piece(live.id, 'N/A piece', { assigneeId: alice.id, dueDate: inNov(18), status: 'NOT_APPLICABLE' });
    await piece(won.id, 'Piece of a won tender', { assigneeId: alice.id, dueDate: inNov(18) });
    const done = await createTask(alice.id, { title: 'Done task' });
    await prisma.task.update({ where: { id: done.id }, data: { dueDate: inNov(5), status: 'DONE' } });

    const got = await deadlineService.forRange(alice.id, START, END);

    expect(got.map((d) => d.id)).toEqual([`RFP_DEADLINE:${live.id}`]);
  });

  it("includes a tender shared with me, never another user's, and only my own pieces", async () => {
    const { alice, bob } = await createTwoUsers();
    const shared = await createRfp(bob.id, { reference: 'SHARED', deadlineAt: inNov(20) });
    await prisma.rfpShare.create({ data: { rfpId: shared.id, sharedByUserId: bob.id, sharedWithUserId: alice.id } });
    await createRfp(bob.id, { reference: 'PRIVATE', deadlineAt: inNov(21) });
    await piece(shared.id, 'Bob prepares this', { assigneeId: bob.id, dueDate: inNov(18) });

    const got = await deadlineService.forRange(alice.id, START, END);

    expect(got.map((d) => d.id)).toEqual([`RFP_DEADLINE:${shared.id}`]);
  });

  it('keeps to the range, and refuses a bad or over-long one', async () => {
    const { alice } = await createTwoUsers();
    await createRfp(alice.id, { reference: 'BEFORE', deadlineAt: new Date(Date.UTC(2026, 9, 31, 23)) });
    await createRfp(alice.id, { reference: 'AT END', deadlineAt: new Date(END) });
    expect(await deadlineService.forRange(alice.id, START, END)).toEqual([]);

    await expect(deadlineService.forRange(alice.id, 'nope', END)).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_RANGE' });
    await expect(deadlineService.forRange(alice.id, END, START)).rejects.toMatchObject({ code: 'INVALID_RANGE' });
    await expect(deadlineService.forRange(alice.id, '2026-01-01T00:00:00Z', '2026-12-31T00:00:00Z')).rejects.toMatchObject({
      code: 'RANGE_TOO_LONG',
    });
  });
});
