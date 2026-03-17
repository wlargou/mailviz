import { api } from './client';
import type { Contact } from '../types/customer';
import type { ApiResponse } from '../types/api';

export const contactsApi = {
  search(query: string, limit = 10) {
    return api.get<ApiResponse<Contact[]>>('/contacts', {
      params: { search: query, limit: String(limit) },
    });
  },
};
