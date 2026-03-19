import { api } from './client';
import type { TaskStatusConfig } from '../types/task';

export const taskStatusesApi = {
  getAll() {
    return api.get<{ data: TaskStatusConfig[] }>('/task-statuses');
  },

  create(data: { label: string; color?: string }) {
    return api.post<{ data: TaskStatusConfig }>('/task-statuses', data);
  },

  update(id: string, data: { label?: string; color?: string }) {
    return api.patch<{ data: TaskStatusConfig }>(`/task-statuses/${id}`, data);
  },

  reorder(items: { id: string; position: number }[]) {
    return api.patch<{ data: { success: boolean } }>('/task-statuses/reorder', { items });
  },

  delete(id: string) {
    return api.delete(`/task-statuses/${id}`);
  },
};
