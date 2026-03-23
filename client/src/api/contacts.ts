import { api } from './client';
import type { Contact } from '../types/customer';
import type { ApiResponse } from '../types/api';

export const contactsApi = {
  search(query: string, limit = 10) {
    return api.get<ApiResponse<Contact[]>>('/contacts', {
      params: { search: query, limit: String(limit) },
    });
  },
  lookupByEmail(email: string) {
    return api.get<{ data: { id: string; firstName: string; lastName: string; email: string; customerId: string } | null }>('/contacts/lookup', {
      params: { email },
    });
  },
};
