import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { signAccessToken } from '../utils/jwt.js';
import { createTwoUsers, createClientReference } from '../test/factories.js';

/**
 * The references register over HTTP: what only a request can reach — the
 * validation middleware, multer's refusals arriving as 400s, the bytes served
 * back with their headers, and `/ids` and `/facets` resolving before `/:id`.
 */
const cookieFor = (userId: string) => [`access_token=${signAccessToken(userId)}`];

let storageDir: string;
beforeAll(async () => {
  storageDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mailviz-ref-routes-'));
  process.env.RFP_STORAGE_DIR = storageDir;
});
afterAll(async () => {
  delete process.env.RFP_STORAGE_DIR;
  await fs.promises.rm(storageDir, { recursive: true, force: true });
});

describe('/api/v1/client-references', () => {
  it('creates, reads, updates, lists and deletes a reference', async () => {
    const { alice } = await createTwoUsers();
    const cookie = cookieFor(alice.id);

    const created = await request(app)
      .post('/api/v1/client-references')
      .set('Cookie', cookie)
      .send({
        customerName: 'Crédit Agricole du Maroc',
        projectName: 'Mise en place d’une plateforme Power de production et de secours',
        amount: 13164000,
        amountType: 'TTC',
        projectStart: '2026',
        signedAt: '2026-08-17',
        appreciation: 'SATISFACTION',
        technologies: ['Six (6) serveurs IBM Power 11', 'Deux (2) consoles HMC'],
        signatories: [{ name: 'Imad Chahine', role: 'Directeur Central' }],
      });
    expect(created.status).toBe(201);
    const ref = created.body.data;
    expect(ref.amount).toBe(13164000);
    expect(ref.amountHt).toBe(10970000);
    expect(ref.projectStart).toBe('2026');
    expect(ref.technologyTags).toContain('IBM Power 11');
    expect(ref.signatories).toEqual([expect.objectContaining({ name: 'Imad Chahine', role: 'Directeur Central' })]);

    const patched = await request(app).patch(`/api/v1/client-references/${ref.id}`).set('Cookie', cookie).send({ workStatus: 'IN_PROGRESS' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.workStatus).toBe('IN_PROGRESS');
    // The PATCH carried no appreciation, so none was defaulted over it.
    expect(patched.body.data.appreciation).toBe('SATISFACTION');

    const list = await request(app).get('/api/v1/client-references?tags=IBM%20Power&sinceYears=3').set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body.data.map((r: { id: string }) => r.id)).toEqual([ref.id]);

    expect((await request(app).delete(`/api/v1/client-references/${ref.id}`).set('Cookie', cookie)).status).toBe(204);
    expect(await prisma.clientReference.count({ where: { userId: alice.id } })).toBe(0);
  });

  it('answers 400 on an invalid body, and 404 for another account’s reference without leaking it', async () => {
    const { alice, bob } = await createTwoUsers();
    const cookie = cookieFor(alice.id);

    const bad = await request(app).post('/api/v1/client-references').set('Cookie', cookie).send({ customerName: 'X', projectStart: '17/09/2026' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');

    const bobs = await createClientReference(bob.id, { customerName: 'BobsSecretBank' });
    const read = await request(app).get(`/api/v1/client-references/${bobs.id}`).set('Cookie', cookie);
    expect(read.status).toBe(404);
    expect(JSON.stringify(read.body)).not.toContain('BobsSecretBank');
    expect((await request(app).patch(`/api/v1/client-references/${bobs.id}`).set('Cookie', cookie).send({ customerName: 'Hijacked' })).status).toBe(404);
    expect((await prisma.clientReference.findUniqueOrThrow({ where: { id: bobs.id } })).customerName).toBe('BobsSecretBank');
  });

  it('serves /ids and /facets rather than reading them as an id', async () => {
    const { alice } = await createTwoUsers();
    const cookie = cookieFor(alice.id);
    const small = await createClientReference(alice.id, { amount: 1, amountType: 'HT' });
    const big = await createClientReference(alice.id, { amount: 2, amountType: 'HT', technologies: ['IBM Power 10'] });

    const ids = await request(app).get('/api/v1/client-references/ids').set('Cookie', cookie);
    expect(ids.status).toBe(200);
    expect(ids.body.data).toEqual([big.id, small.id]);

    const facets = await request(app).get('/api/v1/client-references/facets').set('Cookie', cookie);
    expect(facets.status).toBe(200);
    expect(facets.body.data.total).toBe(2);
    expect(facets.body.data.technologyTags.find((t: { tag: string }) => t.tag === 'IBM Power').count).toBe(1);
  });

  it('replaces the document, serves it inline for the preview, and refuses what is not a PDF or an image', async () => {
    const { alice } = await createTwoUsers();
    const cookie = cookieFor(alice.id);
    const ref = await createClientReference(alice.id);

    const none = await request(app).get(`/api/v1/client-references/${ref.id}/document`).set('Cookie', cookie);
    expect(none.status).toBe(404);

    const first = await request(app)
      .put(`/api/v1/client-references/${ref.id}/document`)
      .set('Cookie', cookie)
      .attach('file', Buffer.from('%PDF-1.4 first'), { filename: 'p022 Crédit Agricole.pdf', contentType: 'application/pdf' });
    expect(first.status).toBe(200);
    expect(first.body.data.hasDocument).toBe(true);
    expect(first.body.data.documentFilename).toBe('p022 Crédit Agricole.pdf');
    const firstKey = (await prisma.clientReference.findUniqueOrThrow({ where: { id: ref.id } })).documentStorageKey!;
    expect(firstKey.startsWith(`${alice.id}/`)).toBe(true);

    const second = await request(app)
      .put(`/api/v1/client-references/${ref.id}/document`)
      .set('Cookie', cookie)
      .attach('file', Buffer.from('%PDF-1.4 second'), { filename: 'rescan.pdf', contentType: 'application/pdf' });
    expect(second.status).toBe(200);
    expect(fs.existsSync(path.join(storageDir, firstKey))).toBe(false);

    const inline = await request(app).get(`/api/v1/client-references/${ref.id}/document?inline=true`).set('Cookie', cookie);
    expect(inline.status).toBe(200);
    expect(inline.headers['content-type']).toContain('application/pdf');
    expect(inline.headers['content-disposition']).toBe('inline; filename="rescan.pdf"');
    expect(inline.body.toString()).toBe('%PDF-1.4 second');

    const word = await request(app)
      .put(`/api/v1/client-references/${ref.id}/document`)
      .set('Cookie', cookie)
      .attach('file', Buffer.from('PK'), { filename: 'letter.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    expect(word.status).toBe(400);
    expect(word.body.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    // Still the second file.
    expect((await prisma.clientReference.findUniqueOrThrow({ where: { id: ref.id } })).documentFilename).toBe('rescan.pdf');
  });

  it('says so when the row outlived its file', async () => {
    const { alice } = await createTwoUsers();
    const cookie = cookieFor(alice.id);
    const ref = await createClientReference(alice.id);
    await prisma.clientReference.update({ where: { id: ref.id }, data: { documentStorageKey: `${alice.id}/gone.pdf`, documentFilename: 'gone.pdf' } });

    const res = await request(app).get(`/api/v1/client-references/${ref.id}/document`).set('Cookie', cookie);
    expect(res.status).toBe(410);
    expect(res.body.error.code).toBe('REFERENCE_DOCUMENT_GONE');
  });
});
