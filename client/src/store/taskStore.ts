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
  /** Restrict to tasks the user does not own ('shared') or does own ('owned'). */
  ownership?: TaskOwnership;
  /** 'true' = only tasks with an unfinished blocker; 'false' = only tasks without one. */
  blocked?: string;
  sortBy: string;
  sortOrder: string;
}

export type TaskOwnership = 'shared' | 'owned';

interface TaskState {
  tasks: Task[];
  summary: TaskSummary | null;
  loading: boolean;
  meta: PaginationMeta | null;
  filters: TaskFilters;
  currentPage: number;
  pageSize: number;

  /**
   * Bumped once per successful write to a task. Views that keep their own copy
   * of the task list watch this and refetch.
   *
   * It is deliberately NOT bumped by `fetchTasks`. "The store refetched" is a
   * different signal from "a task was written", and the wrong one here: it
   * fires on paging and on every debounced keystroke in the search box, and it
   * is blind to the writes that never touch this store at all — the Kanban
   * drag, By Company's Mark as done, converting an email to a task from Mail.
   * Those sibling-to-sibling cases are most of what this exists to fix.
   */
  tasksVersion: number;
  /** Same idea for the status vocabulary, which the Kanban board can add to. */
  statusesVersion: number;

  /** Call after a task write lands — never inside a loader, never in a `finally`. */
  taskChanged: () => void;
  /** Call after the status vocabulary changes. */
  statusChanged: () => void;
  fetchTasks: () => Promise<void>;
  fetchSummary: () => Promise<void>;
  setFilter: (key: keyof TaskFilters, value: string | undefined) => void;
  /** Replace every filter and the sort with a saved view's. */
  applyView: (filters: Record<string, string | boolean>, sortBy: string, sortOrder: string) => void;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
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
  pageSize: 20,
  tasksVersion: 0,
  statusesVersion: 0,

  taskChanged: () => set((state) => ({ tasksVersion: state.tasksVersion + 1 })),
  statusChanged: () => set((state) => ({ statusesVersion: state.statusesVersion + 1 })),

  fetchTasks: async () => {
    set({ loading: true });
    try {
      const { filters, currentPage, pageSize } = get();
      const params: Record<string, string> = {
        page: String(currentPage),
        limit: String(pageSize),
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder,
      };
      if (filters.status) params.status = filters.status;
      if (filters.priority) params.priority = filters.priority;
      if (filters.search) params.search = filters.search;
      if (filters.labelId) params.labelId = filters.labelId;
      if (filters.ownership) params.ownership = filters.ownership;
      if (filters.blocked) params.blocked = filters.blocked;
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

  applyView: (filters, sortBy, sortOrder) =>
    set({
      filters: {
        ...defaultFilters,
        status: typeof filters.status === 'string' ? filters.status : undefined,
        priority: typeof filters.priority === 'string' ? (filters.priority as TaskPriority) : undefined,
        search: typeof filters.search === 'string' ? filters.search : undefined,
        labelId: typeof filters.labelId === 'string' ? filters.labelId : undefined,
        ownership: filters.ownership === 'shared' || filters.ownership === 'owned' ? filters.ownership : undefined,
        blocked: typeof filters.blocked === 'string' ? filters.blocked : undefined,
        overdue: filters.overdue === true || filters.overdue === 'true' ? true : undefined,
        sortBy: sortBy || defaultFilters.sortBy,
        sortOrder: sortOrder || defaultFilters.sortOrder,
      },
      currentPage: 1,
    }),

  setPage: (page) => set({ currentPage: page }),
  setPageSize: (size) => set({ pageSize: size, currentPage: 1 }),

  resetFilters: () => set({ filters: { ...defaultFilters }, currentPage: 1 }),
}));
