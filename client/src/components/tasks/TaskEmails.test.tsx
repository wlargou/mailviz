import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { emailsApi } from '../../api/emails';
import { tasksApi } from '../../api/tasks';
import { searchApi } from '../../api/search';
import { TaskEmails } from './TaskEmails';
import { ConvertToTaskModal } from '../mail/ConvertToTaskModal';
import type { Task } from '../../types/task';
import type { EmailMessage } from '../../types/email';

/**
 * Email ↔ task on the client: the panel's Emails section, and the convert
 * modal's two modes. What matters is the payload each sends — attach names
 * the email and the task; the modal's existing mode attaches rather than
 * creating; and its new-task mode carries the whole task form, because it
 * used to send three fields and the rest had to be filled in afterwards.
 */

vi.mock('../../api/emails', () => ({
  emailsApi: { attachToTask: vi.fn(), detachFromTask: vi.fn(), convertToTask: vi.fn() },
}));
vi.mock('../../api/tasks', () => ({ tasksApi: { getAll: vi.fn() } }));
vi.mock('../../api/search', () => ({ searchApi: { search: vi.fn() } }));
vi.mock('../../api/taskStatuses', () => ({
  taskStatusesApi: {
    getAll: vi.fn().mockResolvedValue({
      data: { data: [
        { id: 's1', name: 'TODO', label: 'To do', color: '#4589ff', position: 0, isTerminal: false, createdAt: '' },
        { id: 's2', name: 'IN_PROGRESS', label: 'In progress', color: '#4589ff', position: 1, isTerminal: false, createdAt: '' },
      ] },
    }),
  },
}));
vi.mock('../../api/labels', () => ({
  labelsApi: { getAll: vi.fn().mockResolvedValue({ data: { data: [{ id: 'l-sales', name: 'Sales', color: '#0f62fe', createdAt: '' }] } }) },
}));
vi.mock('../../api/customers', () => ({
  customersApi: {
    getAll: vi.fn().mockResolvedValue({ data: { data: [{ id: 'c-acme', name: 'Acme' }] } }),
    getById: vi.fn().mockResolvedValue({ data: { data: { id: 'c-acme', name: 'Acme' } } }),
  },
}));

function axiosOk<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() } };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Send the quote',
    description: null,
    status: 'OPEN',
    priority: 'MEDIUM',
    dueDate: null,
    startDate: null,
    remindAt: null,
    reminderSentAt: null,
    position: 0,
    customerId: null,
    assignedToId: null,
    assignedTo: null,
    estimatedMinutes: null,
    userId: 'me',
    createdAt: '',
    updatedAt: '',
    labels: [],
    customer: null,
    parentId: null,
    parent: null,
    subtaskCount: 0,
    subtaskDoneCount: 0,
    checklistCount: 0,
    checklistDoneCount: 0,
    blockedByCount: 0,
    openBlockerCount: 0,
    blocksCount: 0,
    linkCount: 0,
    trackedMinutes: 0,
    recurrence: null,
    recurrenceNextId: null,
    ...overrides,
  } as Task;
}

const LINK = {
  id: 'l1',
  conversionNote: null,
  createdAt: '',
  email: { id: 'e1', subject: 'Quote request', from: 'sam@acme.test', fromName: 'Sam', threadId: 'thr', receivedAt: '2026-09-01T09:00:00.000Z', isArchived: false },
};

describe('TaskEmails', () => {
  beforeEach(() => {
    vi.mocked(emailsApi.attachToTask).mockReset();
    vi.mocked(emailsApi.detachFromTask).mockReset();
    vi.mocked(searchApi.search).mockReset();
  });

  it('lists linked emails and detaches one', async () => {
    vi.mocked(emailsApi.detachFromTask).mockResolvedValue(axiosOk({}));
    const onChanged = vi.fn();
    render(
      <MemoryRouter>
        <TaskEmails task={makeTask({ emailLinks: [LINK] })} onChanged={onChanged} />
      </MemoryRouter>
    );

    expect(screen.getByRole('button', { name: /^Quote request/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Detach: Quote request' }));

    await waitFor(() => expect(emailsApi.detachFromTask).toHaveBeenCalledWith('e1', 't1'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('searches mail and attaches a pick, hiding what is already linked', async () => {
    vi.mocked(searchApi.search).mockResolvedValue(
      axiosOk({
        data: {
          emails: [
            { id: 'e1', threadId: 'thr', subject: 'Quote request', from: 'sam@acme.test', fromName: 'Sam', snippet: null, receivedAt: '2026-09-01T09:00:00.000Z' },
            { id: 'e2', threadId: 'thr', subject: 'Re: Quote request', from: 'sam@acme.test', fromName: 'Sam', snippet: null, receivedAt: '2026-09-02T09:00:00.000Z' },
          ],
          tasks: [],
          events: [],
          customers: [],
          contacts: [],
          deals: [],
        },
      })
    );
    vi.mocked(emailsApi.attachToTask).mockResolvedValue(axiosOk({}));
    render(
      <MemoryRouter>
        <TaskEmails task={makeTask({ emailLinks: [LINK] })} onChanged={vi.fn()} />
      </MemoryRouter>
    );

    await userEvent.type(screen.getByPlaceholderText('Attach an email…'), 'quote');
    const reply = await screen.findByRole('option', { name: /Re: Quote request/ });
    expect(screen.queryByRole('option', { name: /^Quote request/ })).toBeNull();

    await userEvent.click(reply);
    await waitFor(() => expect(emailsApi.attachToTask).toHaveBeenCalledWith('e2', 't1'));
  });
});

describe('ConvertToTaskModal — existing task', () => {
  const email = { id: 'e9', subject: 'Re: Renewal', from: 'sam@acme.test' } as EmailMessage;

  it('attaches to the picked task instead of creating one', async () => {
    vi.mocked(tasksApi.getAll).mockResolvedValue(axiosOk({ data: [makeTask({ id: 'renew', title: 'Renew the contract' })] } as never));
    vi.mocked(emailsApi.attachToTask).mockResolvedValue(axiosOk({}));
    const onConverted = vi.fn();
    render(<ConvertToTaskModal email={email} open onClose={vi.fn()} onConverted={onConverted} />);

    await userEvent.click(screen.getByRole('tab', { name: 'Existing task' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Attach' })).toBeDisabled();
    await userEvent.type(within(dialog).getByPlaceholderText('Search a task…'), 'ren');
    await userEvent.click(await within(dialog).findByRole('option', { name: 'Renew the contract' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Attach' }));

    await waitFor(() => expect(emailsApi.attachToTask).toHaveBeenCalledWith('e9', 'renew', undefined));
    expect(emailsApi.convertToTask).not.toHaveBeenCalled();
    expect(onConverted).toHaveBeenCalled();
  });
});

describe('ConvertToTaskModal — new task', () => {
  beforeEach(() => {
    vi.mocked(emailsApi.attachToTask).mockClear();
    vi.mocked(emailsApi.convertToTask).mockClear();
  });

  const email = {
    id: 'e9',
    subject: 'Re: Renewal &amp; upgrade',
    snippet: 'Can we talk &amp; agree?',
    from: 'sam@acme.test',
    customer: { id: 'c-acme', name: 'Acme', domain: 'acme.test', logoUrl: null },
  } as EmailMessage;

  it('seeds the title, description and company from the email', async () => {
    render(<ConvertToTaskModal email={email} open onClose={vi.fn()} onConverted={vi.fn()} />);
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).getByLabelText('Task title')).toHaveValue('Re: Renewal & upgrade');
    expect(within(dialog).getByLabelText('Description')).toHaveValue('Can we talk & agree?');
    await waitFor(() => expect(within(dialog).getByRole('combobox', { name: /Company/i })).toHaveValue('Acme'));
  });

  it('reseeds when reopened for another email — nothing carries over', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ConvertToTaskModal email={email} open onClose={vi.fn()} onConverted={vi.fn()} />);
    let dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('combobox', { name: /Priority/i }));
    await user.click(await within(dialog).findByRole('option', { name: 'High' }));
    await user.type(within(dialog).getByLabelText('Notes'), 'stale');

    rerender(<ConvertToTaskModal email={email} open={false} onClose={vi.fn()} onConverted={vi.fn()} />);
    const other = { ...email, id: 'e10', subject: 'Invoice', snippet: 'Attached', customer: null } as EmailMessage;
    rerender(<ConvertToTaskModal email={other} open onClose={vi.fn()} onConverted={vi.fn()} />);
    dialog = screen.getByRole('dialog');

    expect(within(dialog).getByLabelText('Task title')).toHaveValue('Invoice');
    expect(within(dialog).getByLabelText('Description')).toHaveValue('Attached');
    expect(within(dialog).getByLabelText('Notes')).toHaveValue('');
    expect(within(dialog).getByRole('combobox', { name: /Priority/i })).toHaveTextContent('Medium');
  });

  it('sends every task field, not just title and priority', async () => {
    vi.mocked(emailsApi.convertToTask).mockResolvedValue(axiosOk({}) as never);
    const onConverted = vi.fn();
    const user = userEvent.setup();
    render(<ConvertToTaskModal email={email} open onClose={vi.fn()} onConverted={onConverted} />);
    const dialog = screen.getByRole('dialog');

    await user.click(within(dialog).getByRole('combobox', { name: /Status/i }));
    await user.click(await within(dialog).findByRole('option', { name: 'In progress' }));
    await user.click(within(dialog).getByRole('combobox', { name: /Priority/i }));
    await user.click(await within(dialog).findByRole('option', { name: 'High' }));
    await user.click(within(dialog).getByRole('combobox', { name: /Labels/i }));
    await user.click(await within(dialog).findByRole('option', { name: 'Sales' }));
    await user.keyboard('{Escape}');
    // Two steps up the effort ladder: None → 5 min → 10 min.
    within(dialog).getByRole('slider').focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    await user.type(within(dialog).getByLabelText('Notes'), 'from the thread');
    await user.click(within(dialog).getByRole('button', { name: 'Create Task' }));

    await waitFor(() => expect(emailsApi.convertToTask).toHaveBeenCalledTimes(1));
    expect(vi.mocked(emailsApi.convertToTask).mock.calls[0]).toEqual(['e9', {
      title: 'Re: Renewal & upgrade',
      description: 'Can we talk & agree?',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      dueDate: null,
      startDate: undefined,
      labelIds: ['l-sales'],
      customerId: 'c-acme',
      recurrence: undefined,
      remindAt: undefined,
      estimatedMinutes: 10,
      notes: 'from the thread',
    }]);
    expect(emailsApi.attachToTask).not.toHaveBeenCalled();
    expect(onConverted).toHaveBeenCalled();
  });
});
