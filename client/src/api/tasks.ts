import { api } from './client';
import type { Task, TaskSummary, CreateTaskInput, UpdateTaskInput, ReorderItem, ChecklistItem, TaskComment, TaskActivityEntry } from '../types/task';
import type { ApiResponse } from '../types/api';

/** How the By Company view orders its groups. Mirrors the server's whitelist. */
export type TaskGroupSort = 'urgency' | 'company' | 'taskCount';

/** One company's slice of the by-company view. `customer` is null for the trailing unassigned bucket. */
export interface TaskCompanyGroup {
  customer: { id: string; name: string; domain: string | null; logoUrl: string | null } | null;
  taskCount: number;
  overdueCount: number;
  /** Soonest unfinished work still ahead; null when there is none. */
  nextDueAt: string | null;
  tasks: Task[];
}

export interface TaskCompanyMeta {
  totalTasks: number;
  companies: number;
  truncated: boolean;
  overdueTasks: number;
  urgentTasks: number;
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
    sort?: TaskGroupSort;
  }) {
    return api.get<{
      data: TaskCompanyGroup[];
      meta: TaskCompanyMeta;
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

  // Checklist
  addChecklistItem(taskId: string, text: string) {
    return api.post<ApiResponse<ChecklistItem>>(`/tasks/${taskId}/checklist`, { text });
  },
  updateChecklistItem(taskId: string, itemId: string, data: { text?: string; isDone?: boolean }) {
    return api.patch<ApiResponse<ChecklistItem>>(`/tasks/${taskId}/checklist/${itemId}`, data);
  },
  deleteChecklistItem(taskId: string, itemId: string) {
    return api.delete(`/tasks/${taskId}/checklist/${itemId}`);
  },

  // Dependencies
  addDependency(taskId: string, blockerId: string) {
    return api.post<ApiResponse<Task>>(`/tasks/${taskId}/dependencies`, { blockerId });
  },
  removeDependency(taskId: string, blockerId: string) {
    return api.delete<ApiResponse<Task>>(`/tasks/${taskId}/dependencies/${blockerId}`);
  },

  // Activity and comments
  getActivity(taskId: string) {
    return api.get<{ data: TaskActivityEntry[] }>(`/tasks/${taskId}/activity`);
  },
  addComment(taskId: string, data: { body: string; mentions?: string[] }) {
    return api.post<ApiResponse<TaskComment>>(`/tasks/${taskId}/comments`, data);
  },
  updateComment(taskId: string, commentId: string, data: { body: string; mentions?: string[] }) {
    return api.patch<ApiResponse<TaskComment>>(`/tasks/${taskId}/comments/${commentId}`, data);
  },
  deleteComment(taskId: string, commentId: string) {
    return api.delete(`/tasks/${taskId}/comments/${commentId}`);
  },
};
