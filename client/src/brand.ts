/**
 * What the product is called, in one place.
 *
 * Every user-visible name reads from here — the tab title too, which
 * `vite.config.ts` substitutes into index.html — so the next rename is one edit.
 * Internal names stay `mailviz` on purpose: the repository, the npm packages,
 * the databases, the `mv_*` SQL functions and the localStorage keys (those wait
 * for the host move, where the origin changes and they are lost anyway).
 */

/** The full name: the tab title, About, the login screen and onboarding. */
export const PRODUCT_NAME = 'Olympusx Productivity Hub';

/** Beside the glyph in the header, where the full name does not fit. */
export const PRODUCT_SHORT_NAME = 'Productivity Hub';

/** What it is, in sentence case: under the name on the login screen and in About. */
export const PRODUCT_DESCRIPTOR = 'Your workday in one place';
