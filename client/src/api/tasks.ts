import { api } from './client';
import type { Task, TaskSummary, CreateTaskInput, UpdateTaskInput, ReorderItem } from '../types/task';
import type { ApiResponse } from '../types/api';

/** One company's slice of the by-company view. `customer` is null for the trailing unassigned bucket. */
export interface TaskCompanyGroup {
  customer: { id: string; name: string; domain: string | null; logoUrl: string | null } | null;
  taskCount: number;
  overdueCount: number;
  tasks: Task[];
}

export const tasksApi = {
  getAll(params?: Record<string, string>) {
    return api.get<ApiResponse<Task[]>>('/tasks', { params });
  },

  getGroupedByCompany(params?: {
    search?: string;
    status?: string;
    priority?: string;
    labelId?: string;
    includeCompleted?: boolean;
  }) {
    return api.get<{
      data: TaskCompanyGroup[];
      meta: { totalTasks: number; companies: number; truncated: boolean };
    }>('/tasks/by-company', {
      params: {
        ...params,
        // Axios drops undefined, and the server only treats the literal 'true'
        // as opting in — so send nothing rather than 'false'.
        includeCompleted: params?.includeCompleted ? 'true' : undefined,
      },
    });
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
