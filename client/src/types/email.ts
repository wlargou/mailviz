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
  subject: string;
  from: string;
  fromName: string | null;
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
  customer: { id: string; name: string; domain: string | null; logoUrl: string | null } | null;
  attachments: EmailAttachment[];
  mailToTask?: { id: string; task: { id: string; title: string; status: string } } | null;
  syncedAt: string | null;
  createdAt: string;
}

export interface EmailThread {
  threadId: string | null;
  messageCount: number;
  unreadCount: number;
  latestEmail: EmailMessage;
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

export interface ConvertToTaskInput {
  title?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  notes?: string;
}
