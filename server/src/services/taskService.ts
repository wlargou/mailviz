import { Prisma } from '../lib/prismaClient.js';
import { prisma } from '../lib/prisma.js';
import { terminalStatusNames, notTerminal, isTerminalStatus } from '../utils/taskStatus.js';
import {
  CreateTaskInput,
  UpdateTaskInput,
  ReorderInput,
  CreateChecklistItemInput,
  UpdateChecklistItemInput,
  TASK_LINK_TYPES,
  type TaskLinkType,
  type LogTimeInput,
  type SaveViewInput,
  type UpdateViewInput,
} from '../validators/taskValidator.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';
import { AppError } from '../middleware/errorHandler.js';
import { getSharedTaskIds, canAccessTask, isTaskOwner } from '../utils/accessControl.js';
import { nextOccurrence } from '../utils/recurrence.js';
import { resolveTimeZone, startOfDayInZone, addDaysInZone } from '../utils/timezone.js';
import { wsEmitToUsers, wsEmitToUser } from '../websocket.js';
import { auditService } from './auditService.js';
import { notificationService } from './notificationService.js';

interface TaskQueryParams {
  status?: string;
  statusNot?: string;
  priority?: string;
  search?: string;
  labelId?: string;
  customerId?: string;
  dueBefore?: string;
  dueAfter?: string;
  /** Only the subtasks of this task. */
  parentId?: string;
  /** 'true' = leave subtasks out; they are reached through their parent. */
  topLevel?: string;
  /** 'true' = only tasks with an unfinished blocker; 'false' = only tasks without one. */
  blocked?: string;
  /** `contact:<id>`, `deal:<id>` or `event:<id>` — only tasks linked to that record. */
  linkedTo?: string;
  /** 'shared' = only rows this user does not own, 'owned' = only rows they own. */
  ownership?: string;
  sortBy?: string;
  sortOrder?: string;
  page?: string;
  limit?: string;
}

// Whitelist of sortable Task columns. `sortBy` comes straight off the query
// string and is used as a Prisma orderBy key, so it must never be trusted raw.
// `position` is here because the Kanban board sorts by it.
/**
 * Upper bound on the grouped view. It is not pagination — the view is a
 * distribution and a truncated group misleads — but an unbounded findMany over
 * a table that could grow is worse. The response flags when it bites.
 */
/** How the By Company view orders its groups. */
export type TaskGroupSort = 'urgency' | 'company' | 'taskCount';

export const TASK_GROUP_SORTS: readonly TaskGroupSort[] = ['urgency', 'company', 'taskCount'];

interface TaskGroupQueryParams {
  search?: string;
  status?: string;
  priority?: string;
  labelId?: string;
  /** Completed tasks are excluded by default; this brings them back. */
  includeCompleted?: boolean;
  /** Defaults to 'urgency' — see the comparator in findGroupedByCompany. */
  sort?: TaskGroupSort;
}

const TASKS_BY_COMPANY_CAP = 1000;



const TASK_SORT_FIELDS = ['title', 'status', 'priority', 'dueDate', 'position', 'createdAt', 'updatedAt'] as const;

/**
 * A task may only ever point at rows owned by the same account.
 *
 * `customerId` and `labelIds` arrive in the request body and are plain foreign
 * keys into user-scoped tables, so the database accepts another account's id
 * without complaint. The cost is not just a malformed row: `create`/`update`
 * include `customer` and `labels` in what they return, so the response echoes
 * another account's company record — notes and all — back to the caller.
 *
 * `ownerId` is the owner of the task being written, not the caller: a user a
 * task was shared with or assigned must not be able to attach their own
 * company to someone else's task either.
 */
async function assertReferencesOwnedBy(
  ownerId: string,
  data: { customerId?: string | null; labelIds?: string[] }
) {
  if (data.customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: data.customerId, userId: ownerId },
      select: { id: true },
    });
    if (!customer) {
      throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }
  }
  if (data.labelIds && data.labelIds.length > 0) {
    const ids = [...new Set(data.labelIds)];
    const owned = await prisma.label.count({ where: { id: { in: ids }, userId: ownerId } });
    if (owned !== ids.length) {
      throw new AppError(404, 'LABEL_NOT_FOUND', 'Label not found');
    }
  }
}

/**
 * What every task row carries besides its own columns.
 *
 * `parent` is the one-line breadcrumb a subtask shows in a list; `checklist`
 * is selected as bare flags so the counts can be derived without a second
 * query. Subtask counts cannot come from an include — "done" depends on the
 * account's terminal statuses — so `withSubtaskProgress` adds them afterwards.
 */
const TASK_INCLUDE = {
  labels: { include: { label: true } },
  customer: true,
  parent: { select: { id: true, title: true } },
  checklist: { select: { isDone: true } },
} as const;

/**
 * The two-level rule, checked before a task is attached to a parent.
 *
 * A parent must be owned by the same account as the task (a foreign key alone
 * accepts any account's id, and `findById` would then echo another account's
 * title back through `parent`), must not be a subtask itself, and — when the
 * task being moved already has subtasks — the move is refused, because it
 * would make three levels. Self-parenting is caught before any of that.
 */
async function assertParentAllowed(ownerId: string, taskId: string | null, parentId: string) {
  if (taskId && taskId === parentId) {
    throw new AppError(400, 'INVALID_PARENT', 'A task cannot be its own subtask');
  }
  const parent = await prisma.task.findFirst({
    where: { id: parentId, userId: ownerId },
    select: { id: true, parentId: true, customerId: true },
  });
  if (!parent) {
    throw new AppError(404, 'TASK_NOT_FOUND', 'Parent task not found');
  }
  if (parent.parentId) {
    throw new AppError(400, 'INVALID_PARENT', 'A subtask cannot have subtasks of its own');
  }
  if (taskId) {
    const children = await prisma.task.count({ where: { parentId: taskId } });
    if (children > 0) {
      throw new AppError(400, 'INVALID_PARENT', 'A task with subtasks cannot become a subtask');
    }
  }
  return parent;
}

interface RelationCounts {
  subtaskCount: number;
  subtaskDoneCount: number;
  /** Tasks this one waits on. */
  blockedByCount: number;
  /** Of those, the ones not yet in a terminal status — what "blocked" means. */
  openBlockerCount: number;
  /** Tasks waiting on this one. */
  blocksCount: number;
  /** Contacts, deals and events this task is attached to. */
  linkCount: number;
  /** Minutes logged against this task, finished entries only. */
  trackedMinutes: number;
}

/**
 * Attach the subtask and dependency counts to formatted tasks.
 *
 * Three queries for the whole page rather than several per row. "Done" is
 * whatever the CALLER's account calls terminal — the same choice
 * `findGroupedByCompany` makes for shared tasks, so a board and a list never
 * disagree about the same row.
 */
async function withSubtaskProgress<T extends { id: string; status?: string }>(userId: string, tasks: T[]): Promise<Array<T & RelationCounts>> {
  if (tasks.length === 0) return [];
  const ids = tasks.map((t) => t.id);
  const [children, blockers, blocks, links, time, terminal] = await Promise.all([
    prisma.task.findMany({
      where: { parentId: { in: ids } },
      select: { parentId: true, status: true },
    }),
    prisma.taskDependency.findMany({
      where: { blockedId: { in: ids } },
      select: { blockedId: true, blocker: { select: { status: true } } },
    }),
    prisma.taskDependency.groupBy({
      by: ['blockerId'],
      where: { blockerId: { in: ids } },
      _count: { blockedId: true },
    }),
    prisma.taskLink.groupBy({
      by: ['taskId'],
      where: { taskId: { in: ids } },
      _count: { entityId: true },
    }),
    prisma.taskTimeEntry.groupBy({
      by: ['taskId'],
      where: { taskId: { in: ids }, endedAt: { not: null } },
      _sum: { minutes: true },
    }),
    terminalStatusNames(userId),
  ]);

  const counts = new Map<string, RelationCounts>();
  const entry = (id: string) => {
    let c = counts.get(id);
    if (!c) {
      c = { subtaskCount: 0, subtaskDoneCount: 0, blockedByCount: 0, openBlockerCount: 0, blocksCount: 0, linkCount: 0, trackedMinutes: 0 };
      counts.set(id, c);
    }
    return c;
  };
  for (const child of children) {
    const c = entry(child.parentId!);
    c.subtaskCount += 1;
    if (isTerminalStatus(child.status, terminal)) c.subtaskDoneCount += 1;
  }
  for (const dep of blockers) {
    const c = entry(dep.blockedId);
    c.blockedByCount += 1;
    if (!isTerminalStatus(dep.blocker.status, terminal)) c.openBlockerCount += 1;
  }
  for (const row of blocks) {
    entry(row.blockerId).blocksCount = row._count.blockedId;
  }
  for (const row of links) {
    entry(row.taskId).linkCount = row._count.entityId;
  }
  for (const row of time) {
    entry(row.taskId).trackedMinutes = row._sum.minutes ?? 0;
  }
  return tasks.map((t) => {
    const c = counts.get(t.id) ?? { subtaskCount: 0, subtaskDoneCount: 0, blockedByCount: 0, openBlockerCount: 0, blocksCount: 0, linkCount: 0, trackedMinutes: 0 };
    // A finished task is not blocked, whatever its blockers are doing:
    // "blocked" means "cannot be finished", and this one already is.
    const finished = t.status !== undefined && isTerminalStatus(t.status, terminal);
    return { ...t, ...c, openBlockerCount: finished ? 0 : c.openBlockerCount };
  });
}

/** The shape a dependency's other end takes in a task's detail. */
const DEPENDENCY_END = { select: { id: true, title: true, status: true } } as const;

/**
 * The rules for "blocker must finish before blocked", checked before the row
 * is written. The foreign keys accept any two task ids, so all of it lives
 * here: no self-dependency, the blocker must be owned by the same account as
 * the blocked task (a share is not ownership, and `findById` would otherwise
 * echo another account's title through `blockedBy`), and the graph must stay
 * acyclic — a cycle is a set of tasks none of which can ever be finished.
 */
async function assertDependencyAllowed(ownerId: string, blockedId: string, blockerId: string) {
  if (blockedId === blockerId) {
    throw new AppError(400, 'INVALID_DEPENDENCY', 'A task cannot block itself');
  }
  const blocker = await prisma.task.findFirst({
    where: { id: blockerId, userId: ownerId },
    select: { id: true, title: true },
  });
  if (!blocker) {
    throw new AppError(404, 'TASK_NOT_FOUND', 'Blocker task not found');
  }
  // Would the blocker, through what IT waits on, reach the blocked task?
  // Then blocked → … → blocker → blocked is a loop. Breadth-first over the
  // "is blocked by" edges, bounded so a pathological graph cannot spin.
  const seen = new Set<string>([blockerId]);
  let frontier = [blockerId];
  let hops = 0;
  while (frontier.length > 0 && hops < 50) {
    const edges = await prisma.taskDependency.findMany({
      where: { blockedId: { in: frontier } },
      select: { blockerId: true },
    });
    frontier = [];
    for (const e of edges) {
      if (e.blockerId === blockedId) {
        throw new AppError(400, 'INVALID_DEPENDENCY', 'That would create a cycle: the blocker already depends on this task');
      }
      if (!seen.has(e.blockerId)) {
        seen.add(e.blockerId);
        frontier.push(e.blockerId);
      }
    }
    hops += 1;
  }
  return blocker;
}

/**
 * The blockers of a task that are not finished, by the owner's vocabulary.
 * Empty means the task may move to a terminal status.
 */
async function openBlockers(taskId: string, ownerId: string) {
  const terminal = await terminalStatusNames(ownerId);
  const rows = await prisma.taskDependency.findMany({
    where: { blockedId: taskId, blocker: notTerminal(terminal) },
    select: { blocker: { select: { id: true, title: true } } },
  });
  return rows.map((r) => r.blocker);
}

function blockedError(blockers: Array<{ id: string; title: string }>) {
  const n = blockers.length;
  return new AppError(
    409,
    'TASK_BLOCKED',
    `Blocked by ${n} unfinished ${n === 1 ? 'task' : 'tasks'}: ${blockers.map((b) => b.title).join(', ')}`,
    { blockers }
  );
}

export const taskService = {
  async findAll(userId: string, query: TaskQueryParams) {
    const pagination = parsePagination(query);

    // Include shared + assigned tasks
    const sharedTaskIds = await getSharedTaskIds(userId);
    const ownershipFilter: Prisma.TaskWhereInput = {
      OR: [
        { userId },
        ...(sharedTaskIds.length > 0 ? [{ id: { in: sharedTaskIds } }] : []),
        { assignedToId: userId },
      ],
    };
    // Ownership lives under `AND`, not at the top level, so that a filter
    // branch below can never overwrite it by assigning `where.OR`. That is
    // exactly how the cross-tenant leak in dealService.findAll happened.
    const andFilters: Prisma.TaskWhereInput[] = [ownershipFilter];
    const where: Prisma.TaskWhereInput = { AND: andFilters };

    if (query.status) {
      where.status = query.status;
    }
    if (query.statusNot) {
      where.status = { not: query.statusNot };
    }
    if (query.priority) {
      where.priority = query.priority as Prisma.EnumTaskPriorityFilter;
    }
    if (query.search) {
      /**
       * Search title, description and company name.
       *
       * Title alone meant searching a company you deal with returned nothing,
       * even though every task carries a company — which is the most obvious
       * thing to type.
       *
       * Pushed onto `andFilters` rather than assigned to `where.OR`. Both are
       * correct today, because ownership already lives under `AND` — but a
       * top-level `where.OR` is one careless edit away from being the thing
       * that overwrites it, which is exactly how the cross-tenant leak in
       * dealService.findAll happened. Keeping every OR inside the AND array
       * removes the possibility rather than relying on the next person noticing.
       */
      andFilters.push({
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
          { customer: { name: { contains: query.search, mode: 'insensitive' } } },
        ],
      });
    }
    if (query.labelId) {
      where.labels = { some: { labelId: query.labelId } };
    }
    if (query.customerId) {
      where.customerId = query.customerId;
    }
    if (query.parentId) {
      where.parentId = query.parentId;
    } else if (query.topLevel === 'true') {
      where.parentId = null;
    }
    if (query.linkedTo) {
      const [entityType, entityId] = query.linkedTo.split(':', 2);
      if ((TASK_LINK_TYPES as readonly string[]).includes(entityType) && entityId) {
        where.links = { some: { entityType, entityId } };
      } else {
        // A malformed filter matches nothing rather than everything.
        where.links = { some: { entityType: '__none__' } };
      }
    }
    if (query.blocked === 'true' || query.blocked === 'false') {
      // "Blocked" is relative to what this account calls finished.
      const open = { blocker: notTerminal(await terminalStatusNames(userId)) };
      where.blockedBy = query.blocked === 'true' ? { some: open } : { none: open };
    }
    if (query.dueBefore || query.dueAfter) {
      where.dueDate = {};
      if (query.dueBefore) where.dueDate.lte = new Date(query.dueBefore);
      if (query.dueAfter) where.dueDate.gte = new Date(query.dueAfter);
    }
    // "Shared with me" / "Owned by me" narrowing. This only ever restricts the
    // access-controlled OR above — it never widens what the user can see.
    if (query.ownership === 'shared') {
      where.userId = { not: userId };
    } else if (query.ownership === 'owned') {
      where.userId = userId;
    }

    const requestedSort = query.sortBy || 'createdAt';
    const sortBy = (TASK_SORT_FIELDS as readonly string[]).includes(requestedSort)
      ? requestedSort
      : 'createdAt';
    const sortOrder: Prisma.SortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';
    const orderBy: Prisma.TaskOrderByWithRelationInput[] = [
      { [sortBy]: sortOrder },
      { id: 'asc' },
    ];
    /**
     * `id` is the tiebreaker, and it is not optional.
     *
     * Every page is a separate `LIMIT`/`OFFSET` query. When rows tie on the sort
     * column, Postgres is free to return them in a different order each time — so
     * a row can appear on page 1 and again on page 3 while another is never
     * reachable at all. On this data that is not a corner case: 3,499 of 11,694
     * contacts share an empty surname, one tie group about 175 pages deep.
     */

    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        orderBy,
        skip: pagination.skip,
        take: pagination.limit,
        include: TASK_INCLUDE,
      }),
      prisma.task.count({ where }),
    ]);

    return {
      data: await withSubtaskProgress(userId, tasks.map(formatTask)),
      meta: paginationMeta(total, pagination),
    };
  },

  async findById(userId: string, id: string) {
    const hasAccess = await canAccessTask(id, userId);
    if (!hasAccess) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        ...TASK_INCLUDE,
        // The full items here, not the bare flags the list rows carry.
        checklist: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
        subtasks: {
          include: { labels: { include: { label: true } }, customer: true, checklist: { select: { isDone: true } } },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        },
        blockedBy: { select: { blocker: DEPENDENCY_END }, orderBy: { createdAt: 'asc' } },
        blocks: { select: { blocked: DEPENDENCY_END }, orderBy: { createdAt: 'asc' } },
        recurrenceNext: { select: { id: true, title: true, dueDate: true, status: true } },
        recurrencePrevious: { select: { id: true, title: true, dueDate: true } },
        links: { orderBy: { createdAt: 'asc' } },
        timeEntries: {
          include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
          take: 100,
        },
        emailLinks: {
          include: {
            email: {
              select: { id: true, subject: true, from: true, fromName: true, threadId: true, receivedAt: true, isArchived: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!task) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    const { blockedBy, blocks, links, timeEntries, ...row } = task;
    const [decorated] = await withSubtaskProgress(userId, [formatTask(row)]);
    return {
      ...decorated,
      subtasks: await withSubtaskProgress(userId, task.subtasks.map(formatTask)),
      blockedBy: blockedBy.map((d) => d.blocker),
      blocks: blocks.map((d) => d.blocked),
      links: await resolveLinks(task.userId, links),
      timeEntries,
      // The caller's own running timer on this task, if any. Another
      // person's running entry is in the list, but it is not this caller's
      // to stop.
      runningEntry: timeEntries.find((e) => e.endedAt === null && e.userId === userId) ?? null,
    };
  },

  /**
   * Every task the caller can reach, grouped by the company it belongs to.
   *
   * Tasks acquire a company automatically: `emailService.convertToTask` copies
   * `email.customerId` across, and emails are filed against a company by sender
   * domain. So this grouping reflects work that already exists rather than
   * asking anyone to categorise anything — in production all 40 tasks are
   * linked, across 22 companies.
   *
   * Two things this deliberately does NOT do:
   *
   *  - It does not paginate. A grouped overview whose groups are cut off at an
   *    arbitrary row is worse than no overview, and the whole point is seeing
   *    the distribution. It is bounded instead by TASKS_BY_COMPANY_CAP, and the
   *    response says whether it hit that so the UI can say so too.
   *  - It does not drop company-less tasks. They come back in a trailing group
   *    with a null customer, because a "by company" view that silently hides
   *    work is a worse bug than one that shows an awkward bucket.
   */
  async findGroupedByCompany(userId: string, query: TaskGroupQueryParams = {}) {
    const sharedTaskIds = await getSharedTaskIds(userId);
    // Read once: both the "hide completed" filter and the per-group overdue
    // count need it, and it is the same answer for the whole request.
    const terminal = await terminalStatusNames(userId);

    // Same shape as findAll: ownership under AND so no filter branch can
    // overwrite it, and every OR added below goes inside that array.
    const andFilters: Prisma.TaskWhereInput[] = [
      {
        OR: [
          { userId },
          ...(sharedTaskIds.length > 0 ? [{ id: { in: sharedTaskIds } }] : []),
          { assignedToId: userId },
        ],
      },
    ];

    if (query.status) andFilters.push({ status: query.status });
    if (query.priority) {
      andFilters.push({ priority: query.priority as Prisma.EnumTaskPriorityFilter });
    }
    if (query.labelId) andFilters.push({ labels: { some: { labelId: query.labelId } } });
    if (query.search) {
      andFilters.push({
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
          { customer: { name: { contains: query.search, mode: 'insensitive' } } },
        ],
      });
    }

    /**
     * Completed work is hidden unless asked for.
     *
     * The counts in this view read as workload — "Powerm: 7 tasks" is a
     * statement about what is outstanding. Counting finished tasks in that
     * total turns it into history and makes the number useless for deciding
     * where to look. An explicit status filter wins, because asking for DONE
     * and getting nothing would be absurd.
     */
    if (!query.status && !query.includeCompleted) {
      // Whatever THIS account calls finished, not the literal name DONE.
      andFilters.push(notTerminal(terminal));
    }

    const tasks = await prisma.task.findMany({
      where: { AND: andFilters },
      include: {
        customer: { select: { id: true, name: true, domain: true, logoUrl: true } },
        labels: { include: { label: true } },
        parent: { select: { id: true, title: true } },
        checklist: { select: { isDone: true } },
        assignedTo: { select: { id: true, name: true, email: true, avatarUrl: true } },
        /**
         * The email this task was made from, if any.
         *
         * Most tasks here have one — they are created from mail — and the row
         * is far more identifiable with "from Ilham Bennani, 24 Aug" on it than
         * with a title alone. `threadId` is what makes "Open email" able to go
         * anywhere; without it the link would have nothing to navigate to.
         */
        emailLinks: {
          select: {
            id: true,
            conversionNote: true,
            createdAt: true,
            email: {
              select: {
                id: true,
                subject: true,
                from: true,
                fromName: true,
                threadId: true,
                receivedAt: true,
                isArchived: true,
              },
            },
          },
          orderBy: { createdAt: 'asc' },
          // The row shows the first one; the panel shows them all.
          take: 1,
        },
      },
      // Deterministic within a group: soonest due first, undated last, then a
      // stable id tiebreaker so the order does not shuffle between loads.
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      take: TASKS_BY_COMPANY_CAP + 1,
    });

    const truncated = tasks.length > TASKS_BY_COMPANY_CAP;
    const visible = truncated ? tasks.slice(0, TASKS_BY_COMPANY_CAP) : tasks;
    const progress = new Map(
      (await withSubtaskProgress(userId, visible.map((t) => ({ id: t.id })))).map((p) => [p.id, p])
    );

    const now = new Date();
    type Group = {
      customer: { id: string; name: string; domain: string | null; logoUrl: string | null } | null;
      tasks: typeof visible;
      overdueCount: number;
      /** Soonest upcoming due date among unfinished tasks; null if none. */
      nextDueAt: Date | null;
    };
    const groups = new Map<string, Group>();

    let overdueTasks = 0;
    let urgentTasks = 0;

    for (const task of visible) {
      // '' is the bucket for tasks with no company — a real key, so the group
      // survives into the output rather than being dropped by a falsy check.
      const key = task.customerId ?? '';
      let group = groups.get(key);
      if (!group) {
        group = { customer: task.customer ?? null, tasks: [], overdueCount: 0, nextDueAt: null };
        groups.set(key, group);
      }
      group.tasks.push(task);

      const unfinished = !isTerminalStatus(task.status, terminal);
      // "Overdue" excludes finished work — a completed task that happens to sit
      // past its due date is not something anyone needs chasing.
      if (task.dueDate && task.dueDate < now && unfinished) {
        group.overdueCount += 1;
        overdueTasks += 1;
      }
      /**
       * What a collapsed company row shows when nothing is overdue.
       *
       * Only unfinished work, and only the future: the soonest thing still
       * ahead is the useful summary. A past date belongs to the overdue count,
       * and a finished task's due date says nothing about what is left.
       */
      if (task.dueDate && task.dueDate >= now && unfinished) {
        if (!group.nextDueAt || task.dueDate < group.nextDueAt) group.nextDueAt = task.dueDate;
      }
      if (task.priority === 'URGENT' && unfinished) urgentTasks += 1;
    }

    const byName = (
      a: { customer: { name: string } | null },
      b: { customer: { name: string } | null }
    ) => (a.customer?.name ?? '').localeCompare(b.customer?.name ?? '');

    /**
     * Group order.
     *
     * `urgency` is the default and the only one that is not obvious: companies
     * with overdue work first, then the busiest, then alphabetical. It answers
     * "where should I look first" rather than "where is X", which is what the
     * other two are for.
     */
    const comparators: Record<TaskGroupSort, (a: Group, b: Group) => number> = {
      urgency: (a, b) => {
        const overdue = (b.overdueCount > 0 ? 1 : 0) - (a.overdueCount > 0 ? 1 : 0);
        if (overdue !== 0) return overdue;
        if (b.tasks.length !== a.tasks.length) return b.tasks.length - a.tasks.length;
        return byName(a, b);
      },
      company: byName,
      taskCount: (a, b) =>
        b.tasks.length !== a.tasks.length ? b.tasks.length - a.tasks.length : byName(a, b),
    };

    const compare = comparators[query.sort ?? 'urgency'] ?? comparators.urgency;
    const ordered = [...groups.values()].sort((a, b) => {
      // The unassigned bucket always trails, whatever the sort and however big
      // it is — it is not a company, so it does not compete with them.
      if (a.customer === null) return 1;
      if (b.customer === null) return -1;
      return compare(a, b);
    });

    return {
      data: ordered.map((g) => ({
        customer: g.customer,
        taskCount: g.tasks.length,
        overdueCount: g.overdueCount,
        nextDueAt: g.nextDueAt,
        /**
         * Through `formatTask`, like every other endpoint that returns tasks.
         *
         * Prisma returns a many-to-many `include` as the JOIN rows — each one
         * `{ taskId, labelId, label: {...} }` — while the client's `Task` type
         * says `Label[]` and `LabelTag` reads `.color` off each element and
         * calls `.replace` on it. A join row therefore does not render the
         * wrong colour, it throws.
         *
         * This endpoint was the only one that skipped the mapping, and nothing
         * caught it because no account has ever had a label. Seeding a starter
         * set is precisely what would have surfaced it.
         */
        tasks: g.tasks.map((t) => ({ ...formatTask(t), ...progress.get(t.id) })),
      })),
      meta: {
        totalTasks: visible.length,
        companies: ordered.filter((g) => g.customer).length,
        truncated,
        // Drive the filter chips above the list. Counted over what is actually
        // returned, so they agree with what the user can see.
        overdueTasks,
        urgentTasks,
      },
    };
  },

  /**
   * What to do today: the four buckets a person opens the app to see.
   *
   * Overdue and due today by the due date; starting today by the start date;
   * and the coming week for a look ahead. Day boundaries are computed in the
   * user's own timezone, as the dashboard's are — "today" at UTC midnight is
   * 2am in Paris and still yesterday in California. Finished work is excluded
   * everywhere, and a task appears in one bucket only, the most urgent.
   */
  async findMyDay(userId: string) {
    const [sharedTaskIds, terminal, user] = await Promise.all([
      getSharedTaskIds(userId),
      terminalStatusNames(userId),
      prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
    ]);
    const tz = resolveTimeZone(user?.timezone);
    const now = new Date();
    const startOfToday = startOfDayInZone(now, tz);
    const endOfToday = addDaysInZone(startOfToday, 1, tz);
    const endOfWeekAhead = addDaysInZone(startOfToday, 8, tz);

    const reachable: Prisma.TaskWhereInput = {
      AND: [
        {
          OR: [
            { userId },
            ...(sharedTaskIds.length > 0 ? [{ id: { in: sharedTaskIds } }] : []),
            { assignedToId: userId },
          ],
        },
        notTerminal(terminal),
      ],
    };

    const rows = await prisma.task.findMany({
      where: {
        ...reachable,
        OR: [
          { dueDate: { lt: endOfWeekAhead } },
          { startDate: { gte: startOfToday, lt: endOfToday } },
        ],
      },
      include: TASK_INCLUDE,
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { priority: 'desc' }, { id: 'asc' }],
      take: 500,
    });

    const tasks = await withSubtaskProgress(userId, rows.map(formatTask));
    const overdue: typeof tasks = [];
    const dueToday: typeof tasks = [];
    const startingToday: typeof tasks = [];
    const upcoming: typeof tasks = [];
    for (const t of tasks) {
      const due = t.dueDate as Date | null;
      const start = t.startDate as Date | null;
      if (due && due < startOfToday) overdue.push(t);
      else if (due && due < endOfToday) dueToday.push(t);
      else if (start && start >= startOfToday && start < endOfToday) startingToday.push(t);
      else if (due && due < endOfWeekAhead) upcoming.push(t);
    }

    return {
      data: { overdue, dueToday, startingToday, upcoming },
      meta: { timezone: tz, today: startOfToday, total: overdue.length + dueToday.length + startingToday.length },
    };
  },

  async getSummary(userId: string) {
    const now = new Date();

    // Include shared + assigned tasks in summary
    const sharedTaskIds = await getSharedTaskIds(userId);
    const summaryWhere: Prisma.TaskWhereInput = {
      OR: [
        { userId },
        ...(sharedTaskIds.length > 0 ? [{ id: { in: sharedTaskIds } }] : []),
        { assignedToId: userId },
      ],
    };

    const terminalNames = await terminalStatusNames(userId);
    const [total, completed, overdue, byPriority] = await Promise.all([
      prisma.task.count({ where: summaryWhere }),
      prisma.task.count({ where: { ...summaryWhere, status: { in: terminalNames } } }),
      prisma.task.count({
        where: {
          ...summaryWhere,
          ...notTerminal(terminalNames),
          dueDate: { lt: now },
        },
      }),
      prisma.task.groupBy({
        by: ['priority'],
        where: summaryWhere,
        _count: { priority: true },
      }),
    ]);

    const priorityMap: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, URGENT: 0 };
    byPriority.forEach((p) => {
      priorityMap[p.priority] = p._count.priority;
    });

    return {
      total,
      completed,
      overdue,
      inProgress: total - completed,
      byPriority: priorityMap,
    };
  },

  async create(userId: string, data: CreateTaskInput) {
    await assertReferencesOwnedBy(userId, data);
    const { labelIds, assignedToId, parentId, ...taskData } = data;
    let { customerId } = data;

    if (taskData.recurrence && !taskData.dueDate) {
      throw new AppError(400, 'RECURRENCE_NEEDS_DUE_DATE', 'A repeating task needs a due date to repeat from');
    }
    assertDatesInOrder(taskData.startDate ?? null, taskData.dueDate ?? null);

    if (parentId) {
      const parent = await assertParentAllowed(userId, null, parentId);
      // A subtask belongs to its parent's company unless told otherwise. It is
      // the same work, and a subtask filed under "no company" would drop out
      // of every per-company view its parent appears in.
      if (customerId === undefined) customerId = parent.customerId;
    }

    // Get max position for the status column
    const maxPos = await prisma.task.findFirst({
      where: { userId, status: taskData.status || 'TODO' },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const position = (maxPos?.position ?? 0) + 1000;

    const task = await prisma.task.create({
      data: {
        ...taskData,
        userId,
        dueDate: taskData.dueDate ? new Date(taskData.dueDate) : null,
        startDate: taskData.startDate ? new Date(taskData.startDate) : null,
        remindAt: taskData.remindAt ? new Date(taskData.remindAt) : null,
        description: taskData.description || null,
        position,
        customerId: customerId || null,
        assignedToId: assignedToId || null,
        parentId: parentId || null,
        labels: labelIds?.length
          ? { create: labelIds.map((labelId) => ({ labelId })) }
          : undefined,
      } as any,
      include: TASK_INCLUDE,
    });

    auditService.log({ userId, action: 'TASK_CREATED', entityType: 'task', entityId: task.id, details: { title: data.title, status: data.status, priority: data.priority, parentId: parentId ?? undefined } });

    const [created] = await withSubtaskProgress(userId, [formatTask(task)]);
    return created;
  },

  async update(userId: string, id: string, data: UpdateTaskInput) {
    const hasAccess = await canAccessTask(id, userId);
    if (!hasAccess) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    const existing = await prisma.task.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    await assertReferencesOwnedBy(existing.userId, data);

    /**
     * Reassigning through a PATCH needs ownership, exactly as `assignTask` does.
     *
     * This route is the other half of the same escalation. `assignTask` was
     * tightened to `isTaskOwner`, but `updateTaskSchema` also carries
     * `assignedToId` and `update` gates on `canAccessTask` — which a share or an
     * existing assignment satisfies. So the door closed on
     * `PATCH /tasks/:id/assign` was still open on `PATCH /tasks/:id`, and a
     * share recipient could still hand a third account standing access the
     * owner never granted.
     *
     * Editing a shared task's title or status stays allowed — that is what
     * sharing is for. Only the field that grants other people access is
     * restricted to the owner.
     */
    if (data.assignedToId !== undefined && data.assignedToId !== existing.assignedToId) {
      const owner = await isTaskOwner(id, userId);
      if (!owner) {
        throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
      }
      if (data.assignedToId) {
        const assignee = await prisma.user.findUnique({
          where: { id: data.assignedToId },
          select: { id: true },
        });
        if (!assignee) {
          throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
        }
      }
    }

    const { labelIds, customerId, parentId, force, ...taskData } = data;

    // The rule needs a date to advance from — whichever of the two this PATCH
    // leaves in place.
    const nextRecurrence = taskData.recurrence !== undefined ? taskData.recurrence : existing.recurrence;
    const nextDueDate = taskData.dueDate !== undefined ? taskData.dueDate : existing.dueDate;
    if (nextRecurrence && !nextDueDate) {
      throw new AppError(400, 'RECURRENCE_NEEDS_DUE_DATE', 'A repeating task needs a due date to repeat from');
    }
    const nextStart = taskData.startDate !== undefined ? taskData.startDate : existing.startDate?.toISOString() ?? null;
    assertDatesInOrder(nextStart, typeof nextDueDate === 'string' ? nextDueDate : nextDueDate?.toISOString() ?? null);

    /**
     * The dependency gate. Moving to a terminal status while a blocker is
     * unfinished is refused with a 409 that names the blockers, unless the
     * caller says `force` — which the UI offers as an explicit "complete
     * anyway", and which is recorded on the audit row.
     */
    let forced = false;
    if (taskData.status !== undefined && taskData.status !== existing.status) {
      const terminal = await terminalStatusNames(existing.userId);
      if (isTerminalStatus(taskData.status, terminal)) {
        const open = await openBlockers(id, existing.userId);
        if (open.length > 0) {
          if (!force) throw blockedError(open);
          forced = true;
        }
      }
    }

    const updateData: any = {
      ...taskData,
    };

    if (parentId !== undefined && parentId !== existing.parentId) {
      if (parentId) await assertParentAllowed(existing.userId, id, parentId);
      updateData.parentId = parentId;
    }

    if (taskData.dueDate !== undefined) {
      updateData.dueDate = taskData.dueDate ? new Date(taskData.dueDate) : null;
    }
    if (taskData.startDate !== undefined) {
      updateData.startDate = taskData.startDate ? new Date(taskData.startDate) : null;
    }
    if (taskData.remindAt !== undefined) {
      updateData.remindAt = taskData.remindAt ? new Date(taskData.remindAt) : null;
      // A new time is a new reminder; one that already fired must fire again.
      updateData.reminderSentAt = null;
    }

    if (customerId !== undefined) {
      updateData.customerId = customerId || null;
    }

    /**
     * One empty representation, not two.
     *
     * The column is nullable and every other writer stores NULL for "no
     * description", but the edit form clears by sending '' — so without this
     * the table would hold both, indistinguishable to every reader and
     * unrepairable by a later edit (the form's diff baseline trims, so a NULL
     * row and an '' row look identical to it).
     */
    if (taskData.description !== undefined) {
      updateData.description = taskData.description || null;
    }

    /**
     * One transaction, as `reorder` below already does.
     *
     * These were three separate statements, so anything that failed after the
     * `deleteMany` left the task with no labels at all — the destructive half
     * committed and the restoring half not. A duplicate id in `labelIds` did
     * exactly that: `createMany` raised P2002, which `errorHandler` does not
     * map, so the caller got a 500 and the labels were already gone.
     *
     * `skipDuplicates` removes that trigger, and the transaction removes the
     * consequence for every other one.
     */
    const task = await prisma.$transaction(async (tx) => {
      if (labelIds !== undefined) {
        await tx.taskLabel.deleteMany({ where: { taskId: id } });
        if (labelIds.length > 0) {
          await tx.taskLabel.createMany({
            data: labelIds.map((labelId) => ({ taskId: id, labelId })),
            skipDuplicates: true,
          });
        }
      }

      return tx.task.update({
        // The ownership filter belongs in the `where`, not only in the
        // `canAccessTask` check above — it closes the window between that read
        // and this write. `existing.userId` rather than `userId`: a share
        // recipient may edit, and the row is still the owner's.
        where: { id, userId: existing.userId },
        data: updateData,
        include: TASK_INCLUDE,
      });
    });

    auditService.log({
      userId,
      action: 'TASK_UPDATED',
      entityType: 'task',
      entityId: id,
      details: { ...describeTaskChanges(existing, task, data), ...(forced ? { forced: true } : {}) },
    });

    if (taskData.status !== undefined && taskData.status !== existing.status) {
      await spawnNextOccurrences(userId, [id]);
    }

    const [updated] = await withSubtaskProgress(userId, [formatTask(task)]);
    return updated;
  },

  async reorder(userId: string, data: ReorderInput) {
    // Checked up front so an id the caller does not own — a stale board, or
    // another account's task — is a 404. The per-row `update` below still
    // carries `userId`, but on its own it raises an unhandled P2025 that the
    // error handler can only turn into a 500.
    const ids = [...new Set(data.items.map((item) => item.id))];
    if (ids.length > 0) {
      const owned = await prisma.task.count({ where: { id: { in: ids }, userId } });
      if (owned !== ids.length) {
        throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
      }
    }
    /**
     * Same gate as `update`, for a drag into a finished column. There is no
     * `force` on a drag — the board rolls back and says why, and finishing
     * a blocked task deliberately is done from its panel.
     */
    const terminal = await terminalStatusNames(userId);
    const finishing = data.items.filter((item) => isTerminalStatus(item.status, terminal)).map((item) => item.id);
    if (finishing.length > 0) {
      const blocked = await prisma.taskDependency.findMany({
        where: {
          blockedId: { in: finishing },
          blocked: notTerminal(terminal),
          blocker: notTerminal(terminal),
        },
        select: { blocker: { select: { id: true, title: true } } },
      });
      if (blocked.length > 0) throw blockedError(blocked.map((b) => b.blocker));
    }

    const operations = data.items.map((item) =>
      prisma.task.update({
        where: { id: item.id, userId },
        data: { status: item.status, position: item.position },
      })
    );
    await prisma.$transaction(operations);
    if (finishing.length > 0) await spawnNextOccurrences(userId, finishing);
    return { success: true };
  },

  async delete(userId: string, id: string) {
    const owner = await isTaskOwner(id, userId);
    if (!owner) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    const existing = await prisma.task.findUnique({
      where: { id },
      select: { title: true, _count: { select: { subtasks: true } } },
    });
    // Subtasks go with the parent (ON DELETE CASCADE); recorded so the audit
    // trail says how many, since the rows themselves leave no trace.
    await prisma.task.delete({ where: { id } });
    auditService.log({
      userId,
      action: 'TASK_DELETED',
      entityType: 'task',
      entityId: id,
      details: { title: existing?.title, subtasksDeleted: existing?._count.subtasks ?? 0 },
    });
    return { success: true };
  },

  async shareTask(userId: string, taskId: string, recipientUserIds: string[]) {
    const owner = await isTaskOwner(taskId, userId);
    if (!owner) throw Object.assign(new Error('Task not found'), { status: 404 });

    const validIds = recipientUserIds.filter(id => id !== userId);
    if (validIds.length === 0) throw Object.assign(new Error('Cannot share with yourself'), { status: 400 });

    await prisma.taskShare.createMany({
      data: validIds.map(recipientId => ({
        taskId,
        sharedByUserId: userId,
        sharedWithUserId: recipientId,
      })),
      skipDuplicates: true,
    });

    // Get sharer's name for notification
    const [sharer, task] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
      prisma.task.findFirst({ where: { id: taskId }, select: { title: true } }),
    ]);

    wsEmitToUsers(validIds, 'task:shared', {
      taskId,
      sharedBy: { name: sharer?.name, email: sharer?.email },
      title: task?.title,
    });

    auditService.log({ userId, action: 'TASK_SHARED', entityType: 'task', entityId: taskId, details: { sharedWith: recipientUserIds } });

    for (const recipientUserId of validIds) {
      await notificationService.create(recipientUserId, {
        type: 'TASK_SHARED',
        title: `Task shared: ${task?.title}`,
        message: `shared a task with you`,
        entityType: 'task',
        entityId: taskId,
      });
    }

    return { success: true, sharedWith: validIds.length };
  },

  async unshareTask(userId: string, taskId: string, recipientUserId: string) {
    await prisma.taskShare.deleteMany({
      where: { taskId, sharedByUserId: userId, sharedWithUserId: recipientUserId },
    });
    return { success: true };
  },

  async getTaskShares(userId: string, taskId: string) {
    const owner = await isTaskOwner(taskId, userId);
    if (!owner) throw Object.assign(new Error('Task not found'), { status: 404 });

    const shares = await prisma.taskShare.findMany({
      where: { taskId, sharedByUserId: userId },
      include: { sharedWith: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return shares;
  },

  /**
   * Assignment is an owner-only power, not an access-level one.
   *
   * This used to gate on `canAccessTask`, which is satisfied by a share or by
   * being the current assignee — so anyone the owner shared a task with could
   * assign it onward to a third account. That grants standing access (the
   * assignee sees the task through `assignedToId` forever) to somebody the
   * owner never chose, and revoking the original share does not take it back.
   *
   * Every other privileged operation on a task already gates on ownership —
   * `shareTask`, `delete`, `reorder` — so this is the outlier being brought
   * into line, not a new restriction.
   */
  async assignTask(userId: string, taskId: string, assignedToId: string | null) {
    const isOwner = await isTaskOwner(taskId, userId);
    if (!isOwner) throw Object.assign(new Error('Task not found'), { status: 404 });

    // The assignee must be a real account. Without this the column becomes a
    // sink for any uuid the caller invents.
    if (assignedToId) {
      const assignee = await prisma.user.findUnique({
        where: { id: assignedToId },
        select: { id: true },
      });
      if (!assignee) throw Object.assign(new Error('User not found'), { status: 404 });
    }

    const before = await prisma.task.findUnique({ where: { id: taskId }, select: { assignedToId: true } });
    const task = await prisma.task.update({
      where: { id: taskId, userId },
      data: { assignedToId },
      include: TASK_INCLUDE,
    });

    // Notify the assignee if assigned to someone else
    if (assignedToId && assignedToId !== userId) {
      const assigner = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      });
      wsEmitToUser(assignedToId, 'task:assigned', {
        taskId,
        title: task.title,
        assignedBy: { name: assigner?.name, email: assigner?.email },
      });
    }

    auditService.log({
      userId,
      action: 'TASK_ASSIGNED',
      entityType: 'task',
      entityId: taskId,
      details: {
        assignedToId,
        // Names, so the task's timeline can read "assigned to Sam" without a
        // lookup against a user who may since have been deleted.
        from: { assignedTo: await userLabel(before?.assignedToId ?? null) },
        to: { assignedTo: await userLabel(assignedToId) },
      },
    });

    if (assignedToId && assignedToId !== userId) {
      await notificationService.create(assignedToId, {
        type: 'TASK_ASSIGNED',
        title: `Task assigned: ${task.title}`,
        message: `assigned a task to you`,
        entityType: 'task',
        entityId: taskId,
      });
    }

    const [assigned] = await withSubtaskProgress(userId, [formatTask(task)]);
    return assigned;
  },

  // ─── Batch actions ────────────────────────────────────────────────────────
  //
  // Each action applies to the ids it may and reports the rest with a reason,
  // rather than failing the whole batch on the first refusal: a selection of
  // twenty tasks with one blocked among them should finish nineteen. Access
  // rules are the single-task ones — a status change needs access, assigning
  // and deleting need ownership — applied per row.

  async batchStatus(userId: string, ids: string[], status: string) {
    const { reachable, skipped } = await partitionByAccess(userId, ids, 'access');
    const terminal = new Map<string, string[]>();
    const updated: string[] = [];
    for (const task of reachable) {
      if (task.status === status) {
        updated.push(task.id);
        continue;
      }
      let names = terminal.get(task.userId);
      if (!names) {
        names = await terminalStatusNames(task.userId);
        terminal.set(task.userId, names);
      }
      if (isTerminalStatus(status, names)) {
        const open = await openBlockers(task.id, task.userId);
        if (open.length > 0) {
          skipped.push({ id: task.id, reason: `Blocked by ${open.map((b) => b.title).join(', ')}` });
          continue;
        }
      }
      await prisma.task.update({ where: { id: task.id }, data: { status } });
      updated.push(task.id);
    }
    if (updated.length > 0) {
      await spawnNextOccurrences(userId, updated);
      auditService.log({ userId, action: 'TASK_BATCH_STATUS', entityType: 'task', details: { count: updated.length, status, skipped: skipped.length } });
    }
    return { updated: updated.length, skipped };
  },

  async batchAssign(userId: string, ids: string[], assignedToId: string | null) {
    if (assignedToId) {
      const assignee = await prisma.user.findUnique({ where: { id: assignedToId }, select: { id: true } });
      if (!assignee) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }
    const { reachable, skipped } = await partitionByAccess(userId, ids, 'owner');
    const owned = reachable.map((t) => t.id);
    if (owned.length > 0) {
      await prisma.task.updateMany({ where: { id: { in: owned }, userId }, data: { assignedToId } });
      auditService.log({ userId, action: 'TASK_BATCH_ASSIGNED', entityType: 'task', details: { count: owned.length, assignedToId, skipped: skipped.length } });
      if (assignedToId && assignedToId !== userId) {
        const assigner = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
        await notificationService.create(assignedToId, {
          type: 'TASK_ASSIGNED',
          title: `${owned.length} ${owned.length === 1 ? 'task' : 'tasks'} assigned to you`,
          message: `${assigner?.name || assigner?.email || 'Someone'} assigned ${owned.length} ${owned.length === 1 ? 'task' : 'tasks'} to you`,
          entityType: 'task',
          entityId: owned.length === 1 ? owned[0] : undefined,
        });
        wsEmitToUser(assignedToId, 'task:assigned', { taskIds: owned });
      }
    }
    return { updated: owned.length, skipped };
  },

  async batchLabel(userId: string, ids: string[], labelId: string) {
    const label = await prisma.label.findFirst({ where: { id: labelId, userId }, select: { id: true } });
    if (!label) throw new AppError(404, 'LABEL_NOT_FOUND', 'Label not found');
    // A label is the owner's; it can only go on the owner's tasks.
    const { reachable, skipped } = await partitionByAccess(userId, ids, 'owner');
    const owned = reachable.map((t) => t.id);
    if (owned.length > 0) {
      await prisma.taskLabel.createMany({ data: owned.map((taskId) => ({ taskId, labelId })), skipDuplicates: true });
      auditService.log({ userId, action: 'TASK_BATCH_LABELLED', entityType: 'task', details: { count: owned.length, labelId, skipped: skipped.length } });
    }
    return { updated: owned.length, skipped };
  },

  async batchDelete(userId: string, ids: string[]) {
    const { reachable, skipped } = await partitionByAccess(userId, ids, 'owner');
    const owned = reachable.map((t) => t.id);
    if (owned.length > 0) {
      await prisma.task.deleteMany({ where: { id: { in: owned }, userId } });
      auditService.log({ userId, action: 'TASK_BATCH_DELETED', entityType: 'task', details: { count: owned.length, skipped: skipped.length } });
    }
    return { updated: owned.length, skipped };
  },

  // ─── Saved views ──────────────────────────────────────────────────────────

  async listViews(userId: string) {
    return prisma.taskView.findMany({ where: { userId }, orderBy: [{ position: 'asc' }, { name: 'asc' }] });
  },

  async saveView(userId: string, data: SaveViewInput) {
    try {
      const last = await prisma.taskView.findFirst({ where: { userId }, orderBy: { position: 'desc' }, select: { position: true } });
      const view = await prisma.taskView.create({
        data: {
          userId,
          name: data.name,
          filters: data.filters as Prisma.InputJsonObject,
          sortBy: data.sortBy ?? 'createdAt',
          sortOrder: data.sortOrder ?? 'desc',
          position: (last?.position ?? 0) + 1000,
        },
      });
      auditService.log({ userId, action: 'TASK_VIEW_SAVED', entityType: 'task', entityId: view.id, details: { name: view.name } });
      return view;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(409, 'VIEW_NAME_TAKEN', 'A view with that name already exists');
      }
      throw err;
    }
  },

  async updateView(userId: string, id: string, data: UpdateViewInput) {
    const existing = await prisma.taskView.findFirst({ where: { id, userId } });
    if (!existing) throw new AppError(404, 'VIEW_NOT_FOUND', 'View not found');
    try {
      return await prisma.taskView.update({
        where: { id },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.filters !== undefined ? { filters: data.filters as Prisma.InputJsonObject } : {}),
          ...(data.sortBy !== undefined ? { sortBy: data.sortBy } : {}),
          ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(409, 'VIEW_NAME_TAKEN', 'A view with that name already exists');
      }
      throw err;
    }
  },

  async deleteView(userId: string, id: string) {
    const { count } = await prisma.taskView.deleteMany({ where: { id, userId } });
    if (count === 0) throw new AppError(404, 'VIEW_NOT_FOUND', 'View not found');
    auditService.log({ userId, action: 'TASK_VIEW_DELETED', entityType: 'task', entityId: id });
    return { success: true };
  },

  // ─── Time tracking ────────────────────────────────────────────────────────
  //
  // Access, not ownership: anyone who can open a task can log time on it —
  // that is what a shared task's time is for. A person has one running timer
  // at a time across all tasks; starting a second is refused and names the
  // first, rather than silently stopping it.

  async getRunningTimer(userId: string) {
    const entry = await prisma.taskTimeEntry.findFirst({
      where: { userId, endedAt: null },
      include: { task: { select: { id: true, title: true } } },
      orderBy: { startedAt: 'desc' },
    });
    return entry;
  },

  async startTimer(userId: string, taskId: string) {
    if (!(await canAccessTask(taskId, userId))) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    const running = await prisma.taskTimeEntry.findFirst({
      where: { userId, endedAt: null },
      include: { task: { select: { id: true, title: true } } },
    });
    if (running) {
      if (running.taskId === taskId) return running;
      throw new AppError(409, 'TIMER_RUNNING', `A timer is already running on “${running.task.title}”`, {
        taskId: running.taskId,
        title: running.task.title,
        startedAt: running.startedAt,
      });
    }
    return prisma.taskTimeEntry.create({ data: { taskId, userId, startedAt: new Date() } });
  },

  async stopTimer(userId: string, taskId: string) {
    if (!(await canAccessTask(taskId, userId))) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    const running = await prisma.taskTimeEntry.findFirst({ where: { userId, taskId, endedAt: null } });
    if (!running) {
      throw new AppError(404, 'TIMER_NOT_RUNNING', 'No timer is running on this task');
    }
    const endedAt = new Date();
    // At least one minute: a timer stopped after ten seconds still records
    // that work happened, and a zero would read as "nothing".
    const minutes = Math.max(1, Math.ceil((endedAt.getTime() - running.startedAt.getTime()) / 60_000));
    const entry = await prisma.taskTimeEntry.update({ where: { id: running.id }, data: { endedAt, minutes } });
    auditService.log({ userId, action: 'TASK_TIME_LOGGED', entityType: 'task', entityId: taskId, details: { minutes, entryId: entry.id, timer: true } });
    return entry;
  },

  async logTime(userId: string, taskId: string, input: LogTimeInput) {
    if (!(await canAccessTask(taskId, userId))) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    const endedAt = input.at ? new Date(input.at) : new Date();
    const startedAt = new Date(endedAt.getTime() - input.minutes * 60_000);
    const entry = await prisma.taskTimeEntry.create({
      data: { taskId, userId, startedAt, endedAt, minutes: input.minutes, note: input.note || null },
    });
    auditService.log({ userId, action: 'TASK_TIME_LOGGED', entityType: 'task', entityId: taskId, details: { minutes: input.minutes, entryId: entry.id, note: input.note ?? undefined } });
    return entry;
  },

  /** The person who logged it, or the task's owner. */
  async deleteTimeEntry(userId: string, taskId: string, entryId: string) {
    if (!(await canAccessTask(taskId, userId))) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    const entry = await prisma.taskTimeEntry.findFirst({ where: { id: entryId, taskId } });
    if (!entry || (entry.userId !== userId && !(await isTaskOwner(taskId, userId)))) {
      throw new AppError(404, 'TIME_ENTRY_NOT_FOUND', 'Time entry not found');
    }
    await prisma.taskTimeEntry.delete({ where: { id: entryId } });
    auditService.log({ userId, action: 'TASK_TIME_DELETED', entityType: 'task', entityId: taskId, details: { entryId, minutes: entry.minutes } });
    return { success: true };
  },

  // ─── Links ────────────────────────────────────────────────────────────────
  //
  // A task attached to a contact, a deal or an event. The target must belong
  // to the task's account: there is no foreign key on a polymorphic column,
  // and `findById` would otherwise resolve another account's record into the
  // response. Access to the task, not ownership, is enough to attach one.

  async addLink(userId: string, taskId: string, input: { entityType: TaskLinkType; entityId: string }) {
    if (!(await canAccessTask(taskId, userId))) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { userId: true } });
    const target = await resolveLinkTarget(task.userId, input.entityType, input.entityId);
    if (!target) {
      throw new AppError(404, 'LINK_TARGET_NOT_FOUND', `${input.entityType} not found`);
    }
    await prisma.taskLink.upsert({
      where: { taskId_entityType_entityId: { taskId, entityType: input.entityType, entityId: input.entityId } },
      create: { taskId, entityType: input.entityType, entityId: input.entityId },
      update: {},
    });
    auditService.log({ userId, action: 'TASK_LINK_ADDED', entityType: 'task', entityId: taskId, details: { linkType: input.entityType, linkId: input.entityId, label: target.label } });
    return this.findById(userId, taskId);
  },

  async removeLink(userId: string, taskId: string, entityType: string, entityId: string) {
    if (!(await canAccessTask(taskId, userId))) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    const { count } = await prisma.taskLink.deleteMany({ where: { taskId, entityType, entityId } });
    if (count === 0) {
      throw new AppError(404, 'LINK_NOT_FOUND', 'Link not found');
    }
    auditService.log({ userId, action: 'TASK_LINK_REMOVED', entityType: 'task', entityId: taskId, details: { linkType: entityType, linkId: entityId } });
    return this.findById(userId, taskId);
  },

  // ─── Dependencies ─────────────────────────────────────────────────────────

  async addDependency(userId: string, taskId: string, blockerId: string) {
    if (!(await canAccessTask(taskId, userId))) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { userId: true } });
    const blocker = await assertDependencyAllowed(task.userId, taskId, blockerId);
    // Idempotent: the pair is the primary key, and "already there" is not an error.
    await prisma.taskDependency.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId: taskId } },
      create: { blockerId, blockedId: taskId },
      update: {},
    });
    auditService.log({ userId, action: 'TASK_DEPENDENCY_ADDED', entityType: 'task', entityId: taskId, details: { blockerId, blocker: blocker.title } });
    return this.findById(userId, taskId);
  },

  async removeDependency(userId: string, taskId: string, blockerId: string) {
    if (!(await canAccessTask(taskId, userId))) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    const { count } = await prisma.taskDependency.deleteMany({ where: { blockedId: taskId, blockerId } });
    if (count === 0) {
      throw new AppError(404, 'DEPENDENCY_NOT_FOUND', 'Dependency not found');
    }
    auditService.log({ userId, action: 'TASK_DEPENDENCY_REMOVED', entityType: 'task', entityId: taskId, details: { blockerId } });
    return this.findById(userId, taskId);
  },

  // ─── Checklist ────────────────────────────────────────────────────────────
  //
  // Access, not ownership: anyone who can open the task can tick a line on it,
  // which is what a checklist on a shared task is for. Every write names both
  // the item and the task, so an item id from another task — or another
  // account — is a 404 rather than an edit.

  async addChecklistItem(userId: string, taskId: string, data: CreateChecklistItemInput) {
    if (!(await canAccessTask(taskId, userId))) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    const last = await prisma.taskChecklistItem.findFirst({
      where: { taskId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const item = await prisma.taskChecklistItem.create({
      data: { taskId, text: data.text, position: (last?.position ?? 0) + 1000 },
    });
    auditService.log({ userId, action: 'TASK_CHECKLIST_UPDATED', entityType: 'task', entityId: taskId, details: { added: item.text } });
    return item;
  },

  async updateChecklistItem(userId: string, taskId: string, itemId: string, data: UpdateChecklistItemInput) {
    if (!(await canAccessTask(taskId, userId))) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    const existing = await prisma.taskChecklistItem.findFirst({ where: { id: itemId, taskId } });
    if (!existing) {
      throw new AppError(404, 'CHECKLIST_ITEM_NOT_FOUND', 'Checklist item not found');
    }
    const item = await prisma.taskChecklistItem.update({
      where: { id: itemId, taskId },
      data: {
        ...(data.text !== undefined ? { text: data.text } : {}),
        ...(data.isDone !== undefined
          ? { isDone: data.isDone, completedAt: data.isDone ? new Date() : null }
          : {}),
      },
    });
    auditService.log({ userId, action: 'TASK_CHECKLIST_UPDATED', entityType: 'task', entityId: taskId, details: { itemId, changes: Object.keys(data) } });
    return item;
  },

  async deleteChecklistItem(userId: string, taskId: string, itemId: string) {
    if (!(await canAccessTask(taskId, userId))) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    const { count } = await prisma.taskChecklistItem.deleteMany({ where: { id: itemId, taskId } });
    if (count === 0) {
      throw new AppError(404, 'CHECKLIST_ITEM_NOT_FOUND', 'Checklist item not found');
    }
    auditService.log({ userId, action: 'TASK_CHECKLIST_UPDATED', entityType: 'task', entityId: taskId, details: { removed: itemId } });
    return { success: true };
  },
};

/**
 * Create the next occurrence of every repeating task among `ids` that has
 * just reached a terminal status.
 *
 * Called after the status write, never inside it: the write is the user's
 * action and must land whatever happens here. Each spawn is its own
 * transaction, and the claim on `recurrenceNextId` — an `updateMany` that
 * matches only while it is still null — is what makes it happen once. Two
 * completions racing both create a candidate; the loser's claim matches
 * nothing and its candidate is removed. The unique index on the column is
 * the backstop.
 *
 * What carries over: title, description, priority, estimate, company,
 * assignee, labels, parent, the rule itself — and the checklist, unticked,
 * because a repeating task's steps repeat with it. Dependencies do not: they
 * were about this occurrence.
 */
async function spawnNextOccurrences(userId: string, ids: string[]) {
  const rows = await prisma.task.findMany({
    where: { id: { in: ids }, recurrence: { not: null }, recurrenceNextId: null, dueDate: { not: null } },
    include: { labels: { select: { labelId: true } }, checklist: { orderBy: { position: 'asc' } } },
  });
  if (rows.length === 0) return;
  const terminalByOwner = new Map<string, string[]>();

  for (const row of rows) {
    let terminal = terminalByOwner.get(row.userId);
    if (!terminal) {
      terminal = await terminalStatusNames(row.userId);
      terminalByOwner.set(row.userId, terminal);
    }
    if (!isTerminalStatus(row.status, terminal)) continue;

    const nextDue = nextOccurrence(row.recurrence!, row.dueDate!);
    if (!nextDue) continue;

    // The account's first unfinished status, in its own order.
    const opening = await prisma.taskStatus.findFirst({
      where: { userId: row.userId, isTerminal: false },
      orderBy: { position: 'asc' },
      select: { name: true },
    });
    const status = opening?.name ?? 'TODO';
    const maxPos = await prisma.task.findFirst({
      where: { userId: row.userId, status },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const created = await prisma.$transaction(async (tx) => {
      const next = await tx.task.create({
        data: {
          userId: row.userId,
          title: row.title,
          description: row.description,
          priority: row.priority,
          estimatedMinutes: row.estimatedMinutes,
          customerId: row.customerId,
          assignedToId: row.assignedToId,
          parentId: row.parentId,
          recurrence: row.recurrence,
          status,
          position: (maxPos?.position ?? 0) + 1000,
          dueDate: nextDue,
          labels: row.labels.length ? { create: row.labels.map((l) => ({ labelId: l.labelId })) } : undefined,
          checklist: row.checklist.length
            ? { create: row.checklist.map((c) => ({ text: c.text, position: c.position })) }
            : undefined,
        },
        select: { id: true },
      });
      const claim = await tx.task.updateMany({
        where: { id: row.id, recurrenceNextId: null },
        data: { recurrenceNextId: next.id },
      });
      if (claim.count === 0) {
        // Somebody else finished this occurrence first and already spawned.
        await tx.task.delete({ where: { id: next.id } });
        return null;
      }
      return next.id;
    });

    if (created) {
      auditService.log({
        userId,
        action: 'TASK_CREATED',
        entityType: 'task',
        entityId: created,
        details: { title: row.title, status, recurrence: row.recurrence, previousId: row.id, dueDate: nextDue.toISOString() },
      });
    }
  }
}

/**
 * A start date after the due date is a task that cannot be done in time by
 * construction. Refused rather than silently reordered: either date may be
 * the wrong one, and only the user knows which.
 */
function assertDatesInOrder(startDate: string | null, dueDate: string | null) {
  if (startDate && dueDate && new Date(startDate).getTime() > new Date(dueDate).getTime()) {
    throw new AppError(400, 'START_AFTER_DUE', 'The start date cannot be after the due date');
  }
}

/** What a link resolves to for display. */
export interface ResolvedLink {
  entityType: TaskLinkType;
  entityId: string;
  label: string;
  subtitle: string | null;
  /** The event's start, for events. */
  when: Date | null;
}

/**
 * One link's target, if it exists and belongs to `ownerId`.
 *
 * Contacts have no `userId` of their own — they belong to a customer, which
 * does — so the ownership check goes through the customer.
 */
async function resolveLinkTarget(ownerId: string, entityType: TaskLinkType, entityId: string): Promise<ResolvedLink | null> {
  const [resolved] = await resolveLinks(ownerId, [{ entityType, entityId }]);
  return resolved ?? null;
}

/**
 * Resolve a task's links to what the panel shows, dropping any whose target
 * is gone or is not the account's. Three queries at most, one per type.
 */
async function resolveLinks(ownerId: string, links: Array<{ entityType: string; entityId: string }>): Promise<ResolvedLink[]> {
  const ids = (type: TaskLinkType) => links.filter((l) => l.entityType === type).map((l) => l.entityId);
  const [contacts, deals, events] = await Promise.all([
    ids('contact').length
      ? prisma.contact.findMany({
          where: { id: { in: ids('contact') }, customer: { userId: ownerId } },
          select: { id: true, firstName: true, lastName: true, email: true, customer: { select: { name: true } } },
        })
      : [],
    ids('deal').length
      ? prisma.deal.findMany({
          where: { id: { in: ids('deal') }, userId: ownerId },
          select: { id: true, title: true, status: true, partner: { select: { name: true } } },
        })
      : [],
    ids('event').length
      ? prisma.calendarEvent.findMany({
          where: { id: { in: ids('event') }, userId: ownerId },
          select: { id: true, title: true, startTime: true, location: true },
        })
      : [],
  ]);
  const byKey = new Map<string, ResolvedLink>();
  for (const c of contacts) {
    byKey.set(`contact:${c.id}`, {
      entityType: 'contact',
      entityId: c.id,
      label: `${c.firstName} ${c.lastName}`.trim() || c.email || 'Contact',
      subtitle: c.customer?.name ?? c.email ?? null,
      when: null,
    });
  }
  for (const d of deals) {
    byKey.set(`deal:${d.id}`, { entityType: 'deal', entityId: d.id, label: d.title, subtitle: d.partner?.name ?? null, when: null });
  }
  for (const e of events) {
    byKey.set(`event:${e.id}`, { entityType: 'event', entityId: e.id, label: e.title, subtitle: e.location ?? null, when: e.startTime });
  }
  // In the links' own order, minus the ones that resolved to nothing.
  return links.map((l) => byKey.get(`${l.entityType}:${l.entityId}`)).filter((l): l is ResolvedLink => !!l);
}

/**
 * Split a batch's ids into the rows the caller may act on and the rest.
 *
 * `access` is the single-task rule for edits (owned, shared or assigned);
 * `owner` is the rule for assigning and deleting. An id that is not a task
 * at all, or belongs to another account, is skipped as "not found" — the
 * same answer a single request would get — never reported as someone else's.
 */
async function partitionByAccess(userId: string, ids: string[], level: 'access' | 'owner') {
  const unique = [...new Set(ids)];
  const sharedIds = level === 'access' ? await getSharedTaskIds(userId) : [];
  const rows = await prisma.task.findMany({
    where: {
      id: { in: unique },
      OR: level === 'owner'
        ? [{ userId }]
        : [{ userId }, { assignedToId: userId }, ...(sharedIds.length ? [{ id: { in: sharedIds } }] : [])],
    },
    select: { id: true, userId: true, status: true },
  });
  const found = new Set(rows.map((r) => r.id));
  const skipped = unique.filter((id) => !found.has(id)).map((id) => ({ id, reason: level === 'owner' ? 'Not yours to change' : 'Not found' }));
  return { reachable: rows, skipped };
}

/** A user as the timeline names them; null for "nobody". */
async function userLabel(id: string | null): Promise<string | null> {
  if (!id) return null;
  const u = await prisma.user.findUnique({ where: { id }, select: { name: true, email: true } });
  return u?.name || u?.email || null;
}

/**
 * What a TASK_UPDATED audit row records.
 *
 * `changes` (the payload's keys) is what it always recorded and what the
 * Activity page reads. `from` / `to` are new and carry the values, so a task's
 * timeline can say "status: To do → Done" rather than "changed: status". Only
 * the fields that actually differ are listed — the panel sends only what
 * changed, but an API caller may not — and only scalar ones; labels and the
 * description are named without their contents.
 */
function describeTaskChanges(
  before: { title: string; status: string; priority: string; dueDate: Date | null; startDate: Date | null; remindAt: Date | null; customerId: string | null; parentId: string | null; estimatedMinutes: number | null; description: string | null },
  after: { title: string; status: string; priority: string; dueDate: Date | null; startDate: Date | null; remindAt: Date | null; customerId: string | null; parentId: string | null; estimatedMinutes: number | null; description: string | null; customer?: { name: string } | null; parent?: { title: string } | null },
  data: UpdateTaskInput
): Prisma.InputJsonObject {
  const from: Record<string, string | number | null> = {};
  const to: Record<string, string | number | null> = {};
  const changed: string[] = [];

  const scalar = (key: 'title' | 'status' | 'priority' | 'estimatedMinutes') => {
    if (before[key] !== after[key]) {
      changed.push(key);
      from[key] = before[key];
      to[key] = after[key];
    }
  };
  scalar('title');
  scalar('status');
  scalar('priority');
  scalar('estimatedMinutes');

  const dateField = (key: 'dueDate' | 'startDate' | 'remindAt') => {
    const b = before[key]?.toISOString() ?? null;
    const a = after[key]?.toISOString() ?? null;
    if (b !== a) {
      changed.push(key);
      from[key] = b;
      to[key] = a;
    }
  };
  dateField('dueDate');
  dateField('startDate');
  dateField('remindAt');
  if (before.customerId !== after.customerId) {
    changed.push('customerId');
    from.customerId = before.customerId;
    to.customerId = after.customerId;
    to.customer = after.customer?.name ?? null;
  }
  if (before.parentId !== after.parentId) {
    changed.push('parentId');
    from.parentId = before.parentId;
    to.parentId = after.parentId;
    to.parent = after.parent?.title ?? null;
  }
  if ((before.description ?? '') !== (after.description ?? '')) changed.push('description');
  if (data.labelIds !== undefined) changed.push('labelIds');

  return { changes: changed, from, to };
}

/**
 * Shape a Prisma row into what the client's `Task` type declares.
 *
 * `checklist` arrives either as bare `{ isDone }` flags (list rows) or as full
 * items (`findById`). Both produce the counts; only the full items are kept
 * as `checklist`, so a list row does not carry an array of booleans the
 * client has no use for.
 */
function formatTask(task: any) {
  const items: Array<{ isDone: boolean; id?: string }> = task.checklist ?? [];
  const { checklist, ...rest } = task;
  return {
    ...rest,
    labels: task.labels?.map((tl: any) => tl.label) || [],
    customer: task.customer || null,
    parent: task.parent ?? null,
    checklistCount: items.length,
    checklistDoneCount: items.filter((i) => i.isDone).length,
    ...(items.length > 0 && items[0].id !== undefined ? { checklist } : {}),
  };
}
