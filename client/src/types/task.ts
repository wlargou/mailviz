export type TaskStatus = string;
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export interface TaskStatusConfig {
  id: string;
  name: string;
  label: string;
  color: string;
  position: number;
  createdAt: string;
  /** Tasks in this status are finished: not overdue, and no reminders. */
  isTerminal: boolean;
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

/** One line on a task's checklist. */
export interface ChecklistItem {
  id: string;
  taskId: string;
  text: string;
  isDone: boolean;
  position: number;
  createdAt: string;
  completedAt: string | null;
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
  /** Set when this task is a subtask. Two levels only. */
  parentId: string | null;
  parent: { id: string; title: string } | null;
  subtaskCount: number;
  /** Subtasks in one of the account's terminal statuses. */
  subtaskDoneCount: number;
  checklistCount: number;
  checklistDoneCount: number;
  /** Only on `GET /tasks/:id`. */
  subtasks?: Task[];
  /** Only on `GET /tasks/:id`. */
  checklist?: ChecklistItem[];
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
  parentId?: string | null;
}

export interface UpdateTaskInput extends Partial<CreateTaskInput> {}

export interface ReorderItem {
  id: string;
  status: TaskStatus;
  position: number;
}
