import { useState, useRef, useCallback, useEffect } from 'react';
import { TextInput, Button, InlineLoading, Tag, DatePicker, DatePickerInput, TimePicker, ComboBox } from '@carbon/react';
import { Tearsheet } from '@carbon/ibm-products';
import { SendAlt, Attachment, Close, Time, Save } from '@carbon/icons-react';
import DOMPurify from 'dompurify';
import { format } from 'date-fns';
import { emailsApi } from '../../api/emails';
import { draftsApi } from '../../api/drafts';
import { authApi } from '../../api/auth';
import { templatesApi } from '../../api/templates';
import { useUIStore } from '../../store/uiStore';
import { TiptapEditor } from './TiptapEditor';
import { ComposeToolbar } from './ComposeToolbar';
import { RecipientInput } from './RecipientInput';
import type { Editor } from '@tiptap/react';
import type { ComposeMode, DraftDetail, DraftSaveInput, EmailMessage } from '../../types/email';
import type { EmailTemplate } from '../../types/template';

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

/**
 * A template placeholder the server could not fill — same shape it validates
 * on write, so nothing else can end up matching this.
 */
const PLACEHOLDER_PATTERN = /\{\{\s*[A-Za-z][A-Za-z0-9]*\s*\}\}/g;

/**
 * Placeholders still sitting in the message.
 *
 * The server tells us which variables it could not fill at insert time, but the
 * user may have typed the value in since — or inserted a second template — so
 * the only trustworthy answer is to re-read the text about to be sent.
 */
export function findUnfilledPlaceholders(...parts: string[]): string[] {
  const found = new Set<string>();
  for (const part of parts) {
    for (const match of part.matchAll(PLACEHOLDER_PATTERN)) {
      found.add(match[0].replace(/\s+/g, ''));
    }
  }
  return [...found];
}

interface MailComposeModalProps {
  open: boolean;
  onClose: () => void;
  onSent: () => void;
  mode: ComposeMode;
  replyToEmail?: EmailMessage | null;
  /**
   * A draft already loaded from the server (recipients, subject, body and
   * attachment bytes). Present when the window was opened from the Drafts
   * folder; saving then updates that draft instead of creating a second one.
   */
  draft?: DraftDetail | null;
  /** Fired after a draft is saved or sent so the Drafts folder can refresh. */
  onDraftChanged?: () => void;
}

export function MailComposeModal({ open, onClose, onSent, mode, replyToEmail, draft, onDraftChanged }: MailComposeModalProps) {
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
  /**
   * The draft this window is bound to, if any. Set when opened from the Drafts
   * folder, and set again by the first "Save draft" of a fresh compose — which
   * is what makes the second save an update rather than a duplicate.
   */
  const [draftId, setDraftId] = useState<string | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [insertingTemplate, setInsertingTemplate] = useState(false);
  const [templatePickerKey, setTemplatePickerKey] = useState(0);

  // Pre-fill based on mode
  useEffect(() => {
    if (!open) return;
    setAttachments([]);
    setForwardedAttachments([]);
    setIsDragging(false);
    setScheduledAt(null);
    setShowSchedulePicker(false);
    setScheduleTime('09:00');
    setDraftId(draft?.id ?? null);

    if (mode === 'draft' && draft) {
      setTo(draft.to);
      setCc(draft.cc);
      setBcc(draft.bcc);
      setShowBcc(draft.bcc.length > 0);
      setSubject(draft.subject);
      setAttachments(
        draft.attachments.map((a) => ({
          id: crypto.randomUUID(),
          filename: a.filename,
          size: a.size,
          contentType: a.mimeType,
          content: a.content,
          // A draft attachment Gmail would not hand back (too large to
          // rehydrate) arrives with no bytes; flagging it stops a silent
          // send of an empty file.
          status: a.content ? ('ready' as const) : ('error' as const),
        }))
      );
    } else if (mode === 'new') {
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
  }, [open, mode, replyToEmail, draft]);

  // Seed the editor once it exists: with the draft's own body when one was
  // opened, otherwise with the signature. A draft already carries whatever
  // signature it was saved with, so injecting one here would duplicate it.
  useEffect(() => {
    if (!open || !editorInstance) return;

    // Small delay to ensure editor is fully initialized after mode setup
    const timer = setTimeout(async () => {
      if (editorInstance.isDestroyed) return;

      if (mode === 'draft' && draft) {
        editorInstance.commands.setContent(draft.htmlBody || '');
        editorInstance.commands.focus('start');
        return;
      }

      /**
       * Set the body on EVERY open, even when there is no signature.
       *
       * This used to call `setContent` only if a signature came back, so an
       * account with no signature configured never cleared the editor: close
       * compose without sending, reopen, and the previous message's text was
       * still there — now attached to a different recipient and subject, which
       * To/Cc/Subject had correctly reset. Worse from the draft path, where the
       * body of a draft you had merely looked at followed you into a new
       * message.
       *
       * The signature request is allowed to fail; an empty body is the right
       * fallback, not last time's.
       */
      let body = '';
      try {
        const { data } = await authApi.getSignature();
        if (data.signature) body = `<p></p><p>--</p>${data.signature}`;
      } catch { /* no signature set, or the request failed — start empty */ }

      if (!editorInstance.isDestroyed) {
        editorInstance.commands.setContent(body);
        // Cursor before the signature, so typing starts where the message goes.
        editorInstance.commands.focus('start');
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [open, editorInstance, mode, draft]);

  // Refetched on every open rather than cached: templates are edited in
  // Settings in another tab, and a stale picker is a template the user cannot
  // find the one time they need it.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    templatesApi
      .getAll()
      .then(({ data }) => { if (!cancelled) setTemplates(data.data); })
      .catch(() => { if (!cancelled) setTemplates([]); });
    return () => { cancelled = true; };
  }, [open]);

  /** Replies and forwards keep the original subject; only these modes own one. */
  const canEditSubject = mode === 'new' || mode === 'forward' || mode === 'draft';

  /**
   * Drop a template or snippet into the message.
   *
   * The body is **inserted at the cursor**, never swapped in over what is
   * already there. Replacing would be defensible for an empty compose window
   * and catastrophic everywhere else — and the window is essentially never
   * empty, because the signature is seeded into it on open.
   *
   * The subject is only filled when it is blank and the mode actually owns one.
   * Overwriting a subject the user typed, or rewriting a reply's "Re: …", are
   * both silent destruction of something they chose.
   */
  const handleInsertTemplate = useCallback(async (template: EmailTemplate) => {
    setInsertingTemplate(true);
    try {
      const recipient = to[0];
      const { data } = await templatesApi.render(template.id, {
        ...(recipient ? { recipientEmail: recipient } : {}),
        // The display name is only a valid hint for the person it belongs to.
        ...(replyToEmail?.fromName && recipient?.toLowerCase() === replyToEmail.from.toLowerCase()
          ? { recipientName: replyToEmail.fromName }
          : {}),
      });
      const rendered = data.data;

      const editor = editorRef.current;
      if (editor && !editor.isDestroyed) {
        editor.chain().focus().insertContent(rendered.body).run();
      }

      const notes: string[] = [];
      if (rendered.subject) {
        if (!canEditSubject) {
          notes.push('the subject was kept as-is');
        } else if (subject.trim()) {
          notes.push('the subject you already wrote was kept');
        } else {
          setSubject(rendered.subject);
        }
      }

      if (rendered.missing.length > 0) {
        addNotification({
          kind: 'warning',
          title: `Inserted "${template.name}" — fill in ${rendered.missing.map((v) => `{{${v}}}`).join(', ')}`,
          subtitle: [
            'There is nothing on file for those, so they were left in place. The message cannot be sent until they are gone.',
            ...notes,
          ].join(' Also, '),
        });
      } else {
        addNotification({
          kind: 'success',
          title: `Inserted "${template.name}"`,
          ...(notes.length > 0 ? { subtitle: `Note: ${notes.join('; ')}.` } : {}),
        });
      }
    } catch {
      addNotification({ kind: 'error', title: `Failed to insert "${template.name}"` });
    } finally {
      setInsertingTemplate(false);
    }
  }, [to, replyToEmail, subject, canEditSubject, addNotification]);

  /**
   * Refuse to send while a `{{placeholder}}` survives.
   *
   * The whole point of substitution is that a customer never receives "Hi
   * {{firstName}},". Leaving the token visible in the editor is not enough —
   * people send without re-reading — so this is a hard stop, and it is checked
   * against the text at send time rather than the state at insert time.
   */
  const blockedByPlaceholders = (): boolean => {
    const unfilled = findUnfilledPlaceholders(editorRef.current?.getHTML() || '', subject);
    if (unfilled.length === 0) return false;
    addNotification({
      kind: 'warning',
      title: `Fill in ${unfilled.join(', ')} before sending`,
      subtitle: 'A template placeholder is still in the message.',
    });
    return true;
  };

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

  /**
   * Drafts are offered everywhere except Forward. A forward's payload includes
   * attachments that live on the original message and are never uploaded here,
   * so saving one as a draft would quietly drop them.
   */
  const canSaveDraft = mode !== 'forward';

  /**
   * The body a draft has to carry. A reply's quoted original is appended by the
   * server at send time but not at draft time, so it is folded in here —
   * otherwise the quote would vanish from a reply that was put down and picked
   * back up. A draft reopened from the Drafts folder already contains it.
   */
  const draftBody = () => {
    const html = editorRef.current?.getHTML() || '';
    if (mode === 'reply' || mode === 'replyAll') return `${html}${getQuotedHtml()}`;
    return html;
  };

  const draftPayload = (): DraftSaveInput => ({
    to,
    cc,
    bcc,
    subject,
    htmlBody: draftBody(),
    attachments: attachments
      .filter((a) => a.status === 'ready')
      .map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType, size: a.size })),
    ...(mode === 'reply' || mode === 'replyAll' ? { replyToEmailId: replyToEmail?.id } : {}),
  });

  const handleSaveDraft = async () => {
    setSavingDraft(true);
    try {
      const payload = draftPayload();
      const { data } = draftId
        ? await draftsApi.update(draftId, payload)
        : await draftsApi.create(payload);
      setDraftId(data.data.id);
      addNotification({ kind: 'success', title: 'Draft saved' });
      onDraftChanged?.();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to save draft' });
    } finally {
      setSavingDraft(false);
    }
  };

  /**
   * Send a message that is already a Gmail draft.
   *
   * Goes through `drafts.send`, which sends and consumes the draft in one
   * operation — the alternative (send, then delete) leaves a stale copy behind
   * whenever the delete fails.
   */
  const handleSendDraft = async (id: string) => {
    if (to.length === 0) {
      addNotification({ kind: 'warning', title: 'Add at least one recipient' });
      return;
    }
    if (blockedByPlaceholders()) return;
    setSending(true);
    try {
      await draftsApi.send(id, draftPayload());
      addNotification({ kind: 'success', title: 'Message sent' });
      onDraftChanged?.();
      onSent();
      onClose();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to send message' });
    } finally {
      setSending(false);
    }
  };

  const handleSend = async () => {
    // If scheduled, delegate to schedule handler
    if (scheduledAt) {
      return handleScheduleSend();
    }

    // Once this window is bound to a draft, sending must go through the draft
    // so Gmail consumes it. Sending the normal way would leave the draft behind.
    if (draftId) {
      return handleSendDraft(draftId);
    }

    const htmlBody = editorRef.current?.getHTML() || '';
    if (mode !== 'forward' && (!htmlBody || htmlBody === '<p></p>')) {
      addNotification({ kind: 'warning', title: 'Please write a message' });
      return;
    }
    if (blockedByPlaceholders()) return;

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
        if (to.length === 0) {
          addNotification({ kind: 'warning', title: 'Add at least one recipient' });
          setSending(false);
          return;
        }
        await emailsApi.replyToEmail(replyToEmail.id, {
          htmlBody,
          // The To field is editable on a reply, so send what it holds. This
          // used to be omitted entirely and the server fell back to the original
          // sender — so clearing the chip and typing a different address sent
          // the message to the person the user had just removed.
          to,
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
    // A scheduled send goes out unattended, so an unfilled placeholder here is
    // strictly worse than one in an immediate send — nobody is watching.
    if (blockedByPlaceholders()) return;

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
      // The scheduler now owns this message. Leaving the draft behind would
      // put the same mail in two places, one of which sends itself.
      if (draftId) {
        try {
          await draftsApi.remove(draftId);
          setDraftId(null);
          onDraftChanged?.();
        } catch { /* the draft survives; the schedule still stands */ }
      }
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

  const panelTitle =
    mode === 'new' ? 'New Email'
    : mode === 'draft' ? 'Draft'
    : mode === 'reply' ? 'Reply'
    : mode === 'replyAll' ? 'Reply All'
    : 'Forward';
  const panelDescription =
    mode === 'new'
      ? 'Compose a new message'
      : mode === 'draft'
        ? 'Pick up where you left off'
        : mode === 'forward'
          ? 'Forward this message to new recipients'
          : 'Reply to this conversation';

  return (
    <Tearsheet
      open={open}
      onClose={onClose}
      title={panelTitle}
      label="Mail"
      description={panelDescription}
      hasCloseIcon
      selectorsFloatingMenus={['.cds--date-picker__calendar']}
      actions={[
        {
          key: 'send',
          label: sending ? 'Sending...' : isUploading ? 'Reading files...' : 'Send',
          onClick: handleSend,
          kind: 'primary' as const,
          disabled: sending || isUploading,
          loading: sending,
          renderIcon: SendAlt,
        },
        {
          key: 'schedule',
          label: 'Schedule',
          onClick: () => setShowSchedulePicker(!showSchedulePicker),
          kind: 'secondary' as const,
          // Scheduled send stores its own copy of the message; a draft opened
          // from the Drafts folder already has a copy in Gmail, and there is no
          // sensible reading of "both". Send it or leave it a draft.
          disabled: sending || mode === 'draft',
          renderIcon: Time,
        },
        // Explicit, never on a timer: one save is one Gmail write.
        ...(canSaveDraft
          ? [{
              key: 'save-draft',
              label: savingDraft ? 'Saving...' : draftId ? 'Update draft' : 'Save draft',
              onClick: handleSaveDraft,
              kind: 'ghost' as const,
              disabled: sending || savingDraft || isUploading,
              renderIcon: Save,
            }]
          : []),
      ]}
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

        {(mode === 'new' || mode === 'forward' || mode === 'draft') && (
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

        {/*
          A filterable ComboBox rather than a dialog: picking a saved body is a
          "choose one from a list" job, which is what Carbon's combo box is for,
          and it keeps the whole interaction to a click and a keystroke inside
          the compose window instead of covering it with a second layer.
        */}
        <div className="compose-templates">
          <ComboBox<EmailTemplate>
            // Remounted after each insert: the picker is a command, not a
            // selection, so the previous choice must not linger in the field.
            key={`compose-template-picker-${templatePickerKey}`}
            id="compose-template-picker"
            className="compose-templates__picker"
            size="sm"
            titleText="Templates"
            placeholder={templates.length > 0 ? 'Insert a template or snippet' : 'No templates saved yet'}
            helperText={
              templates.length > 0
                ? 'Inserted at the cursor — nothing you have written is replaced'
                : 'Create them under Settings → Email Templates'
            }
            disabled={templates.length === 0 || insertingTemplate}
            items={templates}
            selectedItem={null}
            itemToString={(item: EmailTemplate | null) =>
              item ? (item.kind === 'snippet' ? `${item.name} — snippet` : item.name) : ''
            }
            onChange={({ selectedItem }: { selectedItem?: EmailTemplate | null }) => {
              if (!selectedItem) return;
              setTemplatePickerKey((k) => k + 1);
              void handleInsertTemplate(selectedItem);
            }}
          />
          {insertingTemplate && <InlineLoading description="Inserting..." />}
        </div>

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

        {scheduledAt && (
          <div className="compose-form__actions">
            <div className="compose-schedule-info">
              <Time size={14} />
              <span>{format(scheduledAt, 'MMM d, h:mm a')}</span>
              <button className="compose-schedule-info__clear" onClick={() => setScheduledAt(null)} title="Remove schedule">
                <Close size={14} />
              </button>
            </div>
          </div>
        )}

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
    </Tearsheet>
  );
}
