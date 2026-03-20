import { api } from './client';
import type { Task, TaskSummary, CreateTaskInput, UpdateTaskInput, ReorderItem } from '../types/task';
import type { ApiResponse } from '../types/api';

export const tasksApi = {
  getAll(params?: Record<string, string>) {
    return api.get<ApiResponse<Task[]>>('/tasks', { params });
  },

  getById(id: string) {
    return api.get<ApiResponse<Task>>(`/tasks/${id}`);
  },

  getSummary() {
    return api.get<ApiResponse<TaskSummary>>('/tasks/summary');
  },

  create(data: CreateTaskInput) {
    return api.post<ApiResponse<Task>>('/tasks', data);
  },

  update(id: string, data: UpdateTaskInput) {
    return api.patch<ApiResponse<Task>>(`/tasks/${id}`, data);
  },

  reorder(items: ReorderItem[]) {
    return api.patch<ApiResponse<{ success: boolean }>>('/tasks/reorder', { items });
  },

  delete(id: string) {
    return api.delete(`/tasks/${id}`);
  },

  // Sharing
  shareTask(id: string, userIds: string[]) {
    return api.post(`/tasks/${id}/share`, { userIds });
  },
  unshareTask(id: string, recipientId: string) {
    return api.delete(`/tasks/${id}/shares/${recipientId}`);
  },
  getTaskShares(id: string) {
    return api.get<{ data: Array<{ id: string; createdAt: string; sharedWith: { id: string; name: string | null; email: string; avatarUrl: string | null } }> }>(`/tasks/${id}/shares`);
  },

  // Assignment
  assignTask(id: string, assignedToId: string | null) {
    return api.patch(`/tasks/${id}/assign`, { assignedToId });
  },
};
