export interface DealPartner {
  id: string;
  name: string;
  registrationUrl: string | null;
  logoUrl: string | null;
  createdAt: string;
}

export interface Deal {
  id: string;
  title: string;
  partnerId: string;
  customerId: string | null;
  products: string | null;
  status: DealStatus;
  expiryDate: string | null;
  notes: string | null;
  partner: DealPartner;
  customer: { id: string; name: string; logoUrl: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export type DealStatus = 'TO_CHALLENGE' | 'APPROVED' | 'DECLINED';

export const DEAL_STATUS_LABELS: Record<DealStatus, string> = {
  TO_CHALLENGE: 'To Challenge',
  APPROVED: 'Approved',
  DECLINED: 'Declined',
};

export const DEAL_STATUS_TAG_TYPE: Record<DealStatus, 'blue' | 'green' | 'red'> = {
  TO_CHALLENGE: 'blue',
  APPROVED: 'green',
  DECLINED: 'red',
};

export interface CreateDealInput {
  title: string;
  partnerId: string;
  customerId?: string | null;
  products?: string;
  status?: DealStatus;
  expiryDate?: string | null;
  notes?: string;
}

export interface UpdateDealInput extends Partial<CreateDealInput> {}
