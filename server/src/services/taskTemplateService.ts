import { Prisma } from '../lib/prismaClient.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { canAccessTask } from '../utils/accessControl.js';
import { auditService } from './auditService.js';
import { taskService } from './taskService.js';
import {
  createTaskTemplateSchema,
  type CreateTaskTemplateInput,
  type UpdateTaskTemplateInput,
  type InstantiateTemplateInput,
  type TemplateItem,
  type TemplateLeaf,
} from '../validators/taskTemplateValidator.js';

const TEMPLATE_SELECT = {
  id: true,
  name: true,
  description: true,
  items: true,
  usageCount: true,
  lastUsedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** How many tasks a template creates, counting subtasks. */
function countItems(items: TemplateItem[]): number {
  return items.reduce((n, item) => n + 1 + (item.subtasks?.length ?? 0), 0);
}

function shape<T extends { items: unknown }>(row: T) {
  const items = row.items as TemplateItem[];
  return { ...row, items, taskCount: countItems(items) };
}

/**
 * Every label a template names must be the account's. The ids are stored in
 * JSON and would otherwise be applied unchecked at instantiation, attaching
 * another account's label to the created tasks.
 */
async function assertLabelsOwned(userId: string, items: TemplateItem[]) {
  const ids = new Set<string>();
  for (const item of items) {
    for (const id of item.labelIds ?? []) ids.add(id);
    for (const sub of item.subtasks ?? []) for (const id of sub.labelIds ?? []) ids.add(id);
  }
  if (ids.size === 0) return;
  const owned = await prisma.label.count({ where: { id: { in: [...ids] }, userId } });
  if (owned !== ids.size) {
    throw new AppError(404, 'LABEL_NOT_FOUND', 'Label not found');
  }
}

/**
 * Task templates: a saved tree of tasks, applied against an anchor day and a
 * company. "New partner onboarding" becomes one click that produces eight
 * tasks with the right offsets, labels, checklists and subtasks.
 */
export const taskTemplateService = {
  async findAll(userId: string) {
    const rows = await prisma.taskTemplate.findMany({
      where: { userId },
      orderBy: [{ usageCount: 'desc' }, { name: 'asc' }],
      select: TEMPLATE_SELECT,
    });
    return rows.map(shape);
  },

  async findById(userId: string, id: string) {
    const row = await prisma.taskTemplate.findFirst({ where: { id, userId }, select: TEMPLATE_SELECT });
    if (!row) throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Template not found');
    return shape(row);
  },

  async create(userId: string, data: CreateTaskTemplateInput) {
    await assertLabelsOwned(userId, data.items);
    try {
      const row = await prisma.taskTemplate.create({
        data: {
          userId,
          name: data.name,
          description: data.description ?? null,
          items: data.items as unknown as Prisma.InputJsonValue,
        },
        select: TEMPLATE_SELECT,
      });
      auditService.log({ userId, action: 'TASK_TEMPLATE_CREATED', entityType: 'task_template', entityId: row.id, details: { name: row.name, tasks: countItems(data.items) } });
      return shape(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(409, 'TEMPLATE_NAME_TAKEN', 'A template with that name already exists');
      }
      throw err;
    }
  },

  async update(userId: string, id: string, data: UpdateTaskTemplateInput) {
    await this.findById(userId, id);
    if (data.items) await assertLabelsOwned(userId, data.items);
    try {
      const row = await prisma.taskTemplate.update({
        where: { id, userId },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.items !== undefined ? { items: data.items as unknown as Prisma.InputJsonValue } : {}),
        },
        select: TEMPLATE_SELECT,
      });
      auditService.log({ userId, action: 'TASK_TEMPLATE_UPDATED', entityType: 'task_template', entityId: id, details: { changes: Object.keys(data) } });
      return shape(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new AppError(409, 'TEMPLATE_NAME_TAKEN', 'A template with that name already exists');
      }
      throw err;
    }
  },

  async delete(userId: string, id: string) {
    const existing = await this.findById(userId, id);
    await prisma.taskTemplate.delete({ where: { id, userId } });
    auditService.log({ userId, action: 'TASK_TEMPLATE_DELETED', entityType: 'task_template', entityId: id, details: { name: existing.name } });
    return { success: true };
  },

  /**
   * A template from a task that exists: its subtasks, checklist, labels,
   * priority and estimate, with due dates turned into offsets from the
   * task's own due date (or dropped when it has none). This is how a
   * template is authored — by doing the work once and keeping the shape.
   */
  async fromTask(userId: string, taskId: string, name: string, description?: string | null) {
    if (!(await canAccessTask(taskId, userId))) {
      throw new AppError(404, 'TASK_NOT_FOUND', 'Task not found');
    }
    const task = await prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: {
        labels: { select: { labelId: true } },
        checklist: { orderBy: { position: 'asc' }, select: { text: true } },
        subtasks: {
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          include: { labels: { select: { labelId: true } }, checklist: { orderBy: { position: 'asc' }, select: { text: true } } },
        },
      },
    });
    const anchor = task.dueDate;
    const offset = (due: Date | null): number | undefined => {
      if (!due || !anchor) return undefined;
      return Math.round((due.getTime() - anchor.getTime()) / 86_400_000);
    };
    const leaf = (t: typeof task.subtasks[number]): TemplateLeaf => ({
      title: t.title,
      description: t.description ?? undefined,
      priority: t.priority,
      estimatedMinutes: t.estimatedMinutes,
      dueOffsetDays: offset(t.dueDate),
      labelIds: t.labels.map((l) => l.labelId),
      checklist: t.checklist.map((c) => c.text),
    });
    const item: TemplateItem = {
      ...leaf(task as unknown as typeof task.subtasks[number]),
      dueOffsetDays: anchor ? 0 : undefined,
      subtasks: task.subtasks.map(leaf),
    };
    // Labels belong to the task's owner; the template belongs to the caller.
    // A share recipient saving someone else's task keeps its shape but not
    // labels they do not own.
    if (task.userId !== userId) {
      item.labelIds = [];
      for (const sub of item.subtasks ?? []) sub.labelIds = [];
    }
    const parsed = createTaskTemplateSchema.parse({ name, description: description ?? null, items: [item] });
    return this.create(userId, parsed);
  },

  /**
   * Create the template's tasks. One transaction for the rows, so a template
   * of eight tasks never half-applies; links are attached afterwards through
   * `taskService.addLink`, which owns the ownership rules for their targets.
   */
  async instantiate(userId: string, id: string, input: InstantiateTemplateInput) {
    const template = await this.findById(userId, id);
    const anchor = input.anchorDate ? new Date(input.anchorDate) : new Date();

    if (input.customerId) {
      const customer = await prisma.customer.findFirst({ where: { id: input.customerId, userId }, select: { id: true } });
      if (!customer) throw new AppError(404, 'CUSTOMER_NOT_FOUND', 'Customer not found');
    }
    if (input.assignedToId) {
      const assignee = await prisma.user.findUnique({ where: { id: input.assignedToId }, select: { id: true } });
      if (!assignee) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }
    const opening = await prisma.taskStatus.findFirst({
      where: { userId, isTerminal: false },
      orderBy: { position: 'asc' },
      select: { name: true },
    });
    const status = opening?.name ?? 'TODO';
    const maxPos = await prisma.task.findFirst({ where: { userId, status }, orderBy: { position: 'desc' }, select: { position: true } });
    let position = maxPos?.position ?? 0;

    const dueFor = (offset: number | null | undefined): Date | null =>
      offset === null || offset === undefined ? null : new Date(anchor.getTime() + offset * 86_400_000);

    const createdIds = await prisma.$transaction(async (tx) => {
      const roots: string[] = [];
      const leafData = (leaf: TemplateLeaf) => ({
        userId,
        title: leaf.title,
        description: leaf.description ?? null,
        priority: leaf.priority ?? 'MEDIUM',
        estimatedMinutes: leaf.estimatedMinutes ?? null,
        dueDate: dueFor(leaf.dueOffsetDays),
        status,
        customerId: input.customerId ?? null,
        assignedToId: input.assignedToId ?? null,
        labels: leaf.labelIds?.length ? { create: leaf.labelIds.map((labelId) => ({ labelId })) } : undefined,
        checklist: leaf.checklist?.length
          ? { create: leaf.checklist.map((text, i) => ({ text, position: (i + 1) * 1000 })) }
          : undefined,
      });
      for (const item of template.items) {
        position += 1000;
        const root = await tx.task.create({ data: { ...leafData(item), position }, select: { id: true } });
        roots.push(root.id);
        for (const sub of item.subtasks ?? []) {
          position += 1000;
          await tx.task.create({ data: { ...leafData(sub), position, parentId: root.id }, select: { id: true } });
        }
      }
      await tx.taskTemplate.update({ where: { id }, data: { usageCount: { increment: 1 }, lastUsedAt: new Date() } });
      return roots;
    });

    for (const link of input.links ?? []) {
      for (const rootId of createdIds) {
        await taskService.addLink(userId, rootId, link);
      }
    }

    for (const rootId of createdIds) {
      auditService.log({ userId, action: 'TASK_CREATED', entityType: 'task', entityId: rootId, details: { templateId: id, template: template.name } });
    }
    auditService.log({ userId, action: 'TASK_TEMPLATE_APPLIED', entityType: 'task_template', entityId: id, details: { name: template.name, tasks: template.taskCount, customerId: input.customerId ?? undefined } });

    const tasks = await Promise.all(createdIds.map((rootId) => taskService.findById(userId, rootId)));
    return { tasks, created: template.taskCount };
  },
};
