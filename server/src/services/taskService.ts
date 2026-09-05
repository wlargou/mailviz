import { Prisma } from '../lib/prismaClient.js';
import { prisma } from '../lib/prisma.js';
import { terminalStatusNames, notTerminal, isTerminalStatus } from '../utils/taskStatus.js';
import {
  CreateTaskInput,
  UpdateTaskInput,
  ReorderInput,
  CreateChecklistItemInput,
  UpdateChecklistItemInput,
} from '../validators/taskValidator.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';
import { AppError } from '../middleware/errorHandler.js';
import { getSharedTaskIds, canAccessTask, isTaskOwner } from '../utils/accessControl.js';
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
}

/**
 * Attach the subtask and dependency counts to formatted tasks.
 *
 * Three queries for the whole page rather than several per row. "Done" is
 * whatever the CALLER's account calls terminal — the same choice
 * `findGroupedByCompany` makes for shared tasks, so a board and a list never
 * disagree about the same row.
 */
async function withSubtaskProgress<T extends { id: string }>(userId: string, tasks: T[]): Promise<Array<T & RelationCounts>> {
  if (tasks.length === 0) return [];
  const ids = tasks.map((t) => t.id);
  const [children, blockers, blocks, terminal] = await Promise.all([
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
    terminalStatusNames(userId),
  ]);

  const counts = new Map<string, RelationCounts>();
  const entry = (id: string) => {
    let c = counts.get(id);
    if (!c) {
      c = { subtaskCount: 0, subtaskDoneCount: 0, blockedByCount: 0, openBlockerCount: 0, blocksCount: 0 };
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
  return tasks.map((t) => ({
    ...t,
    ...(counts.get(t.id) ?? { subtaskCount: 0, subtaskDoneCount: 0, blockedByCount: 0, openBlockerCount: 0, blocksCount: 0 }),
  }));
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
        mailToTask: {
          include: {
            email: {
              select: { id: true, subject: true, from: true, fromName: true, threadId: true, receivedAt: true },
            },
          },
        },
      },
    });
    if (!task) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    const { blockedBy, blocks, ...row } = task;
    const [decorated] = await withSubtaskProgress(userId, [formatTask(row)]);
    return {
      ...decorated,
      subtasks: await withSubtaskProgress(userId, task.subtasks.map(formatTask)),
      blockedBy: blockedBy.map((d) => d.blocker),
      blocks: blocks.map((d) => d.blocked),
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
        mailToTask: {
          select: {
            id: true,
            conversionNote: true,
            // Matches the shape `Task.mailToTask` already declares on the
            // client. Selecting a narrower one here would make that type a lie
            // for this endpoint alone, which is worse than two extra columns.
            email: {
              select: {
                id: true,
                subject: true,
                from: true,
                fromName: true,
                threadId: true,
                receivedAt: true,
              },
            },
          },
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
  before: { title: string; status: string; priority: string; dueDate: Date | null; customerId: string | null; parentId: string | null; estimatedMinutes: number | null; description: string | null },
  after: { title: string; status: string; priority: string; dueDate: Date | null; customerId: string | null; parentId: string | null; estimatedMinutes: number | null; description: string | null; customer?: { name: string } | null; parent?: { title: string } | null },
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

  const beforeDue = before.dueDate?.toISOString() ?? null;
  const afterDue = after.dueDate?.toISOString() ?? null;
  if (beforeDue !== afterDue) {
    changed.push('dueDate');
    from.dueDate = beforeDue;
    to.dueDate = afterDue;
  }
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
