import { useState, useRef, useCallback, useEffect } from 'react';
import { TextInput, Button, InlineLoading } from '@carbon/react';
import { SidePanel } from '@carbon/ibm-products';
import { SendAlt } from '@carbon/icons-react';
import DOMPurify from 'dompurify';
import { format } from 'date-fns';
import { emailsApi } from '../../api/emails';
import { useUIStore } from '../../store/uiStore';
import { TiptapEditor } from './TiptapEditor';
import { ComposeToolbar } from './ComposeToolbar';
import { RecipientInput } from './RecipientInput';
import type { Editor } from '@tiptap/react';
import type { ComposeMode, EmailMessage } from '../../types/email';

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
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const [sending, setSending] = useState(false);
  const [to, setTo] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);
  const [bcc, setBcc] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [showBcc, setShowBcc] = useState(false);

  // Pre-fill based on mode
  useEffect(() => {
    if (!open) return;
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
    }
  }, [open, mode, replyToEmail]);

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

  const handleSend = async () => {
    const htmlBody = editorRef.current?.getHTML() || '';
    if (!htmlBody || htmlBody === '<p></p>') {
      addNotification({ kind: 'warning', title: 'Please write a message' });
      return;
    }

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
        });
      } else if ((mode === 'reply' || mode === 'replyAll') && replyToEmail) {
        await emailsApi.replyToEmail(replyToEmail.id, {
          htmlBody,
          replyAll: mode === 'replyAll',
          cc: cc.length > 0 ? cc : undefined,
          bcc: bcc.length > 0 ? bcc : undefined,
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

  const panelTitle = mode === 'new' ? 'New Email' : mode === 'reply' ? 'Reply' : mode === 'replyAll' ? 'Reply All' : 'Forward';

  return (
    <SidePanel
      open={open}
      onRequestClose={onClose}
      title={panelTitle}
      size="lg"
      slideIn
      selectorPageContent=".app-content"
      className="compose-side-panel"
    >
      <div className="compose-form">
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

        <ComposeToolbar editor={editorInstance} />
        <TiptapEditor editorRef={editorRef} onEditorReady={setEditorInstance} placeholder="Write your message..." />

        <div className="compose-form__actions">
          <Button
            kind="primary"
            size="md"
            renderIcon={SendAlt}
            onClick={handleSend}
            disabled={sending}
          >
            {sending ? 'Sending...' : 'Send'}
          </Button>
          {sending && <InlineLoading description="Sending..." />}
        </div>

        {replyToEmail && (mode === 'reply' || mode === 'replyAll' || mode === 'forward') && (
          <div
            className="compose-quoted"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(getQuotedHtml()) }}
          />
        )}
      </div>
    </SidePanel>
  );
}
