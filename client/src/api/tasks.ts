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
};
