import type { TaskPriority } from '../lib/prismaClient.js';
import { prisma } from '../lib/prisma.js';

let seq = 0;
const uniq = () => `${Date.now().toString(36)}-${++seq}`;

/**
 * Fixtures for the test suite.
 *
 * Everything is scoped to a user on purpose. The bugs these tests exist to
 * catch are multi-tenant ones — a where-clause that stops constraining by
 * userId — so the default shape of a test is "two users, assert one cannot see
 * the other".
 */

export async function createUser(overrides: { email?: string; name?: string } = {}) {
  return prisma.user.create({
    data: {
      email: overrides.email ?? `user-${uniq()}@example.com`,
      name: overrides.name ?? 'Test User',
    },
  });
}

/** Two unrelated users — the standard setup for an isolation test. */
export async function createTwoUsers() {
  const [alice, bob] = await Promise.all([
    createUser({ email: `alice-${uniq()}@example.com`, name: 'Alice' }),
    createUser({ email: `bob-${uniq()}@example.com`, name: 'Bob' }),
  ]);
  return { alice, bob };
}

export async function createCustomer(userId: string, overrides: Partial<{ name: string; domain: string }> = {}) {
  return prisma.customer.create({
    data: {
      userId,
      name: overrides.name ?? `Customer ${uniq()}`,
      domain: overrides.domain ?? `${uniq()}.example.com`,
    },
  });
}

export async function createContact(customerId: string, overrides: Partial<{ firstName: string; lastName: string; email: string }> = {}) {
  return prisma.contact.create({
    data: {
      customerId,
      firstName: overrides.firstName ?? 'Test',
      lastName: overrides.lastName ?? `Contact-${uniq()}`,
      email: overrides.email ?? `contact-${uniq()}@example.com`,
    },
  });
}

export async function createTask(
  userId: string,
  overrides: Partial<{
    title: string;
    status: string;
    assignedToId: string;
    priority: TaskPriority;
    dueDate: Date;
  }> = {}
) {
  return prisma.task.create({
    data: {
      userId,
      title: overrides.title ?? `Task ${uniq()}`,
      status: overrides.status ?? 'TODO',
      ...(overrides.priority ? { priority: overrides.priority } : {}),
      ...(overrides.assignedToId ? { assignedToId: overrides.assignedToId } : {}),
      ...(overrides.dueDate ? { dueDate: overrides.dueDate } : {}),
    },
  });
}

export async function createDealPartner(userId: string, name = `Partner ${uniq()}`) {
  return prisma.dealPartner.create({ data: { userId, name } });
}

export async function createDeal(
  userId: string,
  overrides: Partial<{ title: string; partnerId: string; products: string; status: string }> = {}
) {
  const partnerId = overrides.partnerId ?? (await createDealPartner(userId)).id;
  return prisma.deal.create({
    data: {
      userId,
      partnerId,
      title: overrides.title ?? `Deal ${uniq()}`,
      ...(overrides.products ? { products: overrides.products } : {}),
      ...(overrides.status ? { status: overrides.status } : {}),
    },
  });
}

export async function createEmail(
  userId: string,
  overrides: Partial<{
    threadId: string;
    subject: string;
    from: string;
    gmailMessageId: string;
    snippet: string;
    isRead: boolean;
    isTrashed: boolean;
    customerId: string;
    isStarred: boolean;
    isArchived: boolean;
    labelIds: string[];
    receivedAt: Date;
  }> = {}
) {
  const id = uniq();
  return prisma.email.create({
    data: {
      userId,
      gmailMessageId: overrides.gmailMessageId ?? `gmail-${id}`,
      threadId: overrides.threadId ?? `thread-${id}`,
      subject: overrides.subject ?? `Subject ${id}`,
      from: overrides.from ?? `sender-${id}@example.com`,
      receivedAt: overrides.receivedAt ?? new Date(),
      ...(overrides.customerId ? { customerId: overrides.customerId } : {}),
      ...(overrides.snippet !== undefined ? { snippet: overrides.snippet } : {}),
      ...(overrides.isRead !== undefined ? { isRead: overrides.isRead } : {}),
      ...(overrides.isTrashed !== undefined ? { isTrashed: overrides.isTrashed } : {}),
      ...(overrides.isStarred !== undefined ? { isStarred: overrides.isStarred } : {}),
      ...(overrides.isArchived !== undefined ? { isArchived: overrides.isArchived } : {}),
      ...(overrides.labelIds !== undefined ? { labelIds: overrides.labelIds } : {}),
    },
  });
}

/**
 * The Google connection row for a user.
 *
 * `lastHistoryId` is the switch `syncFromGmail` reads to choose between the
 * incremental (history feed) and initial (full list) paths, so sync tests set
 * it explicitly rather than relying on a default.
 */
export async function createGoogleAuth(
  userId: string,
  overrides: Partial<{ lastHistoryId: string; email: string; lastMailSyncAt: Date }> = {}
) {
  return prisma.googleAuth.create({
    data: {
      userId,
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      tokenExpiry: new Date(Date.now() + 3_600_000),
      email: overrides.email ?? `google-${uniq()}@example.com`,
      ...(overrides.lastHistoryId ? { lastHistoryId: overrides.lastHistoryId } : {}),
      ...(overrides.lastMailSyncAt ? { lastMailSyncAt: overrides.lastMailSyncAt } : {}),
    },
  });
}

/**
 * A row in the local Gmail-draft mirror.
 *
 * Isolation tests use this directly rather than going through `draftService`,
 * because the question they ask — can Bob reach Alice's draft — has to be
 * answerable without Gmail being involved at all.
 */
export async function createDraft(
  userId: string,
  overrides: Partial<{
    gmailDraftId: string;
    gmailMessageId: string;
    threadId: string;
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    htmlBody: string;
    lastEditedAt: Date;
  }> = {}
) {
  const id = uniq();
  return prisma.emailDraft.create({
    data: {
      userId,
      gmailDraftId: overrides.gmailDraftId ?? `draft-${id}`,
      gmailMessageId: overrides.gmailMessageId ?? `draft-msg-${id}`,
      subject: overrides.subject ?? `Draft ${id}`,
      htmlBody: overrides.htmlBody ?? `<p>Draft body ${id}</p>`,
      to: overrides.to ?? [`recipient-${id}@example.com`],
      lastEditedAt: overrides.lastEditedAt ?? new Date(),
      ...(overrides.threadId ? { threadId: overrides.threadId } : {}),
      ...(overrides.cc ? { cc: overrides.cc } : {}),
      ...(overrides.bcc ? { bcc: overrides.bcc } : {}),
    },
  });
}

export async function shareDealWith(dealId: string, sharedById: string, sharedWithId: string) {
  return prisma.dealShare.create({ data: { dealId, sharedByUserId: sharedById, sharedWithUserId: sharedWithId } });
}

export async function shareTaskWith(taskId: string, sharedById: string, sharedWithId: string) {
  return prisma.taskShare.create({ data: { taskId, sharedByUserId: sharedById, sharedWithUserId: sharedWithId } });
}

/**
 * Email sharing is per *thread*, not per message — the share row references a
 * Gmail thread id string rather than an Email row, so this takes the same
 * `threadId` you passed to `createEmail`.
 */
export async function shareThreadWith(threadId: string, sharedById: string, sharedWithId: string) {
  return prisma.emailThreadShare.create({
    data: { threadId, sharedByUserId: sharedById, sharedWithUserId: sharedWithId },
  });
}
