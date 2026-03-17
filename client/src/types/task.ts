export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface Label {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  _count?: { tasks: number };
}

export interface TaskCustomer {
  id: string;
  name: string;
  company: string | null;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  position: number;
  customerId: string | null;
  createdAt: string;
  updatedAt: string;
  labels: Label[];
  customer: TaskCustomer | null;
}

export interface TaskSummary {
  total: number;
  completed: number;
  overdue: number;
  inProgress: number;
  byPriority: Record<string, number>;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  labelIds?: string[];
  customerId?: string | null;
}

export interface UpdateTaskInput extends Partial<CreateTaskInput> {}

export interface ReorderItem {
  id: string;
  status: TaskStatus;
  position: number;
}
