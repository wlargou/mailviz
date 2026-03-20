import { api } from './client';
import type { DealPartner } from '../types/deal';

export const dealPartnersApi = {
  getAll() {
    return api.get<{ data: DealPartner[] }>('/deal-partners');
  },

  create(data: { name: string; registrationUrl?: string; logoUrl?: string }) {
    return api.post<{ data: DealPartner }>('/deal-partners', data);
  },

  update(id: string, data: { name?: string; registrationUrl?: string; logoUrl?: string }) {
    return api.patch<{ data: DealPartner }>(`/deal-partners/${id}`, data);
  },

  delete(id: string) {
    return api.delete(`/deal-partners/${id}`);
  },
};
