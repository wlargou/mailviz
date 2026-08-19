import { describe, it, expect, vi, afterEach } from 'vitest';
import { auditService } from './auditService.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers } from '../test/factories.js';

/**
 * The audit trail is the app's record of what was done to a user's data, and it
 * has two failure modes that matter more than the happy path:
 *
 *   1. `log()` is fire-and-forget. It is called from inside request handlers
 *      that must succeed regardless of whether the audit row lands, so a
 *      rejected write has to be swallowed. Without its `.catch`, a failed
 *      insert becomes an unhandled rejection — which in Node is a process-level
 *      event, not a caught error in the caller. The endpoint would already have
 *      returned 200 and the server would log a crash-shaped warning (or, under
 *      `--unhandled-rejections=strict`, die).
 *
 *   2. `logSync()` takes an optional client so a caller can pass the
 *      transaction client and make the audit row commit or roll back *with* the
 *      operation it describes. Destructive operations rely on that: the record
 *      of what was destroyed has to be atomic with the destruction, or a
 *      half-failed merge leaves rows gone with nothing saying what they were.
 *
 * `findAll` gets the usual treatment for a list endpoint: its search branch
 * assigns `where.OR`, which is exactly the shape that erased the ownership
 * filter in `dealService` and `emailService`. Here ownership lives in
 * `where.userId`, so assignment cannot clobber it — these tests exist to keep
 * it that way.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

/** Poll until `predicate` holds — `log()` gives the caller no promise to await. */
async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() >= deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('auditService.log — fire and forget', () => {
  it('writes the row without the caller awaiting anything', async () => {
    const { alice } = await createTwoUsers();

    const returned = auditService.log({
      userId: alice.id,
      action: 'EMAIL_SENT',
      entityType: 'email',
      entityId: 'msg-1',
      details: { subject: 'Hello' },
    });

    // The contract is synchronous-void: callers must not be able to await it by
    // accident and start depending on the write having finished.
    expect(returned).toBeUndefined();

    await waitFor(async () => (await prisma.auditLog.count({ where: { userId: alice.id } })) === 1);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { userId: alice.id } });
    expect(row.action).toBe('EMAIL_SENT');
    expect(row.entityType).toBe('email');
    expect(row.entityId).toBe('msg-1');
    expect(row.details).toEqual({ subject: 'Hello' });
    expect(row.status).toBe('success');
  });

  /**
   * If this fails in production, a failed audit insert becomes an unhandled
   * promise rejection inside a request that has already returned successfully.
   */
  it('swallows a failed write instead of rejecting into the void', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // No such user — the foreign key rejects the insert.
    expect(() =>
      auditService.log({
        userId: '00000000-0000-0000-0000-000000000000',
        action: 'USER_LOGIN',
        entityType: 'auth',
      })
    ).not.toThrow();

    await waitFor(() => warn.mock.calls.length > 0);
    expect(warn.mock.calls[0][0]).toContain('[AuditLog]');
    expect(await prisma.auditLog.count()).toBe(0);
  });

  /**
   * `details` is a nullable JSONB column, and Prisma needs `Prisma.DbNull` to
   * write SQL NULL — JS null (or `Prisma.JsonNull`) writes the JSON value
   * `null` instead. The two are not the same row: `details IS NULL` and every
   * JSON path filter behave differently, so the audit search silently changes
   * meaning if this regresses.
   */
  it('stores an absent details as SQL NULL, not JSON null', async () => {
    const { alice } = await createTwoUsers();

    auditService.log({ userId: alice.id, action: 'USER_LOGIN', entityType: 'auth' });
    await waitFor(async () => (await prisma.auditLog.count({ where: { userId: alice.id } })) === 1);

    const [row] = await prisma.$queryRaw<Array<{ is_sql_null: boolean }>>`
      SELECT details IS NULL AS is_sql_null FROM audit_logs WHERE user_id = ${alice.id}
    `;
    expect(row.is_sql_null).toBe(true);
  });

  it('records an explicit failure status', async () => {
    const { alice } = await createTwoUsers();

    auditService.log({
      userId: alice.id,
      action: 'EMAIL_SENT',
      entityType: 'email',
      status: 'failure',
      details: { error: 'gmail rejected' },
    });

    await waitFor(async () => (await prisma.auditLog.count({ where: { userId: alice.id } })) === 1);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { userId: alice.id } });
    expect(row.status).toBe('failure');
  });
});

describe('auditService.logSync — atomic with its caller', () => {
  /**
   * The whole reason `logSync` accepts a client. Drop the parameter (or ignore
   * it and always use the shared client) and destructive operations can leave
   * data deleted with no surviving record of what it was.
   */
  it('rolls back with the transaction it was handed', async () => {
    const { alice } = await createTwoUsers();

    await expect(
      prisma.$transaction(async (tx) => {
        await auditService.logSync(
          { userId: alice.id, action: 'CONTACT_MERGED', entityType: 'contact', details: { merged: 2 } },
          tx
        );
        // Proof the row was visible inside the transaction before it aborted.
        expect(await tx.auditLog.count({ where: { userId: alice.id } })).toBe(1);
        throw new Error('operation failed after the audit row');
      })
    ).rejects.toThrow('operation failed after the audit row');

    expect(await prisma.auditLog.count({ where: { userId: alice.id } })).toBe(0);
  });

  /**
   * The counterpart: the default client is deliberately *outside* any ambient
   * transaction. This is what makes the previous test meaningful rather than
   * accidentally passing.
   */
  it('survives a rolled-back transaction when the default client is used', async () => {
    const { alice } = await createTwoUsers();

    await expect(
      prisma.$transaction(async () => {
        await auditService.logSync({ userId: alice.id, action: 'TASK_DELETED', entityType: 'task' });
        throw new Error('rollback');
      })
    ).rejects.toThrow('rollback');

    expect(await prisma.auditLog.count({ where: { userId: alice.id } })).toBe(1);
  });

  /**
   * Unlike `log`, `logSync` must surface its failure — its callers await it
   * precisely because they need to know the row landed.
   */
  it('rejects when the write fails', async () => {
    await expect(
      auditService.logSync({
        userId: '00000000-0000-0000-0000-000000000000',
        action: 'USER_LOGIN',
        entityType: 'auth',
      })
    ).rejects.toThrow();
  });
});

describe('auditService.findAll', () => {
  it('returns only the caller’s own entries', async () => {
    const { alice, bob } = await createTwoUsers();
    await auditService.logSync({ userId: alice.id, action: 'TASK_CREATED', entityType: 'task' });
    await auditService.logSync({ userId: bob.id, action: 'TASK_CREATED', entityType: 'task' });

    const result = await auditService.findAll(alice.id, {});

    expect(result.data).toHaveLength(1);
    expect(result.data[0].user.id).toBe(alice.id);
    expect(result.meta.total).toBe(1);
  });

  /**
   * The search branch assigns `where.OR`. That is the exact shape that erased
   * the ownership filter in dealService and emailService — if ownership ever
   * moves into an OR here, or `userId` is dropped, every user's audit trail
   * becomes searchable by everyone.
   */
  it('keeps the ownership filter when searching — REGRESSION', async () => {
    const { alice, bob } = await createTwoUsers();
    await auditService.logSync({
      userId: alice.id,
      action: 'EMAIL_SENT',
      entityType: 'email',
      details: { subject: 'Quarterly numbers' },
    });
    await auditService.logSync({
      userId: bob.id,
      action: 'EMAIL_SENT',
      entityType: 'email',
      details: { subject: 'Quarterly numbers' },
    });

    const result = await auditService.findAll(alice.id, { search: 'Quarterly' });

    expect(result.data).toHaveLength(1);
    expect(result.data[0].user.id).toBe(alice.id);
    expect(result.meta.total).toBe(1);
  });

  it('searches the entityId as well as the details payload', async () => {
    const { alice } = await createTwoUsers();
    await auditService.logSync({
      userId: alice.id,
      action: 'EMAIL_TRASHED',
      entityType: 'email',
      entityId: 'gmail-abc123',
    });
    await auditService.logSync({ userId: alice.id, action: 'USER_LOGIN', entityType: 'auth' });

    const result = await auditService.findAll(alice.id, { search: 'abc123' });

    expect(result.data.map((l) => l.entityId)).toEqual(['gmail-abc123']);
  });

  it('filters by action, entityType and entityId', async () => {
    const { alice } = await createTwoUsers();
    await auditService.logSync({ userId: alice.id, action: 'TASK_CREATED', entityType: 'task', entityId: 't1' });
    await auditService.logSync({ userId: alice.id, action: 'TASK_DELETED', entityType: 'task', entityId: 't2' });
    await auditService.logSync({ userId: alice.id, action: 'EMAIL_SENT', entityType: 'email', entityId: 'e1' });

    expect((await auditService.findAll(alice.id, { action: 'TASK_CREATED' })).data.map((l) => l.entityId)).toEqual(['t1']);
    expect((await auditService.findAll(alice.id, { entityType: 'task' })).meta.total).toBe(2);
    expect((await auditService.findAll(alice.id, { entityId: 'e1' })).data.map((l) => l.action)).toEqual(['EMAIL_SENT']);
  });

  it('filters by a date range, inclusive at both ends', async () => {
    const { alice } = await createTwoUsers();
    await prisma.auditLog.createMany({
      data: [
        { userId: alice.id, action: 'USER_LOGIN', entityType: 'auth', entityId: 'old', createdAt: new Date('2026-01-01T12:00:00Z') },
        // Exactly on each bound — without these, swapping gte/lte for gt/lt
        // changes nothing observable and "inclusive" is a claim, not a test.
        { userId: alice.id, action: 'USER_LOGIN', entityType: 'auth', entityId: 'lower-edge', createdAt: new Date('2026-02-01T00:00:00Z') },
        { userId: alice.id, action: 'USER_LOGIN', entityType: 'auth', entityId: 'mid', createdAt: new Date('2026-02-15T12:00:00Z') },
        { userId: alice.id, action: 'USER_LOGIN', entityType: 'auth', entityId: 'upper-edge', createdAt: new Date('2026-03-01T00:00:00Z') },
        { userId: alice.id, action: 'USER_LOGIN', entityType: 'auth', entityId: 'new', createdAt: new Date('2026-03-20T12:00:00Z') },
      ],
    });

    const ids = (
      await auditService.findAll(alice.id, {
        dateFrom: '2026-02-01T00:00:00Z',
        dateTo: '2026-03-01T00:00:00Z',
      })
    ).data.map((l) => l.entityId);

    // Newest first, so the upper edge leads and the lower edge trails.
    expect(ids).toEqual(['upper-edge', 'mid', 'lower-edge']);
  });

  it('returns newest first', async () => {
    const { alice } = await createTwoUsers();
    await prisma.auditLog.createMany({
      data: [
        { userId: alice.id, action: 'USER_LOGIN', entityType: 'auth', entityId: 'first', createdAt: new Date('2026-01-01T00:00:00Z') },
        { userId: alice.id, action: 'USER_LOGIN', entityType: 'auth', entityId: 'second', createdAt: new Date('2026-01-02T00:00:00Z') },
        { userId: alice.id, action: 'USER_LOGIN', entityType: 'auth', entityId: 'third', createdAt: new Date('2026-01-03T00:00:00Z') },
      ],
    });

    expect((await auditService.findAll(alice.id, {})).data.map((l) => l.entityId)).toEqual([
      'third',
      'second',
      'first',
    ]);
  });

  it('paginates, and its meta describes the whole filtered set', async () => {
    const { alice } = await createTwoUsers();
    await prisma.auditLog.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({
        userId: alice.id,
        action: 'USER_LOGIN' as const,
        entityType: 'auth',
        entityId: `e${i}`,
        createdAt: new Date(2026, 0, i + 1),
      })),
    });

    const page2 = await auditService.findAll(alice.id, { page: 2, limit: 2 });

    expect(page2.data.map((l) => l.entityId)).toEqual(['e2', 'e1']);
    expect(page2.meta).toEqual({ total: 5, page: 2, limit: 2, totalPages: 3 });
  });

  /**
   * An unbounded `limit` from the query string would let one request pull a
   * user's entire audit history into memory.
   */
  it('clamps the page size to 100 and the page number to 1', async () => {
    const { alice } = await createTwoUsers();
    await auditService.logSync({ userId: alice.id, action: 'USER_LOGIN', entityType: 'auth' });

    // Assert the row count, not just meta.limit — meta echoes the same clamped
    // local, so it stays 100 even if `take` ignores it and returns everything.
    await prisma.auditLog.createMany({
      data: Array.from({ length: 120 }, (_, i) => ({
        userId: alice.id,
        action: 'USER_LOGIN' as const,
        entityType: 'auth',
        entityId: `bulk-${i}`,
      })),
    });

    const capped = await auditService.findAll(alice.id, { limit: 5000 });
    expect(capped.meta.limit).toBe(100);
    expect(capped.data).toHaveLength(100);
    expect((await auditService.findAll(alice.id, { limit: -10 })).meta.limit).toBe(1);
    expect((await auditService.findAll(alice.id, { page: -3 })).meta.page).toBe(1);
    // A page past the end is empty rather than an error.
    expect((await auditService.findAll(alice.id, { page: 99 })).data).toEqual([]);
  });
});

describe('auditService.findById', () => {
  it('returns the caller’s own entry', async () => {
    const { alice } = await createTwoUsers();
    await auditService.logSync({ userId: alice.id, action: 'DEAL_CREATED', entityType: 'deal', entityId: 'd1' });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { userId: alice.id } });

    const found = await auditService.findById(alice.id, row.id);

    expect(found?.action).toBe('DEAL_CREATED');
    expect(found?.user.email).toBe(alice.email);
  });

  it('returns null for another user’s entry', async () => {
    const { alice, bob } = await createTwoUsers();
    await auditService.logSync({ userId: bob.id, action: 'DEAL_CREATED', entityType: 'deal', entityId: 'd1' });
    const bobRow = await prisma.auditLog.findFirstOrThrow({ where: { userId: bob.id } });

    expect(await auditService.findById(alice.id, bobRow.id)).toBeNull();
  });
});
