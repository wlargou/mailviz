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

/** Who did something on a task's timeline. */
export interface TaskActor {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
}

export interface TaskComment {
  id: string;
  taskId: string;
  userId: string;
  body: string;
  /** User ids the author named with @. */
  mentions: string[];
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  user: TaskActor;
}

/** One line of a task's timeline: an audit event, or a comment. */
export type TaskActivityEntry =
  | {
      kind: 'event';
      id: string;
      at: string;
      actor: TaskActor;
      action: string;
      details: Record<string, unknown> | null;
    }
  | {
      kind: 'comment';
      id: string;
      at: string;
      actor: TaskActor;
      body: string;
      mentions: string[];
      editedAt: string | null;
    };

/** The other end of a dependency. */
export interface TaskRef {
  id: string;
  title: string;
  status: TaskStatus;
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
  /** Tasks this one waits on. */
  blockedByCount: number;
  /** Of those, the ones not yet finished — what "blocked" means. */
  openBlockerCount: number;
  /** Tasks waiting on this one. */
  blocksCount: number;
  /** Only on `GET /tasks/:id`. */
  subtasks?: Task[];
  /** Only on `GET /tasks/:id`. */
  checklist?: ChecklistItem[];
  /** Only on `GET /tasks/:id`. */
  blockedBy?: TaskRef[];
  /** Only on `GET /tasks/:id`. */
  blocks?: TaskRef[];
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

export interface UpdateTaskInput extends Partial<CreateTaskInput> {
  /** Finish a task whose blockers are still open. */
  force?: boolean;
}

export interface ReorderItem {
  id: string;
  status: TaskStatus;
  position: number;
}
