import { api } from './client';
import type { Label } from '../types/task';
import type { ApiResponse } from '../types/api';

export const labelsApi = {
  getAll() {
    return api.get<ApiResponse<Label[]>>('/labels');
  },

  create(data: { name: string; color: string }) {
    return api.post<ApiResponse<Label>>('/labels', data);
  },

  update(id: string, data: { name?: string; color?: string }) {
    return api.patch<ApiResponse<Label>>(`/labels/${id}`, data);
  },

  delete(id: string) {
    return api.delete(`/labels/${id}`);
  },
};
