import { useCallback, useState } from 'react';
import type { DataTableSortState } from '@carbon/react';

export type SortOrder = 'asc' | 'desc';

/**
 * Column sorting for the server-paginated list pages.
 *
 * The four list pages passed `DataTable` throwaway rows and destructured only
 * `getTableProps`, using it as a styling shell — so none of them could sort. The
 * fix is *not* to let `DataTable` sort, because these pages fetch one page at a
 * time: its client-side sort would reorder the twenty visible rows and present
 * the result as if it were the whole set, which is worse than no sorting.
 *
 * So sorting is pushed to the query. All four services already accepted
 * `sortBy`/`sortOrder` against a whitelist — nothing ever sent them.
 *
 * `headerProps` returns the Carbon sort props for one column, which is what
 * supplies the arrow affordance and `aria-sort`. Pass a column that the server
 * does not accept and you would get an affordance that does nothing, so callers
 * name the sortable keys explicitly rather than defaulting everything to
 * sortable.
 */
export function useTableSort(defaultSortBy: string, defaultSortOrder: SortOrder = 'desc') {
  /**
   * One piece of state, not two.
   *
   * `toggle` needs to know whether the clicked column is the current one, and
   * the previous version got that by calling `setSortOrder` from inside the
   * `setSortBy` updater. React requires updater functions to be pure: under
   * StrictMode it invokes them twice, so the direction flipped twice and landed
   * back where it started. Clicking the same header in `npm run dev` did
   * nothing — the arrow and `aria-sort` stayed put and the query never changed —
   * while production, which does not double-invoke, behaved correctly. A bug
   * that only appears in development is one nobody trusts their eyes about.
   *
   * Holding both fields together makes the update a single pure function of the
   * previous state, so invoking it twice yields the same result as once.
   */
  const [sort, setSort] = useState<{ by: string; order: SortOrder }>({
    by: defaultSortBy,
    order: defaultSortOrder,
  });
  const { by: sortBy, order: sortOrder } = sort;

  const toggle = useCallback((key: string) => {
    setSort((current) =>
      current.by === key
        ? { by: current.by, order: current.order === 'asc' ? 'desc' : 'asc' }
        // A new column starts ascending: clicking "Name" and getting Z–A reads
        // as a bug.
        : { by: key, order: 'asc' }
    );
  }, []);

  const headerProps = useCallback(
    (key: string): {
      isSortable?: boolean;
      isSortHeader?: boolean;
      sortDirection?: DataTableSortState;
      onClick?: () => void;
    } => {
      const active = sortBy === key;
      return {
        isSortable: true,
        isSortHeader: active,
        sortDirection: active ? (sortOrder === 'asc' ? 'ASC' : 'DESC') : 'NONE',
        onClick: () => toggle(key),
      };
    },
    [sortBy, sortOrder, toggle]
  );

  return {
    sortBy,
    sortOrder,
    /** Spread into the list request's query params. */
    params: { sortBy, sortOrder },
    headerProps,
  };
}
