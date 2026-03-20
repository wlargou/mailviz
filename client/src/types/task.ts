export type TaskStatus = string;
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface TaskStatusConfig {
  id: string;
  name: string;
  label: string;
  color: string;
  position: number;
  createdAt: string;
}

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

export interface TaskAssignee {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
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
  assignedToId: string | null;
  assignedTo: TaskAssignee | null;
  estimatedMinutes: number | null;
  userId: string;
  createdAt: string;
  updatedAt: string;
  labels: Label[];
  customer: TaskCustomer | null;
  mailToTask?: {
    id: string;
    conversionNote: string | null;
    email: {
      id: string;
      subject: string;
      from: string;
      fromName: string | null;
      threadId: string | null;
      receivedAt: string;
    };
  } | null;
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
  assignedToId?: string | null;
  estimatedMinutes?: number | null;
}

export interface UpdateTaskInput extends Partial<CreateTaskInput> {}

export interface ReorderItem {
  id: string;
  status: TaskStatus;
  position: number;
}
