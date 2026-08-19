import { describe, it, expect } from 'vitest';
import { companyCategoryService } from './companyCategoryService.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createCustomer } from '../test/factories.js';

/**
 * Company categories are the user-defined buckets companies are filed under.
 * Same shape as task statuses: per-user rows, a service-maintained `position`,
 * and a delete that is blocked while anything still points at the row.
 *
 * What is worth pinning:
 *
 * `position` comes from a `max(position)` aggregate the service runs itself.
 * Scoped to the caller, a new user starts at 0; unscoped, their first category
 * inherits a number from whoever created categories before them and the list
 * orders wrongly with nothing to indicate why.
 *
 * `reorder` writes the batch in one `$transaction`, so a batch naming another
 * user's row must fail whole rather than half-applying to the caller's list.
 *
 * `delete` refuses while customers reference the category, and the count that
 * decides is `{ userId, categoryId }`. Losing `categoryId` would make owning
 * any company at all block deleting every category — a failure that reads like
 * the feature is simply broken rather than like a where-clause bug, so it is
 * asserted from both sides.
 */

/** Ids that are syntactically valid but belong to nothing. */
const MISSING_ID = '00000000-0000-0000-0000-000000000000';

describe('companyCategoryService.findAll', () => {
  it('returns only the caller’s categories', async () => {
    const { alice, bob } = await createTwoUsers();
    await companyCategoryService.create(alice.id, { name: 'PARTNER', label: 'Partner' });
    await companyCategoryService.create(bob.id, { name: 'VENDOR', label: 'Vendor' });

    const categories = await companyCategoryService.findAll(alice.id);

    expect(categories.map((c) => c.name)).toEqual(['PARTNER']);
  });

  it('orders by position ascending, not by creation time', async () => {
    const { alice } = await createTwoUsers();
    const first = await companyCategoryService.create(alice.id, { name: 'FIRST', label: 'First' });
    const second = await companyCategoryService.create(alice.id, { name: 'SECOND', label: 'Second' });
    await prisma.companyCategory.update({ where: { id: first.id }, data: { position: 10 } });
    await prisma.companyCategory.update({ where: { id: second.id }, data: { position: 5 } });

    const categories = await companyCategoryService.findAll(alice.id);

    expect(categories.map((c) => c.name)).toEqual(['SECOND', 'FIRST']);
  });
});

describe('companyCategoryService.create', () => {
  it('normalises the name and defaults the colour', async () => {
    const { alice } = await createTwoUsers();

    const category = await companyCategoryService.create(alice.id, {
      name: 'key  account',
      label: 'Key account',
    });

    expect(category.name).toBe('KEY_ACCOUNT');
    expect(category.label).toBe('Key account');
    expect(category.color).toBe('#4589ff');
    expect(category.userId).toBe(alice.id);
  });

  it('numbers positions from zero, in creation order', async () => {
    const { alice } = await createTwoUsers();

    const a = await companyCategoryService.create(alice.id, { name: 'A', label: 'A' });
    const b = await companyCategoryService.create(alice.id, { name: 'B', label: 'B' });
    const c = await companyCategoryService.create(alice.id, { name: 'C', label: 'C' });

    expect([a.position, b.position, c.position]).toEqual([0, 1, 2]);
  });

  it('numbers positions per user, not globally', async () => {
    const { alice, bob } = await createTwoUsers();
    await companyCategoryService.create(alice.id, { name: 'A', label: 'A' });
    await companyCategoryService.create(alice.id, { name: 'B', label: 'B' });

    const bobFirst = await companyCategoryService.create(bob.id, { name: 'A', label: 'A' });

    expect(bobFirst.position).toBe(0);
  });

  it('rejects a duplicate name for the same user', async () => {
    const { alice } = await createTwoUsers();
    await companyCategoryService.create(alice.id, { name: 'PARTNER', label: 'Partner' });

    await expect(
      companyCategoryService.create(alice.id, { name: 'partner', label: 'Partner again' })
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(await prisma.companyCategory.count({ where: { userId: alice.id } })).toBe(1);
  });

  it('lets two users own a category with the same name', async () => {
    const { alice, bob } = await createTwoUsers();
    await companyCategoryService.create(alice.id, { name: 'PARTNER', label: 'Partner' });

    const bobCategory = await companyCategoryService.create(bob.id, { name: 'PARTNER', label: 'Partner' });

    expect(bobCategory.userId).toBe(bob.id);
  });
});

describe('companyCategoryService.update', () => {
  it('updates the label and colour of the caller’s category', async () => {
    const { alice } = await createTwoUsers();
    const category = await companyCategoryService.create(alice.id, { name: 'PARTNER', label: 'Partner' });

    const updated = await companyCategoryService.update(alice.id, category.id, {
      label: 'Reseller',
      color: '#8a3ffc',
    });

    expect(updated.label).toBe('Reseller');
    expect(updated.color).toBe('#8a3ffc');
    // Companies are filed by id, but the machine name is still not renameable.
    expect(updated.name).toBe('PARTNER');
  });

  it('refuses to update another user’s category and leaves it untouched', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobCategory = await companyCategoryService.create(bob.id, { name: 'PARTNER', label: 'Bob partner' });

    await expect(
      companyCategoryService.update(alice.id, bobCategory.id, { label: 'Hijacked' })
    ).rejects.toThrow();

    const after = await prisma.companyCategory.findUniqueOrThrow({ where: { id: bobCategory.id } });
    expect(after.label).toBe('Bob partner');
  });

  it('rejects an id that does not exist', async () => {
    const { alice } = await createTwoUsers();

    await expect(companyCategoryService.update(alice.id, MISSING_ID, { label: 'Nope' })).rejects.toThrow();
  });
});

describe('companyCategoryService.reorder', () => {
  it('applies the new positions and the list follows them', async () => {
    const { alice } = await createTwoUsers();
    const a = await companyCategoryService.create(alice.id, { name: 'A', label: 'A' });
    const b = await companyCategoryService.create(alice.id, { name: 'B', label: 'B' });
    const c = await companyCategoryService.create(alice.id, { name: 'C', label: 'C' });

    await companyCategoryService.reorder(alice.id, [
      { id: b.id, position: 0 },
      { id: c.id, position: 1 },
      { id: a.id, position: 2 },
    ]);

    const categories = await companyCategoryService.findAll(alice.id);
    expect(categories.map((c) => c.name)).toEqual(['B', 'C', 'A']);
  });

  it('cannot move another user’s category', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobCategory = await companyCategoryService.create(bob.id, { name: 'BOB', label: 'Bob' });

    await expect(
      companyCategoryService.reorder(alice.id, [{ id: bobCategory.id, position: 99 }])
    ).rejects.toThrow();

    const after = await prisma.companyCategory.findUniqueOrThrow({ where: { id: bobCategory.id } });
    expect(after.position).toBe(0);
  });

  it('rolls the whole batch back when one item belongs to another user', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceA = await companyCategoryService.create(alice.id, { name: 'A', label: 'A' });
    const aliceB = await companyCategoryService.create(alice.id, { name: 'B', label: 'B' });
    const bobCategory = await companyCategoryService.create(bob.id, { name: 'BOB', label: 'Bob' });

    await expect(
      companyCategoryService.reorder(alice.id, [
        { id: aliceA.id, position: 7 },
        { id: bobCategory.id, position: 8 },
        { id: aliceB.id, position: 9 },
      ])
    ).rejects.toThrow();

    const alicePositions = (await companyCategoryService.findAll(alice.id)).map((c) => c.position);
    expect(alicePositions).toEqual([0, 1]);
    expect(
      (await prisma.companyCategory.findUniqueOrThrow({ where: { id: bobCategory.id } })).position
    ).toBe(0);
  });
});

describe('companyCategoryService.delete', () => {
  it('deletes an unused category the caller owns', async () => {
    const { alice } = await createTwoUsers();
    const category = await companyCategoryService.create(alice.id, { name: 'UNUSED', label: 'Unused' });

    await companyCategoryService.delete(alice.id, category.id);

    expect(await prisma.companyCategory.findUnique({ where: { id: category.id } })).toBeNull();
  });

  it('throws 404 for an id that does not exist', async () => {
    const { alice } = await createTwoUsers();

    await expect(companyCategoryService.delete(alice.id, MISSING_ID)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('refuses to delete another user’s category and leaves it in place', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobCategory = await companyCategoryService.create(bob.id, { name: 'BOB', label: 'Bob' });

    await expect(companyCategoryService.delete(alice.id, bobCategory.id)).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(await prisma.companyCategory.findUnique({ where: { id: bobCategory.id } })).not.toBeNull();
  });

  it('refuses to delete a category companies are still filed under', async () => {
    // `Customer.categoryId` is `onDelete: SetNull`, so deleting anyway would
    // silently unfile every company in the category with no way to tell which.
    const { alice } = await createTwoUsers();
    const category = await companyCategoryService.create(alice.id, { name: 'PARTNER', label: 'Partner' });
    const customer = await createCustomer(alice.id, { name: 'Acme' });
    await prisma.customer.update({ where: { id: customer.id }, data: { categoryId: category.id } });

    await expect(companyCategoryService.delete(alice.id, category.id)).rejects.toMatchObject({
      statusCode: 409,
    });

    expect(await prisma.companyCategory.findUnique({ where: { id: category.id } })).not.toBeNull();
    const after = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(after.categoryId).toBe(category.id);
  });

  it('ignores companies filed under a different category', async () => {
    // The in-use count is `{ userId, categoryId }`. Drop `categoryId` and any
    // user who owns a single company can never delete a category again.
    const { alice } = await createTwoUsers();
    const used = await companyCategoryService.create(alice.id, { name: 'PARTNER', label: 'Partner' });
    const unused = await companyCategoryService.create(alice.id, { name: 'UNUSED', label: 'Unused' });
    const customer = await createCustomer(alice.id, { name: 'Acme' });
    await prisma.customer.update({ where: { id: customer.id }, data: { categoryId: used.id } });

    await companyCategoryService.delete(alice.id, unused.id);

    expect(await prisma.companyCategory.findUnique({ where: { id: unused.id } })).toBeNull();
    expect(await prisma.companyCategory.findUnique({ where: { id: used.id } })).not.toBeNull();
  });

  it('ignores another user’s companies when deciding whether a category is in use', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceCategory = await companyCategoryService.create(alice.id, { name: 'PARTNER', label: 'Partner' });
    const bobCustomer = await createCustomer(bob.id, { name: 'Bob Co' });
    // Bob's company points at ALICE's category. Nothing in the schema forbids
    // it, and it is the only arrangement that exercises the `userId` filter:
    // with Bob filed under his own category the `categoryId` predicate already
    // excluded him, so dropping `userId` from the in-use count changed nothing.
    await prisma.customer.update({ where: { id: bobCustomer.id }, data: { categoryId: aliceCategory.id } });

    await companyCategoryService.delete(alice.id, aliceCategory.id);

    // Alice's category is unused *by Alice*, so it goes.
    expect(await prisma.companyCategory.findUnique({ where: { id: aliceCategory.id } })).toBeNull();
  });
});
