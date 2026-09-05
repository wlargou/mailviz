import { api } from './client';
import type { ApiResponse } from '../types/api';
import type { Task, TaskLinkType, TaskPriority } from '../types/task';

/** One task in a template; a subtask is the same minus `subtasks`. */
export interface TemplateLeaf {
  title: string;
  description?: string;
  priority?: TaskPriority;
  estimatedMinutes?: number | null;
  /** Days after the anchor; negative means before. Absent = no due date. */
  dueOffsetDays?: number | null;
  labelIds?: string[];
  checklist?: string[];
}

export interface TemplateItem extends TemplateLeaf {
  subtasks?: TemplateLeaf[];
}

export interface TaskTemplate {
  id: string;
  name: string;
  description: string | null;
  items: TemplateItem[];
  /** Tasks the template creates, counting subtasks. */
  taskCount: number;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InstantiateInput {
  anchorDate?: string;
  customerId?: string | null;
  assignedToId?: string | null;
  links?: Array<{ entityType: TaskLinkType; entityId: string }>;
}

export const taskTemplatesApi = {
  getAll() {
    return api.get<ApiResponse<TaskTemplate[]>>('/task-templates');
  },
  getById(id: string) {
    return api.get<ApiResponse<TaskTemplate>>(`/task-templates/${id}`);
  },
  create(data: { name: string; description?: string | null; items: TemplateItem[] }) {
    return api.post<ApiResponse<TaskTemplate>>('/task-templates', data);
  },
  fromTask(data: { taskId: string; name: string; description?: string | null }) {
    return api.post<ApiResponse<TaskTemplate>>('/task-templates/from-task', data);
  },
  update(id: string, data: { name?: string; description?: string | null; items?: TemplateItem[] }) {
    return api.patch<ApiResponse<TaskTemplate>>(`/task-templates/${id}`, data);
  },
  delete(id: string) {
    return api.delete(`/task-templates/${id}`);
  },
  instantiate(id: string, data: InstantiateInput) {
    return api.post<ApiResponse<{ tasks: Task[]; created: number }>>(`/task-templates/${id}/instantiate`, data);
  },
};
