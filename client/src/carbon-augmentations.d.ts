import type { FocusEventHandler, Ref } from 'react';

/**
 * Props that Carbon components genuinely forward at runtime but do not declare
 * in their published types. Each augmentation below is narrowed to exactly the
 * prop the app relies on — nothing is widened to `any`.
 */

/**
 * `TableToolbarSearch` is a plain function component whose props interface does
 * not declare `ref`. At runtime it collects unrecognised props into `...rest`
 * and spreads them onto the inner `Search`, a `forwardRef` component that
 * attaches the ref to the underlying `<input>`. Under React 19 `ref` is an
 * ordinary prop, so `ref={inputRef}` resolves to that `<input>`.
 */
declare module '@carbon/react/lib/components/DataTable/TableToolbarSearch' {
  interface TableToolbarSearchProps {
    ref?: Ref<HTMLInputElement>;
  }
}

/**
 * `SearchBar` spreads its unrecognised props onto the `<form>` element it
 * renders, so DOM handlers such as `onFocus` work but are not part of the
 * declared prop type.
 */
declare module '@carbon/ibm-products/lib/components/SearchBar/SearchBar' {
  interface SearchBarProps {
    onFocus?: FocusEventHandler<HTMLFormElement>;
  }
}
