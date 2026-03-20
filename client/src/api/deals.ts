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
};
