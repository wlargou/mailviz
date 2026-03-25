import { api } from './client';

export const auditApi = {
  getAll(params?: Record<string, string>) {
    return api.get('/audit-logs', { params });
  },
  getById(id: string) {
    return api.get(`/audit-logs/${id}`);
  },
};
