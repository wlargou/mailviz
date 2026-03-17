import { api } from './client';
import type { Customer, Contact, CreateCustomerInput, UpdateCustomerInput, CreateContactInput, UpdateContactInput } from '../types/customer';
import type { CalendarEvent } from '../types/calendar';
import type { AttachmentWithEmail } from '../types/email';
import type { ApiResponse } from '../types/api';

export const customersApi = {
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
};
