import { prisma } from '../lib/prisma.js';

export async function getSharedThreadIds(userId: string): Promise<string[]> {
  const shares = await prisma.emailThreadShare.findMany({
    where: { sharedWithUserId: userId },
    select: { threadId: true },
  });
  return [...new Set(shares.map(s => s.threadId))];
}

export async function getSharedDealIds(userId: string): Promise<string[]> {
  const shares = await prisma.dealShare.findMany({
    where: { sharedWithUserId: userId },
    select: { dealId: true },
  });
  return [...new Set(shares.map(s => s.dealId))];
}

export async function canAccessThread(threadId: string, userId: string): Promise<boolean> {
  // Check ownership
  const owns = await prisma.email.findFirst({ where: { threadId, userId } });
  if (owns) return true;
  // Check shared access
  const share = await prisma.emailThreadShare.findFirst({
    where: { threadId, sharedWithUserId: userId },
  });
  return !!share;
}

export async function canAccessDeal(dealId: string, userId: string): Promise<boolean> {
  const deal = await prisma.deal.findFirst({ where: { id: dealId, userId } });
  if (deal) return true;
  const share = await prisma.dealShare.findFirst({
    where: { dealId, sharedWithUserId: userId },
  });
  return !!share;
}

export async function isDealOwner(dealId: string, userId: string): Promise<boolean> {
  const deal = await prisma.deal.findFirst({ where: { id: dealId, userId } });
  return !!deal;
}

export async function getSharedTaskIds(userId: string): Promise<string[]> {
  const shares = await prisma.taskShare.findMany({
    where: { sharedWithUserId: userId },
    select: { taskId: true },
  });
  return [...new Set(shares.map(s => s.taskId))];
}

export async function canAccessTask(taskId: string, userId: string): Promise<boolean> {
  // Check ownership or assignment
  const task = await prisma.task.findFirst({
    where: { id: taskId, OR: [{ userId }, { assignedToId: userId }] },
  });
  if (task) return true;
  // Check shared access
  const share = await prisma.taskShare.findFirst({
    where: { taskId, sharedWithUserId: userId },
  });
  return !!share;
}

export async function isTaskOwner(taskId: string, userId: string): Promise<boolean> {
  const task = await prisma.task.findFirst({ where: { id: taskId, userId } });
  return !!task;
}
