import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor } from '@tiptap/react';
import { MailComposeModal } from './MailComposeModal';
import { templatesApi } from '../../api/templates';
import { emailsApi } from '../../api/emails';
import type { EmailMessage } from '../../types/email';

/**
 * Inserting a template into a message being written.
 *
 * Every case here is about *not* destroying something. A template arrives in a
 * window that is never empty — the signature is seeded into it on open — and it
 * may arrive after the user has already typed a subject. And a template body
 * carries `{{placeholders}}`, which must never reach a recipient as literal
 * text. Those three are the whole risk surface of the feature.
 */

/** A stand-in for the Tiptap instance, holding just the HTML the component drives. */
class FakeEditor {
  html = '';
  isDestroyed = false;

  getHTML() {
    return this.html;
  }

  commands = {
    setContent: (html: string) => { this.html = html; },
    focus: () => true,
    clearContent: () => { this.html = ''; },
  };

  chain() {
    return {
      focus: () => ({
        insertContent: (html: string) => ({
          // Appending, not replacing — the assertion under test is that the
          // component never asks the editor to replace.
          run: () => { this.html += html; },
        }),
      }),
    };
  }
}

let fakeEditor = new FakeEditor();

interface TiptapStubProps {
  editorRef?: { current: Editor | null };
  onEditorReady?: (editor: Editor) => void;
}

vi.mock('./TiptapEditor', () => ({
  TiptapEditor: ({ editorRef, onEditorReady }: TiptapStubProps) => {
    const editor = fakeEditor as unknown as Editor;
    if (editorRef) editorRef.current = editor;
    queueMicrotask(() => onEditorReady?.(editor));
    return <div data-testid="tiptap-stub" />;
  },
}));

// The formatting toolbar drives a real Tiptap instance through a dozen
// `isActive`/`can` calls. None of it is under test here, and stubbing it keeps
// the fake editor down to the two methods template insertion actually uses.
vi.mock('./ComposeToolbar', () => ({
  ComposeToolbar: () => <div data-testid="compose-toolbar-stub" />,
}));

vi.mock('../../api/templates', () => ({
  templatesApi: { getAll: vi.fn(), render: vi.fn() },
}));

vi.mock('../../api/emails', () => ({
  emailsApi: { sendEmail: vi.fn(), replyToEmail: vi.fn(), forwardEmail: vi.fn(), scheduleEmail: vi.fn() },
}));

vi.mock('../../api/drafts', () => ({
  draftsApi: { create: vi.fn(), update: vi.fn(), send: vi.fn(), remove: vi.fn() },
}));

vi.mock('../../api/auth', () => ({
  authApi: { getSignature: vi.fn().mockResolvedValue({ data: { signature: '<p>Alice</p>' } }) },
}));

vi.mock('../../api/contacts', () => ({
  contactsApi: { search: vi.fn().mockResolvedValue({ data: { data: [] } }) },
}));

const addNotification = vi.fn();
vi.mock('../../store/uiStore', () => ({
  useUIStore: (selector: (state: { addNotification: typeof addNotification }) => unknown) =>
    selector({ addNotification }),
}));

const TEMPLATE = {
  id: 'tpl-1',
  name: 'Pricing follow-up',
  kind: 'template' as const,
  subject: 'Following up on pricing',
  body: '<p>Hi Jane,</p>',
  usageCount: 4,
  lastUsedAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const REPLY_TO: EmailMessage = {
  id: 'email-1',
  threadId: 'thread-1',
  subject: 'Quote request',
  from: 'jane@acme.test',
  fromName: 'Jane Doe',
  to: ['me@mailviz.test'],
  cc: [],
  snippet: 'Could you send pricing?',
  body: '<p>Could you send pricing?</p>',
  receivedAt: '2026-08-10T09:00:00.000Z',
  attachments: [],
} as unknown as EmailMessage;

function mockRender(overrides: Partial<{ subject: string | null; body: string; missing: string[] }> = {}) {
  vi.mocked(templatesApi.render).mockResolvedValue({
    data: {
      data: {
        id: TEMPLATE.id,
        name: TEMPLATE.name,
        kind: 'template',
        subject: overrides.subject !== undefined ? overrides.subject : TEMPLATE.subject,
        body: overrides.body ?? TEMPLATE.body,
        missing: overrides.missing ?? [],
        variables: {},
      },
    },
  } as Awaited<ReturnType<typeof templatesApi.render>>);
}

/** Open the picker and choose a template by name. */
async function insertTemplate(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('combobox', { name: /templates/i }));
  await user.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeEditor = new FakeEditor();
  vi.mocked(templatesApi.getAll).mockResolvedValue({
    data: { data: [TEMPLATE] },
  } as Awaited<ReturnType<typeof templatesApi.getAll>>);
  mockRender();
});

function renderCompose(props: Partial<React.ComponentProps<typeof MailComposeModal>> = {}) {
  return render(
    <MailComposeModal
      open
      onClose={vi.fn()}
      onSent={vi.fn()}
      mode="new"
      {...props}
    />
  );
}

describe('MailComposeModal — template insertion', () => {
  it('inserts the template body without replacing what is already written', async () => {
    const user = userEvent.setup();
    renderCompose();

    // The signature is seeded on open; that is the text a "replace" would eat.
    await waitFor(() => expect(fakeEditor.html).toContain('Alice'));

    await insertTemplate(user, 'Pricing follow-up');

    await waitFor(() => expect(fakeEditor.html).toContain('Hi Jane,'));
    expect(fakeEditor.html).toContain('Alice');
  });

  it('fills an empty subject from the template', async () => {
    const user = userEvent.setup();
    renderCompose();

    await insertTemplate(user, 'Pricing follow-up');

    const subject = await screen.findByLabelText('Subject');
    await waitFor(() => expect(subject).toHaveValue('Following up on pricing'));
  });

  it('keeps a subject the user already typed, and says so', async () => {
    const user = userEvent.setup();
    renderCompose();

    const subject = await screen.findByLabelText('Subject');
    await user.type(subject, 'My own subject');

    await insertTemplate(user, 'Pricing follow-up');

    await waitFor(() => expect(templatesApi.render).toHaveBeenCalled());
    expect(subject).toHaveValue('My own subject');
    expect(addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ subtitle: expect.stringContaining('subject you already wrote') })
    );
  });

  it('passes the recipient to the server so variables can be resolved', async () => {
    const user = userEvent.setup();
    renderCompose({ mode: 'reply', replyToEmail: REPLY_TO });

    await insertTemplate(user, 'Pricing follow-up');

    await waitFor(() =>
      expect(templatesApi.render).toHaveBeenCalledWith('tpl-1', {
        recipientEmail: 'jane@acme.test',
        recipientName: 'Jane Doe',
      })
    );
  });

  it('refuses to send while an unfilled placeholder is still in the body', async () => {
    const user = userEvent.setup();
    mockRender({ body: '<p>Hi {{firstName}},</p>', missing: ['firstName'], subject: null });
    renderCompose({ mode: 'reply', replyToEmail: REPLY_TO });

    await waitFor(() => expect(fakeEditor.html).toContain('Alice'));
    await insertTemplate(user, 'Pricing follow-up');
    await waitFor(() => expect(fakeEditor.html).toContain('{{firstName}}'));

    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(emailsApi.replyToEmail).not.toHaveBeenCalled();
    expect(addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('{{firstName}}') })
    );
  });

  it('sends once the placeholder has been resolved', async () => {
    const user = userEvent.setup();
    mockRender({ body: '<p>Hi Jane,</p>', subject: null });
    renderCompose({ mode: 'reply', replyToEmail: REPLY_TO });

    await waitFor(() => expect(fakeEditor.html).toContain('Alice'));
    await insertTemplate(user, 'Pricing follow-up');
    await waitFor(() => expect(fakeEditor.html).toContain('Hi Jane,'));

    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(emailsApi.replyToEmail).toHaveBeenCalled());
  });
});
