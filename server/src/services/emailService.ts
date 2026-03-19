import { google } from 'googleapis';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { getGmailClient } from '../lib/gmail.js';
import { customerService } from './customerService.js';
import { extractDomain, isPersonalDomain, normalizeDomain, parseName } from '../utils/domainResolver.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';
import { wsEmit } from '../websocket.js';
import { buildMimeMessage } from '../utils/mimeBuilder.js';
import { format } from 'date-fns';

// Parse "Display Name <email@domain.com>" format
function parseEmailAddress(raw: string): { email: string; name: string | null } {
  const match = raw.match(/^(.+?)\s*<([^>]+)>$/);
  if (match) {
    let name = match[1].trim()
      .replace(/^["']+|["']+$/g, '')  // Strip leading/trailing quotes (single and double)
      .replace(/\[.*?\]/g, '')         // Strip bracketed suffixes like [C]
      .trim();
    return { name: name || null, email: match[2].toLowerCase() };
  }
  // Fallback: try to extract email from angle brackets anywhere in the string
  const emailMatch = raw.match(/<([^>]+@[^>]+)>/);
  if (emailMatch) {
    return { name: null, email: emailMatch[1].toLowerCase() };
  }
  return { name: null, email: raw.trim().toLowerCase() };
}

// Parse comma-separated email addresses
function parseEmailList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map((s) => {
    const { email } = parseEmailAddress(s.trim());
    return email;
  }).filter(Boolean);
}

// Extract attachment metadata from Gmail message payload
function extractAttachments(payload: any): Array<{ filename: string; mimeType: string; size: number; attachmentId: string }> {
  const attachments: Array<{ filename: string; mimeType: string; size: number; attachmentId: string }> = [];

  function walk(parts: any[]) {
    if (!parts) return;
    for (const part of parts) {
      if (part.body?.attachmentId && part.filename) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size || 0,
          attachmentId: part.body.attachmentId,
        });
      }
      if (part.parts) walk(part.parts);
    }
  }

  if (payload.parts) walk(payload.parts);
  return attachments;
}

// Convert plain text to basic HTML: escape, linkify, preserve line breaks
function plainTextToHtml(text: string): string {
  // HTML-escape special characters
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Convert URLs to clickable links
  html = html.replace(
    /(https?:\/\/[^\s<>"')\]]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  // Convert email addresses to mailto links
  html = html.replace(
    /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
    '<a href="mailto:$1">$1</a>'
  );

  // Convert newlines to <br> tags
  html = html.replace(/\n/g, '<br>');

  return html;
}

// Extract HTML or plain text body from Gmail message payload
function extractBody(payload: any): string | null {
  function findPart(parts: any[], mimeType: string): string | null {
    if (!parts) return null;
    for (const part of parts) {
      if (part.mimeType === mimeType && part.body?.data) {
        return Buffer.from(part.body.data, 'base64url').toString('utf-8');
      }
      if (part.parts) {
        const found = findPart(part.parts, mimeType);
        if (found) return found;
      }
    }
    return null;
  }

  // Prefer HTML, fall back to plain text (converted to HTML)
  if (payload.parts) {
    const html = findPart(payload.parts, 'text/html');
    if (html) return html;
    const plain = findPart(payload.parts, 'text/plain');
    if (plain) return plainTextToHtml(plain);
  }

  // Single-part message
  if (payload.body?.data) {
    const raw = Buffer.from(payload.body.data, 'base64url').toString('utf-8');
    // If single-part and not HTML, treat as plain text
    if (payload.mimeType === 'text/html') return raw;
    return plainTextToHtml(raw);
  }

  return null;
}

interface EmailQueryParams {
  search?: string;
  customerId?: string;
  contactEmail?: string;
  isRead?: string;
  hasAttachment?: string;
  folder?: string; // 'inbox' | 'sent' | 'starred'
  from?: string;
  to?: string;
  subject?: string;
  dateAfter?: string;
  dateBefore?: string;
  page?: string;
  limit?: string;
}

export const emailService = {
  async syncFromGmail() {
    const gmail = await getGmailClient();
    const auth = await prisma.googleAuth.findFirst();
    if (!auth) throw Object.assign(new Error('Google not connected'), { status: 400 });

    let synced = 0;
    let customersCreated = 0;
    let contactsCreated = 0;
    let labelsChanged = 0;

    try {
      if (auth.lastHistoryId) {
        // Incremental sync
        const result = await this.incrementalSync(gmail, auth.lastHistoryId);
        synced = result.synced;
        customersCreated = result.customersCreated;
        contactsCreated = result.contactsCreated;
        labelsChanged = result.labelsChanged;
      } else {
        // Initial sync — last 3 months
        const result = await this.initialSync(gmail);
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

  async initialSync(gmail: ReturnType<typeof google.gmail>) {
    let synced = 0;
    let customersCreated = 0;
    let contactsCreated = 0;
    let pageToken: string | undefined;

    do {
      const listRes = await gmail.users.messages.list({
        userId: 'me',
        q: 'newer_than:3m',
        maxResults: 100,
        pageToken,
      });

      const messages = listRes.data.messages || [];
      pageToken = listRes.data.nextPageToken || undefined;

      // Process in batches of 10 for rate limiting
      for (let i = 0; i < messages.length; i += 10) {
        const batch = messages.slice(i, i + 10);
        const results = await Promise.all(
          batch.map((msg) =>
            gmail.users.messages.get({
              userId: 'me',
              id: msg.id!,
              format: 'full',
            }).catch(() => null)
          )
        );

        for (const res of results) {
          if (!res) continue;
          const msg = res.data;
          const result = await this.upsertMessage(msg);
          if (result) {
            synced++;
            customersCreated += result.customersCreated;
            contactsCreated += result.contactsCreated;
          }
        }
      }
    } while (pageToken);

    return { synced, customersCreated, contactsCreated, labelsChanged: 0 };
  },

  async incrementalSync(gmail: ReturnType<typeof google.gmail>, startHistoryId: string) {
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
                const result = await this.upsertMessage(msgRes.data);
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
              await prisma.email.deleteMany({ where: { gmailMessageId: deleted.message.id } });
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
                  where: { gmailMessageId: labelChange.message.id },
                  data: updates,
                });
                if (result.count > 0) labelsChanged++;
              }
              // Also update the stored labelIds array
              const existing = await prisma.email.findFirst({ where: { gmailMessageId: labelChange.message.id } });
              if (existing) {
                const newLabels = [...new Set([...existing.labelIds, ...labels])];
                await prisma.email.updateMany({
                  where: { gmailMessageId: labelChange.message.id },
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
                  where: { gmailMessageId: labelChange.message.id },
                  data: updates,
                });
                if (result.count > 0) labelsChanged++;
              }
              // Also update the stored labelIds array
              const existing = await prisma.email.findFirst({ where: { gmailMessageId: labelChange.message.id } });
              if (existing) {
                const newLabels = existing.labelIds.filter((l) => !labels.includes(l));
                await prisma.email.updateMany({
                  where: { gmailMessageId: labelChange.message.id },
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
        return this.initialSync(gmail);
      }
      throw err;
    }

    return { synced, customersCreated, contactsCreated, labelsChanged };
  },

  async upsertMessage(msg: any) {
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
        const { customer, created: cCreated } = await customerService.findOrCreateByDomain(domain);
        if (!customerId) customerId = customer.id;
        if (cCreated) customersCreated++;

        // Try to find display name for this email
        let displayName: string | null = null;
        if (email === fromEmail) displayName = fromName;
        const { created: contactCreated } = await customerService.findOrCreateContact(email, displayName, customer.id);
        if (contactCreated) contactsCreated++;
      } catch {
        // Skip on error
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
      where: { gmailMessageId: msg.id },
      update: emailData,
      create: {
        gmailMessageId: msg.id,
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

  async findAllThreads(query: EmailQueryParams) {
    const pagination = parsePagination(query);

    const where: Prisma.EmailWhereInput = {};
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

    // Get distinct threads: for each threadId, get the most recent email
    // First get all matching thread IDs with count
    const threadIds = await prisma.email.groupBy({
      by: ['threadId'],
      where,
      _count: { id: true },
      _max: { receivedAt: true },
      orderBy: { _max: { receivedAt: 'desc' } },
      skip: pagination.skip,
      take: pagination.limit,
    });

    const totalResult = await prisma.email.groupBy({
      by: ['threadId'],
      where,
    });
    const total = totalResult.length;

    // For each thread, get the latest email + unread count
    const threads = await Promise.all(
      threadIds.map(async (t) => {
        const [latestEmail, unreadCount] = await Promise.all([
          prisma.email.findFirst({
            where: { ...where, threadId: t.threadId },
            orderBy: { receivedAt: 'desc' },
            include: {
              customer: { select: { id: true, name: true, domain: true, logoUrl: true } },
              attachments: true,
            },
          }),
          prisma.email.count({
            where: { threadId: t.threadId, isRead: false },
          }),
        ]);

        return {
          threadId: t.threadId,
          messageCount: t._count.id,
          unreadCount,
          latestEmail,
        };
      })
    );

    return {
      data: threads.filter((t) => t.latestEmail),
      meta: paginationMeta(total, pagination),
    };
  },

  async findThread(threadId: string) {
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

  async findById(id: string) {
    const email = await prisma.email.findUnique({
      where: { id },
      include: {
        attachments: true,
        customer: { select: { id: true, name: true, domain: true, logoUrl: true } },
        mailToTask: { include: { task: true } },
      },
    });

    if (!email) throw Object.assign(new Error('Email not found'), { status: 404 });

    // On-demand body fetch if body is null
    if (email.body === null && email.gmailMessageId) {
      try {
        const gmail = await getGmailClient();
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
      } catch {
        // Could not fetch body
      }
    }

    return email;
  },

  async getAttachment(emailId: string, attachmentId: string) {
    const attachment = await prisma.emailAttachment.findFirst({
      where: { id: attachmentId, emailId },
      include: { email: true },
    });

    if (!attachment || !attachment.email.gmailMessageId) {
      throw Object.assign(new Error('Attachment not found'), { status: 404 });
    }

    const gmail = await getGmailClient();
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

  async markAsRead(id: string) {
    const email = await prisma.email.findUnique({ where: { id } });
    if (!email) throw Object.assign(new Error('Email not found'), { status: 404 });

    await prisma.email.update({ where: { id }, data: { isRead: true } });
    wsEmit('email:updated', { id, isRead: true });

    // Sync to Gmail (best effort)
    if (email.gmailMessageId) {
      try {
        const gmail = await getGmailClient();
        await gmail.users.messages.modify({
          userId: 'me', id: email.gmailMessageId,
          requestBody: { removeLabelIds: ['UNREAD'] },
        });
      } catch { /* best effort */ }
    }
  },

  async markAsUnread(id: string) {
    const email = await prisma.email.findUnique({ where: { id } });
    if (!email) throw Object.assign(new Error('Email not found'), { status: 404 });

    await prisma.email.update({ where: { id }, data: { isRead: false } });
    wsEmit('email:updated', { id, isRead: false });

    if (email.gmailMessageId) {
      try {
        const gmail = await getGmailClient();
        await gmail.users.messages.modify({
          userId: 'me', id: email.gmailMessageId,
          requestBody: { addLabelIds: ['UNREAD'] },
        });
      } catch { /* best effort */ }
    }
  },

  async toggleStar(id: string) {
    const email = await prisma.email.findUnique({ where: { id } });
    if (!email) throw Object.assign(new Error('Email not found'), { status: 404 });

    const newStarred = !email.isStarred;
    await prisma.email.update({ where: { id }, data: { isStarred: newStarred } });
    wsEmit('email:updated', { id, isStarred: newStarred });

    if (email.gmailMessageId) {
      try {
        const gmail = await getGmailClient();
        await gmail.users.messages.modify({
          userId: 'me', id: email.gmailMessageId,
          requestBody: newStarred
            ? { addLabelIds: ['STARRED'] }
            : { removeLabelIds: ['STARRED'] },
        });
      } catch { /* best effort */ }
    }

    return { isStarred: newStarred };
  },

  async archive(id: string) {
    const email = await prisma.email.findUnique({ where: { id } });
    if (!email) throw Object.assign(new Error('Email not found'), { status: 404 });

    if (email.gmailMessageId) {
      try {
        const gmail = await getGmailClient();
        await gmail.users.messages.modify({
          userId: 'me', id: email.gmailMessageId,
          requestBody: { removeLabelIds: ['INBOX'] },
        });
      } catch { /* best effort */ }
    }

    await prisma.email.update({
      where: { id },
      data: { isArchived: true, labelIds: email.labelIds.filter((l) => l !== 'INBOX') },
    });
    wsEmit('email:updated', { id, isArchived: true });
  },

  async unarchive(id: string) {
    const email = await prisma.email.findUnique({ where: { id } });
    if (!email) throw Object.assign(new Error('Email not found'), { status: 404 });

    if (email.gmailMessageId) {
      try {
        const gmail = await getGmailClient();
        await gmail.users.messages.modify({
          userId: 'me', id: email.gmailMessageId,
          requestBody: { addLabelIds: ['INBOX'] },
        });
      } catch { /* best effort */ }
    }

    await prisma.email.update({
      where: { id },
      data: { isArchived: false, labelIds: [...email.labelIds, 'INBOX'] },
    });
    wsEmit('email:updated', { id, isArchived: false });
  },

  async trash(id: string) {
    const email = await prisma.email.findUnique({ where: { id } });
    if (!email) throw Object.assign(new Error('Email not found'), { status: 404 });

    if (email.gmailMessageId) {
      try {
        const gmail = await getGmailClient();
        await gmail.users.messages.trash({ userId: 'me', id: email.gmailMessageId });
      } catch { /* best effort */ }
    }

    await prisma.email.update({
      where: { id },
      data: { isTrashed: true, labelIds: [...email.labelIds.filter((l) => l !== 'INBOX'), 'TRASH'] },
    });
    wsEmit('email:updated', { id, isTrashed: true });
  },

  async untrash(id: string) {
    const email = await prisma.email.findUnique({ where: { id } });
    if (!email) throw Object.assign(new Error('Email not found'), { status: 404 });

    if (email.gmailMessageId) {
      try {
        const gmail = await getGmailClient();
        await gmail.users.messages.untrash({ userId: 'me', id: email.gmailMessageId });
      } catch { /* best effort */ }
    }

    await prisma.email.update({
      where: { id },
      data: { isTrashed: false, labelIds: email.labelIds.filter((l) => l !== 'TRASH') },
    });
    wsEmit('email:updated', { id, isTrashed: false });
  },

  async batchMarkAsRead(ids: string[]) {
    // Get thread IDs for selected emails, then mark ALL emails in those threads as read
    const selectedEmails = await prisma.email.findMany({ where: { id: { in: ids } }, select: { threadId: true } });
    const threadIds = [...new Set(selectedEmails.map((e) => e.threadId).filter((id): id is string => id != null))];
    const allEmails = await prisma.email.findMany({ where: { threadId: { in: threadIds }, isRead: false } });
    await prisma.email.updateMany({ where: { threadId: { in: threadIds } }, data: { isRead: true } });

    try {
      const gmail = await getGmailClient();
      for (const email of allEmails) {
        if (email.gmailMessageId) {
          try {
            await gmail.users.messages.modify({
              userId: 'me', id: email.gmailMessageId,
              requestBody: { removeLabelIds: ['UNREAD'] },
            });
          } catch { /* best effort */ }
        }
      }
    } catch { /* Gmail not connected */ }

    for (const email of allEmails) wsEmit('email:updated', { id: email.id, isRead: true });
    return { count: threadIds.length };
  },

  async batchMarkAsUnread(ids: string[]) {
    const selectedEmails = await prisma.email.findMany({ where: { id: { in: ids } }, select: { threadId: true } });
    const threadIds = [...new Set(selectedEmails.map((e) => e.threadId).filter((id): id is string => id != null))];
    const allEmails = await prisma.email.findMany({ where: { threadId: { in: threadIds }, isRead: true } });
    await prisma.email.updateMany({ where: { threadId: { in: threadIds } }, data: { isRead: false } });

    try {
      const gmail = await getGmailClient();
      for (const email of allEmails) {
        if (email.gmailMessageId) {
          try {
            await gmail.users.messages.modify({
              userId: 'me', id: email.gmailMessageId,
              requestBody: { addLabelIds: ['UNREAD'] },
            });
          } catch { /* best effort */ }
        }
      }
    } catch { /* Gmail not connected */ }

    for (const email of allEmails) wsEmit('email:updated', { id: email.id, isRead: false });
    return { count: threadIds.length };
  },

  async batchArchive(ids: string[]) {
    const selectedEmails = await prisma.email.findMany({ where: { id: { in: ids } }, select: { threadId: true } });
    const threadIds = [...new Set(selectedEmails.map((e) => e.threadId).filter((id): id is string => id != null))];
    const allEmails = await prisma.email.findMany({ where: { threadId: { in: threadIds } } });

    try {
      const gmail = await getGmailClient();
      for (const email of allEmails) {
        if (email.gmailMessageId) {
          try {
            await gmail.users.messages.modify({
              userId: 'me', id: email.gmailMessageId,
              requestBody: { removeLabelIds: ['INBOX'] },
            });
          } catch { /* best effort */ }
        }
      }
    } catch { /* Gmail not connected */ }

    for (const email of allEmails) {
      await prisma.email.update({
        where: { id: email.id },
        data: { isArchived: true, labelIds: email.labelIds.filter((l) => l !== 'INBOX') },
      });
      wsEmit('email:updated', { id: email.id, isArchived: true });
    }

    return { count: threadIds.length };
  },

  async batchTrash(ids: string[]) {
    const selectedEmails = await prisma.email.findMany({ where: { id: { in: ids } }, select: { threadId: true } });
    const threadIds = [...new Set(selectedEmails.map((e) => e.threadId).filter((id): id is string => id != null))];
    const allEmails = await prisma.email.findMany({ where: { threadId: { in: threadIds } } });

    try {
      const gmail = await getGmailClient();
      for (const email of allEmails) {
        if (email.gmailMessageId) {
          try {
            await gmail.users.messages.trash({ userId: 'me', id: email.gmailMessageId });
          } catch { /* best effort */ }
        }
      }
    } catch { /* Gmail not connected */ }

    for (const email of allEmails) {
      await prisma.email.update({
        where: { id: email.id },
        data: { isTrashed: true, labelIds: [...email.labelIds.filter((l) => l !== 'INBOX'), 'TRASH'] },
      });
      wsEmit('email:updated', { id: email.id, isTrashed: true });
    }

    return { count: threadIds.length };
  },

  async convertToTask(emailId: string, data: { title?: string; priority?: string; notes?: string }) {
    const email = await prisma.email.findUnique({ where: { id: emailId } });
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

  async getUnreadCount() {
    return prisma.email.count({ where: { isRead: false } });
  },

  async sendEmail(data: { to: string[]; cc?: string[]; bcc?: string[]; subject: string; htmlBody: string }) {
    const gmail = await getGmailClient();
    const auth = await prisma.googleAuth.findFirst();
    if (!auth?.email) throw Object.assign(new Error('Google not connected'), { status: 400 });

    const raw = await buildMimeMessage({
      from: auth.email,
      to: data.to,
      cc: data.cc,
      bcc: data.bcc,
      subject: data.subject,
      htmlBody: data.htmlBody,
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
        await this.upsertMessage(msgRes.data);
      } catch {
        // Best effort local storage
      }
    }

    wsEmit('email:sent', { threadId: sendRes.data.threadId });
    return { messageId: sendRes.data.id, threadId: sendRes.data.threadId };
  },

  async replyToEmail(emailId: string, data: { htmlBody: string; replyAll?: boolean; cc?: string[]; bcc?: string[] }) {
    const gmail = await getGmailClient();
    const auth = await prisma.googleAuth.findFirst();
    if (!auth?.email) throw Object.assign(new Error('Google not connected'), { status: 400 });

    const original = await prisma.email.findUnique({ where: { id: emailId } });
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
    });

    const sendRes = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, threadId: original.threadId || undefined },
    });

    if (sendRes.data.id) {
      try {
        const msgRes = await gmail.users.messages.get({ userId: 'me', id: sendRes.data.id, format: 'full' });
        await this.upsertMessage(msgRes.data);
      } catch {
        // Best effort
      }
    }

    wsEmit('email:sent', { threadId: sendRes.data.threadId });
    return { messageId: sendRes.data.id, threadId: sendRes.data.threadId };
  },

  async forwardEmail(emailId: string, data: { to: string[]; cc?: string[]; bcc?: string[]; htmlBody: string }) {
    const gmail = await getGmailClient();
    const auth = await prisma.googleAuth.findFirst();
    if (!auth?.email) throw Object.assign(new Error('Google not connected'), { status: 400 });

    const original = await prisma.email.findUnique({ where: { id: emailId } });
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

    const raw = await buildMimeMessage({
      from: auth.email,
      to,
      cc,
      bcc: data.bcc,
      subject,
      htmlBody: fullHtml,
      // No inReplyTo/references/threadId for forwards — they're new conversations
    });

    const sendRes = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });

    if (sendRes.data.id) {
      try {
        const msgRes = await gmail.users.messages.get({ userId: 'me', id: sendRes.data.id, format: 'full' });
        await this.upsertMessage(msgRes.data);
      } catch {
        // Best effort
      }
    }

    wsEmit('email:sent', { threadId: sendRes.data.threadId });
    return { messageId: sendRes.data.id, threadId: sendRes.data.threadId };
  },
};
