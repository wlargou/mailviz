/**
 * The RFP register's vocabulary. Mirrors `server/src/utils/rfp.ts` — the ids
 * travel in the API, the labels are only ever shown.
 */
export const RFP_STATUSES = ['OPEN', 'WORKING', 'SUBMITTED', 'WON', 'LOST', 'NO_BID', 'CANCELLED'] as const;
export type RfpStatus = (typeof RFP_STATUSES)[number];

export const RFP_STATUS_LABELS: Record<RfpStatus, string> = {
  OPEN: 'Open',
  WORKING: 'Working',
  SUBMITTED: 'Submitted',
  WON: 'Won',
  LOST: 'Lost',
  NO_BID: 'No bid',
  CANCELLED: 'Cancelled',
};

/** Carbon tag colours: live statuses carry weight, finished ones go grey. */
export const RFP_STATUS_TAG_TYPE: Record<RfpStatus, 'blue' | 'purple' | 'teal' | 'green' | 'red' | 'gray' | 'cool-gray'> = {
  OPEN: 'blue',
  WORKING: 'purple',
  SUBMITTED: 'teal',
  WON: 'green',
  LOST: 'red',
  NO_BID: 'cool-gray',
  CANCELLED: 'gray',
};

export const RFP_TERMINAL_STATUSES: readonly RfpStatus[] = ['WON', 'LOST', 'NO_BID', 'CANCELLED'];

export const RFP_SUBMISSION_FORMATS = ['PAPER', 'EMAIL', 'PORTAL'] as const;
export type RfpSubmissionFormat = (typeof RFP_SUBMISSION_FORMATS)[number];

export const RFP_SUBMISSION_FORMAT_LABELS: Record<RfpSubmissionFormat, string> = {
  PAPER: 'Paper',
  EMAIL: 'Email',
  PORTAL: 'Portal',
};

export const RFP_DOCUMENT_KINDS = ['RFP', 'ANNEXE', 'COMPLEMENT', 'AVIS', 'OTHER'] as const;
export type RfpDocumentKind = (typeof RFP_DOCUMENT_KINDS)[number];

export const RFP_DOCUMENT_KIND_LABELS: Record<RfpDocumentKind, string> = {
  RFP: 'RFP',
  ANNEXE: 'Annexe',
  COMPLEMENT: 'Complément',
  AVIS: 'Avis',
  OTHER: 'Other',
};

export interface RfpDocument {
  id: string;
  rfpId: string;
  kind: RfpDocumentKind;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

/** The buying organisation, as the API returns it alongside a tender. */
export interface RfpCustomer {
  id: string;
  name: string;
  logoUrl: string | null;
}

export interface Rfp {
  id: string;
  name: string;
  reference: string;
  /** The buyer, when it is one of our companies. */
  customerId: string | null;
  customer: RfpCustomer | null;
  /** ISO instant — the deadline carries an hour, and the hour is binding. */
  deadlineAt: string;
  submissionFormat: RfpSubmissionFormat;
  portalUrl: string | null;
  /** Government-Owned Entity: a public buyer, which is why a budget is public. */
  isGoe: boolean;
  /** Published estimate in MAD. A number, never a Decimal string. */
  budget: number | null;
  status: RfpStatus;
  notes: string | null;
  userId: string;
  createdAt: string;
  updatedAt: string;
  documents: RfpDocument[];
}

export interface CreateRfpInput {
  name: string;
  reference: string;
  customerId?: string | null;
  deadlineAt: string;
  submissionFormat: RfpSubmissionFormat;
  portalUrl?: string | null;
  isGoe?: boolean;
  budget?: number | null;
  status?: RfpStatus;
  notes?: string | null;
}

export type UpdateRfpInput = Partial<CreateRfpInput>;

/**
 * Dirhams, grouped, no decimals — these are seven- and eight-figure estimates.
 *
 * Grouped by hand rather than through `toLocaleString`, whose separator comes
 * from the runtime's ICU data: `fr-MA` renders 12.500.000 under Node and
 * 12 500 000 in Chrome, so the same row would read differently depending on
 * where it was drawn.
 */
export function formatBudget(budget: number | null): string {
  if (budget === null) return '—';
  const grouped = Math.round(budget).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${grouped} DH`;
}
