import { api } from './client';
import type { CompanyCategory } from '../types/customer';

export const companyCategoriesApi = {
  getAll() {
    return api.get<{ data: CompanyCategory[] }>('/company-categories');
  },

  create(data: { label: string; color?: string }) {
    return api.post<{ data: CompanyCategory }>('/company-categories', data);
  },

  update(id: string, data: { label?: string; color?: string }) {
    return api.patch<{ data: CompanyCategory }>(`/company-categories/${id}`, data);
  },

  reorder(items: { id: string; position: number }[]) {
    return api.patch<{ data: { success: boolean } }>('/company-categories/reorder', { items });
  },

  delete(id: string) {
    return api.delete(`/company-categories/${id}`);
  },
};
