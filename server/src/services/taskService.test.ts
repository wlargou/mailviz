import { describe, it, expect } from 'vitest';
import { taskService } from './taskService.js';
import { prisma } from '../lib/prisma.js';
import { createTwoUsers, createUser, createTask, shareTaskWith } from '../test/factories.js';

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
  it('accepts every whitelisted field in both directions', async () => {
    const { alice } = await createTwoUsers();
    await createTask(alice.id, { title: 'Alpha' });
    await createTask(alice.id, { title: 'Beta' });

    for (const sortBy of TASK_SORT_FIELDS) {
      for (const sortOrder of ['asc', 'desc']) {
        const result = await taskService.findAll(alice.id, { sortBy, sortOrder });
        expect(result.data, `sortBy=${sortBy} sortOrder=${sortOrder}`).toHaveLength(2);
      }
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
