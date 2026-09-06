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
 * modal's "Existing task" mode. What matters is the payload each sends —
 * attach names the email and the task; the modal's existing mode attaches
 * rather than creating.
 */

vi.mock('../../api/emails', () => ({
  emailsApi: { attachToTask: vi.fn(), detachFromTask: vi.fn(), convertToTask: vi.fn() },
}));
vi.mock('../../api/tasks', () => ({ tasksApi: { getAll: vi.fn() } }));
vi.mock('../../api/search', () => ({ searchApi: { search: vi.fn() } }));

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
