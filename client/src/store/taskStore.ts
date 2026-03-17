import { create } from 'zustand';
import type { Task, TaskSummary, TaskStatus, TaskPriority } from '../types/task';
import type { PaginationMeta } from '../types/api';
import { tasksApi } from '../api/tasks';

interface TaskFilters {
  status?: TaskStatus;
  priority?: TaskPriority;
  search?: string;
  labelId?: string;
  overdue?: boolean;
  sortBy: string;
  sortOrder: string;
}

interface TaskState {
  tasks: Task[];
  summary: TaskSummary | null;
  loading: boolean;
  meta: PaginationMeta | null;
  filters: TaskFilters;
  currentPage: number;

  fetchTasks: () => Promise<void>;
  fetchSummary: () => Promise<void>;
  setFilter: (key: keyof TaskFilters, value: string | undefined) => void;
  setPage: (page: number) => void;
  resetFilters: () => void;
}

const defaultFilters: TaskFilters = {
  sortBy: 'createdAt',
  sortOrder: 'desc',
};

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  summary: null,
  loading: false,
  meta: null,
  filters: { ...defaultFilters },
  currentPage: 1,

  fetchTasks: async () => {
    set({ loading: true });
    try {
      const { filters, currentPage } = get();
      const params: Record<string, string> = {
        page: String(currentPage),
        limit: '20',
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder,
      };
      if (filters.status) params.status = filters.status;
      if (filters.priority) params.priority = filters.priority;
      if (filters.search) params.search = filters.search;
      if (filters.labelId) params.labelId = filters.labelId;
      if (filters.overdue) {
        params.dueBefore = new Date().toISOString();
        // Exclude completed tasks for overdue filter
        if (!filters.status) params.statusNot = 'DONE';
      }

      const { data: response } = await tasksApi.getAll(params);
      set({ tasks: response.data, meta: response.meta || null });
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    } finally {
      set({ loading: false });
    }
  },

  fetchSummary: async () => {
    try {
      const { data: response } = await tasksApi.getSummary();
      set({ summary: response.data });
    } catch (err) {
      console.error('Failed to fetch summary:', err);
    }
  },

  setFilter: (key, value) => {
    set((state) => ({
      filters: {
        ...state.filters,
        [key]: key === 'overdue' ? (value === 'true' ? true : undefined) : (value || undefined),
      },
      currentPage: 1,
    }));
  },

  setPage: (page) => set({ currentPage: page }),

  resetFilters: () => set({ filters: { ...defaultFilters }, currentPage: 1 }),
}));
