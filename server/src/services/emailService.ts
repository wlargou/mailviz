import { google } from 'googleapis';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { getGmailClient } from '../lib/gmail.js';
import { customerService } from './customerService.js';
import { extractDomain, isPersonalDomain, normalizeDomain, parseName } from '../utils/domainResolver.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';
import { wsEmit } from '../websocket.js';
import { buildMimeMessage, type MimeAttachment } from '../utils/mimeBuilder.js';
import { env } from '../config/env.js';
import { format } from 'date-fns';
// A4: Helper functions extracted to shared module
import {
  parseEmailAddress,
  parseEmailList,
  extractAttachments,
  extractBody,
  type EmailQueryParams,
} from '../utils/emailHelpers.js';
import { getSharedThreadIds, canAccessThread } from '../utils/accessControl.js';

export const emailService = {
  async syncFromGmail(userId: string) {
    const gmail = await getGmailClient(userId);
    const auth = await prisma.googleAuth.findFirst({ where: { userId } });
    if (!auth) throw Object.assign(new Error('Google not connected'), { status: 400 });

    let synced = 0;
    let customersCreated = 0;
    let contactsCreated = 0;
    let labelsChanged = 0;

    try {
      if (auth.lastHistoryId) {
        // Incremental sync
        const result = await this.incrementalSync(gmail, auth.lastHistoryId, userId);
        synced = result.synced;
        customersCreated = result.customersCreated;
        contactsCreated = result.contactsCreated;
        labelsChanged = result.labelsChanged;
      } else {
        // Initial sync — last 3 months
        const result = await this.initialSync(gmail, userId);
        synced = result.synced;
        customersCreated = result.customersCreated;
        contactsCreated = result.contactsCreated;
      }
    } catch (err: any) {
      if (err?.code === 403 || err?.status === 403) {
        throw Object.assign(
          new Error('Gmail access not granted. Please reconnect Google from Settings to grant email permissions.'),
          { status: 403 }
        );
      }
      throw err;
    }

    // Get current historyId for future incremental syncs
    const profile = await gmail.users.getProfile({ userId: 'me' });
    const historyId = profile.data.historyId || null;

    await prisma.googleAuth.update({
      where: { id: auth.id },
      data: {
        lastMailSyncAt: new Date(),
        ...(historyId ? { lastHistoryId: historyId } : {}),
      },
    });

    return { synced, customersCreated, contactsCreated, labelsChanged };
  },

  async initialSync(gmail: ReturnType<typeof google.gmail>, userId: string) {
    let synced = 0;
    let customersCreated = 0;
    let contactsCreated = 0;
    let currentGmail = gmail;
    let messagesSinceRefresh = 0;

    // Phase 1: Collect ALL message IDs (cheap — only IDs, no content)
    wsEmit('sync:progress', { type: 'email', synced: 0, total: 0, phase: 'counting' });
    const allMessageIds: string[] = [];
    let pageToken: string | undefined;

    do {
      const listRes = await currentGmail.users.messages.list({
        userId: 'me',
        ...(env.EMAIL_SYNC_MONTHS > 0 ? { q: `newer_than:${env.EMAIL_SYNC_MONTHS}m` } : {}),
        maxResults: 500,
        pageToken,
      });

      const messages = listRes.data.messages || [];
      pageToken = listRes.data.nextPageToken || undefined;
      for (const msg of messages) {
        if (msg.id) allMessageIds.push(msg.id);
      }
    } while (pageToken);

    const total = allMessageIds.length;
    wsEmit('sync:progress', { type: 'email', synced: 0, total, phase: 'syncing' });
    console.log(`[EmailSync] Initial sync: ${total} messages to process`);

    // Phase 2: Process messages in batches of 10
    for (let i = 0; i < allMessageIds.length; i += 10) {
      const batch = allMessageIds.slice(i, i + 10);
      const results = await Promise.all(
        batch.map((id) =>
          currentGmail.users.messages.get({
            userId: 'me',
            id,
            format: 'full',
          }).catch(() => null)
        )
      );

      for (const res of results) {
        if (!res) continue;
        const msg = res.data;
        const result = await this.upsertMessage(msg, userId);
        if (result) {
          synced++;
          customersCreated += result.customersCreated;
          contactsCreated += result.contactsCreated;
        }
      }

      messagesSinceRefresh += batch.length;

      // Emit progress every 50 messages
      if (synced % 50 < 10) {
        wsEmit('sync:progress', { type: 'email', synced, total, phase: 'syncing' });
      }

      // Force-refresh Gmail client every 500 messages to get a fresh token
      if (messagesSinceRefresh >= 500) {
        try {
          currentGmail = await getGmailClient(userId, true);
          messagesSinceRefresh = 0;
        } catch (err: any) {
          console.warn('[EmailSync] Auth/token error:', err?.message || err);
          // If refresh fails, continue with existing client
        }
      }
    }

    wsEmit('sync:progress', { type: 'email', synced, total, phase: 'complete' });
    return { synced, customersCreated, contactsCreated, labelsChanged: 0 };
  },

  async incrementalSync(gmail: ReturnType<typeof google.gmail>, startHistoryId: string, userId: string) {
    let synced = 0;
    let customersCreated = 0;
    let contactsCreated = 0;
    let labelsChanged = 0;
    let pageToken: string | undefined;

    try {
      do {
        const historyRes = await gmail.users.history.list({
          userId: 'me',
          startHistoryId,
          historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'],
          pageToken,
        });

        const histories = historyRes.data.history || [];
        pageToken = historyRes.data.nextPageToken || undefined;

        for (const history of histories) {
          // Handle new messages
          if (history.messagesAdded) {
            for (const added of history.messagesAdded) {
              if (!added.message?.id) continue;
              try {
                const msgRes = await gmail.users.messages.get({
                  userId: 'me',
                  id: added.message.id,
                  format: 'full',
                });
                const result = await this.upsertMessage(msgRes.data, userId);
                if (result) {
                  synced++;
                  customersCreated += result.customersCreated;
                  contactsCreated += result.contactsCreated;
                }
              } catch {
                // Message may have been deleted
              }
            }
          }

          // Handle deleted messages
          if (history.messagesDeleted) {
            for (const deleted of history.messagesDeleted) {
              if (!deleted.message?.id) continue;
              await prisma.email.deleteMany({ where: { gmailMessageId: deleted.message.id, userId } });
            }
          }

          // Handle label changes (read/unread/starred/archive/trash)
          if (history.labelsAdded) {
            for (const labelChange of history.labelsAdded) {
              if (!labelChange.message?.id) continue;
              const updates: Prisma.EmailUpdateInput = {};
              const labels = labelChange.labelIds || [];
              if (labels.includes('UNREAD')) updates.isRead = false;
              if (labels.includes('STARRED')) updates.isStarred = true;
              if (labels.includes('INBOX')) updates.isArchived = false;
              if (labels.includes('TRASH')) updates.isTrashed = true;
              if (Object.keys(updates).length > 0) {
                const result = await prisma.email.updateMany({
                  where: { gmailMessageId: labelChange.message.id, userId },
                  data: updates,
                });
                if (result.count > 0) labelsChanged++;
              }
              // Also update the stored labelIds array
              const existing = await prisma.email.findFirst({ where: { gmailMessageId: labelChange.message.id, userId } });
              if (existing) {
                const newLabels = [...new Set([...existing.labelIds, ...labels])];
                await prisma.email.updateMany({
                  where: { gmailMessageId: labelChange.message.id, userId },
                  data: { labelIds: newLabels },
                });
              }
            }
          }

          if (history.labelsRemoved) {
            for (const labelChange of history.labelsRemoved) {
              if (!labelChange.message?.id) continue;
              const updates: Prisma.EmailUpdateInput = {};
              const labels = labelChange.labelIds || [];
              if (labels.includes('UNREAD')) updates.isRead = true;
              if (labels.includes('STARRED')) updates.isStarred = false;
              if (labels.includes('INBOX')) updates.isArchived = true;
              if (labels.includes('TRASH')) updates.isTrashed = false;
              if (Object.keys(updates).length > 0) {
                const result = await prisma.email.updateMany({
                  where: { gmailMessageId: labelChange.message.id, userId },
                  data: updates,
                });
                if (result.count > 0) labelsChanged++;
              }
              // Also update the stored labelIds array
              const existing = await prisma.email.findFirst({ where: { gmailMessageId: labelChange.message.id, userId } });
              if (existing) {
                const newLabels = existing.labelIds.filter((l) => !labels.includes(l));
                await prisma.email.updateMany({
                  where: { gmailMessageId: labelChange.message.id, userId },
                  data: { labelIds: newLabels },
                });
              }
            }
          }
        }
      } while (pageToken);
    } catch (err: any) {
      // If historyId is too old, fall back to initial sync
      if (err?.code === 404) {
        console.warn('History ID expired, falling back to initial sync');
        return this.initialSync(gmail, userId);
      }
      throw err;
    }

    return { synced, customersCreated, contactsCreated, labelsChanged };
  },

  async upsertMessage(msg: any, userId: string) {
    if (!msg.id) return null;

    const headers: Record<string, string> = {};
    for (const h of msg.payload?.headers || []) {
      headers[h.name!.toLowerCase()] = h.value || '';
    }

    const fromRaw = headers['from'] || '';
    const { email: fromEmail, name: fromName } = parseEmailAddress(fromRaw);
    const toList = parseEmailList(headers['to']);
    const ccList = parseEmailList(headers['cc']);
    const subject = headers['subject'] || '(No subject)';
    const receivedAt = msg.internalDate
      ? new Date(parseInt(msg.internalDate, 10))
      : new Date();

    const labelIds = msg.labelIds || [];
    const isRead = !labelIds.includes('UNREAD');
    const isStarred = labelIds.includes('STARRED');
    const isArchived = !labelIds.includes('INBOX') && !labelIds.includes('TRASH');
    const isTrashed = labelIds.includes('TRASH');

    // Extract attachment metadata
    const attachmentMeta = extractAttachments(msg.payload || {});
    const hasAttachment = attachmentMeta.length > 0;

    // Auto-link to customer
    let customerId: string | null = null;
    let customersCreated = 0;
    let contactsCreated = 0;

    // Collect all email addresses for customer/contact linking
    const allEmails = [fromEmail, ...toList, ...ccList];
    for (const email of allEmails) {
      const rawDomain = extractDomain(email);
      if (!rawDomain || isPersonalDomain(rawDomain)) continue;
      const domain = normalizeDomain(rawDomain);

      try {
        const { customer, created: cCreated } = await customerService.findOrCreateByDomain(userId, domain);
        if (!customerId) customerId = customer.id;
        if (cCreated) customersCreated++;

        // Try to find display name for this email
        let displayName: string | null = null;
        if (email === fromEmail) displayName = fromName;
        const { created: contactCreated } = await customerService.findOrCreateContact(userId, email, displayName, customer.id);
        if (contactCreated) contactsCreated++;
      } catch (err: any) {
        console.warn('[EmailSync] Customer/contact creation failed:', err?.message || err);
      }
    }

    // Threading headers
    const messageIdHeader = headers['message-id'] || null;
    const inReplyToHeader = headers['in-reply-to'] || null;
    const referencesHeader = headers['references'] || null;
    const bccList = parseEmailList(headers['bcc']);

    const emailData = {
      threadId: msg.threadId || null,
      subject,
      from: fromEmail,
      fromName: fromName || null,
      to: toList,
      cc: ccList,
      bcc: bccList,
      messageId: messageIdHeader,
      inReplyTo: inReplyToHeader,
      references: referencesHeader,
      snippet: msg.snippet || null,
      receivedAt,
      isRead,
      isStarred,
      isArchived,
      isTrashed,
      hasAttachment,
      sizeEstimate: msg.sizeEstimate || null,
      labelIds,
      customerId,
      syncedAt: new Date(),
    };

    const email = await prisma.email.upsert({
      where: { userId_gmailMessageId: { userId, gmailMessageId: msg.id } },
      update: emailData,
      create: {
        gmailMessageId: msg.id,
        userId,
        ...emailData,
      },
    });

    // Upsert attachments
    if (attachmentMeta.length > 0) {
      // Delete existing attachments for this email and re-create
      await prisma.emailAttachment.deleteMany({ where: { emailId: email.id } });
      await prisma.emailAttachment.createMany({
        data: attachmentMeta.map((a) => ({
          emailId: email.id,
          gmailAttachmentId: a.attachmentId,
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
        })),
      });
    }

    return { customersCreated, contactsCreated };
  },

  async findAllThreads(query: EmailQueryParams, userId: string) {
    const pagination = parsePagination(query);

    // Include shared threads
    const sharedThreadIds = await getSharedThreadIds(userId);
    const ownershipFilter: Prisma.EmailWhereInput = sharedThreadIds.length > 0
      ? { OR: [{ userId }, { threadId: { in: sharedThreadIds } }] }
      : { userId };
    const where: Prisma.EmailWhereInput = { ...ownershipFilter };
    // By default, hide trashed emails unless explicitly viewing trash folder
    if (query.folder !== 'trash') {
      where.isTrashed = false;
    }
    if (query.customerId) {
      const ids = query.customerId.split(',').map((s) => s.trim()).filter(Boolean);
      if (ids.length === 1) where.customerId = ids[0];
      else if (ids.length > 1) where.customerId = { in: ids };
    }
    if (query.isRead === 'true') where.isRead = true;
    if (query.isRead === 'false') where.isRead = false;
    if (query.hasAttachment === 'true') where.hasAttachment = true;
    if (query.folder === 'inbox') where.labelIds = { has: 'INBOX' };
    if (query.folder === 'sent') where.labelIds = { has: 'SENT' };
    if (query.folder === 'starred') where.isStarred = true;
    if (query.folder === 'archived') where.isArchived = true;
    if (query.folder === 'trash') where.isTrashed = true;
    if (query.from) {
      where.from = { contains: query.from, mode: 'insensitive' };
    }
    if (query.to) {
      where.to = { has: query.to.toLowerCase() };
    }
    if (query.subject) {
      where.subject = { contains: query.subject, mode: 'insensitive' };
    }
    if (query.dateAfter) {
      where.receivedAt = { ...(where.receivedAt as object), gte: new Date(query.dateAfter) };
    }
    if (query.dateBefore) {
      where.receivedAt = { ...(where.receivedAt as object), lte: new Date(query.dateBefore) };
    }
    if (query.contactEmail) {
      where.OR = [
        { from: query.contactEmail },
        { to: { has: query.contactEmail } },
        { cc: { has: query.contactEmail } },
      ];
    }
    if (query.search) {
      const searchConditions: Prisma.EmailWhereInput[] = [
        { subject: { contains: query.search, mode: 'insensitive' } },
        { from: { contains: query.search, mode: 'insensitive' } },
        { fromName: { contains: query.search, mode: 'insensitive' } },
        { snippet: { contains: query.search, mode: 'insensitive' } },
      ];
      if (where.OR) {
        // Combine with existing OR (contactEmail filter)
        where.AND = [{ OR: where.OR }, { OR: searchConditions }];
        delete where.OR;
      } else {
        where.OR = searchConditions;
      }
    }

    // P1: Get distinct threads with counts — eliminates N+1 queries
    const threadIds = await prisma.email.groupBy({
      by: ['threadId'],
      where,
      _count: { id: true },
      _max: { receivedAt: true },
      orderBy: { _max: { receivedAt: 'desc' } },
      skip: pagination.skip,
      take: pagination.limit,
    });

    // P4: Use COUNT(DISTINCT) instead of fetching all thread IDs
    const totalResult: Array<{ count: bigint }> = sharedThreadIds.length > 0
      ? await prisma.$queryRaw`
          SELECT COUNT(DISTINCT thread_id) as count FROM emails
          WHERE (user_id = ${userId} OR thread_id = ANY(${sharedThreadIds}))
          AND is_trashed = ${where.isTrashed === true}
          ${query.isRead === 'true' ? Prisma.sql`AND is_read = true` : query.isRead === 'false' ? Prisma.sql`AND is_read = false` : Prisma.empty}
          ${query.folder === 'inbox' ? Prisma.sql`AND 'INBOX' = ANY(label_ids)` : Prisma.empty}
          ${query.folder === 'sent' ? Prisma.sql`AND 'SENT' = ANY(label_ids)` : Prisma.empty}
          ${query.folder === 'starred' ? Prisma.sql`AND is_starred = true` : Prisma.empty}
          ${query.folder === 'archived' ? Prisma.sql`AND is_archived = true` : Prisma.empty}
        `
      : await prisma.$queryRaw`
          SELECT COUNT(DISTINCT thread_id) as count FROM emails
          WHERE user_id = ${userId}
          AND is_trashed = ${where.isTrashed === true}
          ${query.isRead === 'true' ? Prisma.sql`AND is_read = true` : query.isRead === 'false' ? Prisma.sql`AND is_read = false` : Prisma.empty}
          ${query.folder === 'inbox' ? Prisma.sql`AND 'INBOX' = ANY(label_ids)` : Prisma.empty}
          ${query.folder === 'sent' ? Prisma.sql`AND 'SENT' = ANY(label_ids)` : Prisma.empty}
          ${query.folder === 'starred' ? Prisma.sql`AND is_starred = true` : Prisma.empty}
          ${query.folder === 'archived' ? Prisma.sql`AND is_archived = true` : Prisma.empty}
        `;
    const total = Number(totalResult[0]?.count ?? 0);

    // P1: Batch-fetch latest email per thread + unread counts (2 queries instead of 2*N)
    const threadIdList = threadIds.map((t) => t.threadId).filter((id): id is string => id !== null);
    const threadCountMap = new Map(threadIds.map((t) => [t.threadId, t._count.id]));

    const [latestEmails, unreadCounts] = await Promise.all([
      prisma.email.findMany({
        where: { ...where, threadId: { in: threadIdList } },
        orderBy: { receivedAt: 'desc' },
        distinct: ['threadId'],
        include: {
          customer: { select: { id: true, name: true, domain: true, logoUrl: true } },
          attachments: true,
        },
      }),
      prisma.email.groupBy({
        by: ['threadId'],
        where: { threadId: { in: threadIdList }, isRead: false, userId },
        _count: { id: true },
      }),
    ]);

    const unreadMap = new Map(unreadCounts.map((u) => [u.threadId, u._count.id]));
    const emailMap = new Map(latestEmails.map((e) => [e.threadId, e]));

    // Build thread list preserving sort order from groupBy
    const threads = threadIdList.map((threadId) => ({
      threadId,
      messageCount: threadCountMap.get(threadId) ?? 0,
      unreadCount: unreadMap.get(threadId) ?? 0,
      latestEmail: emailMap.get(threadId) ?? null,
    }));

    return {
      data: threads.filter((t) => t.latestEmail),
      meta: paginationMeta(total, pagination),
    };
  },

  async findThread(threadId: string, userId: string) {
    // Check access: ownership or shared
    const hasAccess = await canAccessThread(threadId, userId);
    if (!hasAccess) {
      throw Object.assign(new Error('Thread not found'), { status: 404 });
    }

    const emails = await prisma.email.findMany({
      where: { threadId },
      orderBy: { receivedAt: 'asc' },
      include: {
        attachments: true,
        customer: { select: { id: true, name: true, domain: true, logoUrl: true } },
        mailToTask: { include: { task: true } },
      },
    });

    if (emails.length === 0) {
      throw Object.assign(new Error('Thread not found'), { status: 404 });
    }

    return emails;
  },

  async findById(id: string, userId: string) {
    // First try owned emails
    let email = await prisma.email.findFirst({
      where: { id, userId },
      include: {
        attachments: true,
        customer: { select: { id: true, name: true, domain: true, logoUrl: true } },
        mailToTask: { include: { task: true } },
      },
    });

    // If not owned, check shared access via thread
    if (!email) {
      const candidate = await prisma.email.findFirst({
        where: { id },
        include: {
          attachments: true,
          customer: { select: { id: true, name: true, domain: true, logoUrl: true } },
          mailToTask: { include: { task: true } },
        },
      });
      if (candidate?.threadId && await canAccessThread(candidate.threadId, userId)) {
        email = candidate;
      }
    }

    if (!email) throw Object.assign(new Error('Email not found'), { status: 404 });

    // On-demand body fetch if body is null (only for owned emails)
    if (email.body === null && email.gmailMessageId && email.userId === userId) {
      try {
        const gmail = await getGmailClient(userId);
        const msgRes = await gmail.users.messages.get({
          userId: 'me',
          id: email.gmailMessageId,
          format: 'full',
        });
        const body = extractBody(msgRes.data.payload || {});
        if (body) {
          await prisma.email.update({ where: { id }, data: { body } });
          return { ...email, body };
        }
      } catch (err: any) {
        console.warn('[EmailSync] Gmail API call failed:', err?.message || err);
      }
    }

    return email;
  },

  async getAttachment(emailId: string, attachmentId: string, userId: string) {
    const attachment = await prisma.emailAttachment.findFirst({
      where: { id: attachmentId, emailId, email: { userId } },
      include: { email: true },
    });

    if (!attachment || !attachment.email.gmailMessageId) {
      throw Object.assign(new Error('Attachment not found'), { status: 404 });
    }

    const gmail = await getGmailClient(userId);
    const res = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: attachment.email.gmailMessageId,
      id: attachment.gmailAttachmentId,
    });

    const data = Buffer.from(res.data.data || '', 'base64url');
    return {
      data,
      mimeType: attachment.mimeType,
      filename: attachment.filename,
    };
  },

  async markAsRead(id: string, userId: string) {
    let email = await prisma.email.findFirst({ where: { id, userId } });
    if (!email) {
      // Check shared access
      const candidate = await prisma.email.findFirst({ where: { id } });
      if (candidate?.threadId && await canAccessThread(candidate.threadId, userId)) {
        email = candidate;
      }
    }
    if (!email) throw Object.assign(new Error('Email not found'), { status: 404 });

    await prisma.email.update({ where: { id }, data: { isRead: true } });
    wsEmit('email:updated', { id, isRead: true });

    // Sync to Gmail (best effort) — only if user owns the email
    if (email.gmailMessageId && email.userId === userId) {
      try {
        const gmail = await getGmailClient(userId);
        await gmail.users.messages.modify({
          userId: 'me', id: email.gmailMessageId,
          requestBody: { removeLabelIds: ['UNREAD'] },
        });
      } catch (err: any) { console.warn('[EmailSync] Gmail API call failed:', err?.message || err); }
    }
  },

  async markAsUnread(id: string, userId: string) {
    let email = await prisma.email.findFirst({ where: { id, userId } });
    if (!email) {
      const candidate = await prisma.email.findFirst({ where: { id } });
      if (candidate?.threadId && await canAccessThread(candidate.threadId, userId)) {
        email = candidate;
      }
    }
    if (!email) throw Object.assign(new Error('Email not found'), { status: 404 });

    await prisma.email.update({ where: { id }, data: { isRead: false } });
    wsEmit('email:updated', { id, isRead: false });

    if (email.gmailMessageId && email.userId === userId) {
      try {
        const gmail = await getGmailClient(userId);
        await gmail.users.messages.modify({
          userId: 'me', id: email.gmailMessageId,
          requestBody: { addLabelIds: ['UNREAD'] },
        });
      } catch (err: any) { console.warn('[EmailSync] Gmail API call failed:', err?.message || err); }
    }
  },

  async toggleStar(id: string, userId: string) {
    let email = await prisma.email.findFirst({ where: { id, userId } });
    if (!email) {
      const candidate = await prisma.email.findFirst({ where: { id } });
      if (candidate?.threadId && await canAccessThread(candidate.threadId, userId)) {
        email = candidate;
      }
    }
    if (!email) throw Object.assign(new Error('Email not found'), { status: 404 });

    const newStarred = !email.isStarred;
    await prisma.email.update({ where: { id }, data: { isStarred: newStarred } });
    wsEmit('email:updated', { id, isStarred: newStarred });

    if (email.gmailMessageId && email.userId === userId) {
      try {
        const gmail = await getGmailClient(userId);
        await gmail.users.messages.modify({
          userId: 'me', id: email.gmailMessageId,
          requestBody: newStarred
            ? { addLabelIds: ['STARRED'] }
            : { removeLabelIds: ['STARRED'] },
        });
      } catch (err: any) { console.warn('[EmailSync] Gmail API call failed:', err?.message || err); }
    }

    return { isStarred: newStarred };
  },

  async archive(id: string, userId: string) {
    let email = await prisma.email.findFirst({ where: { id, userId } });
    if (!email) {
      const candidate = await prisma.email.findFirst({ where: { id } });
      if (candidate?.threadId && await canAccessThread(candidate.threadId, userId)) {
        email = candidate;
      }
    }
    if (!email) throw Object.assign(new Error('Email not found'), { status: 404 });

    if (email.gmailMessageId && email.userId === userId) {
      try {
        const gmail = await getGmailClient(userId);
        await gmail.users.messages.modify({
          userId: 'me', id: email.gmailMessageId,
          requestBody: { removeLabelIds: ['INBOX'] },
        });
      } catch (err: any) { console.warn('[EmailSync] Gmail API call failed:', err?.message || err); }
    }

    await prisma.email.update({
      where: { id },
      data: { isArchived: true, labelIds: email.labelIds.filter((l) => l !== 'INBOX') },
    });
    wsEmit('email:updated', { id, isArchived: true });
  },

  async unarchive(id: string, userId: string) {
    let email = await prisma.email.findFirst({ where: { id, userId } });
    if (!email) {
      const candidate = await prisma.email.findFirst({ where: { id } });
      if (candidate?.threadId && await canAccessThread(candidate.threadId, userId)) {
        email = candidate;
      }
    }
    if (!email) throw Object.assign(new Error('Email not found'), { status: 404 });

    if (email.gmailMessageId && email.userId === userId) {
      try {
        const gmail = await getGmailClient(userId);
        await gmail.users.messages.modify({
          userId: 'me', id: email.gmailMessageId,
          requestBody: { addLabelIds: ['INBOX'] },
        });
      } catch (err: any) { console.warn('[EmailSync] Gmail API call failed:', err?.message || err); }
    }

    await prisma.email.update({
      where: { id },
      data: { isArchived: false, labelIds: [...email.labelIds, 'INBOX'] },
    });
    wsEmit('email:updated', { id, isArchived: false });
  },

  async trash(id: string, userId: string) {
    let email = await prisma.email.findFirst({ where: { id, userId } });
    if (!email) {
      const candidate = await prisma.email.findFirst({ where: { id } });
      if (candidate?.threadId && await canAccessThread(candidate.threadId, userId)) {
        email = candidate;
      }
    }
    if (!email) throw Object.assign(new Error('Email not found'), { status: 404 });

    if (email.gmailMessageId && email.userId === userId) {
      try {
        const gmail = await getGmailClient(userId);
        await gmail.users.messages.trash({ userId: 'me', id: email.gmailMessageId });
      } catch (err: any) { console.warn('[EmailSync] Gmail API call failed:', err?.message || err); }
    }

    await prisma.email.update({
      where: { id },
      data: { isTrashed: true, labelIds: [...email.labelIds.filter((l) => l !== 'INBOX'), 'TRASH'] },
    });
    wsEmit('email:updated', { id, isTrashed: true });
  },

  async untrash(id: string, userId: string) {
    let email = await prisma.email.findFirst({ where: { id, userId } });
    if (!email) {
      const candidate = await prisma.email.findFirst({ where: { id } });
      if (candidate?.threadId && await canAccessThread(candidate.threadId, userId)) {
        email = candidate;
      }
    }
    if (!email) throw Object.assign(new Error('Email not found'), { status: 404 });

    if (email.gmailMessageId && email.userId === userId) {
      try {
        const gmail = await getGmailClient(userId);
        await gmail.users.messages.untrash({ userId: 'me', id: email.gmailMessageId });
      } catch (err: any) { console.warn('[EmailSync] Gmail API call failed:', err?.message || err); }
    }

    await prisma.email.update({
      where: { id },
      data: { isTrashed: false, labelIds: email.labelIds.filter((l) => l !== 'TRASH') },
    });
    wsEmit('email:updated', { id, isTrashed: false });
  },

  async batchMarkAsRead(ids: string[], userId: string) {
    // Get thread IDs for selected emails, then mark ALL emails in those threads as read
    const selectedEmails = await prisma.email.findMany({ where: { id: { in: ids }, userId }, select: { threadId: true } });
    const threadIds = [...new Set(selectedEmails.map((e) => e.threadId).filter((id): id is string => id != null))];
    const allEmails = await prisma.email.findMany({ where: { threadId: { in: threadIds }, userId, isRead: false } });
    await prisma.email.updateMany({ where: { threadId: { in: threadIds }, userId }, data: { isRead: true } });

    try {
      const gmail = await getGmailClient(userId);
      for (const email of allEmails) {
        if (email.gmailMessageId) {
          try {
            await gmail.users.messages.modify({
              userId: 'me', id: email.gmailMessageId,
              requestBody: { removeLabelIds: ['UNREAD'] },
            });
          } catch (err: any) { console.warn('[EmailSync] Gmail API call failed:', err?.message || err); }
        }
      }
    } catch (err: any) { console.warn('[EmailSync] Gmail API call failed:', err?.message || err); }

    for (const email of allEmails) wsEmit('email:updated', { id: email.id, isRead: true });
    return { count: threadIds.length };
  },

  async batchMarkAsUnread(ids: string[], userId: string) {
    const selectedEmails = await prisma.email.findMany({ where: { id: { in: ids }, userId }, select: { threadId: true } });
    const threadIds = [...new Set(selectedEmails.map((e) => e.threadId).filter((id): id is string => id != null))];
    const allEmails = await prisma.email.findMany({ where: { threadId: { in: threadIds }, userId, isRead: true } });
    await prisma.email.updateMany({ where: { threadId: { in: threadIds }, userId }, data: { isRead: false } });

    try {
      const gmail = await getGmailClient(userId);
      for (const email of allEmails) {
        if (email.gmailMessageId) {
          try {
            await gmail.users.messages.modify({
              userId: 'me', id: email.gmailMessageId,
              requestBody: { addLabelIds: ['UNREAD'] },
            });
          } catch (err: any) { console.warn('[EmailSync] Gmail API call failed:', err?.message || err); }
        }
      }
    } catch (err: any) { console.warn('[EmailSync] Gmail API call failed:', err?.message || err); }

    for (const email of allEmails) wsEmit('email:updated', { id: email.id, isRead: false });
    return { count: threadIds.length };
  },

  async batchArchive(ids: string[], userId: string) {
    const selectedEmails = await prisma.email.findMany({ where: { id: { in: ids }, userId }, select: { threadId: true } });
    const threadIds = [...new Set(selectedEmails.map((e) => e.threadId).filter((id): id is string => id != null))];
    const allEmails = await prisma.email.findMany({ where: { threadId: { in: threadIds }, userId } });

    try {
      const gmail = await getGmailClient(userId);
      for (const email of allEmails) {
        if (email.gmailMessageId) {
          try {
            await gmail.users.messages.modify({
              userId: 'me', id: email.gmailMessageId,
              requestBody: { removeLabelIds: ['INBOX'] },
            });
          } catch (err: any) { console.warn('[EmailSync] Gmail API call failed:', err?.message || err); }
        }
      }
    } catch (err: any) { console.warn('[EmailSync] Gmail API call failed:', err?.message || err); }

    for (const email of allEmails) {
      await prisma.email.update({
        where: { id: email.id },
        data: { isArchived: true, labelIds: email.labelIds.filter((l) => l !== 'INBOX') },
      });
      wsEmit('email:updated', { id: email.id, isArchived: true });
    }

    return { count: threadIds.length };
  },

  async batchTrash(ids: string[], userId: string) {
    const selectedEmails = await prisma.email.findMany({ where: { id: { in: ids }, userId }, select: { threadId: true } });
    const threadIds = [...new Set(selectedEmails.map((e) => e.threadId).filter((id): id is string => id != null))];
    const allEmails = await prisma.email.findMany({ where: { threadId: { in: threadIds }, userId } });

    try {
      const gmail = await getGmailClient(userId);
      for (const email of allEmails) {
        if (email.gmailMessageId) {
          try {
            await gmail.users.messages.trash({ userId: 'me', id: email.gmailMessageId });
          } catch (err: any) { console.warn('[EmailSync] Gmail API call failed:', err?.message || err); }
        }
      }
    } catch (err: any) { console.warn('[EmailSync] Gmail API call failed:', err?.message || err); }

    for (const email of allEmails) {
      await prisma.email.update({
        where: { id: email.id },
        data: { isTrashed: true, labelIds: [...email.labelIds.filter((l) => l !== 'INBOX'), 'TRASH'] },
      });
      wsEmit('email:updated', { id: email.id, isTrashed: true });
    }

    return { count: threadIds.length };
  },

  async convertToTask(emailId: string, data: { title?: string; priority?: string; notes?: string }, userId: string) {
    const email = await prisma.email.findFirst({ where: { id: emailId, userId } });
    if (!email) throw Object.assign(new Error('Email not found'), { status: 404 });

    // Check if already converted
    const existing = await prisma.mailToTask.findUnique({ where: { emailId } });
    if (existing) throw Object.assign(new Error('Email already converted to task'), { status: 409 });

    const task = await prisma.task.create({
      data: {
        title: data.title || email.subject,
        description: email.snippet || undefined,
        priority: (data.priority as any) || 'MEDIUM',
        customerId: email.customerId,
        userId,
      },
    });

    await prisma.mailToTask.create({
      data: {
        emailId,
        taskId: task.id,
        conversionNote: data.notes || null,
      },
    });

    return task;
  },

  async getUnreadCount(userId: string) {
    const sharedThreadIds = await getSharedThreadIds(userId);
    const where: Prisma.EmailWhereInput = sharedThreadIds.length > 0
      ? { isRead: false, OR: [{ userId }, { threadId: { in: sharedThreadIds } }] }
      : { isRead: false, userId };
    return prisma.email.count({ where });
  },

  async sendEmail(data: { to: string[]; cc?: string[]; bcc?: string[]; subject: string; htmlBody: string; attachments?: Array<{ filename: string; content: string; contentType: string; size: number }> }, userId: string) {
    const gmail = await getGmailClient(userId);
    const auth = await prisma.googleAuth.findFirst({ where: { userId } });
    if (!auth?.email) throw Object.assign(new Error('Google not connected'), { status: 400 });

    const raw = await buildMimeMessage({
      from: auth.email,
      to: data.to,
      cc: data.cc,
      bcc: data.bcc,
      subject: data.subject,
      htmlBody: data.htmlBody,
      attachments: data.attachments?.map(a => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    });

    const sendRes = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    // Fetch the sent message to store locally
    if (sendRes.data.id) {
      try {
        const msgRes = await gmail.users.messages.get({
          userId: 'me',
          id: sendRes.data.id,
          format: 'full',
        });
        await this.upsertMessage(msgRes.data, userId);
      } catch (err: any) {
        console.warn('[EmailSync] Gmail API call failed:', err?.message || err);
      }
    }

    wsEmit('email:sent', { threadId: sendRes.data.threadId });
    return { messageId: sendRes.data.id, threadId: sendRes.data.threadId };
  },

  async replyToEmail(emailId: string, data: { htmlBody: string; replyAll?: boolean; cc?: string[]; bcc?: string[]; attachments?: Array<{ filename: string; content: string; contentType: string; size: number }> }, userId: string) {
    const gmail = await getGmailClient(userId);
    const auth = await prisma.googleAuth.findFirst({ where: { userId } });
    if (!auth?.email) throw Object.assign(new Error('Google not connected'), { status: 400 });

    const original = await prisma.email.findFirst({ where: { id: emailId, userId } });
    if (!original) throw Object.assign(new Error('Email not found'), { status: 404 });

    const userEmail = auth.email.toLowerCase();

    // Determine recipients
    let to: string[];
    let cc: string[] = [];

    if (data.replyAll) {
      to = [original.from];
      // Combine original to + cc, exclude user's own email
      const allCc = [...original.to, ...original.cc, ...(data.cc || [])];
      cc = [...new Set(allCc.map((e) => e.toLowerCase().trim()))].filter((e) => e !== userEmail && e !== original.from.toLowerCase());
    } else {
      to = [original.from];
      cc = data.cc || [];
    }

    // Deduplicate case-insensitively
    to = [...new Set(to.map((e) => e.toLowerCase().trim()))].filter((e) => e !== userEmail);
    if (to.length === 0) to = [original.from]; // Fallback: can't remove all recipients

    // Subject
    const subject = original.subject.match(/^Re:/i) ? original.subject : `Re: ${original.subject}`;

    // Build quoted HTML
    const originalDate = format(original.receivedAt, 'EEE, MMM d, yyyy \'at\' h:mm a');
    const originalSender = original.fromName ? `${original.fromName} &lt;${original.from}&gt;` : original.from;

    // Fetch original body if not stored
    let originalBody = '';
    if (original.body) {
      originalBody = original.body;
    } else if (original.gmailMessageId) {
      try {
        const msgRes = await gmail.users.messages.get({ userId: 'me', id: original.gmailMessageId, format: 'full' });
        originalBody = extractBody(msgRes.data.payload || {}) || original.snippet || '';
      } catch {
        originalBody = original.snippet || '';
      }
    }

    const quotedHtml = `<div style="border-left:2px solid #ccc;padding-left:12px;margin-top:16px;color:#666"><p>On ${originalDate}, ${originalSender} wrote:</p>${originalBody}</div>`;
    const fullHtml = `${data.htmlBody}${quotedHtml}`;

    // Threading headers
    const inReplyTo = original.messageId || undefined;
    const references = original.references
      ? `${original.references} ${original.messageId || ''}`
      : original.messageId || undefined;

    const raw = await buildMimeMessage({
      from: auth.email,
      to,
      cc: cc.length > 0 ? cc : undefined,
      bcc: data.bcc,
      subject,
      htmlBody: fullHtml,
      inReplyTo: inReplyTo?.trim(),
      references: references?.trim(),
      attachments: data.attachments?.map(a => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    });

    const sendRes = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, threadId: original.threadId || undefined },
    });

    if (sendRes.data.id) {
      try {
        const msgRes = await gmail.users.messages.get({ userId: 'me', id: sendRes.data.id, format: 'full' });
        await this.upsertMessage(msgRes.data, userId);
      } catch (err: any) {
        console.warn('[EmailSync] Gmail API call failed:', err?.message || err);
      }
    }

    wsEmit('email:sent', { threadId: sendRes.data.threadId });
    return { messageId: sendRes.data.id, threadId: sendRes.data.threadId };
  },

  async forwardEmail(emailId: string, data: { to: string[]; cc?: string[]; bcc?: string[]; htmlBody: string; attachments?: Array<{ filename: string; content: string; contentType: string; size: number }>; forwardExistingAttachments?: string[] }, userId: string) {
    const gmail = await getGmailClient(userId);
    const auth = await prisma.googleAuth.findFirst({ where: { userId } });
    if (!auth?.email) throw Object.assign(new Error('Google not connected'), { status: 400 });

    const original = await prisma.email.findFirst({ where: { id: emailId, userId } });
    if (!original) throw Object.assign(new Error('Email not found'), { status: 404 });

    // Subject
    const subject = original.subject.match(/^Fwd:/i) ? original.subject : `Fwd: ${original.subject}`;

    // Fetch original body
    let originalBody = '';
    if (original.body) {
      originalBody = original.body;
    } else if (original.gmailMessageId) {
      try {
        const msgRes = await gmail.users.messages.get({ userId: 'me', id: original.gmailMessageId, format: 'full' });
        originalBody = extractBody(msgRes.data.payload || {}) || original.snippet || '';
      } catch {
        originalBody = original.snippet || '';
      }
    }

    const originalDate = format(original.receivedAt, 'EEE, MMM d, yyyy \'at\' h:mm a');
    const forwardedHtml = `<div style="margin-top:16px;padding-top:12px;border-top:1px solid #ccc"><p style="color:#666">---------- Forwarded message ----------<br>From: ${original.fromName || ''} &lt;${original.from}&gt;<br>Date: ${originalDate}<br>Subject: ${original.subject}<br>To: ${original.to.join(', ')}</p>${originalBody}</div>`;
    const fullHtml = `${data.htmlBody}${forwardedHtml}`;

    // Deduplicate recipients
    const to = [...new Set(data.to.map((e) => e.toLowerCase().trim()))];
    const cc = data.cc ? [...new Set(data.cc.map((e) => e.toLowerCase().trim()))] : undefined;

    // Collect attachments: new uploads + existing email attachments to forward
    const allAttachments: MimeAttachment[] = [];

    if (data.attachments) {
      for (const a of data.attachments) {
        allAttachments.push({ filename: a.filename, content: a.content, contentType: a.contentType });
      }
    }

    if (data.forwardExistingAttachments && data.forwardExistingAttachments.length > 0) {
      const existingAtts = await prisma.emailAttachment.findMany({
        where: { id: { in: data.forwardExistingAttachments }, emailId, email: { userId } },
        include: { email: true },
      });

      const downloaded = await Promise.all(
        existingAtts.map(async (att) => {
          const res = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: att.email.gmailMessageId!,
            id: att.gmailAttachmentId,
          });
          return {
            filename: att.filename,
            content: res.data.data || '',
            contentType: att.mimeType,
          } as MimeAttachment;
        })
      );

      allAttachments.push(...downloaded);
    }

    const raw = await buildMimeMessage({
      from: auth.email,
      to,
      cc,
      bcc: data.bcc,
      subject,
      htmlBody: fullHtml,
      attachments: allAttachments.length > 0 ? allAttachments : undefined,
      // No inReplyTo/references/threadId for forwards — they're new conversations
    });

    const sendRes = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    if (sendRes.data.id) {
      try {
        const msgRes = await gmail.users.messages.get({ userId: 'me', id: sendRes.data.id, format: 'full' });
        await this.upsertMessage(msgRes.data, userId);
      } catch (err: any) {
        console.warn('[EmailSync] Gmail API call failed:', err?.message || err);
      }
    }

    wsEmit('email:sent', { threadId: sendRes.data.threadId });
    return { messageId: sendRes.data.id, threadId: sendRes.data.threadId };
  },

  async shareThread(userId: string, threadId: string, recipientUserIds: string[]) {
    // Verify caller owns at least one email in this thread
    const owns = await prisma.email.findFirst({ where: { threadId, userId } });
    if (!owns) throw Object.assign(new Error('Thread not found'), { status: 404 });

    // Filter out self-sharing
    const validIds = recipientUserIds.filter(id => id !== userId);
    if (validIds.length === 0) throw Object.assign(new Error('Cannot share with yourself'), { status: 400 });

    await prisma.emailThreadShare.createMany({
      data: validIds.map(recipientId => ({
        threadId,
        sharedByUserId: userId,
        sharedWithUserId: recipientId,
      })),
      skipDuplicates: true,
    });

    // Get sharer's name for notification
    const sharer = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });

    const { wsEmitToUsers } = await import('../websocket.js');
    wsEmitToUsers(validIds, 'email:shared', {
      threadId,
      sharedBy: { name: sharer?.name, email: sharer?.email },
      subject: owns.subject,
    });

    return { success: true, sharedWith: validIds.length };
  },

  async unshareThread(userId: string, threadId: string, recipientUserId: string) {
    await prisma.emailThreadShare.deleteMany({
      where: { threadId, sharedByUserId: userId, sharedWithUserId: recipientUserId },
    });
    return { success: true };
  },

  async getThreadShares(userId: string, threadId: string) {
    // Verify caller owns the thread
    const owns = await prisma.email.findFirst({ where: { threadId, userId } });
    if (!owns) throw Object.assign(new Error('Thread not found'), { status: 404 });

    const shares = await prisma.emailThreadShare.findMany({
      where: { threadId, sharedByUserId: userId },
      include: { sharedWith: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return shares;
  },
};
