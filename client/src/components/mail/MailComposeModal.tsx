import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { TextInput, Button, InlineLoading, Tag, DatePicker, DatePickerInput, TimePicker } from '@carbon/react';
import { SidePanel } from '@carbon/ibm-products';
import { SendAlt, Attachment, Close, Time } from '@carbon/icons-react';
import DOMPurify from 'dompurify';
import { format } from 'date-fns';
import { emailsApi } from '../../api/emails';
import { authApi } from '../../api/auth';
import { useUIStore } from '../../store/uiStore';
import { TiptapEditor } from './TiptapEditor';
import { ComposeToolbar } from './ComposeToolbar';
import { RecipientInput } from './RecipientInput';
import type { Editor } from '@tiptap/react';
import type { ComposeMode, EmailMessage } from '../../types/email';

interface ComposeAttachment {
  id: string;
  filename: string;
  size: number;
  contentType: string;
  content: string;
  status: 'reading' | 'ready' | 'error';
}

interface ForwardedAttachment {
  id: string; // EmailAttachment ID
  filename: string;
  size: number;
  mimeType: string;
}

const MAX_TOTAL_SIZE = 25 * 1024 * 1024;
const BLOCKED_EXTENSIONS = /\.(exe|bat|cmd|com|msi|scr|pif|vbs|js|wsf|cpl)$/i;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface MailComposeModalProps {
  open: boolean;
  onClose: () => void;
  onSent: () => void;
  mode: ComposeMode;
  replyToEmail?: EmailMessage | null;
}

export function MailComposeModal({ open, onClose, onSent, mode, replyToEmail }: MailComposeModalProps) {
  const addNotification = useUIStore((s) => s.addNotification);
  const editorRef = useRef<Editor | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const [sending, setSending] = useState(false);
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [showBcc, setShowBcc] = useState(false);
  const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
  const [forwardedAttachments, setForwardedAttachments] = useState<ForwardedAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [scheduleTime, setScheduleTime] = useState('09:00');

  // Pre-fill based on mode
  useEffect(() => {
    if (!open) return;
    setAttachments([]);
    setForwardedAttachments([]);
    setIsDragging(false);
    setScheduledAt(null);
    setShowSchedulePicker(false);
    setScheduleTime('09:00');

    if (mode === 'new') {
      setTo([]);
      setCc([]);
      setBcc([]);
      setSubject('');
      setShowBcc(false);
    } else if (mode === 'reply' && replyToEmail) {
      setTo([replyToEmail.from]);
      setCc([]);
      setBcc([]);
      setSubject(replyToEmail.subject.match(/^Re:/i) ? replyToEmail.subject : `Re: ${replyToEmail.subject}`);
      setShowBcc(false);
    } else if (mode === 'replyAll' && replyToEmail) {
      setTo([replyToEmail.from]);
      const allCc = [...replyToEmail.to, ...replyToEmail.cc].filter(
        (e) => e.toLowerCase() !== replyToEmail.from.toLowerCase()
      );
      setCc([...new Set(allCc.map((e) => e.toLowerCase()))]);
      setBcc([]);
      setSubject(replyToEmail.subject.match(/^Re:/i) ? replyToEmail.subject : `Re: ${replyToEmail.subject}`);
      setShowBcc(false);
    } else if (mode === 'forward' && replyToEmail) {
      setTo([]);
      setCc([]);
      setBcc([]);
      setSubject(replyToEmail.subject.match(/^Fwd:/i) ? replyToEmail.subject : `Fwd: ${replyToEmail.subject}`);
      setShowBcc(false);
      // Pre-populate original attachments for forwarding
      if (replyToEmail.attachments?.length > 0) {
        setForwardedAttachments(
          replyToEmail.attachments.map((a) => ({
            id: a.id,
            filename: a.filename,
            size: a.size,
            mimeType: a.mimeType,
          }))
        );
      }
    }
  }, [open, mode, replyToEmail]);

  // Inject email signature into editor when it's ready
  useEffect(() => {
    if (!open || !editorInstance) return;

    // Small delay to ensure editor is fully initialized after mode setup
    const timer = setTimeout(async () => {
      try {
        const { data } = await authApi.getSignature();
        if (data.signature && editorInstance && !editorInstance.isDestroyed) {
          const sigHtml = `<p></p><p>--</p>${data.signature}`;
          editorInstance.commands.setContent(sigHtml);
          // Move cursor to the beginning (before the signature)
          editorInstance.commands.focus('start');
        }
      } catch { /* ignore - no signature set */ }
    }, 100);

    return () => clearTimeout(timer);
  }, [open, editorInstance]);

  const handleFilesSelected = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const currentSize = attachments.reduce((sum, a) => sum + a.size, 0)
      + forwardedAttachments.reduce((sum, a) => sum + a.size, 0);

    for (const file of fileArray) {
      if (BLOCKED_EXTENSIONS.test(file.name)) {
        addNotification({ kind: 'error', title: `"${file.name}" is not allowed` });
        continue;
      }
      if (file.size > MAX_TOTAL_SIZE) {
        addNotification({ kind: 'error', title: `"${file.name}" exceeds 25MB limit` });
        continue;
      }
      if (currentSize + file.size > MAX_TOTAL_SIZE) {
        addNotification({ kind: 'error', title: 'Total attachments exceed 25MB' });
        break;
      }

      const id = crypto.randomUUID();
      setAttachments((prev) => [
        ...prev,
        {
          id,
          filename: file.name,
          size: file.size,
          contentType: file.type || 'application/octet-stream',
          content: '',
          status: 'reading',
        },
      ]);

      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        setAttachments((prev) =>
          prev.map((a) => (a.id === id ? { ...a, content: base64, status: 'ready' as const } : a))
        );
      };
      reader.onerror = () => {
        setAttachments((prev) =>
          prev.map((a) => (a.id === id ? { ...a, status: 'error' as const } : a))
        );
      };
      reader.readAsDataURL(file);
    }
  }, [attachments, forwardedAttachments, addNotification]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleFilesSelected(e.dataTransfer.files);
    }
  }, [handleFilesSelected]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const removeForwardedAttachment = useCallback((id: string) => {
    setForwardedAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const getQuotedHtml = useCallback(() => {
    if (!replyToEmail) return '';
    const date = format(new Date(replyToEmail.receivedAt), 'EEE, MMM d, yyyy \'at\' h:mm a');
    const sender = replyToEmail.fromName
      ? `${replyToEmail.fromName} &lt;${replyToEmail.from}&gt;`
      : replyToEmail.from;

    if (mode === 'forward') {
      return `<div class="compose-quoted"><p>---------- Forwarded message ----------<br>From: ${sender}<br>Date: ${date}<br>Subject: ${replyToEmail.subject}<br>To: ${replyToEmail.to.join(', ')}</p>${replyToEmail.body || replyToEmail.snippet || ''}</div>`;
    }
    return `<div class="compose-quoted"><p>On ${date}, ${sender} wrote:</p>${replyToEmail.body || replyToEmail.snippet || ''}</div>`;
  }, [replyToEmail, mode]);

  const isUploading = attachments.some((a) => a.status === 'reading');
  const totalSize = attachments.reduce((s, a) => s + a.size, 0) + forwardedAttachments.reduce((s, a) => s + a.size, 0);
  const allAttachmentCount = attachments.length + forwardedAttachments.length;

  const handleSend = async () => {
    // If scheduled, delegate to schedule handler
    if (scheduledAt) {
      return handleScheduleSend();
    }

    const htmlBody = editorRef.current?.getHTML() || '';
    if (mode !== 'forward' && (!htmlBody || htmlBody === '<p></p>')) {
      addNotification({ kind: 'warning', title: 'Please write a message' });
      return;
    }

    const attachmentPayload = attachments
      .filter((a) => a.status === 'ready')
      .map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType, size: a.size }));

    setSending(true);
    try {
      if (mode === 'new') {
        if (to.length === 0) {
          addNotification({ kind: 'warning', title: 'Add at least one recipient' });
          setSending(false);
          return;
        }
        await emailsApi.sendEmail({
          to,
          cc: cc.length > 0 ? cc : undefined,
          bcc: bcc.length > 0 ? bcc : undefined,
          subject,
          htmlBody,
          attachments: attachmentPayload.length > 0 ? attachmentPayload : undefined,
        });
      } else if ((mode === 'reply' || mode === 'replyAll') && replyToEmail) {
        await emailsApi.replyToEmail(replyToEmail.id, {
          htmlBody,
          replyAll: mode === 'replyAll',
          cc: cc.length > 0 ? cc : undefined,
          bcc: bcc.length > 0 ? bcc : undefined,
          attachments: attachmentPayload.length > 0 ? attachmentPayload : undefined,
        });
      } else if (mode === 'forward' && replyToEmail) {
        if (to.length === 0) {
          addNotification({ kind: 'warning', title: 'Add at least one recipient' });
          setSending(false);
          return;
        }
        await emailsApi.forwardEmail(replyToEmail.id, {
          to,
          cc: cc.length > 0 ? cc : undefined,
          bcc: bcc.length > 0 ? bcc : undefined,
          htmlBody,
          attachments: attachmentPayload.length > 0 ? attachmentPayload : undefined,
          forwardExistingAttachments: forwardedAttachments.length > 0
            ? forwardedAttachments.map((a) => a.id)
            : undefined,
        });
      }

      addNotification({ kind: 'success', title: 'Message sent' });
      onSent();
      onClose();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to send message' });
    } finally {
      setSending(false);
    }
  };

  const handleScheduleSend = async () => {
    if (!scheduledAt) return;
    const htmlBody = editorRef.current?.getHTML() || '';
    if (mode !== 'forward' && (!htmlBody || htmlBody === '<p></p>')) {
      addNotification({ kind: 'warning', title: 'Please write a message' });
      return;
    }
    if ((mode === 'new' || mode === 'forward') && to.length === 0) {
      addNotification({ kind: 'warning', title: 'Add at least one recipient' });
      return;
    }

    const attachmentPayload = attachments
      .filter((a) => a.status === 'ready')
      .map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType, size: a.size }));

    setSending(true);
    try {
      await emailsApi.scheduleEmail({
        sendAt: scheduledAt.toISOString(),
        mode,
        to: to.length > 0 ? to : undefined,
        cc: cc.length > 0 ? cc : undefined,
        bcc: bcc.length > 0 ? bcc : undefined,
        subject,
        htmlBody,
        replyToEmailId: replyToEmail?.id,
        attachments: attachmentPayload.length > 0 ? attachmentPayload : undefined,
        forwardExistingAttachments: forwardedAttachments.length > 0
          ? forwardedAttachments.map((a) => a.id)
          : undefined,
      });
      addNotification({ kind: 'success', title: `Email scheduled for ${format(scheduledAt, 'MMM d, h:mm a')}` });
      onSent();
      onClose();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to schedule email' });
    } finally {
      setSending(false);
    }
  };

  const confirmSchedule = () => {
    if (!scheduledAt) return;
    const [hours, minutes] = scheduleTime.split(':').map(Number);
    const dt = new Date(scheduledAt);
    dt.setHours(hours, minutes, 0, 0);
    if (dt <= new Date()) {
      addNotification({ kind: 'warning', title: 'Schedule time must be in the future' });
      return;
    }
    setScheduledAt(dt);
    setShowSchedulePicker(false);
  };

  const panelTitle = mode === 'new' ? 'New Email' : mode === 'reply' ? 'Reply' : mode === 'replyAll' ? 'Reply All' : 'Forward';

  return createPortal(
    <SidePanel
      open={open}
      onRequestClose={onClose}
      title={panelTitle}
      size="lg"
      className="compose-side-panel"
    >
      <div
        className={`compose-form${isDragging ? ' compose-form--dragging' : ''}`}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <RecipientInput label="To" value={to} onChange={setTo} />
        <RecipientInput label="Cc" value={cc} onChange={setCc} />

        {!showBcc && (
          <Button
            kind="ghost"
            size="sm"
            className="compose-form__cc-toggle"
            onClick={() => setShowBcc(true)}
          >
            Bcc
          </Button>
        )}

        {showBcc && (
          <RecipientInput label="Bcc" value={bcc} onChange={setBcc} />
        )}

        {(mode === 'new' || mode === 'forward') && (
          <TextInput
            id="compose-subject"
            labelText="Subject"
            value={subject}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSubject(e.target.value)}
          />
        )}

        {(mode === 'reply' || mode === 'replyAll') && (
          <div className="compose-form__subject-display">
            <span className="compose-form__subject-label">Subject:</span> {subject}
          </div>
        )}

        <ComposeToolbar editor={editorInstance} onAttach={() => fileInputRef.current?.click()} />
        <TiptapEditor editorRef={editorRef} onEditorReady={setEditorInstance} placeholder="Write your message..." />

        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) handleFilesSelected(e.target.files);
            e.target.value = '';
          }}
        />

        {/* Attachment list */}
        {allAttachmentCount > 0 && (
          <div className="compose-attachments">
            <div className="compose-attachments__header">
              <Attachment size={14} />
              <span>
                {allAttachmentCount} attachment{allAttachmentCount > 1 ? 's' : ''}
              </span>
              <span className="compose-attachments__size">{formatFileSize(totalSize)}</span>
            </div>
            {forwardedAttachments.map((att) => (
              <div key={att.id} className="compose-attachments__item">
                <span className="compose-attachments__name">{att.filename}</span>
                <Tag size="sm" type="cool-gray">forwarded</Tag>
                <span className="compose-attachments__meta">{formatFileSize(att.size)}</span>
                <Button
                  kind="ghost"
                  size="sm"
                  hasIconOnly
                  iconDescription="Remove"
                  renderIcon={Close}
                  onClick={() => removeForwardedAttachment(att.id)}
                  className="compose-attachments__remove"
                />
              </div>
            ))}
            {attachments.map((att) => (
              <div key={att.id} className="compose-attachments__item">
                <span className="compose-attachments__name">{att.filename}</span>
                {att.status === 'reading' && <InlineLoading description="" />}
                {att.status === 'error' && <Tag size="sm" type="red">error</Tag>}
                <span className="compose-attachments__meta">{formatFileSize(att.size)}</span>
                <Button
                  kind="ghost"
                  size="sm"
                  hasIconOnly
                  iconDescription="Remove"
                  renderIcon={Close}
                  onClick={() => removeAttachment(att.id)}
                  className="compose-attachments__remove"
                />
              </div>
            ))}
          </div>
        )}

        <div className="compose-form__actions">
          <Button
            kind="primary"
            size="md"
            renderIcon={SendAlt}
            onClick={handleSend}
            disabled={sending || isUploading}
          >
            {sending ? 'Sending...' : isUploading ? 'Reading files...' : 'Send'}
          </Button>
          <Button
            kind="secondary"
            size="md"
            renderIcon={Time}
            onClick={() => setShowSchedulePicker(!showSchedulePicker)}
            disabled={sending}
          >
            Schedule
          </Button>
          {scheduledAt && (
            <div className="compose-schedule-info">
              <Time size={14} />
              <span>{format(scheduledAt, 'MMM d, h:mm a')}</span>
              <button className="compose-schedule-info__clear" onClick={() => setScheduledAt(null)} title="Remove schedule">
                <Close size={14} />
              </button>
            </div>
          )}
          {sending && <InlineLoading description="" />}
        </div>

        {/* Schedule picker */}
        {showSchedulePicker && (
          <div className="compose-schedule-picker">
            <DatePicker datePickerType="single" onChange={(dates: Date[]) => setScheduledAt(dates[0] || null)}>
              <DatePickerInput id="schedule-date" labelText="Date" placeholder="mm/dd/yyyy" size="sm" />
            </DatePicker>
            <TimePicker id="schedule-time" labelText="Time" value={scheduleTime} size="sm"
              onChange={(e: any) => setScheduleTime(e.target.value)} />
            <Button kind="primary" size="sm" onClick={confirmSchedule} disabled={!scheduledAt}>
              Confirm
            </Button>
          </div>
        )}

        {replyToEmail && (mode === 'reply' || mode === 'replyAll' || mode === 'forward') && (
          <div
            className="compose-quoted"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(getQuotedHtml()) }}
          />
        )}
      </div>
    </SidePanel>,
    document.body
  );
}
