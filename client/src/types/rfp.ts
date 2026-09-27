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

// ── The response: lots, dossiers and their pieces ────────────────────────
// Mirrors server/src/utils/rfpComposition.ts, where the default pieces live.

export const RFP_FOLDER_KINDS = ['ADMINISTRATIF', 'TECHNIQUE', 'ADDITIF', 'OFFRE_TECHNIQUE', 'OFFRE_FINANCIERE', 'OTHER'] as const;
export type RfpFolderKind = (typeof RFP_FOLDER_KINDS)[number];

export const RFP_ITEM_STATUSES = ['TODO', 'IN_PROGRESS', 'READY', 'NOT_APPLICABLE'] as const;
export type RfpItemStatus = (typeof RFP_ITEM_STATUSES)[number];

export const RFP_ITEM_STATUS_LABELS: Record<RfpItemStatus, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  READY: 'Ready',
  NOT_APPLICABLE: 'N/A',
};

export const RFP_ITEM_STATUS_TAG_TYPE: Record<RfpItemStatus, 'gray' | 'blue' | 'green' | 'cool-gray'> = {
  TODO: 'gray',
  IN_PROGRESS: 'blue',
  READY: 'green',
  NOT_APPLICABLE: 'cool-gray',
};

/** One entry of `GET /rfps/catalogue`. */
export interface RfpCatalogueEntry {
  kind: RfpFolderKind;
  label: string;
  /** Prepared once per lot (the offers) rather than once per tender. */
  perLot: boolean;
  defaultItems: string[];
}

export interface RfpLot {
  id: string;
  rfpId: string;
  /** As the RC numbers it; stable when another lot is removed. */
  number: number;
  title: string;
  /** Published estimate for this lot, in MAD. */
  budget: number | null;
}

/** Someone named on a tender: an uploader, a verifier. */
export interface RfpPerson {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
}

export const RFP_VERIFICATION_DECISIONS = ['APPROVED', 'CHANGES_REQUESTED'] as const;
export type RfpVerificationDecision = (typeof RFP_VERIFICATION_DECISIONS)[number];

/** One verifier's decision on one version of a piece. */
export interface RfpItemVerification {
  id: string;
  itemId: string;
  userId: string;
  /** The version decided on — stale once a newer one is uploaded. */
  documentId: string;
  decision: RfpVerificationDecision;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  user: RfpPerson;
}

export interface RfpVerifier {
  id: string;
  rfpId: string;
  userId: string;
  createdAt: string;
  user: RfpPerson;
}

export interface RfpItem {
  id: string;
  folderId: string;
  title: string;
  status: RfpItemStatus;
  notes: string | null;
  position: number;
  updatedAt: string;
  /** The piece's versions, oldest first — the last is the current one. */
  documents: RfpDocument[];
  verifications: RfpItemVerification[];
}

/** The version a verifier is asked about, if anything has been uploaded. */
export function currentVersion(item: Pick<RfpItem, 'documents'>): RfpDocument | null {
  return item.documents.length > 0 ? item.documents[item.documents.length - 1] : null;
}

/**
 * Where a verifier stands on a piece's current version.
 *
 * `stale`: they decided on an older version, so it no longer counts — shown
 * apart from `pending` because "approved v1, v2 since" is worth knowing.
 */
export type VerificationState = 'approved' | 'changes' | 'stale' | 'pending';

export function verificationStates(
  item: Pick<RfpItem, 'documents' | 'verifications'>,
  verifiers: RfpVerifier[],
): Array<{ person: RfpPerson; state: VerificationState; verification: RfpItemVerification | null }> {
  const current = currentVersion(item);
  return verifiers.map((v) => {
    const verification = item.verifications.find((x) => x.userId === v.userId) ?? null;
    const state: VerificationState =
      !verification || !current
        ? 'pending'
        : verification.documentId !== current.id
          ? 'stale'
          : verification.decision === 'APPROVED'
            ? 'approved'
            : 'changes';
    return { person: v.user, state, verification };
  });
}

/**
 * Whether Ready is the verifiers' to give on this piece — mirrors the
 * server's rule: there are verifiers, and there is a file to verify.
 */
export function readyNeedsVerifiers(item: Pick<RfpItem, 'documents'>, verifiers: RfpVerifier[]): boolean {
  return verifiers.length > 0 && currentVersion(item) !== null;
}

export function personName(p: Pick<RfpPerson, 'name' | 'email'> | null | undefined): string {
  // Files uploaded before uploaders were recorded, or by someone since removed.
  if (!p) return 'Unknown uploader';
  return p.name || p.email;
}

export interface RfpFolder {
  id: string;
  rfpId: string;
  lotId: string | null;
  lot: { id: string; number: number; title: string } | null;
  kind: RfpFolderKind;
  title: string;
  position: number;
  items: RfpItem[];
}

/**
 * How far a dossier (or a whole response) is: pieces ready, out of those
 * that apply. N/A pieces are neither done nor left to do.
 */
export function readiness(items: Pick<RfpItem, 'status'>[]): { ready: number; total: number } {
  const applicable = items.filter((i) => i.status !== 'NOT_APPLICABLE');
  return { ready: applicable.filter((i) => i.status === 'READY').length, total: applicable.length };
}

export interface RfpDocument {
  id: string;
  rfpId: string;
  kind: RfpDocumentKind;
  filename: string;
  mimeType: string;
  size: number;
  /** A piece's version number; null for the tender's own documents. */
  version: number | null;
  uploadedById: string | null;
  /** Null when unknown — files uploaded before uploaders were recorded. */
  uploadedBy?: RfpPerson | null;
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
  /** The lots' total, in MAD — derived, never sent. A number, never a Decimal string. */
  budget: number | null;
  status: RfpStatus;
  notes: string | null;
  /** The owner. Anything the signed-in user sees but does not own is shared. */
  userId: string;
  user?: { id: string; name: string | null; email: string };
  createdAt: string;
  updatedAt: string;
  /** The tender's own dossier (RC, CPS, Avis …) — never a piece's files. */
  documents: RfpDocument[];
}

/** What `GET /rfps/:id` returns: the tender with its lots and response. */
export interface RfpDetail extends Rfp {
  lots: RfpLot[];
  folders: RfpFolder[];
  verifiers: RfpVerifier[];
}

export interface LotInput {
  title: string;
  budget?: number | null;
}

export interface CreateRfpInput {
  name: string;
  reference: string;
  customerId?: string | null;
  deadlineAt: string;
  submissionFormat: RfpSubmissionFormat;
  portalUrl?: string | null;
  isGoe?: boolean;
  status?: RfpStatus;
  notes?: string | null;
  lots?: LotInput[];
  composition?: { kinds: RfpFolderKind[]; prefill: boolean };
}

/** Lots and composition have their own endpoints; a PATCH does not carry them. */
export type UpdateRfpInput = Partial<Omit<CreateRfpInput, 'lots' | 'composition'>>;

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

/**
 * A budget as typed, in whole dirhams: `null` when empty, `undefined` when it
 * is not an amount.
 *
 * Amounts are written the way the Avis writes them — "1 500 000,00",
 * "1.500.000", "1500000" — so grouping spaces and dots and two decimals are
 * all read. Parsed once, on the way out, rather than filtered per keystroke:
 * a filter that drops the comma of "1500000,00" as it is typed turns the
 * following "00" into two more zeros.
 */
export function parseBudget(raw: string): number | null | undefined {
  // `\s` covers the no-break spaces a copy from a PDF carries.
  const s = raw.replace(/\s/g, '').replace(/(DH|MAD)$/i, '');
  if (s === '') return null;
  let m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(s);
  if (!m) {
    // Dot-grouped thousands, with an optional comma for the cents.
    m = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(s);
    if (!m) return undefined;
  }
  return Math.round(Number(`${m[1].replace(/\./g, '')}.${m[2] ?? '0'}`));
}
