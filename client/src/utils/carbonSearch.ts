import type { TableToolbarSearchProps } from '@carbon/react';

/**
 * The event Carbon hands to `TableToolbarSearch`'s `onChange`.
 *
 * Carbon's signature is `(event, value?) => void`, where `event` is either a
 * real `ChangeEvent<HTMLInputElement>` or the legacy `''` sentinel the
 * component emits once on mount when a `defaultValue` is present.
 */
export type TableToolbarSearchChangeEvent = Parameters<
  NonNullable<TableToolbarSearchProps['onChange']>
>[0];

/** Reads the current search text out of a `TableToolbarSearch` change event. */
export function toolbarSearchValue(event: TableToolbarSearchChangeEvent): string {
  return typeof event === 'string' ? event : event.target.value;
}
