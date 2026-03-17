import dotenv from 'dotenv';
dotenv.config();

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Clear existing data
  await prisma.taskLabel.deleteMany();
  await prisma.task.deleteMany();
  await prisma.label.deleteMany();

  // Create labels
  const labels = await Promise.all([
    prisma.label.create({ data: { name: 'Bug', color: '#da1e28' } }),
    prisma.label.create({ data: { name: 'Feature', color: '#0f62fe' } }),
    prisma.label.create({ data: { name: 'Documentation', color: '#8a3ffc' } }),
    prisma.label.create({ data: { name: 'Design', color: '#ff832b' } }),
    prisma.label.create({ data: { name: 'Backend', color: '#198038' } }),
    prisma.label.create({ data: { name: 'Frontend', color: '#1192e8' } }),
  ]);

  const [bug, feature, docs, design, backend, frontend] = labels;

  // Create tasks
  const tasks = [
    {
      title: 'Set up project infrastructure',
      description: 'Initialize monorepo with client and server workspaces, Docker setup for PostgreSQL',
      status: 'DONE' as const,
      priority: 'HIGH' as const,
      position: 1000,
      dueDate: new Date('2026-03-10'),
      labelIds: [backend.id],
    },
    {
      title: 'Design dashboard layout',
      description: 'Create mockups for the main dashboard with task summary widgets and quick actions',
      status: 'DONE' as const,
      priority: 'HIGH' as const,
      position: 2000,
      dueDate: new Date('2026-03-12'),
      labelIds: [design.id, frontend.id],
    },
    {
      title: 'Implement task CRUD API',
      description: 'Build REST endpoints for creating, reading, updating, and deleting tasks with validation',
      status: 'IN_PROGRESS' as const,
      priority: 'URGENT' as const,
      position: 1000,
      dueDate: new Date('2026-03-16'),
      labelIds: [backend.id, feature.id],
    },
    {
      title: 'Build kanban board view',
      description: 'Implement drag-and-drop kanban board with three columns: Todo, In Progress, Done',
      status: 'TODO' as const,
      priority: 'HIGH' as const,
      position: 1000,
      dueDate: new Date('2026-03-20'),
      labelIds: [frontend.id, feature.id],
    },
    {
      title: 'Fix date picker timezone issue',
      description: 'Due dates are showing one day off in certain timezones. Need to normalize to UTC.',
      status: 'TODO' as const,
      priority: 'MEDIUM' as const,
      position: 2000,
      dueDate: new Date('2026-03-18'),
      labelIds: [bug.id, frontend.id],
    },
    {
      title: 'Write API documentation',
      description: 'Document all REST endpoints with request/response examples',
      status: 'TODO' as const,
      priority: 'LOW' as const,
      position: 3000,
      dueDate: new Date('2026-03-25'),
      labelIds: [docs.id],
    },
    {
      title: 'Add task filtering and search',
      description: 'Implement server-side filtering by status, priority, labels, and text search',
      status: 'IN_PROGRESS' as const,
      priority: 'MEDIUM' as const,
      position: 2000,
      dueDate: new Date('2026-03-17'),
      labelIds: [backend.id, feature.id],
    },
    {
      title: 'Implement theme toggle',
      description: 'Add light/dark theme switching using Carbon g10 and g100 themes',
      status: 'TODO' as const,
      priority: 'LOW' as const,
      position: 4000,
      dueDate: null,
      labelIds: [frontend.id, design.id],
    },
    {
      title: 'Set up email integration',
      description: 'Plan and scaffold Gmail API integration for the mail feature (Phase 2)',
      status: 'TODO' as const,
      priority: 'LOW' as const,
      position: 5000,
      dueDate: new Date('2026-04-01'),
      labelIds: [backend.id, feature.id],
    },
    {
      title: 'Overdue task example',
      description: 'This task is past its due date to test overdue styling',
      status: 'IN_PROGRESS' as const,
      priority: 'HIGH' as const,
      position: 3000,
      dueDate: new Date('2026-03-10'),
      labelIds: [bug.id],
    },
  ];

  for (const { labelIds, ...taskData } of tasks) {
    await prisma.task.create({
      data: {
        ...taskData,
        labels: {
          create: labelIds.map((labelId) => ({ labelId })),
        },
      },
    });
  }

  console.log('Seed completed: 6 labels, 10 tasks created');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
