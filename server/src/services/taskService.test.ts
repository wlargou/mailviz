import { describe, it, expect } from 'vitest';
import { taskService } from './taskService.js';
import { prisma } from '../lib/prisma.js';
import {
  createTwoUsers,
  createUser,
  createTask,
  createCustomer,
  shareTaskWith,
} from '../test/factories.js';

/**
 * Multi-tenant isolation for tasks.
 *
 * `findAll` has the same shape that produced the cross-tenant leak in
 * `dealService.findAll`: an ownership constraint expressed as an `OR` array,
 * followed by a series of `if (query.x)` branches that mutate the same
 * where-object. In dealService the search branch assigned `where.OR` and
 * silently replaced the ownership clause, so any user with a shared row who
 * searched saw every user's rows.
 *
 * Tasks are a wider target than deals because the ownership `OR` has three
 * arms (owned / shared / assigned-to-me) and there are six independent filter
 * branches. The tests below therefore hit search *combined with* each of the
 * other filters rather than search alone — the leak only appears when two
 * conditions coincide, which is precisely why it survived review the first
 * time. These run against a real Postgres; a mocked Prisma would happily
 * accept a where-clause that returns the whole table.
 */
describe('taskService.findAll — tenant isolation', () => {
  it('returns only tasks the caller owns', async () => {
    const { alice, bob } = await createTwoUsers();
    await createTask(alice.id, { title: 'Alice task' });
    await createTask(bob.id, { title: 'Bob task' });

    const result = await taskService.findAll(alice.id, {});

    expect(result.data).toHaveLength(1);
    expect(result.data[0].title).toBe('Alice task');
    expect(result.meta.total).toBe(1);
  });

  it('includes tasks explicitly shared with the caller', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobTask = await createTask(bob.id, { title: 'Shared with Alice' });
    await createTask(bob.id, { title: 'Bob keeps this' });
    await shareTaskWith(bobTask.id, bob.id, alice.id);

    const titles = (await taskService.findAll(alice.id, {})).data.map((t) => t.title);

    expect(titles).toContain('Shared with Alice');
    expect(titles).not.toContain('Bob keeps this');
  });

  it('includes tasks assigned to the caller even without a share row', async () => {
    const { alice, bob } = await createTwoUsers();
    await createTask(bob.id, { title: 'Assigned to Alice', assignedToId: alice.id });
    await createTask(bob.id, { title: 'Assigned to nobody' });

    const titles = (await taskService.findAll(alice.id, {})).data.map((t) => t.title);

    expect(titles).toEqual(['Assigned to Alice']);
  });

  it('does not leak other users’ tasks when searching', async () => {
    const { alice, bob } = await createTwoUsers();

    // The trigger from the deal bug: the caller must have a shared row, which
    // is what makes the ownership constraint an OR in the first place.
    const shared = await createTask(bob.id, { title: 'Shared widget task' });
    await shareTaskWith(shared.id, bob.id, alice.id);

    await createTask(alice.id, { title: 'Alice widget task' });
    await createTask(bob.id, { title: 'Bob secret widget task' });

    const titles = (await taskService.findAll(alice.id, { search: 'widget' })).data.map((t) => t.title);

    expect(titles).toContain('Alice widget task');
    expect(titles).toContain('Shared widget task');
    expect(titles).not.toContain('Bob secret widget task');
  });

  it('keeps the ownership constraint when search is combined with status', async () => {
    const { alice, bob } = await createTwoUsers();
    const shared = await createTask(bob.id, { title: 'Shared alpha', status: 'TODO' });
    await shareTaskWith(shared.id, bob.id, alice.id);
    await createTask(alice.id, { title: 'Alice alpha', status: 'TODO' });
    await createTask(bob.id, { title: 'Bob alpha', status: 'TODO' });

    const titles = (await taskService.findAll(alice.id, { search: 'alpha', status: 'TODO' })).data.map(
      (t) => t.title
    );

    expect(titles).toContain('Alice alpha');
    expect(titles).toContain('Shared alpha');
    expect(titles).not.toContain('Bob alpha');
  });

  it('keeps the ownership constraint when search is combined with priority', async () => {
    const { alice, bob } = await createTwoUsers();
    const shared = await createTask(bob.id, { title: 'Shared beta', priority: 'HIGH' });
    await shareTaskWith(shared.id, bob.id, alice.id);
    await createTask(alice.id, { title: 'Alice beta', priority: 'HIGH' });
    await createTask(bob.id, { title: 'Bob beta', priority: 'HIGH' });

    const titles = (await taskService.findAll(alice.id, { search: 'beta', priority: 'HIGH' })).data.map(
      (t) => t.title
    );

    expect(titles.sort()).toEqual(['Alice beta', 'Shared beta']);
  });

  it('keeps the ownership constraint across every search + filter combination', async () => {
    const { alice, bob } = await createTwoUsers();
    const shared = await createTask(bob.id, { title: 'Shared gamma', status: 'TODO', priority: 'HIGH' });
    await shareTaskWith(shared.id, bob.id, alice.id);
    await createTask(alice.id, { title: 'Alice gamma', status: 'TODO', priority: 'HIGH' });
    await createTask(bob.id, { title: 'Bob gamma', status: 'TODO', priority: 'HIGH' });

    type TaskQuery = Parameters<typeof taskService.findAll>[1];
    const combinations: TaskQuery[] = [
      { search: 'gamma' },
      { search: 'gamma', status: 'TODO' },
      { search: 'gamma', priority: 'HIGH' },
      { search: 'gamma', statusNot: 'DONE' },
      { search: 'gamma', status: 'TODO', priority: 'HIGH' },
      { search: 'gamma', status: 'TODO', priority: 'HIGH', statusNot: 'ARCHIVED' },
      { search: 'gamma', dueAfter: '2000-01-01T00:00:00.000Z' },
      { search: 'gamma', sortBy: 'title', sortOrder: 'asc' },
    ];

    for (const query of combinations) {
      const titles = (await taskService.findAll(alice.id, query)).data.map((t) => t.title);
      expect(titles, `leaked with query ${JSON.stringify(query)}`).not.toContain('Bob gamma');
    }
  });

  it('counts only visible rows in pagination meta when searching', async () => {
    const { alice, bob } = await createTwoUsers();
    const shared = await createTask(bob.id, { title: 'Shared delta' });
    await shareTaskWith(shared.id, bob.id, alice.id);
    await createTask(alice.id, { title: 'Alice delta' });
    await createTask(bob.id, { title: 'Bob delta one' });
    await createTask(bob.id, { title: 'Bob delta two' });

    // The count query uses the same where-clause as the data query, so a
    // clobbered ownership filter would show up here too.
    const result = await taskService.findAll(alice.id, { search: 'delta' });

    expect(result.meta.total).toBe(2);
  });

  it('ownership=shared returns only tasks the caller does not own', async () => {
    const { alice, bob } = await createTwoUsers();
    const shared = await createTask(bob.id, { title: 'From Bob' });
    await shareTaskWith(shared.id, bob.id, alice.id);
    await createTask(alice.id, { title: 'Alice own' });
    await createTask(bob.id, { title: 'Bob private' });

    const titles = (await taskService.findAll(alice.id, { ownership: 'shared' })).data.map((t) => t.title);

    expect(titles).toEqual(['From Bob']);
  });

  it('ownership=owned excludes shared and assigned tasks', async () => {
    const { alice, bob } = await createTwoUsers();
    const shared = await createTask(bob.id, { title: 'From Bob' });
    await shareTaskWith(shared.id, bob.id, alice.id);
    await createTask(bob.id, { title: 'Assigned to Alice', assignedToId: alice.id });
    await createTask(alice.id, { title: 'Alice own' });

    const titles = (await taskService.findAll(alice.id, { ownership: 'owned' })).data.map((t) => t.title);

    expect(titles).toEqual(['Alice own']);
  });

  it('ownership=shared cannot be used to widen visibility', async () => {
    // `ownership=shared` sets `userId != caller`, which on its own would match
    // every other user's tasks. It must only ever narrow the access filter.
    const { alice, bob } = await createTwoUsers();
    await createTask(bob.id, { title: 'Bob private one' });
    await createTask(bob.id, { title: 'Bob private two' });

    const result = await taskService.findAll(alice.id, { ownership: 'shared' });

    expect(result.data).toHaveLength(0);
    expect(result.meta.total).toBe(0);
  });

  it('does not leak a third user’s tasks to either party of a share', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser({ name: 'Carol' });
    const shared = await createTask(bob.id, { title: 'Bob shares with Alice' });
    await shareTaskWith(shared.id, bob.id, alice.id);
    await createTask(carol.id, { title: 'Carol shares nothing' });

    const titles = (await taskService.findAll(alice.id, { search: 'shares' })).data.map((t) => t.title);

    expect(titles).toEqual(['Bob shares with Alice']);
  });
});

/**
 * Sort-field whitelisting for tasks.
 *
 * `sortBy` and `sortOrder` arrive on the query string and used to be spliced
 * into Prisma's `orderBy` unchecked. Prisma rejects an unknown key, so
 * `?sortBy=whatever` was an unhandled 500 that any caller could trigger. Both
 * are now matched against a whitelist and fall back to the default.
 *
 * The whitelist is duplicated here on purpose rather than exported from the
 * service: the point is to pin down the sorts the API promises to support, so
 * a field silently disappearing from the service list should fail this file.
 * `position` in particular is not something the list view sends — the Kanban
 * board depends on it — and dropping it would break the board rather than
 * return a 500, which is the harder failure to notice.
 */
const TASK_SORT_FIELDS = ['title', 'status', 'priority', 'dueDate', 'position', 'createdAt', 'updatedAt'];

/** Pins createdAt so assertions about the default sort are deterministic. */
async function pinCreatedAt(id: string, iso: string) {
  await prisma.task.update({ where: { id }, data: { createdAt: new Date(iso) } });
}

describe('taskService.findAll — sort whitelisting', () => {
  it('actually sorts by every whitelisted field', async () => {
    const { alice } = await createTwoUsers();
    // `first` precedes `second` on every sortable column EXCEPT createdAt,
    // where the order is deliberately inverted. That inversion is what gives
    // the test teeth: an unwhitelisted field falls back to createdAt while
    // keeping the requested direction, so a field quietly dropped from the
    // service list flips the expected pair instead of silently returning the
    // same two rows.
    const first = await createTask(alice.id, {
      title: 'Alpha',
      status: 'ATODO',
      priority: 'LOW',
      dueDate: new Date('2026-01-01T00:00:00Z'),
    });
    const second = await createTask(alice.id, {
      title: 'Beta',
      status: 'BDOING',
      priority: 'URGENT',
      dueDate: new Date('2026-06-01T00:00:00Z'),
    });
    await prisma.task.update({
      where: { id: first.id },
      data: { position: 100, createdAt: new Date('2026-05-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') },
    });
    await prisma.task.update({
      where: { id: second.id },
      data: { position: 200, createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-05-01T00:00:00Z') },
    });

    for (const sortBy of TASK_SORT_FIELDS) {
      // createdAt is the inverted one, so ascending puts `second` in front.
      const expected = sortBy === 'createdAt' ? [second.id, first.id] : [first.id, second.id];

      const asc = await taskService.findAll(alice.id, { sortBy, sortOrder: 'asc' });
      expect(asc.data.map((t) => t.id), `sortBy=${sortBy} asc`).toEqual(expected);

      const desc = await taskService.findAll(alice.id, { sortBy, sortOrder: 'desc' });
      expect(desc.data.map((t) => t.id), `sortBy=${sortBy} desc`).toEqual([...expected].reverse());
    }
  });

  it('orders by a whitelisted field in the requested direction', async () => {
    const { alice } = await createTwoUsers();
    await createTask(alice.id, { title: 'Beta' });
    await createTask(alice.id, { title: 'Alpha' });
    await createTask(alice.id, { title: 'Gamma' });

    const asc = await taskService.findAll(alice.id, { sortBy: 'title', sortOrder: 'asc' });
    const desc = await taskService.findAll(alice.id, { sortBy: 'title', sortOrder: 'desc' });

    expect(asc.data.map((t) => t.title)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(desc.data.map((t) => t.title)).toEqual(['Gamma', 'Beta', 'Alpha']);
  });

  it('sorts by createdAt descending when no sort is requested', async () => {
    const { alice } = await createTwoUsers();
    const older = await createTask(alice.id, { title: 'Older' });
    const newer = await createTask(alice.id, { title: 'Newer' });
    await pinCreatedAt(older.id, '2024-01-01T00:00:00.000Z');
    await pinCreatedAt(newer.id, '2024-06-01T00:00:00.000Z');

    const titles = (await taskService.findAll(alice.id, {})).data.map((t) => t.title);

    expect(titles).toEqual(['Newer', 'Older']);
  });

  it('falls back to the default sort for a sortBy that is not whitelisted', async () => {
    // The regression: an unknown key reached Prisma and threw, so anyone could
    // turn the endpoint into a 500 by appending ?sortBy=whatever.
    const { alice } = await createTwoUsers();
    const older = await createTask(alice.id, { title: 'Older' });
    const newer = await createTask(alice.id, { title: 'Newer' });
    await pinCreatedAt(older.id, '2024-01-01T00:00:00.000Z');
    await pinCreatedAt(newer.id, '2024-06-01T00:00:00.000Z');

    // Nonsense, a real-but-not-sortable column, and an injection-shaped key.
    const unknownSorts = ['whatever', 'userId', 'password', '(SELECT 1)', 'title; DROP TABLE tasks'];

    for (const sortBy of unknownSorts) {
      const result = await taskService.findAll(alice.id, { sortBy });
      expect(result.data.map((t) => t.title), `sortBy=${sortBy}`).toEqual(['Newer', 'Older']);
    }
  });

  it('falls back to the default direction for a sortOrder that is not asc or desc', async () => {
    const { alice } = await createTwoUsers();
    await createTask(alice.id, { title: 'Alpha' });
    await createTask(alice.id, { title: 'Beta' });

    for (const sortOrder of ['sideways', 'ASC', '', 'asc; DROP TABLE tasks']) {
      const result = await taskService.findAll(alice.id, { sortBy: 'title', sortOrder });
      expect(result.data.map((t) => t.title), `sortOrder=${sortOrder}`).toEqual(['Beta', 'Alpha']);
    }
  });

  it('keeps the ownership constraint when the sort falls back', async () => {
    // Falling back must not become a way around the where-clause: the row set
    // has to stay exactly what an unsorted call would return.
    const { alice, bob } = await createTwoUsers();
    const shared = await createTask(bob.id, { title: 'Shared with Alice' });
    await shareTaskWith(shared.id, bob.id, alice.id);
    await createTask(alice.id, { title: 'Alice own' });
    await createTask(bob.id, { title: 'Bob private' });

    type TaskQuery = Parameters<typeof taskService.findAll>[1];
    const queries: TaskQuery[] = [
      { sortBy: 'userId' },
      { sortBy: 'whatever', sortOrder: 'sideways' },
      { sortBy: 'title; DROP TABLE tasks', sortOrder: 'asc', search: 'Bob' },
    ];

    for (const query of queries) {
      const result = await taskService.findAll(alice.id, query);
      const titles = result.data.map((t) => t.title);
      expect(titles, `leaked with ${JSON.stringify(query)}`).not.toContain('Bob private');
      expect(result.meta.total, `over-counted with ${JSON.stringify(query)}`).toBe(titles.length);
    }
  });
});

describe('taskService.findById — tenant isolation', () => {
  it('refuses to return another user’s task', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobTask = await createTask(bob.id, { title: 'Bob only' });

    await expect(taskService.findById(alice.id, bobTask.id)).rejects.toThrow(/not found/i);
  });

  it('returns a task shared with the caller', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobTask = await createTask(bob.id, { title: 'Shared' });
    await shareTaskWith(bobTask.id, bob.id, alice.id);

    const task = await taskService.findById(alice.id, bobTask.id);

    expect(task.title).toBe('Shared');
  });
});

describe('taskService.getSummary — tenant isolation', () => {
  it('counts only tasks the caller can see', async () => {
    const { alice, bob } = await createTwoUsers();
    await createTask(alice.id, { title: 'Alice one' });
    await createTask(bob.id, { title: 'Bob one' });
    await createTask(bob.id, { title: 'Bob two' });
    const shared = await createTask(bob.id, { title: 'Bob shares' });
    await shareTaskWith(shared.id, bob.id, alice.id);

    const summary = await taskService.getSummary(alice.id);

    expect(summary.total).toBe(2);
  });
});

/**
 * Paging, filtering, and the write paths.
 *
 * The pieces pinned here are the ones with no type-level safety net:
 *
 *  - `position` is maintained by the service, not the database. `create` reads
 *    `max(position)` for `{ userId, status }` and adds 1000, so the query has
 *    to carry *both* keys. Lose the userId and a new account's first card is
 *    numbered behind a stranger's; lose the status and every column shares one
 *    sequence and the Kanban board orders wrongly.
 *  - `update` gates on `canAccessTask` (owner, assignee, or share) while
 *    `delete` gates on `isTaskOwner`. Being assigned a task must never become
 *    permission to destroy it.
 *  - `reorder` writes the whole drag in one `$transaction`. A batch naming
 *    another user's task has to fail as a unit — a partial apply leaves the
 *    caller's own board rearranged in a way they never asked for.
 */

/** A label owned by `userId`. Local to this file — factories.ts is shared. */
async function createLabel(userId: string, name: string, color = '#0f62fe') {
  return prisma.label.create({ data: { userId, name, color } });
}

const MISSING_ID = '00000000-0000-0000-0000-000000000000';

describe('taskService.findAll — pagination', () => {
  it('pages through the result set without dropping or repeating a row', async () => {
    const { alice } = await createTwoUsers();
    for (const title of ['A task', 'B task', 'C task', 'D task', 'E task']) {
      await createTask(alice.id, { title });
    }

    const pages = await Promise.all(
      ['1', '2', '3'].map((page) =>
        taskService.findAll(alice.id, { page, limit: '2', sortBy: 'title', sortOrder: 'asc' })
      )
    );

    expect(pages.map((p) => p.data.map((t: { title: string }) => t.title))).toEqual([
      ['A task', 'B task'],
      ['C task', 'D task'],
      ['E task'],
    ]);
    expect(pages[0]!.meta).toEqual({ page: 1, limit: 2, total: 5, totalPages: 3 });
  });

  it('counts every visible row, not just the ones on the page', async () => {
    const { alice, bob } = await createTwoUsers();
    for (const title of ['One', 'Two', 'Three']) await createTask(alice.id, { title });
    await createTask(bob.id, { title: 'Bob task' });

    const result = await taskService.findAll(alice.id, { limit: '1' });

    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(3);
    expect(result.meta.totalPages).toBe(3);
  });
});

describe('taskService.findAll — filters', () => {
  it('filters by label', async () => {
    const { alice } = await createTwoUsers();
    const label = await createLabel(alice.id, 'Urgent');
    const tagged = await createTask(alice.id, { title: 'Tagged' });
    await createTask(alice.id, { title: 'Untagged' });
    await prisma.taskLabel.create({ data: { taskId: tagged.id, labelId: label.id } });

    const titles = (await taskService.findAll(alice.id, { labelId: label.id })).data.map(
      (t: { title: string }) => t.title
    );

    expect(titles).toEqual(['Tagged']);
  });

  it('cannot reach another user’s tasks by filtering on their label id', async () => {
    // labelId is an unvalidated id off the query string; only the ownership
    // filter under AND keeps it from becoming a read of Bob's board.
    const { alice, bob } = await createTwoUsers();
    const bobLabel = await createLabel(bob.id, 'Bob label');
    const bobTask = await createTask(bob.id, { title: 'Bob private' });
    await prisma.taskLabel.create({ data: { taskId: bobTask.id, labelId: bobLabel.id } });

    const result = await taskService.findAll(alice.id, { labelId: bobLabel.id });

    expect(result.data).toHaveLength(0);
    expect(result.meta.total).toBe(0);
  });

  it('filters by company', async () => {
    const { alice } = await createTwoUsers();
    const customer = await createCustomer(alice.id, { name: 'Northwind' });
    const linked = await createTask(alice.id, { title: 'Linked' });
    await createTask(alice.id, { title: 'Unlinked' });
    await prisma.task.update({ where: { id: linked.id }, data: { customerId: customer.id } });

    const titles = (await taskService.findAll(alice.id, { customerId: customer.id })).data.map(
      (t: { title: string }) => t.title
    );

    expect(titles).toEqual(['Linked']);
  });

  it('cannot reach another user’s tasks by filtering on their company id', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobCustomer = await createCustomer(bob.id, { name: 'Bob Co' });
    const bobTask = await createTask(bob.id, { title: 'Bob private' });
    await prisma.task.update({ where: { id: bobTask.id }, data: { customerId: bobCustomer.id } });

    const result = await taskService.findAll(alice.id, { customerId: bobCustomer.id });

    expect(result.data).toHaveLength(0);
  });

  it('excludes a status with statusNot', async () => {
    const { alice } = await createTwoUsers();
    await createTask(alice.id, { title: 'Open', status: 'TODO' });
    await createTask(alice.id, { title: 'Finished', status: 'DONE' });

    const titles = (await taskService.findAll(alice.id, { statusNot: 'DONE' })).data.map(
      (t: { title: string }) => t.title
    );

    expect(titles).toEqual(['Open']);
  });

  it('filters on a due-date window, inclusive at both ends', async () => {
    // The list view's "overdue" and "this week" tabs are this filter. An
    // exclusive bound silently hides whatever is due exactly on the boundary.
    const { alice } = await createTwoUsers();
    const early = await createTask(alice.id, { title: 'Early' });
    const middle = await createTask(alice.id, { title: 'Middle' });
    const late = await createTask(alice.id, { title: 'Late' });
    await prisma.task.update({ where: { id: early.id }, data: { dueDate: new Date('2026-01-01T00:00:00.000Z') } });
    await prisma.task.update({ where: { id: middle.id }, data: { dueDate: new Date('2026-02-01T00:00:00.000Z') } });
    await prisma.task.update({ where: { id: late.id }, data: { dueDate: new Date('2026-03-01T00:00:00.000Z') } });

    const window = await taskService.findAll(alice.id, {
      dueAfter: '2026-01-01T00:00:00.000Z',
      dueBefore: '2026-02-01T00:00:00.000Z',
      sortBy: 'dueDate',
      sortOrder: 'asc',
    });

    expect(window.data.map((t: { title: string }) => t.title)).toEqual(['Early', 'Middle']);
  });
});

describe('taskService.findById', () => {
  it('flattens the label join rows into a plain list', async () => {
    // The client reads `task.labels[].name`. Returning raw TaskLabel join rows
    // instead renders a row of blank chips rather than throwing.
    const { alice } = await createTwoUsers();
    const label = await createLabel(alice.id, 'Urgent');
    const task = await createTask(alice.id, { title: 'Tagged' });
    await prisma.taskLabel.create({ data: { taskId: task.id, labelId: label.id } });

    const found = await taskService.findById(alice.id, task.id);

    expect(found.labels.map((l: { name: string }) => l.name)).toEqual(['Urgent']);
  });

  it('returns a task assigned to the caller even though they do not own it', async () => {
    const { alice, bob } = await createTwoUsers();
    const task = await createTask(bob.id, { title: 'Assigned', assignedToId: alice.id });

    const found = await taskService.findById(alice.id, task.id);

    expect(found.title).toBe('Assigned');
  });

  it('throws 404 for an id that does not exist', async () => {
    const { alice } = await createTwoUsers();

    await expect(taskService.findById(alice.id, MISSING_ID)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('taskService.create', () => {
  it('stores the task against the caller with the requested fields', async () => {
    const { alice } = await createTwoUsers();

    const task = await taskService.create(alice.id, {
      title: 'Write the thing',
      status: 'TODO',
      priority: 'HIGH',
      dueDate: '2026-05-01T00:00:00.000Z',
    });

    expect(task.userId).toBe(alice.id);
    expect(task.priority).toBe('HIGH');
    expect(task.dueDate).toEqual(new Date('2026-05-01T00:00:00.000Z'));
  });

  it('appends to the end of its status column', async () => {
    const { alice } = await createTwoUsers();

    const first = await taskService.create(alice.id, { title: 'First', status: 'TODO' });
    const second = await taskService.create(alice.id, { title: 'Second', status: 'TODO' });

    expect(first.position).toBe(1000);
    expect(second.position).toBe(2000);
  });

  it('gives each status column its own position sequence', async () => {
    const { alice } = await createTwoUsers();
    await taskService.create(alice.id, { title: 'Todo one', status: 'TODO' });
    await taskService.create(alice.id, { title: 'Todo two', status: 'TODO' });

    const inOtherColumn = await taskService.create(alice.id, { title: 'Doing one', status: 'DOING' });

    expect(inOtherColumn.position).toBe(1000);
  });

  it('numbers positions per user, not globally', async () => {
    // Drop the userId from the max(position) lookup and Bob's very first card
    // is numbered behind Alice's — his board orders by her data.
    const { alice, bob } = await createTwoUsers();
    await taskService.create(alice.id, { title: 'Alice one', status: 'TODO' });
    await taskService.create(alice.id, { title: 'Alice two', status: 'TODO' });

    const bobFirst = await taskService.create(bob.id, { title: 'Bob one', status: 'TODO' });

    expect(bobFirst.position).toBe(1000);
  });

  it('attaches the requested labels', async () => {
    const { alice } = await createTwoUsers();
    const one = await createLabel(alice.id, 'One');
    const two = await createLabel(alice.id, 'Two');

    const task = await taskService.create(alice.id, {
      title: 'Tagged',
      labelIds: [one.id, two.id],
    });

    expect(task.labels.map((l: { name: string }) => l.name).sort()).toEqual(['One', 'Two']);
  });
});

describe('taskService.update', () => {
  it('updates a task the caller owns', async () => {
    const { alice } = await createTwoUsers();
    const task = await createTask(alice.id, { title: 'Before', status: 'TODO' });

    const updated = await taskService.update(alice.id, task.id, { title: 'After', status: 'DONE' });

    expect(updated.title).toBe('After');
    expect(updated.status).toBe('DONE');
  });

  it('refuses to update another user’s task and leaves it untouched', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobTask = await createTask(bob.id, { title: 'Bob only', status: 'TODO' });

    await expect(
      taskService.update(alice.id, bobTask.id, { title: 'Hijacked', status: 'DONE' })
    ).rejects.toMatchObject({ statusCode: 404 });

    const after = await prisma.task.findUniqueOrThrow({ where: { id: bobTask.id } });
    expect(after.title).toBe('Bob only');
    expect(after.status).toBe('TODO');
  });

  it('lets the assignee update the task they were given', async () => {
    const { alice, bob } = await createTwoUsers();
    const task = await createTask(bob.id, { title: 'Assigned', assignedToId: alice.id });

    const updated = await taskService.update(alice.id, task.id, { status: 'DONE' });

    expect(updated.status).toBe('DONE');
    expect(updated.userId).toBe(bob.id);
  });

  it('replaces the label set rather than adding to it', async () => {
    const { alice } = await createTwoUsers();
    const one = await createLabel(alice.id, 'One');
    const two = await createLabel(alice.id, 'Two');
    const task = await taskService.create(alice.id, { title: 'Tagged', labelIds: [one.id] });

    const updated = await taskService.update(alice.id, task.id, { labelIds: [two.id] });

    expect(updated.labels.map((l: { name: string }) => l.name)).toEqual(['Two']);
  });

  it('clears every label when given an empty list', async () => {
    const { alice } = await createTwoUsers();
    const one = await createLabel(alice.id, 'One');
    const task = await taskService.create(alice.id, { title: 'Tagged', labelIds: [one.id] });

    const updated = await taskService.update(alice.id, task.id, { labelIds: [] });

    expect(updated.labels).toEqual([]);
    // The label itself survives — clearing a task's labels is not deleting them.
    expect(await prisma.label.findUnique({ where: { id: one.id } })).not.toBeNull();
  });

  it('leaves the labels alone when labelIds is not supplied', async () => {
    // `labelIds !== undefined` is the guard. Without it, saving a title change
    // from a form that does not send labels would silently strip them.
    const { alice } = await createTwoUsers();
    const one = await createLabel(alice.id, 'One');
    const task = await taskService.create(alice.id, { title: 'Tagged', labelIds: [one.id] });

    const updated = await taskService.update(alice.id, task.id, { title: 'Renamed' });

    expect(updated.labels.map((l: { name: string }) => l.name)).toEqual(['One']);
  });

  it('throws 404 for an id that does not exist', async () => {
    const { alice } = await createTwoUsers();

    await expect(taskService.update(alice.id, MISSING_ID, { title: 'Nope' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

describe('taskService.delete', () => {
  it('deletes a task the caller owns', async () => {
    const { alice } = await createTwoUsers();
    const task = await createTask(alice.id, { title: 'Going away' });

    await taskService.delete(alice.id, task.id);

    expect(await prisma.task.findUnique({ where: { id: task.id } })).toBeNull();
  });

  it('refuses to delete another user’s task and leaves it in place', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobTask = await createTask(bob.id, { title: 'Bob only' });

    await expect(taskService.delete(alice.id, bobTask.id)).rejects.toMatchObject({ statusCode: 404 });

    expect(await prisma.task.findUnique({ where: { id: bobTask.id } })).not.toBeNull();
  });

  it('does not let the assignee delete the task', async () => {
    // Being handed a task is permission to work on it, not to erase it. If
    // `delete` ever switched to canAccessTask, assigning work to someone would
    // hand them the power to destroy the owner's record of it.
    const { alice, bob } = await createTwoUsers();
    const task = await createTask(bob.id, { title: 'Assigned to Alice', assignedToId: alice.id });

    await expect(taskService.delete(alice.id, task.id)).rejects.toMatchObject({ statusCode: 404 });

    expect(await prisma.task.findUnique({ where: { id: task.id } })).not.toBeNull();
  });

  it('does not let a user the task was shared with delete it', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobTask = await createTask(bob.id, { title: 'Shared' });
    await shareTaskWith(bobTask.id, bob.id, alice.id);

    await expect(taskService.delete(alice.id, bobTask.id)).rejects.toMatchObject({ statusCode: 404 });

    expect(await prisma.task.findUnique({ where: { id: bobTask.id } })).not.toBeNull();
  });

  it('throws 404 for an id that does not exist', async () => {
    const { alice } = await createTwoUsers();

    await expect(taskService.delete(alice.id, MISSING_ID)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('taskService.reorder', () => {
  it('moves cards between columns and renumbers them', async () => {
    const { alice } = await createTwoUsers();
    const one = await createTask(alice.id, { title: 'One', status: 'TODO' });
    const two = await createTask(alice.id, { title: 'Two', status: 'TODO' });

    await taskService.reorder(alice.id, {
      items: [
        { id: two.id, status: 'DOING', position: 1000 },
        { id: one.id, status: 'TODO', position: 2000 },
      ],
    });

    const after = await prisma.task.findMany({ where: { userId: alice.id }, orderBy: { title: 'asc' } });
    expect(after.map((t) => [t.title, t.status, t.position])).toEqual([
      ['One', 'TODO', 2000],
      ['Two', 'DOING', 1000],
    ]);
  });

  it('cannot move another user’s task', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobTask = await createTask(bob.id, { title: 'Bob card', status: 'TODO' });

    await expect(
      taskService.reorder(alice.id, { items: [{ id: bobTask.id, status: 'DONE', position: 9000 }] })
      // 404, not merely "something threw": without the up-front ownership
      // count this raises a raw Prisma P2025 from inside the transaction, which
      // satisfies a bare toThrow() while the route answers 500.
    ).rejects.toMatchObject({ statusCode: 404 });

    const after = await prisma.task.findUniqueOrThrow({ where: { id: bobTask.id } });
    expect(after.status).toBe('TODO');
    expect(after.position).toBe(0);
  });

  it('rolls the whole drag back when one card belongs to another user', async () => {
    const { alice, bob } = await createTwoUsers();
    const aliceTask = await createTask(alice.id, { title: 'Alice card', status: 'TODO' });
    const bobTask = await createTask(bob.id, { title: 'Bob card', status: 'TODO' });

    await expect(
      taskService.reorder(alice.id, {
        items: [
          { id: aliceTask.id, status: 'DOING', position: 5000 },
          { id: bobTask.id, status: 'DOING', position: 6000 },
        ],
      })
      // Same discrimination as its sibling above: without the ownership guard
      // this rejects with a statusCode-less P2025, which a bare toThrow() would
      // accept while the route answered 500.
    ).rejects.toMatchObject({ statusCode: 404 });

    const after = await prisma.task.findUniqueOrThrow({ where: { id: aliceTask.id } });
    expect(after.status).toBe('TODO');
    expect(after.position).toBe(0);
  });
});

describe('taskService.assignTask', () => {
  it('assigns a task the caller owns', async () => {
    const { alice, bob } = await createTwoUsers();
    const task = await createTask(alice.id, { title: 'Hand over' });

    const updated = await taskService.assignTask(alice.id, task.id, bob.id);

    expect(updated.assignedToId).toBe(bob.id);
  });

  it('unassigns when given null', async () => {
    const { alice, bob } = await createTwoUsers();
    const task = await createTask(alice.id, { title: 'Hand back', assignedToId: bob.id });

    const updated = await taskService.assignTask(alice.id, task.id, null);

    expect(updated.assignedToId).toBeNull();
  });

  it('refuses to assign another user’s task and leaves it untouched', async () => {
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser({ name: 'Carol' });
    const bobTask = await createTask(bob.id, { title: 'Bob only' });

    await expect(taskService.assignTask(alice.id, bobTask.id, carol.id)).rejects.toMatchObject({
      status: 404,
    });

    const after = await prisma.task.findUniqueOrThrow({ where: { id: bobTask.id } });
    expect(after.assignedToId).toBeNull();
  });

  it('refuses to let a share recipient assign the task onward — PRIVILEGE ESCALATION', async () => {
    // The escalation this closes: assignment used to gate on `canAccessTask`,
    // which a share satisfies. So Bob, given read access to Alice's task, could
    // assign it to Carol — handing a third account standing access through
    // `assignedToId` that Alice never granted, and that revoking Bob's share
    // does not take away. Every other privileged task operation (share, delete,
    // reorder) already required ownership; assignment was the outlier.
    const { alice, bob } = await createTwoUsers();
    const carol = await createUser({ name: 'Carol' });
    const aliceTask = await createTask(alice.id, { title: 'Alice owns this' });
    await shareTaskWith(aliceTask.id, alice.id, bob.id);

    // Bob can genuinely see it — the share works, which is the point.
    await expect(taskService.findById(bob.id, aliceTask.id)).resolves.toMatchObject({
      id: aliceTask.id,
    });

    await expect(taskService.assignTask(bob.id, aliceTask.id, carol.id)).rejects.toMatchObject({
      status: 404,
    });

    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: aliceTask.id } })).assignedToId
    ).toBeNull();
  });

  it('lets the owner assign, and refuses an assignee who does not exist', async () => {
    const { alice, bob } = await createTwoUsers();
    const task = await createTask(alice.id);

    await taskService.assignTask(alice.id, task.id, bob.id);
    expect(
      (await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).assignedToId
    ).toBe(bob.id);

    // Without this check the column is a sink for any uuid the caller invents.
    await expect(
      taskService.assignTask(alice.id, task.id, '9c858901-8a57-4791-81fe-4c455b099bc9')
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('taskService.getSummary', () => {
  it('splits the caller’s tasks into done, outstanding, overdue and priority', async () => {
    const { alice } = await createTwoUsers();
    const done = await createTask(alice.id, { title: 'Done', status: 'DONE', priority: 'LOW' });
    const overdue = await createTask(alice.id, { title: 'Overdue', status: 'TODO', priority: 'URGENT' });
    const later = await createTask(alice.id, { title: 'Later', status: 'TODO', priority: 'URGENT' });
    // A completed task in the past must not be counted as overdue — the
    // "overdue" tile is what drives the red badge in the header.
    await prisma.task.update({ where: { id: done.id }, data: { dueDate: new Date('2000-01-01T00:00:00.000Z') } });
    await prisma.task.update({ where: { id: overdue.id }, data: { dueDate: new Date('2000-01-01T00:00:00.000Z') } });
    await prisma.task.update({ where: { id: later.id }, data: { dueDate: new Date('2099-01-01T00:00:00.000Z') } });

    const summary = await taskService.getSummary(alice.id);

    expect(summary).toEqual({
      total: 3,
      completed: 1,
      overdue: 1,
      inProgress: 2,
      byPriority: { LOW: 1, MEDIUM: 0, HIGH: 0, URGENT: 2 },
    });
  });

  it('does not count another user’s overdue tasks', async () => {
    const { alice, bob } = await createTwoUsers();
    const bobTask = await createTask(bob.id, { title: 'Bob overdue', status: 'TODO' });
    await prisma.task.update({
      where: { id: bobTask.id },
      data: { dueDate: new Date('2000-01-01T00:00:00.000Z') },
    });
    await createTask(alice.id, { title: 'Alice task' });

    const summary = await taskService.getSummary(alice.id);

    expect(summary.overdue).toBe(0);
    expect(summary.total).toBe(1);
  });
});
