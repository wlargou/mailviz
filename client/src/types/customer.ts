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
  createdAt: string;
  updatedAt: string;
  _count?: { contacts: number; tasks: number };
  contacts?: Contact[];
}

export interface CustomerSummary {
  id: string;
  name: string;
  domain: string | null;
  logoUrl: string | null;
}

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  customerId: string;
  customer?: { id: string; name: string; domain: string | null; logoUrl: string | null };
  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomerInput {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  website?: string;
  notes?: string;
}

export interface UpdateCustomerInput extends Partial<CreateCustomerInput> {}

export interface CreateContactInput {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  role?: string;
  customerId: string;
}

export interface UpdateContactInput {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  role?: string;
}
