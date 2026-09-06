import { describe, it, expect } from 'vitest';
import { describeView } from './TaskViewsMenu';

/**
 * The line under the "Save view" name field says what the view keeps. It
 * used to print the query keys (`search=NDA; sorted by createdAt desc`);
 * the point here is that a person reads it, so it is words.
 */
describe('describeView', () => {
  it('names each filter and the sort in words', () => {
    expect(describeView({ search: 'NDA', priority: 'URGENT', blocked: 'true' }, 'dueDate', 'asc')).toBe(
      'Keeps tasks matching “NDA”, urgent priority, blocked, sorted by due date ascending.'
    );
    expect(describeView({ status: 'IN_PROGRESS', ownership: 'shared', overdue: true }, 'createdAt', 'desc')).toBe(
      'Keeps tasks status in progress, shared with me, overdue, sorted by date added descending.'
    );
  });

  it('says so when there is no filter, and does not hide an unknown key', () => {
    expect(describeView({}, 'title', 'asc')).toBe('Keeps every task, sorted by title ascending.');
    expect(describeView({ customerId: 'c1' }, 'weight', 'desc')).toBe('Keeps tasks customerId c1, sorted by weight descending.');
  });
});
