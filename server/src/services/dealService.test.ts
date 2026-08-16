import { describe, it, expect } from 'vitest';
import { dealService } from './dealService.js';
import { createTwoUsers, createDeal, shareDealWith } from '../test/factories.js';

/**
 * Multi-tenant isolation for deals.
 *
 * The search case is a regression test for a real cross-tenant leak. `findAll`
 * built its where-clause as `{ ...ownershipFilter }`, and ownershipFilter is
 * `{ OR: [...] }` whenever the user has any shared deal — so the search
 * branch's `where.OR = [...]` overwrote the ownership constraint entirely. Any
 * user with at least one shared deal who ran a search saw EVERY user's deals.
 *
 * Two conditions had to coincide, which is why it survived review. It is also
 * why these run against a real Postgres: a mocked Prisma client would have
 * accepted the broken where-clause without complaint.
 */
describe('dealService.findAll — tenant isolation', () => {
  it('returns only deals the caller owns', async () => {
    const { alice, bob } = await createTwoUsers();
    await createDeal(alice.id, { title: 'Alice deal' });
    await createDeal(bob.id, { title: 'Bob deal' });

    const result = await dealService.findAll(alice.id, {});

    expect(result.data).toHaveLength(1);
    expect(result.data[0].title).toBe('Alice deal');
  });

  it('includes deals explicitly shared with the caller', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobDeal = await createDeal(bob.id, { title: 'Shared with Alice' });
    await createDeal(bob.id, { title: 'Bob keeps this' });
    await shareDealWith(bobDeal.id, bob.id, alice.id);

    const titles = (await dealService.findAll(alice.id, {})).data.map((d) => d.title);

    expect(titles).toContain('Shared with Alice');
    expect(titles).not.toContain('Bob keeps this');
  });

  it('does not leak other users’ deals when searching — REGRESSION', async () => {
    const { alice, bob } = await createTwoUsers();

    // The trigger: Alice must have at least one shared deal, so the ownership
    // filter becomes an OR clause that the search branch can overwrite.
    const shared = await createDeal(bob.id, { title: 'Shared widget deal' });
    await shareDealWith(shared.id, bob.id, alice.id);

    await createDeal(alice.id, { title: 'Alice widget deal' });
    await createDeal(bob.id, { title: 'Bob secret widget deal' });

    const titles = (await dealService.findAll(alice.id, { search: 'widget' })).data.map((d) => d.title);

    expect(titles).toContain('Alice widget deal');
    expect(titles).toContain('Shared widget deal');
    // The bug: this used to appear.
    expect(titles).not.toContain('Bob secret widget deal');
  });

  it('keeps the ownership constraint when combining search with other filters', async () => {
    const { alice, bob } = await createTwoUsers();
    const shared = await createDeal(bob.id, { title: 'Shared alpha' });
    await shareDealWith(shared.id, bob.id, alice.id);
    await createDeal(bob.id, { title: 'Bob alpha', status: 'APPROVED' });

    const titles = (
      await dealService.findAll(alice.id, { search: 'alpha', status: 'APPROVED' })
    ).data.map((d) => d.title);

    expect(titles).not.toContain('Bob alpha');
  });

  it('ownership=shared returns only deals the caller does not own', async () => {
    const { alice, bob } = await createTwoUsers();
    const shared = await createDeal(bob.id, { title: 'From Bob' });
    await shareDealWith(shared.id, bob.id, alice.id);
    await createDeal(alice.id, { title: 'Alice own' });

    const titles = (await dealService.findAll(alice.id, { ownership: 'shared' })).data.map((d) => d.title);

    expect(titles).toEqual(['From Bob']);
  });

  it('ownership=owned excludes shared deals', async () => {
    const { alice, bob } = await createTwoUsers();
    const shared = await createDeal(bob.id, { title: 'From Bob' });
    await shareDealWith(shared.id, bob.id, alice.id);
    await createDeal(alice.id, { title: 'Alice own' });

    const titles = (await dealService.findAll(alice.id, { ownership: 'owned' })).data.map((d) => d.title);

    expect(titles).toEqual(['Alice own']);
  });
});
