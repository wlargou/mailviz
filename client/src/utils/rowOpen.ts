import type { MouseEvent } from 'react';

/**
 * Anything inside a row that does its own thing on click. A click on one of
 * these must not also open the row — selecting a task would open it, and
 * choosing Delete from its menu would navigate away under the dialog.
 */
const OWN_CLICK =
  'button, a, input, label, select, textarea, [role="menuitem"], [role="checkbox"], .cds--overflow-menu, .cds--checkbox, .clickable-tag';

/**
 * A row that opens its record when clicked anywhere that is not a control.
 *
 * Only the record's name used to open it (a `<span>` on Companies and
 * Contacts, so not by keyboard either); the rest of the row was dead, and a
 * small eye icon did what the whole row should. The name stays a real button
 * for keyboard users — this is the mouse's larger target.
 */
export function openRowOnClick(open: () => void) {
  return (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest(OWN_CLICK)) return;
    // A drag to select text in the row is not a click on it.
    if (window.getSelection()?.toString()) return;
    open();
  };
}
