import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Tag,
  Button,
  InlineLoading,
  SkeletonText,
} from '@carbon/react';
import { StarFilled, Star, Attachment, Download, Archive, TrashCan, Undo, Email as EmailIcon, EmailNew, TaskComplete, Reply, ReplyAll, SendAlt, Share, Launch } from '@carbon/icons-react';
import { contactsApi } from '../../api/contacts';
import { UserAvatar } from '@carbon/ibm-products';
import { format, formatDistanceToNow } from 'date-fns';
import DOMPurify from 'dompurify';
import { useNavigate } from 'react-router-dom';
import { emailsApi } from '../../api/emails';
import { useUIStore } from '../../store/uiStore';
import { EmptyState } from '../shared/EmptyState';
import { ConvertToTaskModal } from './ConvertToTaskModal';
import { AttachmentPreviewModal } from './AttachmentPreviewModal';
import { MailComposeModal } from './MailComposeModal';
import { ShareDialog } from '../shared/ShareDialog';
import { getFileTypeInfo, formatFileSize as formatSize } from '../../utils/fileTypes';
import type { EmailMessage, EmailAttachment, ComposeMode } from '../../types/email';

// Decode HTML entities in snippets (Gmail API returns &#39; &amp; etc.)
const entityEl = document.createElement('textarea');
function decodeEntities(text: string | null | undefined): string {
  if (!text) return '';
  entityEl.innerHTML = text;
  return entityEl.value;
}

interface ThreadDetailProps {
  threadId: string;
  onEmailAction?: () => void;
}

function getInitials(name: string | null, email: string): string {
  if (name) {
    const parts = name.split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name[0].toUpperCase();
  }
  return email[0]?.toUpperCase() || '?';
}

export function ThreadDetail({ threadId, onEmailAction }: ThreadDetailProps) {
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [loadingBodies, setLoadingBodies] = useState<Set<string>>(new Set());
  const [convertEmail, setConvertEmail] = useState<EmailMessage | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<{ attachment: EmailAttachment; emailId: string } | null>(null);
  const [composeState, setComposeState] = useState<{ mode: ComposeMode; email: EmailMessage } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [threadShares, setThreadShares] = useState<Array<{ id: string; createdAt: string; sharedWith: { id: string; name: string | null; email: string; avatarUrl: string | null } }>>([]);
  const scrollTargetRef = useRef<string | null>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const navigate = useNavigate();
  const addNotification = useUIStore((s) => s.addNotification);

  const fetchThread = useCallback(async () => {
    setLoading(true);
    try {
      const { data: res } = await emailsApi.getThread(threadId);
      setMessages(res.data);
      // Find first unread message, or fall back to latest
      if (res.data.length > 0) {
        const firstUnread = res.data.find((m) => !m.isRead);
        const targetMsg = firstUnread || res.data[res.data.length - 1];

        // Expand the target message (and all unread messages)
        const toExpand = new Set<string>([targetMsg.id]);
        res.data.forEach((m) => { if (!m.isRead) toExpand.add(m.id); });
        setExpandedMessages(toExpand);

        // Set scroll target for after render
        scrollTargetRef.current = targetMsg.id;

        // Fetch body for expanded message
        if (!targetMsg.body) {
          try {
            const { data: fullMsg } = await emailsApi.getMessage(targetMsg.id);
            setMessages((prev) =>
              prev.map((m) => (m.id === targetMsg.id ? { ...m, body: fullMsg.data.body } : m))
            );
          } catch {
            // Body fetch failed, snippet will be shown
          }
        }
        // Mark as read when auto-expanding
        if (!targetMsg.isRead) {
          emailsApi.markAsRead(targetMsg.id).then(() => {
            setMessages((prev) => prev.map((m) => (m.id === targetMsg.id ? { ...m, isRead: true } : m)));
            onEmailAction?.();
          }).catch(() => {});
        }
      }
    } catch {
      addNotification({ kind: 'error', title: 'Failed to load thread' });
    } finally {
      setLoading(false);
    }
  }, [threadId, addNotification]);

  useEffect(() => {
    fetchThread();
  }, [fetchThread]);

  // Scroll to target message (first unread) after messages render
  useEffect(() => {
    if (!loading && scrollTargetRef.current && messages.length > 1) {
      const el = messageRefs.current.get(scrollTargetRef.current);
      if (el) {
        setTimeout(() => {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
      scrollTargetRef.current = null;
    }
  }, [loading, messages]);

  const toggleExpand = async (msg: EmailMessage) => {
    const newSet = new Set(expandedMessages);
    if (newSet.has(msg.id)) {
      newSet.delete(msg.id);
    } else {
      newSet.add(msg.id);
      // Fetch body on-demand if not loaded
      if (!msg.body) {
        setLoadingBodies((prev) => new Set(prev).add(msg.id));
        try {
          const { data: res } = await emailsApi.getMessage(msg.id);
          setMessages((prev) =>
            prev.map((m) => (m.id === msg.id ? { ...m, body: res.data.body } : m))
          );
        } catch {
          // Ignore
        } finally {
          setLoadingBodies((prev) => {
            const s = new Set(prev);
            s.delete(msg.id);
            return s;
          });
        }
      }
    }
    setExpandedMessages(newSet);

    // Mark as read if unread
    if (!msg.isRead) {
      emailsApi.markAsRead(msg.id).then(() => {
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, isRead: true } : m)));
        onEmailAction?.();
      }).catch(() => {});
    }
  };

  const handleToggleStar = async (msg: EmailMessage) => {
    try {
      await emailsApi.toggleStar(msg.id);
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, isStarred: !m.isStarred } : m))
      );
      onEmailAction?.();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to update star' });
    }
  };

  const handleMarkUnread = async (msg: EmailMessage) => {
    try {
      await emailsApi.markAsUnread(msg.id);
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, isRead: false } : m)));
      onEmailAction?.();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to mark as unread' });
    }
  };

  const handleArchive = async (msg: EmailMessage) => {
    try {
      if (msg.isArchived) {
        await emailsApi.unarchive(msg.id);
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, isArchived: false } : m)));
        addNotification({ kind: 'success', title: 'Moved to Inbox' });
      } else {
        await emailsApi.archive(msg.id);
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, isArchived: true } : m)));
        addNotification({ kind: 'success', title: 'Archived' });
      }
      onEmailAction?.();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to archive' });
    }
  };

  const handleTrash = async (msg: EmailMessage) => {
    try {
      if (msg.isTrashed) {
        await emailsApi.untrash(msg.id);
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, isTrashed: false } : m)));
        addNotification({ kind: 'success', title: 'Restored from trash' });
      } else {
        await emailsApi.trash(msg.id);
        setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, isTrashed: true } : m)));
        addNotification({ kind: 'success', title: 'Moved to trash' });
      }
      onEmailAction?.();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to update' });
    }
  };

  const fetchShares = useCallback(async () => {
    try {
      const { data: res } = await emailsApi.getThreadShares(threadId);
      setThreadShares(res.data);
    } catch {
      // Ignore
    }
  }, [threadId]);

  const handleOpenShare = async () => {
    await fetchShares();
    setShareOpen(true);
  };

  if (loading) {
    return (
      <div style={{ padding: '1rem' }}>
        <SkeletonText heading width="60%" />
        <SkeletonText paragraph lineCount={4} />
      </div>
    );
  }

  if (messages.length === 0) {
    return <EmptyState title="No messages" />;
  }

  // Collect unique participants
  const participants = new Set<string>();
  for (const msg of messages) {
    participants.add(msg.from);
    msg.to.forEach((e) => participants.add(e));
    msg.cc.forEach((e) => participants.add(e));
  }

  // Find linked customer from any message
  const customer = messages.find((m) => m.customer)?.customer;

  return (
    <div className="thread-detail">
      {customer && (
        <div className="thread-detail__company">
          <Tag
            type="cool-gray"
            size="sm"
            className="clickable-tag"
            onClick={() => navigate(`/customers/${customer.id}`)}
          >
            {customer.name}
          </Tag>
        </div>
      )}

      <div className="thread-detail__messages">
        {messages.map((msg) => {
          const isExpanded = expandedMessages.has(msg.id);
          const isLoadingBody = loadingBodies.has(msg.id);

          return (
            <div
              key={msg.id}
              ref={(el) => { if (el) messageRefs.current.set(msg.id, el); }}
              className={`message-bubble${!msg.isRead ? ' message-bubble--unread' : ''}`}
            >
              <div className="message-bubble__header" onClick={(e) => {
                // Don't toggle expand if click was on the avatar link
                if ((e.target as HTMLElement).closest('.message-bubble__avatar-link')) return;
                toggleExpand(msg);
              }}>
                <div className="message-bubble__sender">
                  <div
                    role="button"
                    tabIndex={0}
                    className="message-bubble__avatar-link"
                    title="View contact"
                    onClick={async () => {
                      try {
                        const res = await contactsApi.lookupByEmail(msg.from);
                        if (res.data.data) {
                          navigate(`/contacts/${res.data.data.id}`);
                        } else if (msg.customerId) {
                          navigate(`/companies/${msg.customerId}`);
                        }
                      } catch {
                        if (msg.customerId) navigate(`/companies/${msg.customerId}`);
                      }
                    }}
                  >
                    <UserAvatar
                      name={msg.fromName || msg.from}
                      size="sm"
                    />
                  </div>
                  <div className="message-bubble__sender-info">
                    <span className="message-bubble__sender-name">{msg.fromName || msg.from}</span>
                    <span className="message-bubble__sender-email">{msg.from}</span>
                  </div>
                </div>
                <div className="message-bubble__actions">
                  <span className="message-bubble__date">
                    {formatDistanceToNow(new Date(msg.receivedAt), { addSuffix: true })}
                  </span>
                  <Button
                    kind="ghost"
                    size="sm"
                    hasIconOnly
                    iconDescription={msg.isStarred ? 'Unstar' : 'Star'}
                    renderIcon={msg.isStarred ? StarFilled : Star}
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleToggleStar(msg); }}
                  />
                  <Button
                    kind="ghost"
                    size="sm"
                    hasIconOnly
                    iconDescription={msg.isArchived ? 'Unarchive' : 'Archive'}
                    renderIcon={msg.isArchived ? Undo : Archive}
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleArchive(msg); }}
                  />
                  <Button
                    kind="ghost"
                    size="sm"
                    hasIconOnly
                    iconDescription={msg.isTrashed ? 'Restore' : 'Trash'}
                    renderIcon={msg.isTrashed ? Undo : TrashCan}
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleTrash(msg); }}
                  />
                  <Button
                    kind="ghost"
                    size="sm"
                    hasIconOnly
                    iconDescription={msg.isRead ? 'Mark as unread' : 'Mark as read'}
                    renderIcon={msg.isRead ? EmailNew : EmailIcon}
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleMarkUnread(msg); }}
                  />
                  <Button
                    kind="ghost"
                    size="sm"
                    hasIconOnly
                    iconDescription="Convert to task"
                    renderIcon={TaskComplete}
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); setConvertEmail(msg); }}
                  />
                  <Button
                    kind="ghost"
                    size="sm"
                    hasIconOnly
                    iconDescription="Reply"
                    renderIcon={Reply}
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); setComposeState({ mode: 'reply', email: msg }); }}
                  />
                  <Button
                    kind="ghost"
                    size="sm"
                    hasIconOnly
                    iconDescription="Reply all"
                    renderIcon={ReplyAll}
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); setComposeState({ mode: 'replyAll', email: msg }); }}
                  />
                  <Button
                    kind="ghost"
                    size="sm"
                    hasIconOnly
                    iconDescription="Forward"
                    renderIcon={SendAlt}
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); setComposeState({ mode: 'forward', email: msg }); }}
                  />
                  <Button
                    kind="ghost"
                    size="sm"
                    hasIconOnly
                    iconDescription="Share thread"
                    renderIcon={Share}
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); handleOpenShare(); }}
                  />
                </div>
              </div>

              {isExpanded && (
                <div className="message-bubble__body">
                  <div className="message-bubble__meta">
                    {msg.to.length > 0 && (
                      <div className="message-bubble__meta-row">
                        <span className="message-bubble__meta-label">To</span>
                        <span className="message-bubble__meta-value">{msg.to.join(', ')}</span>
                      </div>
                    )}
                    {msg.cc.length > 0 && (
                      <div className="message-bubble__meta-row">
                        <span className="message-bubble__meta-label">Cc</span>
                        <span className="message-bubble__meta-value">{msg.cc.join(', ')}</span>
                      </div>
                    )}
                    <div className="message-bubble__meta-row">
                      <span className="message-bubble__meta-label">Date</span>
                      <span className="message-bubble__meta-value">
                        {format(new Date(msg.receivedAt), 'EEEE, MMM d, yyyy · h:mm a')}
                      </span>
                    </div>
                  </div>

                  {isLoadingBody ? (
                    <InlineLoading description="Loading message..." />
                  ) : msg.body ? (
                    <div
                      className="message-bubble__body--html"
                      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(msg.body) }}
                    />
                  ) : (
                    <p className="message-bubble__snippet">{decodeEntities(msg.snippet) || '(No content)'}</p>
                  )}

                  {msg.attachments.length > 0 && (
                    <div className="message-bubble__attachments">
                      {msg.attachments.map((att) => {
                        const fileInfo = getFileTypeInfo(att.mimeType, att.filename);
                        const FileIcon = fileInfo.icon;
                        return (
                          <div key={att.id} className="attachment-chip">
                            {fileInfo.previewable ? (
                              <span
                                className="attachment-chip__clickable"
                                onClick={() => setPreviewAttachment({ attachment: att, emailId: msg.id })}
                              >
                                <FileIcon size={16} />
                                <span className="attachment-chip__name">{att.filename}</span>
                                <span className="attachment-chip__size">{formatSize(att.size)}</span>
                              </span>
                            ) : (
                              <a
                                className="attachment-chip__clickable"
                                href={emailsApi.getAttachmentUrl(msg.id, att.id)}
                                download={att.filename}
                              >
                                <FileIcon size={16} />
                                <span className="attachment-chip__name">{att.filename}</span>
                                <span className="attachment-chip__size">{formatSize(att.size)}</span>
                              </a>
                            )}
                            <a
                              className="attachment-chip__download"
                              href={emailsApi.getAttachmentUrl(msg.id, att.id)}
                              download={att.filename}
                              onClick={(e) => e.stopPropagation()}
                              title="Download"
                            >
                              <Download size={14} />
                            </a>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {!isExpanded && (
                <div className="message-bubble__collapsed" onClick={() => toggleExpand(msg)}>
                  {decodeEntities(msg.snippet)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {messages.length > 0 && (
        <div
          className="inline-reply-trigger"
          onClick={() => setComposeState({ mode: 'reply', email: messages[messages.length - 1] })}
        >
          Click to reply...
        </div>
      )}

      {convertEmail && (
        <ConvertToTaskModal
          email={convertEmail}
          open={!!convertEmail}
          onClose={() => setConvertEmail(null)}
          onConverted={() => {
            setConvertEmail(null);
            fetchThread();
            onEmailAction?.();
          }}
        />
      )}

      <AttachmentPreviewModal
        open={!!previewAttachment}
        attachment={previewAttachment?.attachment || null}
        emailId={previewAttachment?.emailId || ''}
        onClose={() => setPreviewAttachment(null)}
      />

      <MailComposeModal
        open={!!composeState}
        onClose={() => setComposeState(null)}
        onSent={() => {
          setComposeState(null);
          fetchThread();
          onEmailAction?.();
        }}
        mode={composeState?.mode || 'reply'}
        replyToEmail={composeState?.email}
      />

      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title={messages[0]?.subject || 'Thread'}
        currentShares={threadShares}
        onShare={async (userIds) => {
          await emailsApi.shareThread(threadId, userIds);
        }}
        onUnshare={async (userId) => {
          await emailsApi.unshareThread(threadId, userId);
        }}
        onRefresh={fetchShares}
      />
    </div>
  );
}
