export interface EmailAttachment {
  id: string;
  emailId: string;
  gmailAttachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface EmailMessage {
  id: string;
  gmailMessageId: string | null;
  threadId: string | null;
  userId: string;
  subject: string;
  from: string;
  fromName: string | null;
  contactName?: string | null;
  to: string[];
  cc: string[];
  snippet: string | null;
  body: string | null;
  receivedAt: string;
  isRead: boolean;
  isStarred: boolean;
  isArchived: boolean;
  isTrashed: boolean;
  hasAttachment: boolean;
  sizeEstimate: number | null;
  labelIds: string[];
  customerId: string | null;
  customer: { id: string; name: string; domain: string | null; logoUrl: string | null; isVip?: boolean; isInternal?: boolean } | null;
  attachments: EmailAttachment[];
  /** Tasks this email was made into or attached to. */
  taskLinks?: Array<{ id: string; task: { id: string; title: string; status: string } }>;
  syncedAt: string | null;
  createdAt: string;
}

export interface EmailThread {
  threadId: string | null;
  messageCount: number;
  unreadCount: number;
  latestEmail: EmailMessage;
}

/**
 * Sentinel the `customerId` query parameter accepts for "mail with no customer
 * link" — the review flow's Uncategorized bucket. Mirrors
 * `UNCATEGORIZED_CUSTOMER_ID` in `server/src/utils/emailHelpers.ts`.
 */
export const UNCATEGORIZED_CUSTOMER_ID = 'none';

/** Per-company counts backing the review flow. Thread counts match the paged
 *  list's `meta.total`; email counts are what the company picker shows. */
export interface ReviewCustomerRow {
  customerId: string;
  customerName: string;
  customerDomain: string;
  customerLogoUrl: string | null;
  isVip: boolean;
  totalEmails: number;
  unreadEmails: number;
  totalThreads: number;
  unreadThreads: number;
}

export interface ReviewUncategorized {
  totalEmails: number;
  unreadEmails: number;
  totalThreads: number;
  unreadThreads: number;
}

export interface ReviewSummary {
  data: ReviewCustomerRow[];
  uncategorized: ReviewUncategorized;
}

export interface AttachmentWithEmail {
  id: string;
  emailId: string;
  gmailAttachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
  email: {
    id: string;
    subject: string;
    from: string;
    fromName: string | null;
    receivedAt: string;
    customerId: string | null;
  };
}

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward' | 'draft';

/** Metadata about a draft attachment — what the Drafts list can show. */
export interface DraftAttachmentMeta {
  filename: string;
  mimeType: string;
  size: number;
}

/** A row in the Drafts folder. Served from the local Gmail mirror. */
export interface DraftListItem {
  id: string;
  to: string[];
  cc: string[];
  subject: string;
  snippet: string | null;
  hasAttachment: boolean;
  attachments: DraftAttachmentMeta[];
  lastEditedAt: string;
}

/** A draft loaded back into compose — read through to Gmail, bytes included. */
export interface DraftDetail {
  id: string;
  gmailDraftId: string;
  threadId: string | null;
  /** Set when the draft is a reply — sent back on save so threading survives. */
  replyToEmailId: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  htmlBody: string;
  lastEditedAt: string;
  attachments: Array<DraftAttachmentMeta & { content: string }>;
}

export interface DraftSummary {
  id: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  lastEditedAt: string;
}

export interface DraftSaveInput {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  htmlBody: string;
  attachments: Array<{ filename: string; content: string; contentType: string; size: number }>;
  replyToEmailId?: string;
}

/**
 * The two things a reminder can be. They share a row and a scheduler on the
 * server and differ in what firing does: a snooze hides the thread and brings
 * it back, a follow-up hides nothing and cancels itself if a reply arrives.
 */
export type ReminderKind = 'snooze' | 'follow_up';

/** A pending snooze or follow-up. Mirrors `EmailReminder` on the server. */
export interface EmailReminder {
  id: string;
  threadId: string;
  kind: ReminderKind;
  state: 'armed' | 'fired' | 'cancelled';
  remindAt: string;
  armedAt: string;
  wasInInbox: boolean;
  resolution: string | null;
  firedAt: string | null;
  createdAt: string;
}

export interface ConvertToTaskInput {
  title?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  notes?: string;
}
