import { google } from 'googleapis';
import { Prisma } from '../lib/prismaClient.js';
import { prisma } from '../lib/prisma.js';
import { getGmailClient } from '../lib/gmail.js';
import { isGmailRateLimitError } from '../lib/gmailLimiter.js';
import { customerService } from './customerService.js';
import {
  extractDomain,
  isMailingListDomain,
  isPersonalDomain,
  normalizeDomain,
  parseName,
} from '../utils/domainResolver.js';
import { parsePagination, paginationMeta } from '../utils/pagination.js';
import { wsEmit, wsEmitToUser } from '../websocket.js';
import { buildMimeMessage, type MimeAttachment } from '../utils/mimeBuilder.js';
import { env } from '../config/env.js';
import { format } from 'date-fns';
// A4: Helper functions extracted to shared module
import {
  parseEmailAddress,
  parseEmailList,
  extractAttachments,
  extractBody,
  UNCATEGORIZED_CUSTOMER_ID,
  type EmailQueryParams,
} from '../utils/emailHelpers.js';
import { getSharedThreadIds, canAccessThread } from '../utils/accessControl.js';
import { auditService } from './auditService.js';
import { notificationService } from './notificationService.js';
import { snoozeService } from './snoozeService.js';
import { mergeEngagement } from '../utils/contactEngagement.js';
import { decodeEntities } from '../utils/htmlEntities.js';

/**
 * The single definition of how Gmail's labels map onto our boolean columns.
 *
 * Both write paths — `upsertMessage` and the incremental label handlers — must
 * derive flags from the RESULTING label set, never from the delta Gmail sent.
 * They used to disagree: `upsertMessage` computed
 * `isArchived = !INBOX && !TRASH`, while the labelsRemoved handler set
 * `isArchived = true` from an INBOX removal alone. Gmail sends a trash as one
 * record that removes INBOX and adds TRASH, so the flag depended on which path
 * touched the row last — and since `untrash()` clears only `isTrashed`, a
 * trash-then-restore left the message flagged archived and it never came back
 * to the inbox view.
 */
/**
 * A failed fetch is remembered so a later sync can retry it.
 *
 * Capped because a permanently poisoned id would otherwise accumulate on every
 * run. The cap drops the oldest, on the reasoning that a recent failure is far
 * more likely to be transient — and therefore worth a retry — than one that has
 * already survived many attempts.
 */
const MAX_TRACKED_FAILURES = 500;

/**
 * The normalised domain of the account's own address, or null for a personal
 * mailbox (a gmail.com account has no company domain to exclude).
 *
 * Cached per process: it is read once per message otherwise, and it cannot change
 * without the user changing their address.
 */
const ownDomainCache = new Map<string, string | null>();

/**
 * The account's own address, lowercased.
 *
 * Distinct from `ownEmailDomain`: engagement asks whether *this account* wrote to
 * someone, and a colleague on the same domain writing to them is not the same
 * fact. Cached for the same reason.
 */
const ownAddressCache = new Map<string, string | null>();

async function ownEmailAddress(userId: string): Promise<string | null> {
  const cached = ownAddressCache.get(userId);
  if (cached !== undefined) return cached;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const address = user?.email?.trim().toLowerCase() ?? null;
  ownAddressCache.set(userId, address);
  return address;
}

async function ownEmailDomain(userId: string): Promise<string | null> {
  const cached = ownDomainCache.get(userId);
  if (cached !== undefined) return cached;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const raw = user?.email ? extractDomain(user.email) : null;
  const domain = raw && !isPersonalDomain(raw) ? normalizeDomain(raw) : null;
  ownDomainCache.set(userId, domain);
  return domain;
}

async function addFailedMessageIds(userId: string, ids: string[]) {
  if (ids.length === 0) return;
  const auth = await prisma.googleAuth.findFirst({
    where: { userId },
    select: { id: true, syncFailedMessageIds: true },
  });
  if (!auth) return;
  const merged = [...new Set([...auth.syncFailedMessageIds, ...ids])].slice(-MAX_TRACKED_FAILURES);
  await prisma.googleAuth.update({ where: { id: auth.id }, data: { syncFailedMessageIds: merged } });
}

async function replaceFailedMessageIds(userId: string, ids: string[]) {
  await prisma.googleAuth.updateMany({
    where: { userId },
    data: { syncFailedMessageIds: ids.slice(-MAX_TRACKED_FAILURES) },
  });
}

function flagsFromLabels(labelIds: string[]) {
  return {
    isRead: !labelIds.includes('UNREAD'),
    isStarred: labelIds.includes('STARRED'),
    isArchived: !labelIds.includes('INBOX') && !labelIds.includes('TRASH'),
    isTrashed: labelIds.includes('TRASH'),
  };
}

export const emailService = {
  async syncFromGmail(userId: string) {
    const gmail = await getGmailClient(userId);
    const auth = await prisma.googleAuth.findFirst({ where: { userId } });
    if (!auth) throw Object.assign(new Error('Google not connected'), { status: 400 });

    let synced = 0;
    let customersCreated = 0;
    let contactsCreated = 0;
    let labelsChanged = 0;
    let failed = 0;
    let historyId: string | null = null;

    try {
      if (auth.lastHistoryId) {
        // Incremental sync. The next cursor comes from the history response
        // itself, which is the point in the feed we have actually consumed to —
        // reading it from getProfile afterwards would skip anything that arrived
        // while we were working.
        const result = await this.incrementalSync(gmail, auth.lastHistoryId, userId);
        synced = result.synced;
        customersCreated = result.customersCreated;
        contactsCreated = result.contactsCreated;
        labelsChanged = result.labelsChanged;
        failed = result.failed;
        historyId = result.newHistoryId;
      } else {
        /**
         * Initial sync — honours EMAIL_SYNC_MONTHS (0 = the whole mailbox).
         *
         * The cursor is taken BEFORE listing, not after. Taken afterwards, any
         * message arriving during the sync was in neither half: too late for the
         * id list, too early for a history feed starting at the end. With
         * EMAIL_SYNC_MONTHS=0 an initial sync is one `messages.get` per message
         * — hours on a large mailbox — so that gap silently swallowed everything
         * received while it ran. Replaying a few already-imported messages is
         * free (`upsertMessage` is idempotent); missing them is not.
         */
        const baseline = await gmail.users.getProfile({ userId: 'me' });
        historyId = baseline.data.historyId || null;

        const result = await this.initialSync(gmail, userId);
        synced = result.synced;
        customersCreated = result.customersCreated;
        contactsCreated = result.contactsCreated;
        failed = result.failed;
      }

      // The history-expiry catch-up re-lists by date and so cannot report a feed
      // position. Without this fallback the cursor would keep its expired value,
      // Gmail would 404 again on the next run, and every sync from then on would
      // be a catch-up.
      if (!historyId) {
        const profile = await gmail.users.getProfile({ userId: 'me' });
        historyId = profile.data.historyId || null;
      }

      /**
       * Retry anything that could not be fetched — INCLUDING failures recorded
       * moments ago by this very run.
       *
       * `auth` was read before the sync started, so its `syncFailedMessageIds`
       * is a pre-sync snapshot. The sync then records new failures through
       * `addFailedMessageIds`, and `retryFailedMessages` ends by *replacing*
       * the column with the survivors of whatever list it was handed. Passing
       * the stale snapshot therefore erased every failure this run had just
       * recorded — and because the history cursor advances at the end of the
       * same run, nothing would ever fetch those messages again. A message
       * Gmail could not serve was silently lost, with no error and no retry.
       *
       * Re-reading picks up both the old backlog and the new failures.
       *
       * Kept inside the try so a revoked grant here is translated below like
       * any other Gmail failure.
       */
      const latest = await prisma.googleAuth.findFirst({
        where: { userId },
        select: { syncFailedMessageIds: true },
      });
      const retry = await this.retryFailedMessages(
        gmail,
        userId,
        latest?.syncFailedMessageIds ?? auth.syncFailedMessageIds
      );
      synced += retry.synced;
      customersCreated += retry.customersCreated;
      contactsCreated += retry.contactsCreated;
    } catch (err: any) {
      // A plain 403 means the gmail scope was never granted. A 403 carrying a
      // rateLimitExceeded reason is throttling that outlived the limiter's
      // retries — telling the user to reconnect Google would be wrong, so let
      // it surface as itself.
      if ((err?.code === 403 || err?.status === 403) && !isGmailRateLimitError(err)) {
        throw Object.assign(
          new Error('Gmail access not granted. Please reconnect Google from Settings to grant email permissions.'),
          { status: 403 }
        );
      }
      throw err;
    }

    await prisma.googleAuth.update({
      where: { id: auth.id },
      data: {
        lastMailSyncAt: new Date(),
        ...(historyId ? { lastHistoryId: historyId } : {}),
      },
    });

    return { synced, customersCreated, contactsCreated, labelsChanged, failed };
  },

  /**
   * Re-attempt message fetches that failed on an earlier run.
   *
   * Ids that succeed are cleared; ids that fail again are kept for the next
   * sync. This is what makes a transient fetch error cost a delay rather than a
   * message — the history cursor has already moved past them, so nothing else
   * will ever come back for them.
   */
  async retryFailedMessages(
    gmail: ReturnType<typeof google.gmail>,
    userId: string,
    failedIds: string[]
  ) {
    let synced = 0;
    let customersCreated = 0;
    let contactsCreated = 0;
    if (failedIds.length === 0) return { synced, customersCreated, contactsCreated };

    console.log(`[EmailSync] Retrying ${failedIds.length} message(s) that failed earlier`);
    const stillFailing: string[] = [];

    for (const id of failedIds) {
      try {
        const res = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
        const result = await this.upsertMessage(res.data, userId);
        if (result) {
          synced++;
          customersCreated += result.customersCreated;
          contactsCreated += result.contactsCreated;
        }
      } catch (err: any) {
        // A 404 means the message is genuinely gone from Gmail — deleted between
        // the failed fetch and now. Retrying forever would never succeed, so it
        // is dropped rather than kept.
        if (err?.code === 404 || err?.status === 404) continue;
        stillFailing.push(id);
      }
    }

    await replaceFailedMessageIds(userId, stillFailing);
    if (stillFailing.length > 0) {
      console.warn(`[EmailSync] ${stillFailing.length} message(s) still failing; will retry next sync`);
    }
    return { synced, customersCreated, contactsCreated };
  },

  /**
   * @param windowDays When set, only messages newer than this many days are
   *   listed, overriding EMAIL_SYNC_MONTHS. Used by the history-expiry catch-up
   *   path, which must stay bounded — see the 404 handler in incrementalSync.
   */
  async initialSync(gmail: ReturnType<typeof google.gmail>, userId: string, windowDays?: number) {
    let synced = 0;
    let customersCreated = 0;
    let contactsCreated = 0;
    let currentGmail = gmail;
    let messagesSinceRefresh = 0;

    // A true initial sync honours EMAIL_SYNC_MONTHS (0 = the whole mailbox).
    // A catch-up sync passes an explicit day window instead.
    const query = windowDays
      ? `newer_than:${windowDays}d`
      : env.EMAIL_SYNC_MONTHS > 0
        ? `newer_than:${env.EMAIL_SYNC_MONTHS}m`
        : undefined;

    // Phase 1: Collect ALL message IDs (cheap — only IDs, no content)
    wsEmitToUser(userId, 'sync:progress', { type: 'email', synced: 0, total: 0, phase: 'counting' });
    const allMessageIds: string[] = [];
    let pageToken: string | undefined;

    do {
      const listRes = await currentGmail.users.messages.list({
        userId: 'me',
        ...(query ? { q: query } : {}),
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
    wsEmitToUser(userId, 'sync:progress', { type: 'email', synced: 0, total, phase: 'syncing' });
    console.log(`[EmailSync] Initial sync: ${total} messages to process`);

    // Phase 2: Process messages in batches of 10
    // Ids whose fetch failed. Recorded rather than skipped: the cursor moves past
    // them once this completes, so a swallowed failure was a message lost for
    // good with nothing to show it had ever existed.
    const failedIds: string[] = [];
    // Attempted, whether or not the fetch succeeded — this is what drives the
    // progress indicator.
    let processed = 0;
    let lastProgressAt = 0;

    for (let i = 0; i < allMessageIds.length; i += 10) {
      const batch = allMessageIds.slice(i, i + 10);
      const results = await Promise.all(
        batch.map((id) =>
          currentGmail.users.messages
            .get({ userId: 'me', id, format: 'full' })
            .then((res) => ({ ok: true as const, res }))
            .catch((err: any) => ({ ok: false as const, id, err }))
        )
      );

      for (const outcome of results) {
        if (!outcome.ok) {
          // A 404 is a message deleted since the id was listed — not a failure
          // worth retrying.
          if (outcome.err?.code !== 404 && outcome.err?.status !== 404) {
            failedIds.push(outcome.id);
          }
          continue;
        }
        const result = await this.upsertMessage(outcome.res.data, userId);
        if (result) {
          synced++;
          customersCreated += result.customersCreated;
          contactsCreated += result.contactsCreated;
        }
      }

      messagesSinceRefresh += batch.length;
      processed += batch.length;

      // Progress is driven by messages *attempted*, not by `synced`. Keyed off
      // `synced % 50 < 10`, the bar froze whenever a run of batches failed
      // wholesale — the sync was working, the counter was not moving, and the
      // only visible difference from a hung sync was none.
      if (processed - lastProgressAt >= 50) {
        lastProgressAt = processed;
        wsEmitToUser(userId, 'sync:progress', {
          type: 'email',
          synced,
          processed,
          failed: failedIds.length,
          total,
          phase: 'syncing',
        });
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

    if (failedIds.length > 0) {
      console.warn(
        `[EmailSync] ${failedIds.length} message(s) could not be fetched; recorded for retry on the next sync`
      );
      await addFailedMessageIds(userId, failedIds);
    }

    wsEmitToUser(userId, 'sync:progress', { type: 'email', synced, total, phase: 'complete' });
    return { synced, customersCreated, contactsCreated, labelsChanged: 0, failed: failedIds.length };
  },

  async incrementalSync(gmail: ReturnType<typeof google.gmail>, startHistoryId: string, userId: string) {
    let synced = 0;
    let customersCreated = 0;
    let contactsCreated = 0;
    let labelsChanged = 0;
    let pageToken: string | undefined;
    // The furthest point in the feed we have actually consumed. Returned as the
    // next cursor so nothing arriving mid-sync is stepped over.
    let newHistoryId: string | null = null;
    const failedIds: string[] = [];

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
        if (historyRes.data.historyId) newHistoryId = historyRes.data.historyId;

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
              } catch (err: any) {
                // A 404 is a message deleted between the history event and now.
                // Anything else is a fetch that should be retried rather than
                // forgotten — the cursor is about to move past this id.
                if (err?.code !== 404 && err?.status !== 404) {
                  failedIds.push(added.message.id);
                }
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

          // Handle label changes (read/unread/starred/archive/trash).
          //
          // Both handlers below compute the resulting label set FIRST and then
          // derive every flag from it via flagsFromLabels. Deriving from the
          // delta instead is what let the two write paths disagree about
          // isArchived — see the note on flagsFromLabels.
          if (history.labelsAdded) {
            for (const labelChange of history.labelsAdded) {
              if (!labelChange.message?.id) continue;
              const labels = labelChange.labelIds || [];
              const existing = await prisma.email.findFirst({
                where: { gmailMessageId: labelChange.message.id, userId },
              });
              if (!existing) continue;

              const newLabels = [...new Set([...existing.labelIds, ...labels])];
              const result = await prisma.email.updateMany({
                where: { gmailMessageId: labelChange.message.id, userId },
                data: { labelIds: newLabels, ...flagsFromLabels(newLabels) },
              });
              if (result.count > 0) labelsChanged++;
            }
          }

          if (history.labelsRemoved) {
            for (const labelChange of history.labelsRemoved) {
              if (!labelChange.message?.id) continue;
              const labels = labelChange.labelIds || [];
              const existing = await prisma.email.findFirst({
                where: { gmailMessageId: labelChange.message.id, userId },
              });
              if (!existing) continue;

              const newLabels = existing.labelIds.filter((l) => !labels.includes(l));
              const result = await prisma.email.updateMany({
                where: { gmailMessageId: labelChange.message.id, userId },
                data: { labelIds: newLabels, ...flagsFromLabels(newLabels) },
              });
              if (result.count > 0) labelsChanged++;
            }
          }
        }
      } while (pageToken);
    } catch (err: any) {
      // Gmail returns 404 when startHistoryId is older than its retention
      // window. This is routine (it happens after any longish gap), not an
      // error condition — but it used to fall through to a FULL initialSync,
      // which with the default EMAIL_SYNC_MONTHS=0 re-listed the entire
      // mailbox. On a large account that is tens of thousands of message
      // fetches triggered by a condition we do not control.
      //
      // Gmail retains history for about a week, so a bounded catch-up over the
      // same period recovers everything the history feed would have contained.
      if (err?.code === 404) {
        console.warn(
          `[EmailSync] History ID expired; catching up on the last ${env.SYNC_CATCHUP_DAYS} days instead of a full re-sync`
        );
        const result = await this.initialSync(gmail, userId, env.SYNC_CATCHUP_DAYS);
        // Add to what earlier history pages already imported rather than
        // replacing it. Spreading `result` discarded those counts, and
        // emailSyncScheduler only broadcasts `emails:synced` when a counter is
        // non-zero — so mail landed in the database while every open client was
        // told nothing had changed.
        if (failedIds.length > 0) await addFailedMessageIds(userId, failedIds);
        return {
          synced: synced + result.synced,
          customersCreated: customersCreated + result.customersCreated,
          contactsCreated: contactsCreated + result.contactsCreated,
          labelsChanged,
          failed: failedIds.length + result.failed,
          // The catch-up re-listed by date, so the feed position is unknown here;
          // syncFromGmail falls back to getProfile when this is null.
          newHistoryId: null as string | null,
        };
      }
      throw err;
    }

    if (failedIds.length > 0) {
      console.warn(
        `[EmailSync] ${failedIds.length} message(s) could not be fetched; recorded for retry on the next sync`
      );
      await addFailedMessageIds(userId, failedIds);
    }

    return { synced, customersCreated, contactsCreated, labelsChanged, failed: failedIds.length, newHistoryId };
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
    const { isRead, isStarred, isArchived, isTrashed } = flagsFromLabels(labelIds);

    // Extract attachment metadata
    const attachmentMeta = extractAttachments(msg.payload || {});
    const hasAttachment = attachmentMeta.length > 0;

    // Auto-link to customer
    let customerId: string | null = null;
    let customersCreated = 0;
    let contactsCreated = 0;

    /**
     * The account's own domain, which must never be the customer a message is
     * filed against.
     *
     * Without this, an outbound message resolved `from` first — the user's own
     * address — and was filed under the user's own company. On this database
     * that made "Powerm" the largest customer in the system at 33,309 emails, of
     * which 32,359 were the user's own sent mail, while the actual recipient's
     * company showed none of it. Every per-company view, the dashboard's top
     * customers and Review's grouping saw inbound only.
     *
     * The calendar importer already skips the account holder via the attendee
     * `self` flag; this is the mail side of the same rule.
     */
    const ownDomain = await ownEmailDomain(userId);
    const ownAddress = await ownEmailAddress(userId);
    /**
     * Outbound means *this account* sent it, so its recipients are people the
     * account has written to. On an inbound message the sender is someone who has
     * written to the account, and the other recipients are bystanders — which is
     * exactly the distinction the engagement filter exists to make.
     */
    const isOutbound = Boolean(ownAddress) && fromEmail.trim().toLowerCase() === ownAddress;

    /**
     * Mail that arrived via a mailing list creates no companies or contacts.
     *
     * `List-Id` (RFC 2919) is the precise signal: it means this message was
     * distributed by a list, which is why every participant's address is on it.
     * Deliberately not keyed off `List-Unsubscribe`, which ordinary vendor
     * marketing also carries — a real supplier who emails you should still become
     * a company.
     */
    const viaMailingList = Boolean(headers['list-id']);

    // Collect all email addresses for customer/contact linking
    const allEmails = viaMailingList ? [] : [fromEmail, ...toList, ...ccList];
    for (const email of allEmails) {
      const rawDomain = extractDomain(email);
      if (!rawDomain || isPersonalDomain(rawDomain)) continue;
      // A list host is infrastructure, not an organisation you deal with.
      if (isMailingListDomain(rawDomain)) continue;
      const domain = normalizeDomain(rawDomain);

      try {
        const { customer, created: cCreated } = await customerService.findOrCreateByDomain(userId, domain);
        // Colleagues still become contacts — an internal address is worth
        // knowing — but the message is never *filed* against your own company.
        if (!customerId && domain !== ownDomain) customerId = customer.id;
        if (cCreated) customersCreated++;

        // Try to find display name for this email
        let displayName: string | null = null;
        if (email === fromEmail) displayName = fromName;
        const { contact, created: contactCreated } = await customerService.findOrCreateContact(userId, email, displayName, customer.id);
        if (contactCreated) contactsCreated++;

        // Only the two roles that carry information: the sender of an inbound
        // message, and the recipients of one this account sent.
        const observed = isOutbound
          ? email !== fromEmail ? ('receiver' as const) : null
          : email === fromEmail ? ('sender' as const) : null;
        if (observed) {
          const next = mergeEngagement(contact.engagement, observed);
          // Written only when it widens — most messages tell us nothing new, and
          // this runs per address per message.
          if (next !== contact.engagement) {
            await prisma.contact.update({ where: { id: contact.id }, data: { engagement: next } });
          }
        }
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
    // The ownership filter lives under `AND` so that the search branch below,
    // which assigns `where.OR`, cannot clobber it. Spreading it here instead
    // leaked every user's mail to anyone who had a shared thread and searched.
    //
    // `andFilters` is the same array `where.AND` points at: any branch that
    // needs its own `OR` must push onto it rather than assign `where.OR`, for
    // exactly the reason above.
    const andFilters: Prisma.EmailWhereInput[] = [ownershipFilter];
    const where: Prisma.EmailWhereInput = { AND: andFilters };
    // By default, hide trashed emails unless explicitly viewing trash folder
    if (query.folder !== 'trash') {
      where.isTrashed = false;
    }
    if (query.customerId) {
      const tokens = query.customerId.split(',').map((s) => s.trim()).filter(Boolean);
      // The review flow needs to ask for mail that was never linked to a
      // customer — its "Uncategorized" bucket. `customerId` ids are uuids, so
      // the sentinel cannot collide with a real one.
      const wantsUncategorized = tokens.includes(UNCATEGORIZED_CUSTOMER_ID);
      const ids = tokens.filter((t) => t !== UNCATEGORIZED_CUSTOMER_ID);
      if (wantsUncategorized && ids.length > 0) {
        andFilters.push({ OR: [{ customerId: null }, { customerId: { in: ids } }] });
      } else if (wantsUncategorized) {
        where.customerId = null;
      } else if (ids.length === 1) {
        where.customerId = ids[0];
      } else if (ids.length > 1) {
        where.customerId = { in: ids };
      }
    }
    if (query.isRead === 'true') where.isRead = true;
    if (query.isRead === 'false') where.isRead = false;
    if (query.hasAttachment === 'true') where.hasAttachment = true;
    // ── Snoozed threads ──
    //
    // Hidden from every folder except the Snoozed folder itself and Trash.
    // Trash is excluded from the hiding because a thread the user throws away
    // while it is snoozed has to still be findable where they threw it —
    // otherwise it vanishes from both places at once.
    //
    // This is where snooze actually happens. Nothing on the `emails` row says
    // "snoozed": those columns are rewritten from Gmail every sync, so a flag
    // there would be undone within the minute. The authority is the
    // `email_reminders` table, which no sync path writes to.
    //
    // The `threadId: null` arm matters: `NOT IN (...)` is NULL-valued for a
    // NULL column, so a bare `notIn` would silently drop every message that has
    // no thread id from every folder.
    const snoozedThreadIds = await snoozeService.snoozedThreadIds(userId);
    if (query.folder === 'snoozed') {
      // An empty list yields `IN ()`, i.e. nothing — which is the right answer
      // for a Snoozed folder with nothing in it.
      andFilters.push({ threadId: { in: snoozedThreadIds } });
    } else if (snoozedThreadIds.length > 0 && query.folder !== 'trash') {
      andFilters.push({ OR: [{ threadId: null }, { threadId: { notIn: snoozedThreadIds } }] });
    }

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
      where.from = query.contactEmail;
    }
    if (query.search) {
      where.OR = [
        { subject: { contains: query.search, mode: 'insensitive' } },
        { from: { contains: query.search, mode: 'insensitive' } },
        { fromName: { contains: query.search, mode: 'insensitive' } },
        { snippet: { contains: query.search, mode: 'insensitive' } },
      ];
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

    /**
     * How many threads match, for pagination.
     *
     * No aggregate: only the NUMBER of groups is used, so asking for a
     * per-group count makes Postgres compute and ship ~72,000 bigints that are
     * thrown away. Dropping it is worth about 7% of this endpoint — measured
     * against production at 132k emails, 1347ms to 1250ms over five
     * interleaved samples.
     *
     * Deliberately still sequential with the query above. They are independent
     * and running them in a Promise.all looks free, but both scan the same
     * large table: measured the same way, concurrency made the pair ~33% SLOWER
     * (1666ms median) because they contend for the same I/O rather than
     * overlapping with idle time.
     *
     * The remaining cost is that this materialises one row per thread to take
     * its length. `COUNT(DISTINCT thread_id)` would collapse that to a single
     * row, but `where` is built across a dozen branches above — ownership plus
     * shares, the uncategorised sentinel, the snooze exclusion with its
     * NULL-threadId arm — and expressing it a second time in raw SQL invites
     * the two to drift apart. A wrong total is a worse bug than a slow one, and
     * the comments above record two occasions when this very filter was got
     * wrong.
     */
    const totalGroupBy = await prisma.email.groupBy({ by: ['threadId'], where });
    const total = totalGroupBy.length;

    // P1: Batch-fetch latest email per thread + unread counts (2 queries instead of 2*N)
    const threadIdList = threadIds.map((t) => t.threadId).filter((id): id is string => id !== null);
    const threadCountMap = new Map(threadIds.map((t) => [t.threadId, t._count.id]));

    const [latestEmails, unreadCounts] = await Promise.all([
      prisma.email.findMany({
        where: { ...where, threadId: { in: threadIdList } },
        orderBy: { receivedAt: 'desc' },
        distinct: ['threadId'],
        include: {
          customer: { select: { id: true, name: true, domain: true, logoUrl: true, isVip: true, isInternal: true } },
          attachments: true,
        },
      }),
      prisma.email.groupBy({
        by: ['threadId'],
        // The SAME `where` the list uses, not just ownership. Counting unread
        // across the whole mailbox while listing one folder makes a thread
        // render bold in a folder where nothing unread is visible, and lets
        // unreadCount exceed the messageCount shown beside it — in Sent, a
        // thread you replied to reported 1 message and 3 unread.
        where: { ...where, threadId: { in: threadIdList }, isRead: false },
        _count: { id: true },
      }),
    ]);

    const unreadMap = new Map(unreadCounts.map((u) => [u.threadId, u._count.id]));
    const emailMap = new Map(latestEmails.map((e) => [e.threadId, e]));

    // Resolve contact names from 'from' addresses
    const fromAddresses = [...new Set(latestEmails.map((e) => e.from).filter(Boolean))];
    const contacts = fromAddresses.length > 0
      ? await prisma.contact.findMany({
          where: { email: { in: fromAddresses }, customer: { userId } },
          select: { email: true, firstName: true, lastName: true },
        })
      : [];
    const contactNameMap = new Map(
      contacts.filter((c) => c.email).map((c) => [c.email!, `${c.firstName} ${c.lastName}`.trim()])
    );

    // Build thread list preserving sort order from groupBy
    const threads = threadIdList.map((threadId) => {
      const email = emailMap.get(threadId);
      return {
        threadId,
        messageCount: threadCountMap.get(threadId) ?? 0,
        unreadCount: unreadMap.get(threadId) ?? 0,
        latestEmail: email ? {
          ...email,
          contactName: contactNameMap.get(email.from) || null,
        } : null,
      };
    });

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

    /**
     * Rows the caller may see: their own, plus those belonging to someone who
     * has shared this thread with them.
     *
     * The filter used to be `{ threadId }` alone, on the reasoning that
     * `canAccessThread` had already authorised the thread. But that helper
     * answers "does the caller own ANY row under this thread id" — a question
     * about the thread, not about each row — so the query returned every
     * tenant's copy of it.
     *
     * Nothing could reach that today: Gmail thread ids are per-mailbox, so two
     * accounts only collide by connecting the same mailbox, and then both
     * legitimately hold the mail. But `GoogleAuth.email` is not unique, so that
     * collision IS possible, and this was the one threadId read in the service
     * not paired with an owner — every other one (findById, the batch
     * operations, findAllThreads, snoozeService.ownedThread) already is.
     */
    const emails = await prisma.email.findMany({
      where: {
        threadId,
        OR: [
          { userId },
          { user: { emailSharesSent: { some: { threadId, sharedWithUserId: userId } } } },
        ],
      },
      orderBy: { receivedAt: 'asc' },
      include: {
        attachments: true,
        customer: { select: { id: true, name: true, domain: true, logoUrl: true, isVip: true, isInternal: true } },
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
        customer: { select: { id: true, name: true, domain: true, logoUrl: true, isVip: true, isInternal: true } },
        mailToTask: { include: { task: true } },
      },
    });

    // If not owned, check shared access via thread. The candidate lookup is
    // constrained to rows whose owner shared this thread with the caller, so a
    // row that merely happens to sit under a thread id the caller also holds
    // cannot be pulled in.
    if (!email) {
      const candidate = await prisma.email.findFirst({
        where: {
          id,
          user: { emailSharesSent: { some: { sharedWithUserId: userId } } },
        },
        include: {
          attachments: true,
          customer: { select: { id: true, name: true, domain: true, logoUrl: true, isVip: true, isInternal: true } },
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
          await prisma.email.updateMany({ where: { id, userId }, data: { body } });
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

    await prisma.email.updateMany({ where: { id, userId }, data: { isRead: true } });
    wsEmitToUser(userId, 'email:updated', { id, isRead: true });

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

    auditService.log({ userId, action: 'EMAIL_MARK_READ', entityType: 'email', entityId: id, details: { subject: email.subject } });
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

    await prisma.email.updateMany({ where: { id, userId }, data: { isRead: false } });
    wsEmitToUser(userId, 'email:updated', { id, isRead: false });

    if (email.gmailMessageId && email.userId === userId) {
      try {
        const gmail = await getGmailClient(userId);
        await gmail.users.messages.modify({
          userId: 'me', id: email.gmailMessageId,
          requestBody: { addLabelIds: ['UNREAD'] },
        });
      } catch (err: any) { console.warn('[EmailSync] Gmail API call failed:', err?.message || err); }
    }

    auditService.log({ userId, action: 'EMAIL_MARK_UNREAD', entityType: 'email', entityId: id, details: { subject: email.subject } });
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
    await prisma.email.updateMany({ where: { id, userId }, data: { isStarred: newStarred } });
    wsEmitToUser(userId, 'email:updated', { id, isStarred: newStarred });

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

    auditService.log({ userId, action: newStarred ? 'EMAIL_STARRED' : 'EMAIL_UNSTARRED', entityType: 'email', entityId: id, details: { subject: email.subject } });

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

    await prisma.email.updateMany({
      where: { id, userId },
      data: { isArchived: true, labelIds: email.labelIds.filter((l) => l !== 'INBOX') },
    });
    wsEmitToUser(userId, 'email:updated', { id, isArchived: true });

    auditService.log({ userId, action: 'EMAIL_ARCHIVED', entityType: 'email', entityId: id, details: { subject: email.subject, from: email.from } });
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

    await prisma.email.updateMany({
      where: { id, userId },
      // Deduplicated like every sibling label write. Appending blindly produced
      // ['INBOX','INBOX'], which disagrees with Gmail's own label set and with
      // what flagsFromLabels is handed on the next sync.
      data: { isArchived: false, labelIds: [...new Set([...email.labelIds, 'INBOX'])] },
    });
    wsEmitToUser(userId, 'email:updated', { id, isArchived: false });

    auditService.log({ userId, action: 'EMAIL_UNARCHIVED', entityType: 'email', entityId: id, details: { subject: email.subject, from: email.from } });
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

    const emailDetails = { subject: email.subject, from: email.from, threadId: email.threadId, receivedAt: email.receivedAt };

    if (email.gmailMessageId && email.userId === userId) {
      try {
        const gmail = await getGmailClient(userId);
        await gmail.users.messages.trash({ userId: 'me', id: email.gmailMessageId });
      } catch (err: any) { console.warn('[EmailSync] Gmail API call failed:', err?.message || err); }
    }

    await prisma.email.updateMany({
      where: { id, userId },
      data: { isTrashed: true, labelIds: [...new Set([...email.labelIds.filter((l) => l !== 'INBOX'), 'TRASH'])] },
    });
    wsEmitToUser(userId, 'email:updated', { id, isTrashed: true });

    await auditService.logSync({ userId, action: 'EMAIL_TRASHED', entityType: 'email', entityId: id, details: emailDetails });
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

    /**
     * Restoring from Trash has to put the message somewhere.
     *
     * `trash` strips INBOX and adds TRASH, so removing TRASH alone left the
     * message in no folder at all: gone from Trash, absent from Inbox, absent
     * from Archived. It existed and was reachable by search, and nowhere else.
     *
     * INBOX goes back unless the message was archived before it was trashed —
     * `isArchived` survives trashing, so that state is still known and an
     * archived message should return to the archive rather than the inbox.
     */
    const withoutTrash = email.labelIds.filter((l) => l !== 'TRASH');
    const restoredLabels =
      email.isArchived || withoutTrash.includes('INBOX')
        ? withoutTrash
        : [...withoutTrash, 'INBOX'];

    await prisma.email.updateMany({
      where: { id, userId },
      data: { isTrashed: false, labelIds: restoredLabels },
    });
    wsEmitToUser(userId, 'email:updated', { id, isTrashed: false });

    auditService.log({ userId, action: 'EMAIL_UNTRASHED', entityType: 'email', entityId: id, details: { subject: email.subject, from: email.from } });
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

    for (const email of allEmails) wsEmitToUser(userId, 'email:updated', { id: email.id, isRead: true });

    auditService.log({ userId, action: 'EMAIL_BATCH_MARK_READ', entityType: 'email', details: { count: ids.length } });
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

    for (const email of allEmails) wsEmitToUser(userId, 'email:updated', { id: email.id, isRead: false });

    auditService.log({ userId, action: 'EMAIL_BATCH_MARK_UNREAD', entityType: 'email', details: { count: ids.length } });
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
      wsEmitToUser(userId, 'email:updated', { id: email.id, isArchived: true });
    }

    auditService.log({ userId, action: 'EMAIL_BATCH_ARCHIVE', entityType: 'email', details: { count: ids.length } });
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
        data: { isTrashed: true, labelIds: [...new Set([...email.labelIds.filter((l) => l !== 'INBOX'), 'TRASH'])] },
      });
      wsEmitToUser(userId, 'email:updated', { id: email.id, isTrashed: true });
    }

    await auditService.logSync({ userId, action: 'EMAIL_BATCH_TRASH', entityType: 'email', details: { count: ids.length, subjects: allEmails.map(e => e.subject).slice(0, 10) } });
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
        // Where Gmail's text stops being a mirror of Gmail and becomes our
        // row. `data.title` is NOT decoded — the client sends it already
        // decoded, and a title someone deliberately typed as `&amp;` is theirs
        // to keep. Only the fallback, which any API caller omitting a title
        // still reaches.
        title: data.title || decodeEntities(email.subject),
        description: decodeEntities(email.snippet) || undefined,
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

    auditService.log({ userId, action: 'EMAIL_CONVERTED_TO_TASK', entityType: 'email', entityId: emailId, details: { taskTitle: data.title || email.subject, taskId: task.id, subject: email.subject } });

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

    wsEmitToUser(userId, 'email:sent', { threadId: sendRes.data.threadId });

    await auditService.logSync({ userId, action: 'EMAIL_SENT', entityType: 'email', entityId: sendRes.data.id || undefined, details: { to: data.to, cc: data.cc, subject: data.subject, hasAttachments: !!(data.attachments?.length) } });

    return { messageId: sendRes.data.id, threadId: sendRes.data.threadId };
  },

  async replyToEmail(emailId: string, data: { htmlBody: string; to?: string[]; replyAll?: boolean; cc?: string[]; bcc?: string[]; attachments?: Array<{ filename: string; content: string; contentType: string; size: number }> }, userId: string) {
    const gmail = await getGmailClient(userId);
    const auth = await prisma.googleAuth.findFirst({ where: { userId } });
    if (!auth?.email) throw Object.assign(new Error('Google not connected'), { status: 400 });

    const original = await prisma.email.findFirst({ where: { id: emailId, userId } });
    if (!original) throw Object.assign(new Error('Email not found'), { status: 404 });

    const userEmail = auth.email.toLowerCase();

    // Determine recipients
    let to: string[];
    let cc: string[] = [];

    // An explicit `to` wins. Compose lets the user edit the recipient on a
    // reply, and this is what makes that edit mean something — without it the
    // message went to `original.from` no matter what the field said.
    const overrideTo = data.to?.filter((address) => address.trim().length > 0) ?? [];

    if (data.replyAll) {
      to = overrideTo.length > 0 ? overrideTo : [original.from];
      // Combine original to + cc, exclude user's own email
      const allCc = [...original.to, ...original.cc, ...(data.cc || [])];
      cc = [...new Set(allCc.map((e) => e.toLowerCase().trim()))].filter((e) => e !== userEmail && e !== original.from.toLowerCase());
    } else {
      to = overrideTo.length > 0 ? overrideTo : [original.from];
      cc = data.cc || [];
    }

    // Deduplicate case-insensitively
    to = [...new Set(to.map((e) => e.toLowerCase().trim()))].filter((e) => e !== userEmail);
    if (to.length === 0) to = [original.from]; // Fallback: can't remove all recipients

    // Subject
    const decodedSubject = decodeEntities(original.subject);
    const subject = decodedSubject.match(/^Re:/i) ? decodedSubject : `Re: ${decodedSubject}`;

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

    wsEmitToUser(userId, 'email:sent', { threadId: sendRes.data.threadId });

    await auditService.logSync({ userId, action: 'EMAIL_REPLY', entityType: 'email', entityId: emailId, details: { to: to, cc: cc.length > 0 ? cc : undefined, subject: original.subject, originalFrom: original.from } });

    return { messageId: sendRes.data.id, threadId: sendRes.data.threadId };
  },

  async forwardEmail(emailId: string, data: { to: string[]; cc?: string[]; bcc?: string[]; htmlBody: string; attachments?: Array<{ filename: string; content: string; contentType: string; size: number }>; forwardExistingAttachments?: string[] }, userId: string) {
    const gmail = await getGmailClient(userId);
    const auth = await prisma.googleAuth.findFirst({ where: { userId } });
    if (!auth?.email) throw Object.assign(new Error('Google not connected'), { status: 400 });

    const original = await prisma.email.findFirst({ where: { id: emailId, userId } });
    if (!original) throw Object.assign(new Error('Email not found'), { status: 404 });

    // Subject
    const decodedSubject = decodeEntities(original.subject);
    const subject = decodedSubject.match(/^Fwd:/i) ? decodedSubject : `Fwd: ${decodedSubject}`;

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

    wsEmitToUser(userId, 'email:sent', { threadId: sendRes.data.threadId });

    await auditService.logSync({ userId, action: 'EMAIL_FORWARD', entityType: 'email', entityId: emailId, details: { to: data.to, subject: original.subject, originalFrom: original.from } });

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

    auditService.log({ userId, action: 'EMAIL_SHARED', entityType: 'email', entityId: threadId, details: { sharedWith: validIds } });

    for (const recipientUserId of validIds) {
      await notificationService.create(recipientUserId, {
        type: 'EMAIL_SHARED',
        title: `Email shared: ${owns.subject}`,
        message: `shared an email thread with you`,
        entityType: 'email',
        entityId: threadId,
      });
    }

    return { success: true, sharedWith: validIds.length };
  },

  async unshareThread(userId: string, threadId: string, recipientUserId: string) {
    await prisma.emailThreadShare.deleteMany({
      where: { threadId, sharedByUserId: userId, sharedWithUserId: recipientUserId },
    });

    auditService.log({ userId, action: 'EMAIL_UNSHARED', entityType: 'email', entityId: threadId, details: { removedUser: recipientUserId } });

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

  // ── Scheduled Email Send ──

  async scheduleEmail(userId: string, data: {
    sendAt: string;
    mode: string;
    replyToEmailId?: string;
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    htmlBody: string;
    attachments: Array<{ filename: string; content: string; contentType: string; size: number }>;
    forwardExistingAttachments: string[];
  }) {
    const scheduled = await prisma.scheduledEmail.create({
      data: {
        userId,
        sendAt: new Date(data.sendAt),
        mode: data.mode,
        replyToEmailId: data.replyToEmailId || null,
        to: data.to,
        cc: data.cc,
        bcc: data.bcc,
        subject: data.subject,
        htmlBody: data.htmlBody,
        attachments: data.attachments,
        forwardExistingAttachments: data.forwardExistingAttachments,
      },
    });
    wsEmitToUser(userId, 'email:scheduled', { id: scheduled.id });

    auditService.log({ userId, action: 'EMAIL_SCHEDULED', entityType: 'scheduled_email', entityId: scheduled.id, details: { to: data.to, subject: data.subject, sendAt: data.sendAt } });

    return scheduled;
  },

  async getScheduledEmails(userId: string) {
    return prisma.scheduledEmail.findMany({
      where: { userId, status: { in: ['pending', 'failed'] } },
      orderBy: { sendAt: 'asc' },
    });
  },

  async updateScheduledEmail(userId: string, id: string, data: { sendAt: string }) {
    const existing = await prisma.scheduledEmail.findFirst({ where: { id, userId } });
    if (!existing) throw Object.assign(new Error('Scheduled email not found'), { status: 404 });
    if (existing.status !== 'pending') throw Object.assign(new Error('Only pending emails can be updated'), { status: 400 });

    const updated = await prisma.scheduledEmail.update({
      where: { id },
      data: { sendAt: new Date(data.sendAt) },
    });

    // Cancel was already audited; rescheduling was not. Record both times so the
    // trail shows what the send time was moved from and to.
    auditService.log({
      userId,
      action: 'EMAIL_SCHEDULE_UPDATED',
      entityType: 'scheduled_email',
      entityId: id,
      details: {
        subject: existing.subject ?? '',
        previousSendAt: existing.sendAt.toISOString(),
        sendAt: updated.sendAt.toISOString(),
      },
    });

    return updated;
  },

  async cancelScheduledEmail(userId: string, id: string) {
    const existing = await prisma.scheduledEmail.findFirst({ where: { id, userId } });
    if (!existing) throw Object.assign(new Error('Scheduled email not found'), { status: 404 });
    if (existing.status !== 'pending') throw Object.assign(new Error('Only pending emails can be cancelled'), { status: 400 });

    const result = await prisma.scheduledEmail.update({
      where: { id },
      data: { status: 'cancelled' },
    });

    auditService.log({ userId, action: 'EMAIL_SCHEDULE_CANCELLED', entityType: 'scheduled_email', entityId: id });

    return result;
  },

  async processScheduledEmails() {
    const due = await prisma.scheduledEmail.findMany({
      where: { status: 'pending', sendAt: { lte: new Date() } },
    });

    let processed = 0;

    for (const scheduled of due) {
      try {
        const attachments = (scheduled.attachments as Array<{ filename: string; content: string; contentType: string; size: number }>) || [];
        let result: { messageId?: string | null; threadId?: string | null };

        if (scheduled.mode === 'new') {
          result = await this.sendEmail({
            to: scheduled.to,
            cc: scheduled.cc,
            bcc: scheduled.bcc,
            subject: scheduled.subject,
            htmlBody: scheduled.htmlBody,
            attachments,
          }, scheduled.userId);
        } else if (scheduled.mode === 'reply' || scheduled.mode === 'replyAll') {
          result = await this.replyToEmail(scheduled.replyToEmailId!, {
            htmlBody: scheduled.htmlBody,
            replyAll: scheduled.mode === 'replyAll',
            cc: scheduled.cc,
            bcc: scheduled.bcc,
            attachments,
          }, scheduled.userId);
        } else if (scheduled.mode === 'forward') {
          result = await this.forwardEmail(scheduled.replyToEmailId!, {
            to: scheduled.to,
            cc: scheduled.cc,
            bcc: scheduled.bcc,
            htmlBody: scheduled.htmlBody,
            attachments,
            forwardExistingAttachments: scheduled.forwardExistingAttachments,
          }, scheduled.userId);
        } else {
          throw new Error(`Unknown mode: ${scheduled.mode}`);
        }

        await prisma.scheduledEmail.update({
          where: { id: scheduled.id },
          data: {
            status: 'sent',
            sentMessageId: result.messageId || null,
            sentThreadId: result.threadId || null,
          },
        });

        wsEmitToUser(scheduled.userId, 'email:scheduled:sent', { id: scheduled.id });
        processed++;
      } catch (err: any) {
        const newRetryCount = scheduled.retryCount + 1;
        const update: Record<string, unknown> = {
          retryCount: newRetryCount,
          errorMessage: err?.message || 'Unknown error',
        };
        if (newRetryCount >= 3) {
          update.status = 'failed';
        }
        await prisma.scheduledEmail.update({
          where: { id: scheduled.id },
          data: update,
        });

        wsEmitToUser(scheduled.userId, 'email:scheduled:sent', { id: scheduled.id });
        console.error(`[ScheduledSend] Failed to send scheduled email ${scheduled.id}:`, err?.message);
      }
    }

    return processed;
  },

  /**
   * Per-customer counts for the review flow's company picker and group headers.
   *
   * Returns both *email* counts and *thread* counts. The review list pages
   * threads, so a group header that showed an email count next to a paged
   * thread list would never add up; `totalThreads`/`unreadThreads` are what the
   * grouped view displays, and they are the same distinct-thread aggregate that
   * `findAllThreads` reports as `meta.total` for the equivalent query
   * (`customerId=<id>` + the same date window, plus `isRead=false` when the
   * unread toggle is on).
   */
  async getReviewSummary(dateAfter: string, dateBefore: string, userId: string) {
    const after = new Date(dateAfter);
    const before = new Date(dateBefore);
    const where: Prisma.EmailWhereInput = {
      userId,
      isTrashed: false,
      receivedAt: {
        gte: after,
        lte: before,
      },
    };

    // Get total emails grouped by customerId
    const totalsByCustomer = await prisma.email.groupBy({
      by: ['customerId'],
      where,
      _count: { id: true },
    });

    // Get unread emails grouped by customerId
    const unreadByCustomer = await prisma.email.groupBy({
      by: ['customerId'],
      where: { ...where, isRead: false },
      _count: { id: true },
    });

    // Distinct-thread counts. Prisma's groupBy cannot express
    // COUNT(DISTINCT thread_id), and grouping by [customerId, threadId] would
    // pull one row per thread back into the process — tens of thousands on a
    // wide period — so this stays in the database.
    const threadCounts = await prisma.$queryRaw<Array<{
      customer_id: string | null;
      total_threads: bigint;
      unread_threads: bigint;
    }>>`
      SELECT
        customer_id,
        COUNT(DISTINCT thread_id) AS total_threads,
        COUNT(DISTINCT thread_id) FILTER (WHERE is_read = false) AS unread_threads
      FROM emails
      WHERE user_id = ${userId}
        AND is_trashed = false
        AND received_at >= ${after}
        AND received_at <= ${before}
      GROUP BY customer_id
    `;

    const totalThreadMap = new Map(
      threadCounts.map((r) => [r.customer_id, Number(r.total_threads)])
    );
    const unreadThreadMap = new Map(
      threadCounts.map((r) => [r.customer_id, Number(r.unread_threads)])
    );

    const unreadMap = new Map(
      unreadByCustomer.map((r) => [r.customerId, r._count.id])
    );

    // Separate categorized vs uncategorized
    const customerIds = totalsByCustomer
      .map((r) => r.customerId)
      .filter((id): id is string => id !== null);

    const customers = customerIds.length > 0
      ? await prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, name: true, domain: true, logoUrl: true, isVip: true },
        })
      : [];

    const customerMap = new Map(customers.map((c) => [c.id, c]));

    const data = totalsByCustomer
      .filter((r) => r.customerId !== null)
      .map((r) => {
        const customer = customerMap.get(r.customerId!);
        return {
          customerId: r.customerId!,
          customerName: customer?.name ?? 'Unknown',
          customerDomain: customer?.domain ?? '',
          customerLogoUrl: customer?.logoUrl ?? null,
          isVip: customer?.isVip ?? false,
          totalEmails: r._count.id,
          unreadEmails: unreadMap.get(r.customerId) ?? 0,
          totalThreads: totalThreadMap.get(r.customerId) ?? 0,
          unreadThreads: unreadThreadMap.get(r.customerId) ?? 0,
        };
      })
      .sort((a, b) => b.totalEmails - a.totalEmails);

    const uncatRow = totalsByCustomer.find((r) => r.customerId === null);
    const uncategorized = {
      totalEmails: uncatRow?._count.id ?? 0,
      unreadEmails: unreadMap.get(null) ?? 0,
      totalThreads: totalThreadMap.get(null) ?? 0,
      unreadThreads: unreadThreadMap.get(null) ?? 0,
    };

    return { data, uncategorized };
  },
};
