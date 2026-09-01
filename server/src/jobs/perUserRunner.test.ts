import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { createUser, createGoogleAuth } from '../test/factories.js';
import { createPerUserRunner } from './perUserRunner.js';

/**
 * The in-flight guard is per account.
 *
 * It used to be one module-level flag shared by every account, so a first sync —
 * which with EMAIL_SYNC_MONTHS=0 means the entire mailbox — blocked everybody
 * else's mail for hours, label changes included, because each following tick saw
 * the flag set and returned.
 */

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('createPerUserRunner', () => {
  it('lets one account sync while another is still running — REGRESSION', async () => {
    const slow = await createUser();
    const quick = await createUser();
    await createGoogleAuth(slow.id);
    await createGoogleAuth(quick.id);

    const block = deferred();
    const started: string[] = [];
    const finished: string[] = [];

    const runner = createPerUserRunner({
      label: 'Test',
      concurrency: 3,
      run: async (userId) => {
        started.push(userId);
        if (userId === slow.id) await block.promise;
        finished.push(userId);
      },
    });

    const all = runner.runAll();
    // Let the workers pick up their first items.
    await new Promise((r) => setTimeout(r, 20));

    // With a global flag the quick account never even started until the slow one
    // was done. It should be finished by now.
    expect(started).toContain(quick.id);
    expect(finished).toContain(quick.id);
    expect(finished).not.toContain(slow.id);

    block.resolve();
    await all;
    expect(finished).toContain(slow.id);
  });

  it('will not start a second sync for an account already syncing', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);

    const block = deferred();
    let starts = 0;
    const runner = createPerUserRunner({
      label: 'Test',
      concurrency: 3,
      run: async () => {
        starts++;
        await block.promise;
      },
    });

    const first = runner.runAll();
    await new Promise((r) => setTimeout(r, 10));
    // A tick arriving while the previous sync is still going must not double up:
    // two syncs for one account race on the same history cursor.
    await runner.runAll();
    expect(starts).toBe(1);

    block.resolve();
    await first;
  });

  /**
   * `runExclusive` is what the manual "Sync now" button goes through.
   *
   * Before it existed the route called `emailService.syncFromGmail` directly,
   * so a manual sync was invisible to the guard in BOTH directions: it could
   * start while a scheduled sync was running, and a scheduled tick could start
   * on top of it. Both halves are asserted below, because covering only one
   * leaves the race live in the other direction.
   */
  it('refuses a manual run while a scheduled sync holds the account', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);

    const block = deferred();
    const runner = createPerUserRunner({
      label: 'Test',
      concurrency: 3,
      run: async () => { await block.promise; },
    });

    const scheduled = runner.runAll();
    await new Promise((r) => setTimeout(r, 10));

    let manualRan = false;
    const outcome = await runner.runExclusive(user.id, async () => {
      manualRan = true;
      return 'result';
    });

    expect(outcome.ran).toBe(false);
    expect(manualRan).toBe(false);

    block.resolve();
    await scheduled;
  });

  it('refuses a scheduled sync while a manual run holds the account', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);

    const block = deferred();
    let scheduledStarts = 0;
    const runner = createPerUserRunner({
      label: 'Test',
      concurrency: 3,
      run: async () => { scheduledStarts++; },
    });

    const manual = runner.runExclusive(user.id, async () => {
      await block.promise;
      return 'result';
    });
    await new Promise((r) => setTimeout(r, 10));

    await runner.runAll();
    expect(scheduledStarts).toBe(0);

    block.resolve();
    await manual;
  });

  it('hands back the job result and releases the account afterwards', async () => {
    const user = await createUser();
    await createGoogleAuth(user.id);
    const runner = createPerUserRunner({ label: 'Test', concurrency: 3, run: async () => {} });

    const outcome = await runner.runExclusive(user.id, async () => ({ synced: 7 }));

    expect(outcome).toEqual({ ran: true, result: { synced: 7 } });
    // Releasing matters as much as holding: a guard that leaks would wedge the
    // account permanently and every later sync would be skipped in silence.
    expect(runner.isInFlight(user.id)).toBe(false);
  });

  it('releases the account when the job throws, and lets the error out', async () => {
    // `runOne` swallows failures because a scheduler tick has nowhere to report
    // them. A request handler does, so this must reject rather than resolve —
    // otherwise "Sync now" answers 200 on a sync that failed.
    const user = await createUser();
    await createGoogleAuth(user.id);
    const runner = createPerUserRunner({ label: 'Test', concurrency: 3, run: async () => {} });

    await expect(
      runner.runExclusive(user.id, async () => { throw new Error('gmail exploded'); })
    ).rejects.toThrow('gmail exploded');

    expect(runner.isInFlight(user.id)).toBe(false);
  });

  it('bounds how many accounts run at once', async () => {
    for (let i = 0; i < 5; i++) {
      const user = await createUser();
      await createGoogleAuth(user.id);
    }

    const block = deferred();
    let active = 0;
    let peak = 0;
    const runner = createPerUserRunner({
      label: 'Test',
      concurrency: 2,
      run: async () => {
        active++;
        peak = Math.max(peak, active);
        await block.promise;
        active--;
      },
    });

    const all = runner.runAll();
    await new Promise((r) => setTimeout(r, 20));
    expect(peak).toBe(2);

    block.resolve();
    await all;
  });

  it('keeps going when one account throws', async () => {
    const bad = await createUser();
    const good = await createUser();
    await createGoogleAuth(bad.id);
    await createGoogleAuth(good.id);

    const completed: string[] = [];
    const runner = createPerUserRunner({
      label: 'Test',
      concurrency: 1,
      run: async (userId) => {
        if (userId === bad.id) throw new Error('boom');
        completed.push(userId);
      },
    });

    await runner.runAll();

    expect(completed).toEqual([good.id]);
    // And the failure must not leave the account permanently marked in flight.
    expect(runner.isInFlight(bad.id)).toBe(false);
    expect(runner.inFlightCount()).toBe(0);
  });

  it('reports in-flight state per account', async () => {
    const a = await createUser();
    const b = await createUser();
    await createGoogleAuth(a.id);

    const block = deferred();
    const runner = createPerUserRunner({
      label: 'Test',
      concurrency: 2,
      run: async () => {
        await block.promise;
      },
    });

    const all = runner.runAll();
    await new Promise((r) => setTimeout(r, 10));

    expect(runner.isInFlight(a.id)).toBe(true);
    // b has no Google connection, so it is not synced at all.
    expect(runner.isInFlight(b.id)).toBe(false);

    block.resolve();
    await all;
    expect(runner.isInFlight(a.id)).toBe(false);
  });

  it('only syncs accounts that have connected Google', async () => {
    const connected = await createUser();
    await createUser(); // no GoogleAuth
    await createGoogleAuth(connected.id);

    const seen: string[] = [];
    const runner = createPerUserRunner({
      label: 'Test',
      concurrency: 2,
      run: async (userId) => {
        seen.push(userId);
      },
    });
    await runner.runAll();

    expect(seen).toEqual([connected.id]);
    expect(await prisma.googleAuth.count()).toBe(1);
  });
});
