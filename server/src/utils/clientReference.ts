/**
 * The vocabulary of the client references register, and the values derived
 * from what a reference says. See `ClientReference` in the schema.
 */

/**
 * The customer's attestation (de référence, or d'exécution), an unsigned
 * fiche projet PowerM wrote, or the signed contract itself — a framework
 * contract or an avenant, which proves the award but not the delivery.
 */
export const REFERENCE_DOCUMENT_TYPES = ['ATTESTATION_REFERENCE', 'ATTESTATION_EXECUTION', 'FICHE_PROJET', 'CONTRAT'] as const;
export type ReferenceDocumentType = (typeof REFERENCE_DOCUMENT_TYPES)[number];

export const REFERENCE_WORK_STATUSES = ['COMPLETED', 'IN_PROGRESS'] as const;
export type ReferenceWorkStatus = (typeof REFERENCE_WORK_STATUSES)[number];

/**
 * What the customer says of the work: SATISFACTION when they say they were
 * satisfied or praise it, GOOD_EXECUTION when they only attest it was done as
 * the contract required, NONE otherwise. "Pour servir et valoir ce que de
 * droit" is the closing formula of every letter, not an appreciation.
 */
export const REFERENCE_APPRECIATIONS = ['SATISFACTION', 'GOOD_EXECUTION', 'NONE'] as const;
export type ReferenceAppreciation = (typeof REFERENCE_APPRECIATIONS)[number];

export const REFERENCE_AMOUNT_TYPES = ['HT', 'TTC'] as const;
export type ReferenceAmountType = (typeof REFERENCE_AMOUNT_TYPES)[number];

/**
 * Moroccan VAT on IT supplies and services. A TTC amount is compared as
 * amount / 1.2 — an estimate, which the register labels as such: a contract
 * can mix rates, and only the letter's own HT figure is exact.
 */
export const VAT_RATE = 0.2;

export const DATE_PRECISIONS = ['YEAR', 'MONTH', 'DAY'] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

/**
 * A date as precise as the letter is: "2025", "2025-07" or "2025-07-30".
 * The API takes and returns this shape; the table keeps the first day of the
 * period with its precision.
 */
export const PARTIAL_DATE_RE = /^(\d{4})(?:-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?)?$/;

export interface PartialDate {
  date: Date;
  precision: DatePrecision;
}

export function parsePartialDate(value: string): PartialDate | null {
  const m = PARTIAL_DATE_RE.exec(value);
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = mo ? Number(mo) - 1 : 0;
  const day = d ? Number(d) : 1;
  const date = new Date(Date.UTC(year, month, day));
  // 2025-02-30 rolls over to March: not a date the letter could have said.
  if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return { date, precision: d ? 'DAY' : mo ? 'MONTH' : 'YEAR' };
}

export function formatPartialDate(date: Date | null, precision: string | null): string | null {
  if (!date) return null;
  const iso = date.toISOString().slice(0, 10);
  if (precision === 'YEAR') return iso.slice(0, 4);
  if (precision === 'MONTH') return iso.slice(0, 7);
  return iso;
}

/** The last day of the period a partial date names. */
export function endOfPeriod(date: Date, precision: string | null): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  if (precision === 'YEAR') return new Date(Date.UTC(y, 11, 31));
  if (precision === 'MONTH') return new Date(Date.UTC(y, m + 1, 0));
  return new Date(Date.UTC(y, m, date.getUTCDate()));
}

/**
 * The date "in the last N years" is measured on: the end of the project as
 * the letter gives it; without an end, the end of its start period — or the
 * signature, when the letter attests work still running then, since it had
 * not ended by that day; and failing both, the signature date.
 *
 * At the end of the period because a letter that says "2023" may mean
 * December. The filter compares years (see `clientReferenceService`), so the
 * day only matters for sorting.
 */
export function effectiveDateOf(r: {
  workStatus: string | null;
  projectStart: Date | null;
  projectStartPrecision: string | null;
  projectEnd: Date | null;
  projectEndPrecision: string | null;
  signedAt: Date | null;
}): Date | null {
  if (r.projectEnd) return endOfPeriod(r.projectEnd, r.projectEndPrecision);
  const startPeriod = r.projectStart ? endOfPeriod(r.projectStart, r.projectStartPrecision) : null;
  if (r.workStatus === 'IN_PROGRESS' && r.signedAt && (!startPeriod || r.signedAt > startPeriod)) return r.signedAt;
  return startPeriod ?? r.signedAt;
}

/**
 * The amount filters and sorts compare on. TTC over 1.2, HT as is — and an
 * amount whose letter says neither is compared as written rather than left
 * out of every amount search.
 */
export function amountHtOf(amount: number | null, amountType: string | null): number | null {
  if (amount === null) return null;
  if (amountType === 'TTC') return Math.round((amount / (1 + VAT_RATE)) * 100) / 100;
  return amount;
}
