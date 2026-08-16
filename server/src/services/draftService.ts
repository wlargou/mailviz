import type { gmail_v1 } from 'googleapis';
import type { EmailDraft } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { getGmailClient } from '../lib/gmail.js';
import { buildMimeMessage } from '../utils/mimeBuilder.js';
import { extractAttachments, extractBody, parseEmailList } from '../utils/emailHelpers.js';
import { wsEmitToUser } from '../websocket.js';
import { auditService } from './auditService.js';

/**
 * Gmail drafts.
 *
 * WHERE A DRAFT LIVES: in Gmail. `users.drafts` is the source of truth, and
 * every write here — create, update, send, delete — goes to Google first and
 * only then touches Postgres. The `email_drafts` table is a mirror, not a
 * store: it exists so the Drafts folder renders from the database like every
 * other folder instead of fanning out to `drafts.get` per row on each page
 * load, and so a draft composed in the Gmail UI shows up in this app.
 *
 * The consequence, accepted deliberately: there is no local-only draft, so
 * saving costs one Gmail round-trip. That is why saving is an explicit user
 * action and not a per-keystroke autosave — see `save`.
 *
 * CONFLICTS: Gmail's drafts API has no etag or If-Match, so two editors of one
 * draft are last-write-wins and neither side can detect it. Two mitigations:
 * `open` re-reads the draft from Gmail rather than trusting the mirror, so an
 * edit made in Gmail is picked up at the moment the compose window opens; and
 * `syncDrafts` never deletes a mirror row that was written after the sync
 * started, so a save racing a sync cannot lose the row out from under an open
 * compose window.
 */

/**
 * What the Drafts list needs to show about an attachment — metadata, not bytes.
 *
 * A type alias rather than an interface so it keeps an implicit index
 * signature and is therefore assignable to Prisma's `InputJsonValue` when it
 * goes into the mirror's `attachments` column.
 */
export type DraftAttachmentMeta = {
  filename: string;
  mimeType: string;
  size: number;
};

/** An attachment handed back to the compose window, bytes included. */
export interface DraftAttachmentContent extends DraftAttachmentMeta {
  /** Standard base64 (not base64url) — the same shape compose uploads. */
  content: string;
}

export interface DraftComposeInput {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  htmlBody: string;
  attachments: Array<{ filename: string; content: string; contentType: string; size: number }>;
  /** Set when the draft is a reply, so the sent message lands in the thread. */
  replyToEmailId?: string;
}

export interface DraftDetail {
  id: string;
  gmailDraftId: string;
  threadId: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  htmlBody: string;
  lastEditedAt: Date;
  attachments: DraftAttachmentContent[];
}

/** The fields a Gmail draft message contributes to a mirror row. */
interface ParsedDraft {
  gmailMessageId: string | null;
  threadId: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  htmlBody: string;
  snippet: string | null;
  attachments: DraftAttachmentMeta[];
  attachmentIds: Array<{ filename: string; attachmentId: string; mimeType: string; size: number }>;
  lastEditedAt: Date;
}

/** Total attachment bytes we are willing to rehydrate into a compose window. */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function parseDraftMessage(msg: gmail_v1.Schema$Message | undefined): ParsedDraft {
  const headers: Record<string, string> = {};
  for (const h of msg?.payload?.headers ?? []) {
    if (h.name) headers[h.name.toLowerCase()] = h.value ?? '';
  }

  const attachmentIds = extractAttachments(msg?.payload ?? {});

  return {
    gmailMessageId: msg?.id ?? null,
    threadId: msg?.threadId ?? null,
    to: parseEmailList(headers['to']),
    cc: parseEmailList(headers['cc']),
    bcc: parseEmailList(headers['bcc']),
    subject: (headers['subject'] ?? '').slice(0, 500),
    htmlBody: extractBody(msg?.payload ?? {}) ?? '',
    snippet: msg?.snippet ?? null,
    attachments: attachmentIds.map((a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.size })),
    attachmentIds,
    lastEditedAt: msg?.internalDate ? new Date(Number(msg.internalDate)) : new Date(),
  };
}

/** A one-line preview for the drafts list when Gmail has not given us a snippet. */
function bodyPreview(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function attachmentMeta(draft: EmailDraft): DraftAttachmentMeta[] {
  // `attachments` is Json; anything we did not write ourselves is ignored
  // rather than trusted into the response shape.
  const raw = draft.attachments;
  if (!Array.isArray(raw)) return [];
  const result: DraftAttachmentMeta[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.filename !== 'string') continue;
    result.push({
      filename: record.filename,
      mimeType: typeof record.mimeType === 'string' ? record.mimeType : 'application/octet-stream',
      size: typeof record.size === 'number' ? record.size : 0,
    });
  }
  return result;
}

export const draftService = {
  /**
   * Reconcile the mirror against Gmail.
   *
   * Cost in the steady state is a single `drafts.list` call: the list response
   * carries each draft's current message id, and Gmail mints a new message id
   * on every edit, so a draft whose message id matches the mirror is known to
   * be unchanged and is never fetched.
   */
  async syncDrafts(userId: string) {
    const startedAt = new Date();
    const gmail = await getGmailClient(userId);

    let synced = 0;
    let pageToken: string | undefined;
    const seenDraftIds: string[] = [];

    do {
      const res: { data: gmail_v1.Schema$ListDraftsResponse } = await gmail.users.drafts.list({
        userId: 'me',
        maxResults: 100,
        pageToken,
      });

      for (const listed of res.data.drafts ?? []) {
        if (!listed.id) continue;
        seenDraftIds.push(listed.id);

        const existing = await prisma.emailDraft.findFirst({
          where: { userId, gmailDraftId: listed.id },
        });
        if (existing && listed.message?.id && existing.gmailMessageId === listed.message.id) {
          continue; // unchanged since the last sync
        }

        try {
          const full = await gmail.users.drafts.get({ userId: 'me', id: listed.id, format: 'full' });
          await this.upsertMirror(userId, listed.id, parseDraftMessage(full.data.message ?? undefined));
          synced++;
        } catch (err: unknown) {
          // A draft can be sent or deleted between the list and the get.
          console.warn('[DraftSync] Failed to fetch draft:', err instanceof Error ? err.message : err);
        }
      }

      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    // Drop mirror rows for drafts that no longer exist in Gmail. The
    // `updatedAt` guard keeps a draft saved *during* this sync — which the
    // `drafts.list` page above could not have contained — from being deleted
    // while its compose window is still open.
    const { count: removed } = await prisma.emailDraft.deleteMany({
      where: {
        userId,
        updatedAt: { lt: startedAt },
        ...(seenDraftIds.length > 0 ? { gmailDraftId: { notIn: seenDraftIds } } : {}),
      },
    });

    if (synced > 0 || removed > 0) {
      wsEmitToUser(userId, 'drafts:synced', { synced, removed });
    }

    return { synced, removed };
  },

  /** Write one parsed Gmail draft into the mirror. Scoped by userId throughout. */
  async upsertMirror(userId: string, gmailDraftId: string, parsed: ParsedDraft) {
    const data = {
      gmailMessageId: parsed.gmailMessageId,
      threadId: parsed.threadId,
      to: parsed.to,
      cc: parsed.cc,
      bcc: parsed.bcc,
      subject: parsed.subject,
      htmlBody: parsed.htmlBody,
      snippet: parsed.snippet ?? bodyPreview(parsed.htmlBody),
      hasAttachment: parsed.attachments.length > 0,
      attachments: parsed.attachments,
      lastEditedAt: parsed.lastEditedAt,
      syncedAt: new Date(),
    };

    return prisma.emailDraft.upsert({
      where: { userId_gmailDraftId: { userId, gmailDraftId } },
      update: data,
      create: { userId, gmailDraftId, ...data },
    });
  },

  /** The Drafts folder. Mirror only — no Gmail call, so it is a single query. */
  async list(userId: string) {
    const drafts = await prisma.emailDraft.findMany({
      where: { userId },
      orderBy: { lastEditedAt: 'desc' },
    });

    return drafts.map((d) => ({
      id: d.id,
      to: d.to,
      cc: d.cc,
      subject: d.subject,
      snippet: d.snippet,
      hasAttachment: d.hasAttachment,
      attachments: attachmentMeta(d),
      lastEditedAt: d.lastEditedAt,
    }));
  },

  /**
   * Open a draft into the compose window.
   *
   * Reads through to Gmail rather than serving the mirror body, so a draft
   * edited in the Gmail UI since the last sync opens at its newest version.
   * Attachment bytes are pulled too, so a save rebuilds a MIME message that
   * still carries them. If Gmail is unreachable the mirror answers instead,
   * minus attachment content.
   */
  async open(id: string, userId: string): Promise<DraftDetail> {
    const row = await prisma.emailDraft.findFirst({ where: { id, userId } });
    if (!row) throw Object.assign(new Error('Draft not found'), { status: 404 });

    const fallback: DraftDetail = {
      id: row.id,
      gmailDraftId: row.gmailDraftId,
      threadId: row.threadId,
      to: row.to,
      cc: row.cc,
      bcc: row.bcc,
      subject: row.subject,
      htmlBody: row.htmlBody,
      lastEditedAt: row.lastEditedAt,
      attachments: attachmentMeta(row).map((a) => ({ ...a, content: '' })),
    };

    try {
      const gmail = await getGmailClient(userId);
      const res = await gmail.users.drafts.get({ userId: 'me', id: row.gmailDraftId, format: 'full' });
      const parsed = parseDraftMessage(res.data.message ?? undefined);
      const refreshed = await this.upsertMirror(userId, row.gmailDraftId, parsed);

      const attachments: DraftAttachmentContent[] = [];
      let budget = MAX_ATTACHMENT_BYTES;
      for (const att of parsed.attachmentIds) {
        if (!parsed.gmailMessageId || att.size > budget) {
          attachments.push({ filename: att.filename, mimeType: att.mimeType, size: att.size, content: '' });
          continue;
        }
        const bytes = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: parsed.gmailMessageId,
          id: att.attachmentId,
        });
        budget -= att.size;
        attachments.push({
          filename: att.filename,
          mimeType: att.mimeType,
          size: att.size,
          // Gmail returns base64url; compose uploads standard base64 and the
          // MIME builder decodes standard base64, so normalise here.
          content: Buffer.from(bytes.data.data ?? '', 'base64url').toString('base64'),
        });
      }

      return {
        id: refreshed.id,
        gmailDraftId: refreshed.gmailDraftId,
        threadId: refreshed.threadId,
        to: parsed.to,
        cc: parsed.cc,
        bcc: parsed.bcc,
        subject: parsed.subject,
        htmlBody: parsed.htmlBody,
        lastEditedAt: parsed.lastEditedAt,
        attachments,
      };
    } catch (err: unknown) {
      console.warn('[Drafts] Gmail read failed, serving mirror:', err instanceof Error ? err.message : err);
      return fallback;
    }
  },

  /**
   * Create or update a draft.
   *
   * This is what the compose window's explicit "Save draft" calls. It is not
   * wired to a keystroke or a timer on purpose: a save is one Gmail write, and
   * an autosave that round-trips to Google per edit would burn the per-user
   * Gmail budget that `lib/gmailLimiter.ts` is there to protect.
   *
   * `id` addresses the mirror row, never the Gmail draft id, and is always
   * resolved with `{ id, userId }` — so one user cannot update another's draft
   * even knowing its id.
   */
  async save(userId: string, input: DraftComposeInput, id?: string) {
    const auth = await prisma.googleAuth.findFirst({ where: { userId } });
    if (!auth?.email) throw Object.assign(new Error('Google not connected'), { status: 400 });

    const existing = id
      ? await prisma.emailDraft.findFirst({ where: { id, userId } })
      : null;
    if (id && !existing) throw Object.assign(new Error('Draft not found'), { status: 404 });

    const threading = await this.resolveThreading(userId, input.replyToEmailId, existing);
    const gmail = await getGmailClient(userId);

    const raw = await buildMimeMessage({
      from: auth.email,
      to: input.to,
      cc: input.cc.length > 0 ? input.cc : undefined,
      bcc: input.bcc.length > 0 ? input.bcc : undefined,
      subject: input.subject,
      htmlBody: input.htmlBody,
      inReplyTo: threading.inReplyTo,
      references: threading.references,
      attachments: input.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });

    const requestBody: gmail_v1.Schema$Draft = {
      message: { raw, ...(threading.threadId ? { threadId: threading.threadId } : {}) },
    };

    const saved = existing
      ? await gmail.users.drafts.update({ userId: 'me', id: existing.gmailDraftId, requestBody })
      : await gmail.users.drafts.create({ userId: 'me', requestBody });

    const gmailDraftId = saved.data.id;
    if (!gmailDraftId) throw Object.assign(new Error('Gmail did not return a draft id'), { status: 502 });

    // Write the mirror from what we just sent rather than re-reading it: we
    // are the most recent writer, and a `drafts.get` here would double the
    // cost of every save.
    const row = await this.upsertMirror(userId, gmailDraftId, {
      gmailMessageId: saved.data.message?.id ?? null,
      threadId: saved.data.message?.threadId ?? threading.threadId ?? null,
      to: input.to,
      cc: input.cc,
      bcc: input.bcc,
      subject: input.subject.slice(0, 500),
      htmlBody: input.htmlBody,
      snippet: bodyPreview(input.htmlBody),
      attachments: input.attachments.map((a) => ({
        filename: a.filename,
        mimeType: a.contentType,
        size: a.size,
      })),
      attachmentIds: [],
      lastEditedAt: new Date(),
    });

    wsEmitToUser(userId, 'drafts:changed', { id: row.id });
    auditService.log({
      userId,
      action: 'EMAIL_DRAFT_SAVED',
      entityType: 'email_draft',
      entityId: row.id,
      details: { subject: input.subject, to: input.to, created: !existing },
    });

    return {
      id: row.id,
      to: row.to,
      cc: row.cc,
      bcc: row.bcc,
      subject: row.subject,
      lastEditedAt: row.lastEditedAt,
    };
  },

  /**
   * Send a draft.
   *
   * The latest compose content is pushed with `drafts.update` and then handed
   * to `drafts.send`, which sends and consumes the draft in one Gmail
   * operation — no send-then-delete, so there is no window in which the
   * message exists both as sent mail and as a stale draft. If the update
   * succeeds and the send fails, the draft survives holding the newest text,
   * which is the failure mode worth having.
   */
  async send(userId: string, id: string, input: DraftComposeInput) {
    const row = await prisma.emailDraft.findFirst({ where: { id, userId } });
    if (!row) throw Object.assign(new Error('Draft not found'), { status: 404 });

    const auth = await prisma.googleAuth.findFirst({ where: { userId } });
    if (!auth?.email) throw Object.assign(new Error('Google not connected'), { status: 400 });

    const threading = await this.resolveThreading(userId, input.replyToEmailId, row);
    const gmail = await getGmailClient(userId);

    const raw = await buildMimeMessage({
      from: auth.email,
      to: input.to,
      cc: input.cc.length > 0 ? input.cc : undefined,
      bcc: input.bcc.length > 0 ? input.bcc : undefined,
      subject: input.subject,
      htmlBody: input.htmlBody,
      inReplyTo: threading.inReplyTo,
      references: threading.references,
      attachments: input.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
    });

    await gmail.users.drafts.update({
      userId: 'me',
      id: row.gmailDraftId,
      requestBody: { message: { raw, ...(threading.threadId ? { threadId: threading.threadId } : {}) } },
    });

    const sent = await gmail.users.drafts.send({
      userId: 'me',
      requestBody: { id: row.gmailDraftId },
    });

    // Gmail has consumed the draft; the mirror row must go with it. Scoped by
    // userId as well as id so this can never reach across tenants.
    await prisma.emailDraft.deleteMany({ where: { id: row.id, userId } });

    if (sent.data.id) {
      try {
        // Imported lazily: emailService is the module that owns message
        // upserts, and a static import would make the two services circular.
        const { emailService } = await import('./emailService.js');
        const msg = await gmail.users.messages.get({ userId: 'me', id: sent.data.id, format: 'full' });
        await emailService.upsertMessage(msg.data, userId);
      } catch (err: unknown) {
        // The mail is sent; failing to mirror it only delays it by one sync.
        console.warn('[Drafts] Failed to store sent message:', err instanceof Error ? err.message : err);
      }
    }

    wsEmitToUser(userId, 'drafts:changed', { id: row.id, sent: true });
    wsEmitToUser(userId, 'email:sent', { threadId: sent.data.threadId ?? null });

    await auditService.logSync({
      userId,
      action: 'EMAIL_DRAFT_SENT',
      entityType: 'email_draft',
      entityId: row.id,
      details: { subject: input.subject, to: input.to },
    });

    return { messageId: sent.data.id ?? null, threadId: sent.data.threadId ?? null };
  },

  /** Discard a draft in Gmail and drop the mirror row. */
  async remove(userId: string, id: string) {
    const row = await prisma.emailDraft.findFirst({ where: { id, userId } });
    if (!row) throw Object.assign(new Error('Draft not found'), { status: 404 });

    try {
      const gmail = await getGmailClient(userId);
      await gmail.users.drafts.delete({ userId: 'me', id: row.gmailDraftId });
    } catch (err: unknown) {
      // Best-effort, like every other Gmail write in this app: the local row
      // goes either way, and a draft Gmail still holds returns on next sync.
      console.warn('[Drafts] Gmail delete failed:', err instanceof Error ? err.message : err);
    }

    await prisma.emailDraft.deleteMany({ where: { id: row.id, userId } });
    wsEmitToUser(userId, 'drafts:changed', { id: row.id, deleted: true });

    auditService.log({
      userId,
      action: 'EMAIL_DRAFT_DELETED',
      entityType: 'email_draft',
      entityId: row.id,
      details: { subject: row.subject },
    });

    return { success: true };
  },

  /**
   * Threading headers for a draft that is a reply.
   *
   * The originating email is looked up `{ id, userId }` — a draft cannot be
   * threaded onto mail the caller does not own. An existing draft keeps the
   * thread it already has, so updating a reply draft never detaches it.
   */
  async resolveThreading(userId: string, replyToEmailId: string | undefined, existing: EmailDraft | null) {
    if (existing?.threadId) {
      return { threadId: existing.threadId, inReplyTo: undefined, references: undefined };
    }
    if (!replyToEmailId) {
      return { threadId: undefined, inReplyTo: undefined, references: undefined };
    }

    const original = await prisma.email.findFirst({ where: { id: replyToEmailId, userId } });
    if (!original) return { threadId: undefined, inReplyTo: undefined, references: undefined };

    const references = original.references
      ? `${original.references} ${original.messageId ?? ''}`.trim()
      : original.messageId ?? undefined;

    return {
      threadId: original.threadId ?? undefined,
      inReplyTo: original.messageId?.trim() || undefined,
      references: references?.trim() || undefined,
    };
  },
};
