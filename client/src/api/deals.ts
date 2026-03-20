import { api } from './client';
import type { Deal, CreateDealInput, UpdateDealInput } from '../types/deal';
import type { ApiResponse } from '../types/api';

export const dealsApi = {
  getAll(params?: Record<string, string>) {
    return api.get<ApiResponse<Deal[]>>('/deals', { params });
  },

  getById(id: string) {
    return api.get<ApiResponse<Deal>>(`/deals/${id}`);
  },

  create(data: CreateDealInput) {
    return api.post<ApiResponse<Deal>>('/deals', data);
  },

  update(id: string, data: UpdateDealInput) {
    return api.patch<ApiResponse<Deal>>(`/deals/${id}`, data);
  },

  delete(id: string) {
    return api.delete(`/deals/${id}`);
  },

  // Sharing
  shareDeal(id: string, userIds: string[]) {
    return api.post(`/deals/${id}/share`, { userIds });
  },
  unshareDeal(id: string, recipientId: string) {
    return api.delete(`/deals/${id}/shares/${recipientId}`);
  },
  getDealShares(id: string) {
    return api.get<{ data: Array<{ id: string; createdAt: string; sharedWith: { id: string; name: string | null; email: string; avatarUrl: string | null } }> }>(`/deals/${id}/shares`);
  },
};
