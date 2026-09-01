import { describe, it, expect } from 'vitest';
import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { useTableSort } from './useTableSort';

/**
 * Sorting for the server-paginated list pages.
 *
 * The behaviour that matters is what reaches the query, because these pages fetch
 * one page at a time — sorting has to happen in the database or it is a lie about
 * the rows the user cannot see.
 */

describe('useTableSort', () => {
  it('starts on the default column and order', () => {
    const { result } = renderHook(() => useTableSort('name', 'asc'));

    expect(result.current.params).toEqual({ sortBy: 'name', sortOrder: 'asc' });
  });

  it('flips direction when the same column is clicked again', () => {
    const { result } = renderHook(() => useTableSort('name', 'asc'));

    act(() => result.current.headerProps('name').onClick!());
    expect(result.current.params).toEqual({ sortBy: 'name', sortOrder: 'desc' });

    act(() => result.current.headerProps('name').onClick!());
    expect(result.current.params).toEqual({ sortBy: 'name', sortOrder: 'asc' });
  });

  it('starts a newly chosen column ascending', () => {
    const { result } = renderHook(() => useTableSort('createdAt', 'desc'));

    act(() => result.current.headerProps('title').onClick!());

    // Inheriting the previous column's direction means clicking "Title" while
    // sorted newest-first silently gives you Z–A.
    expect(result.current.params).toEqual({ sortBy: 'title', sortOrder: 'asc' });
  });

  it('marks only the active column as the sort header', () => {
    const { result } = renderHook(() => useTableSort('name', 'asc'));

    expect(result.current.headerProps('name')).toMatchObject({
      isSortable: true,
      isSortHeader: true,
      sortDirection: 'ASC',
    });
    expect(result.current.headerProps('email')).toMatchObject({
      isSortable: true,
      isSortHeader: false,
      sortDirection: 'NONE',
    });
  });

  it('reports DESC once the active column is flipped', () => {
    const { result } = renderHook(() => useTableSort('name', 'asc'));

    act(() => result.current.headerProps('name').onClick!());

    expect(result.current.headerProps('name').sortDirection).toBe('DESC');
  });

  /**
   * The same behaviour, under StrictMode.
   *
   * Every test above renders without it, which is why they all passed while
   * clicking a header twice in `npm run dev` did nothing. StrictMode invokes
   * state updaters twice to surface impure ones — and the hook used to call
   * `setSortOrder` from inside the `setSortBy` updater, so the direction
   * flipped twice and landed back where it started. The app behaved correctly
   * in production and visibly wrongly in development, which is the worst way
   * round: nobody trusts a bug they cannot reproduce after deploying.
   */
  describe('under StrictMode', () => {
    const renderStrict = (by: string, order: 'asc' | 'desc') =>
      renderHook(() => useTableSort(by, order), { wrapper: StrictMode });

    it('still flips direction on a repeat click — REGRESSION', () => {
      const { result } = renderStrict('name', 'asc');

      act(() => result.current.headerProps('name').onClick!());

      expect(result.current.params).toEqual({ sortBy: 'name', sortOrder: 'desc' });
    });

    it('flips back on a third click rather than sticking', () => {
      const { result } = renderStrict('name', 'asc');

      act(() => result.current.headerProps('name').onClick!());
      act(() => result.current.headerProps('name').onClick!());

      expect(result.current.params).toEqual({ sortBy: 'name', sortOrder: 'asc' });
    });

    it('still starts a newly chosen column ascending', () => {
      const { result } = renderStrict('name', 'desc');

      act(() => result.current.headerProps('createdAt').onClick!());

      expect(result.current.params).toEqual({ sortBy: 'createdAt', sortOrder: 'asc' });
    });

    it('reports the direction to the header affordance too', () => {
      // aria-sort and the arrow read from here; a stuck value is what the user
      // actually sees.
      const { result } = renderStrict('name', 'asc');

      act(() => result.current.headerProps('name').onClick!());

      expect(result.current.headerProps('name').sortDirection).toBe('DESC');
    });
  });
});
