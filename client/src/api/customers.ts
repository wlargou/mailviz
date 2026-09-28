import { api } from './client';
import type { Customer, Contact, CreateCustomerInput, UpdateCustomerInput, CreateContactInput, UpdateContactInput, DuplicateGroup, MergeContactsResult, CompanyStatus } from '../types/customer';
import type { CalendarEvent } from '../types/calendar';
import type { AttachmentWithEmail } from '../types/email';
import type { ApiResponse } from '../types/api';

export const customersApi = {
  /** How many companies are accounts, senders to review, and ignored. */
  getStatusCounts() {
    return api.get<{ data: Record<CompanyStatus, number> }>('/customers/status-counts');
  },

  /** Keep or ignore one or many — the triage. */
  setStatus(ids: string[], status: CompanyStatus) {
    return api.post<{ data: { updated: number } }>('/customers/status', { ids, status });
  },

  getAll(params?: Record<string, string>) {
    return api.get<ApiResponse<Customer[]>>('/customers', { params });
  },

  getById(id: string) {
    return api.get<ApiResponse<Customer>>(`/customers/${id}`);
  },

  create(data: CreateCustomerInput) {
    return api.post<ApiResponse<Customer>>('/customers', data);
  },

  update(id: string, data: UpdateCustomerInput) {
    return api.patch<ApiResponse<Customer>>(`/customers/${id}`, data);
  },

  delete(id: string) {
    return api.delete(`/customers/${id}`);
  },

  getLinkedEvents(customerId: string) {
    return api.get<ApiResponse<CalendarEvent[]>>(`/customers/${customerId}/events`);
  },

  getAttachments(customerId: string) {
    return api.get<ApiResponse<AttachmentWithEmail[]>>(`/customers/${customerId}/attachments`);
  },

  toggleVip(id: string) {
    return api.patch<ApiResponse<Customer>>(`/customers/${id}/vip`);
  },
};

export const contactsApi = {
  getAll(params?: Record<string, string>) {
    return api.get<ApiResponse<Contact[]>>('/contacts', { params });
  },

  getById(id: string) {
    return api.get<ApiResponse<Contact>>(`/contacts/${id}`);
  },

  getEvents(id: string) {
    return api.get<ApiResponse<CalendarEvent[]>>(`/contacts/${id}/events`);
  },

  getAttachments(id: string) {
    return api.get<ApiResponse<AttachmentWithEmail[]>>(`/contacts/${id}/attachments`);
  },

  getByCustomerId(customerId: string) {
    return api.get<ApiResponse<Contact[]>>('/contacts', { params: { customerId } });
  },

  create(data: CreateContactInput) {
    return api.post<ApiResponse<Contact>>('/contacts', data);
  },

  update(id: string, data: UpdateContactInput) {
    return api.patch<ApiResponse<Contact>>(`/contacts/${id}`, data);
  },

  delete(id: string) {
    return api.delete(`/contacts/${id}`);
  },

  toggleVip(id: string) {
    return api.patch<ApiResponse<Contact>>(`/contacts/${id}/vip`);
  },

  getDuplicates(params?: Record<string, string>) {
    return api.get<ApiResponse<DuplicateGroup[]>>('/contacts/duplicates', { params });
  },

  /**
   * Irreversible: every id in `sourceIds` is deleted. The caller sends exactly
   * the ids the user confirmed on screen — there is no "merge the group" call.
   */
  merge(body: { targetId: string; sourceIds: string[] }) {
    return api.post<ApiResponse<MergeContactsResult>>('/contacts/merge', body);
  },
};

export interface AccountOverview {
  lastTouchAt: string | null;
  weekly: Array<{ weekStart: string; emails: number; meetings: number }>;
  open: {
    tasks: Array<{ id: string; title: string; dueDate: string | null; priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'; status: string }>;
    taskCount: number;
    tenders: Array<{ id: string; name: string; reference: string; status: string; deadlineAt: string }>;
    deals: Array<{ id: string; title: string; status: string; expiryDate: string | null; partner: { name: string } | null }>;
  };
  keyPeople: Array<{ id: string; name: string | null; email: string | null; role: string | null; exchanges: number; lastAt: string | null }>;
}

export interface AccountTimelineEntry {
  kind: 'THREAD' | 'MEETING' | 'TASK' | 'TENDER' | 'DEAL';
  id: string;
  title: string;
  detail: string | null;
  at: string;
  threadId?: string | null;
}

/** The account at a glance and its history — see server accountOverviewService. */
export const accountsApi = {
  overview(customerId: string) {
    return api.get<{ data: AccountOverview }>(`/customers/${customerId}/overview`);
  },
  timeline(customerId: string, before?: string) {
    return api.get<{ data: { entries: AccountTimelineEntry[]; nextBefore: string | null } }>(
      `/customers/${customerId}/timeline`,
      { params: before ? { before } : {} },
    );
  },
};
