export interface CompanyCategory {
  id: string;
  name: string;
  label: string;
  color: string;
  position: number;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  website: string | null;
  domain: string | null;
  logoUrl: string | null;
  notes: string | null;
  categoryId: string | null;
  isVip: boolean;
  category: CompanyCategory | null;
  createdAt: string;
  updatedAt: string;
  _count?: { contacts: number; tasks: number; emails: number };
  contacts?: Contact[];
}

export interface CustomerSummary {
  id: string;
  name: string;
  domain: string | null;
  logoUrl: string | null;
}

/** An address a contact answers to besides its primary, gained by a merge. */
export interface ContactEmailAlias {
  id: string;
  email: string;
  createdAt: string;
}

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  isVip: boolean;
  customerId: string;
  customer?: { id: string; name: string; domain: string | null; logoUrl: string | null };
  emailAliases?: ContactEmailAlias[];
  createdAt: string;
  updatedAt: string;
}

export type DuplicateMatchRule = 'exact_email' | 'alias_local_part' | 'initial_form';

export interface DuplicateContact extends Contact {
  /** Messages received from all of this contact's addresses. */
  emailCount: number;
  aliasEmails: string[];
}

export interface DuplicateGroup {
  id: string;
  customer: { id: string; name: string; domain: string | null; logoUrl: string | null };
  confidence: 'high' | 'medium';
  rules: DuplicateMatchRule[];
  /** Plain-language justification, strongest rule first. */
  reasons: string[];
  suggestedPrimaryId: string;
  contacts: DuplicateContact[];
}

export interface MergeContactsResult {
  contact: Contact;
  mergedContactIds: string[];
  aliasEmailsAdded: string[];
  fieldsAdopted: Record<string, string>;
}

export interface CreateCustomerInput {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  website?: string;
  notes?: string;
  categoryId?: string | null;
  isVip?: boolean;
}

export interface UpdateCustomerInput extends Partial<CreateCustomerInput> {}

export interface CreateContactInput {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  role?: string;
  customerId: string;
  isVip?: boolean;
}

export interface UpdateContactInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  role?: string;
  isVip?: boolean;
}
