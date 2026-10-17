import {
  amountInput,
  dateInput,
  parseAmount,
  parseDateInput,
  splitList,
  type ClientReference,
  type ClientReferenceInput,
  type ReferenceAmountType,
  type ReferenceAppreciation,
  type ReferenceDocumentType,
  type ReferenceWorkStatus,
} from '../../types/clientReference';

/**
 * The reference as the form holds it: every field as typed, so a half-typed
 * amount or date is never reformatted under the cursor. Read into the API's
 * shape once, on save, by `toInput`.
 */
export interface ReferenceForm {
  documentType: ReferenceDocumentType;
  workStatus: ReferenceWorkStatus;
  needsReview: boolean;
  reviewNotes: string;
  customerName: string;
  customerId: string | null;
  city: string;
  projectName: string;
  projectReference: string;
  attestationNumber: string;
  amount: string;
  amountType: ReferenceAmountType | '';
  currency: string;
  amountScope: string;
  appreciation: ReferenceAppreciation;
  appreciationQuote: string;
  projectStart: string;
  projectEnd: string;
  signedAt: string;
  signedPlace: string;
  technologies: string;
  prestations: string;
  partners: string;
  consortiumPartners: string;
  details: string;
  signatories: Array<{ key: string; name: string; role: string }>;
}

let keySeq = 0;
export const signatoryKey = () => `s${++keySeq}`;

export const EMPTY_FORM: ReferenceForm = {
  documentType: 'ATTESTATION_REFERENCE',
  workStatus: 'COMPLETED',
  needsReview: false,
  reviewNotes: '',
  customerName: '',
  customerId: null,
  city: '',
  projectName: '',
  projectReference: '',
  attestationNumber: '',
  amount: '',
  amountType: '',
  currency: 'MAD',
  amountScope: '',
  appreciation: 'NONE',
  appreciationQuote: '',
  projectStart: '',
  projectEnd: '',
  signedAt: '',
  signedPlace: '',
  technologies: '',
  prestations: '',
  partners: '',
  consortiumPartners: '',
  details: '',
  signatories: [],
};

export function toForm(ref: ClientReference): ReferenceForm {
  return {
    documentType: ref.documentType,
    workStatus: ref.workStatus,
    needsReview: ref.needsReview,
    reviewNotes: ref.reviewNotes ?? '',
    customerName: ref.customerName,
    customerId: ref.customerId,
    city: ref.city ?? '',
    projectName: ref.projectName ?? '',
    projectReference: ref.projectReference ?? '',
    attestationNumber: ref.attestationNumber ?? '',
    amount: amountInput(ref.amount),
    amountType: ref.amountType ?? '',
    currency: ref.currency,
    amountScope: ref.amountScope ?? '',
    appreciation: ref.appreciation,
    appreciationQuote: ref.appreciationQuote ?? '',
    projectStart: dateInput(ref.projectStart),
    projectEnd: dateInput(ref.projectEnd),
    signedAt: dateInput(ref.signedAt),
    signedPlace: ref.signedPlace ?? '',
    technologies: ref.technologies.join('\n'),
    prestations: ref.prestations.join('\n'),
    partners: ref.partners.join(', '),
    consortiumPartners: ref.consortiumPartners.join(', '),
    details: ref.details ?? '',
    signatories: ref.signatories.map((s) => ({ key: signatoryKey(), name: s.name ?? '', role: s.role ?? '' })),
  };
}

/** What is wrong with the form, field by field; empty when it can be saved. */
export function formErrors(form: ReferenceForm): Partial<Record<keyof ReferenceForm, string>> {
  const errors: Partial<Record<keyof ReferenceForm, string>> = {};
  if (!form.customerName.trim()) errors.customerName = 'The customer is required';
  if (parseAmount(form.amount) === undefined) errors.amount = 'Not an amount — e.g. 1 500 000,00';
  if (!/^[A-Za-z]{3}$/.test(form.currency.trim())) errors.currency = 'Three letters';
  for (const key of ['projectStart', 'projectEnd'] as const) {
    if (parseDateInput(form[key]) === undefined) errors[key] = 'A year, a month or a day — 2025, 07/2025, 30/07/2025';
  }
  const signed = parseDateInput(form.signedAt);
  if (signed === undefined || (signed && signed.length !== 10)) errors.signedAt = 'A day — 17/09/2026';
  return errors;
}

const text = (s: string) => (s.trim() ? s.trim() : null);
const commaList = (s: string) => splitList(s, /[,;\n]/);

/** The whole form in the API's shape. Call only when `formErrors` is empty. */
export function toInput(form: ReferenceForm): Required<Omit<ClientReferenceInput, 'signatories'>> & Pick<ClientReferenceInput, 'signatories'> {
  return {
    documentType: form.documentType,
    workStatus: form.workStatus,
    needsReview: form.needsReview,
    reviewNotes: text(form.reviewNotes),
    customerName: form.customerName.trim(),
    customerId: form.customerId,
    city: text(form.city),
    projectName: text(form.projectName),
    projectReference: text(form.projectReference),
    attestationNumber: text(form.attestationNumber),
    amount: parseAmount(form.amount) ?? null,
    amountType: form.amountType || null,
    currency: form.currency.trim().toUpperCase(),
    amountScope: text(form.amountScope),
    appreciation: form.appreciation,
    appreciationQuote: text(form.appreciationQuote),
    projectStart: parseDateInput(form.projectStart) ?? null,
    projectEnd: parseDateInput(form.projectEnd) ?? null,
    signedAt: parseDateInput(form.signedAt) ?? null,
    signedPlace: text(form.signedPlace),
    technologies: splitList(form.technologies),
    prestations: splitList(form.prestations),
    partners: commaList(form.partners),
    consortiumPartners: commaList(form.consortiumPartners),
    details: text(form.details),
    signatories: form.signatories
      .map((s) => ({ name: text(s.name), role: text(s.role) }))
      .filter((s) => s.name || s.role),
  };
}

/**
 * Only what changed since `base` — so a save never rewrites a field the user
 * did not touch, and two people correcting different fields do not undo each
 * other's work.
 */
export function changedInput(form: ReferenceForm, base: ReferenceForm): ClientReferenceInput {
  const now = toInput(form);
  const before = toInput(base);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(now) as Array<keyof typeof now>) {
    if (JSON.stringify(now[key]) !== JSON.stringify(before[key])) out[key] = now[key];
  }
  return out as ClientReferenceInput;
}
