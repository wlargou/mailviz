/**
 * The client references register — customers' attestations of projects
 * PowerM delivered. Mirrors `server/src/utils/clientReference.ts`.
 */

export const REFERENCE_DOCUMENT_TYPES = ['ATTESTATION_REFERENCE', 'ATTESTATION_EXECUTION', 'FICHE_PROJET', 'CONTRAT'] as const;
export type ReferenceDocumentType = (typeof REFERENCE_DOCUMENT_TYPES)[number];

export const REFERENCE_DOCUMENT_TYPE_LABELS: Record<ReferenceDocumentType, string> = {
  ATTESTATION_REFERENCE: 'Attestation de référence',
  ATTESTATION_EXECUTION: "Attestation d'exécution",
  FICHE_PROJET: 'Fiche projet',
  CONTRAT: 'Contract',
};

export const REFERENCE_WORK_STATUSES = ['COMPLETED', 'IN_PROGRESS'] as const;
export type ReferenceWorkStatus = (typeof REFERENCE_WORK_STATUSES)[number];

export const REFERENCE_WORK_STATUS_LABELS: Record<ReferenceWorkStatus, string> = {
  COMPLETED: 'Completed',
  IN_PROGRESS: 'In progress',
};

export const REFERENCE_APPRECIATIONS = ['SATISFACTION', 'GOOD_EXECUTION', 'NONE'] as const;
export type ReferenceAppreciation = (typeof REFERENCE_APPRECIATIONS)[number];

export const REFERENCE_APPRECIATION_LABELS: Record<ReferenceAppreciation, string> = {
  SATISFACTION: 'Satisfaction',
  GOOD_EXECUTION: 'Good execution',
  NONE: 'None',
};

/** What each level means, under the field — the distinction is the point. */
export const REFERENCE_APPRECIATION_HELP: Record<ReferenceAppreciation, string> = {
  SATISFACTION: 'The customer says they are satisfied, or praises the work',
  GOOD_EXECUTION: 'Only attests the work was done as the contract required',
  NONE: 'Nothing beyond the facts',
};

export type ReferenceAmountType = 'HT' | 'TTC';

export interface ReferenceSignatory {
  id?: string;
  name: string | null;
  role: string | null;
}

export interface ClientReference {
  id: string;
  userId: string;
  documentType: ReferenceDocumentType;
  workStatus: ReferenceWorkStatus;
  customerName: string;
  customerId: string | null;
  customer: { id: string; name: string; logoUrl: string | null; domain: string | null } | null;
  city: string | null;
  projectName: string | null;
  projectReference: string | null;
  attestationNumber: string | null;
  amount: number | null;
  currency: string;
  amountType: ReferenceAmountType | null;
  amountScope: string | null;
  /** What amount filters compare on: TTC / 1.2, HT as is, unstated as written. */
  amountHt: number | null;
  appreciation: ReferenceAppreciation;
  appreciationQuote: string | null;
  /** "2025", "2025-07" or "2025-07-30" — as precise as the letter. */
  projectStart: string | null;
  projectEnd: string | null;
  signedAt: string | null;
  signedPlace: string | null;
  /** The date "the last N years" is measured on. */
  effectiveDate: string | null;
  technologies: string[];
  technologyTags: string[];
  prestations: string[];
  prestationTags: string[];
  partners: string[];
  consortiumPartners: string[];
  details: string | null;
  needsReview: boolean;
  reviewNotes: string | null;
  hasDocument: boolean;
  documentFilename: string | null;
  documentMimeType: string | null;
  documentSize: number | null;
  documentUploadedAt: string | null;
  importKey: string | null;
  signatories: ReferenceSignatory[];
  createdAt: string;
  updatedAt: string;
}

export type ClientReferenceInput = Partial<
  Pick<
    ClientReference,
    | 'documentType'
    | 'workStatus'
    | 'customerName'
    | 'customerId'
    | 'city'
    | 'projectName'
    | 'projectReference'
    | 'attestationNumber'
    | 'amount'
    | 'currency'
    | 'amountType'
    | 'amountScope'
    | 'appreciation'
    | 'appreciationQuote'
    | 'projectStart'
    | 'projectEnd'
    | 'signedAt'
    | 'signedPlace'
    | 'technologies'
    | 'prestations'
    | 'partners'
    | 'consortiumPartners'
    | 'details'
    | 'needsReview'
    | 'reviewNotes'
  >
> & { signatories?: Array<{ name: string | null; role: string | null }> };

export interface ReferenceFacets {
  total: number;
  needsReview: number;
  technologyTags: Array<{ tag: string; count: number }>;
  prestationTags: Array<{ tag: string; count: number }>;
  partners: Array<{ name: string; count: number }>;
  companies: Array<{ id: string; name: string; count: number }>;
}

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/**
 * "29 688 094,80 MAD" — grouped by hand, as `formatBudget` explains, with the
 * cents only when there are some: the letters print them, and a reference
 * pack copies the figure.
 */
export function formatAmount(amount: number | null, currency = 'MAD'): string {
  if (amount === null) return '—';
  const [whole, cents] = amount.toFixed(2).split('.');
  return `${group(whole)}${cents === '00' ? '' : `,${cents}`} ${currency === 'MAD' ? 'DH' : currency}`;
}

/** A short amount for a dense column: "52,0 M", "870 k". */
export function compactAmount(amount: number | null): string {
  if (amount === null) return '—';
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1).replace('.', ',')} M`;
  if (amount >= 1_000) return `${Math.round(amount / 1_000)} k`;
  return String(Math.round(amount));
}

/**
 * An amount as typed: `null` when empty, `undefined` when it is not one.
 * Like `parseBudget`, but keeping the cents — "29 688 094,80" is how the
 * letter prints it, and the register must not round the proof.
 */
export function parseAmount(raw: string): number | null | undefined {
  const s = raw.replace(/\s/g, '').replace(/(DHS?|MAD)$/i, '');
  if (s === '') return null;
  let m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(s);
  if (!m) {
    m = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(s) ?? /^(\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/.exec(s);
    if (!m) return undefined;
  }
  return Number(`${m[1].replace(/[.,]/g, '')}.${(m[2] ?? '0').padEnd(2, '0')}`);
}

/** The amount back into the field, the way `parseAmount` reads it. */
export function amountInput(amount: number | null): string {
  if (amount === null) return '';
  const [whole, cents] = amount.toFixed(2).split('.');
  return `${group(whole)}${cents === '00' ? '' : `,${cents}`}`;
}

/** "2025", "07/2025", "30/07/2025" — a partial date the way the letters write it. */
export function formatPartialDate(value: string | null): string {
  if (!value) return '—';
  const [y, m, d] = value.split('-');
  if (d) return `${d}/${m}/${y}`;
  if (m) return `${m}/${y}`;
  return y;
}

/** The project's period in one short string: "2022 – 2023", "2025", "—". */
export function projectPeriod(ref: Pick<ClientReference, 'projectStart' | 'projectEnd'>): string {
  const start = ref.projectStart ? formatPartialDate(ref.projectStart) : null;
  const end = ref.projectEnd ? formatPartialDate(ref.projectEnd) : null;
  if (start && end) return start === end ? start : `${start} – ${end}`;
  return start ?? end ?? '—';
}

/** The period's last year, the year "the last N years" reads it as. */
export function referenceYear(ref: Pick<ClientReference, 'effectiveDate'>): string {
  return ref.effectiveDate ? ref.effectiveDate.slice(0, 4) : '—';
}

/**
 * A date as typed into the form — the way the letters write it ("30/07/2025",
 * "07/2025", "2025") or ISO — into the API's partial ISO. `null` when empty,
 * `undefined` when it is not a date.
 */
export function parseDateInput(raw: string): string | null | undefined {
  const s = raw.trim();
  if (s === '') return null;
  const pad = (n: string) => n.padStart(2, '0');
  let y: string, m: string | undefined, d: string | undefined;
  let match: RegExpExecArray | null;
  if ((match = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(s))) [, y, m, d] = match;
  else if ((match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s))) [, d, m, y] = match;
  else if ((match = /^(\d{1,2})[/.-](\d{4})$/.exec(s))) [, m, y] = match;
  else return undefined;
  const month = m ? Number(m) : 1;
  const day = d ? Number(d) : 1;
  if (month < 1 || month > 12) return undefined;
  const date = new Date(Date.UTC(Number(y), month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return [y, m && pad(m), d && pad(d)].filter(Boolean).join('-');
}

/** The API's partial ISO back into the field, the way the letters write it. */
export function dateInput(value: string | null): string {
  return value ? formatPartialDate(value) : '';
}

/** A list field: one entry per line (or per comma, for the short ones). */
export function splitList(raw: string, separators: RegExp = /\n/): string[] {
  return raw
    .split(separators)
    .map((s) => s.trim())
    .filter(Boolean);
}
