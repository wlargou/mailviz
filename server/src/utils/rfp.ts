/**
 * The vocabulary of the RFP register.
 *
 * Mirrored on the client in `client/src/types/rfp.ts`; the ids travel in the
 * API and are stored in `rfps.status` / `rfps.submission_format` as plain
 * strings rather than Postgres enums, so adding one is a code change and not
 * a migration (this repo has been through one enum-to-string migration
 * already and is not going back).
 */
export const RFP_STATUSES = ['OPEN', 'WORKING', 'SUBMITTED', 'WON', 'LOST', 'NO_BID', 'CANCELLED'] as const;
export type RfpStatus = (typeof RFP_STATUSES)[number];

/** Statuses that mean the tender is over — the register's history. */
export const RFP_TERMINAL_STATUSES: readonly RfpStatus[] = ['WON', 'LOST', 'NO_BID', 'CANCELLED'];

export const RFP_SUBMISSION_FORMATS = ['PAPER', 'EMAIL', 'PORTAL'] as const;
export type RfpSubmissionFormat = (typeof RFP_SUBMISSION_FORMATS)[number];

/** Document roles in a tender dossier. */
export const RFP_DOCUMENT_KINDS = ['RFP', 'ANNEXE', 'COMPLEMENT', 'AVIS', 'OTHER'] as const;
export type RfpDocumentKind = (typeof RFP_DOCUMENT_KINDS)[number];
