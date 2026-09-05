import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { tasksApi } from '../../api/tasks';
import { useAuthStore } from '../../store/authStore';
import { TaskActivity, describeEvent } from './TaskActivity';
import type { TaskActivityEntry, TaskStatusConfig } from '../../types/task';

/**
 * The activity section: the timeline sentences, and the @mention composer.
 *
 * What the composer sends is the point. A mention picked from the list is an
 * id in the payload; delete the `@Name` from the text and the id goes with
 * it, so nobody is notified about a comment that no longer addresses them.
 */

vi.mock('../../api/tasks', () => ({
  tasksApi: {
    getActivity: vi.fn(),
    addComment: vi.fn(),
    updateComment: vi.fn(),
    deleteComment: vi.fn(),
  },
}));

function axiosOk<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() } };
}

const ME = { id: 'me', name: 'Walid', email: 'walid@example.com', avatarUrl: null };
const SAM = { id: 'sam', name: 'Sam Lee', email: 'sam@example.com' };
const PAT = { id: 'pat', name: null, email: 'pat.o@example.com' };

const STATUSES: TaskStatusConfig[] = [
  { id: 's1', name: 'TODO', label: 'To do', color: '', position: 0, isTerminal: false, createdAt: '' },
  { id: 's2', name: 'DONE', label: 'Done', color: '', position: 1, isTerminal: true, createdAt: '' },
];

const statusLabel = (n: unknown) => STATUSES.find((s) => s.name === n)?.label ?? String(n);

function textOf(node: React.ReactNode): string {
  const { container } = render(<span>{node}</span>);
  return container.textContent ?? '';
}

describe('describeEvent', () => {
  it('reads a status change with its labels, and lists several changes as a sentence', () => {
    const details = {
      changes: ['status', 'priority', 'dueDate'],
      from: { status: 'TODO', priority: 'LOW', dueDate: null },
      to: { status: 'DONE', priority: 'HIGH', dueDate: '2026-10-01T00:00:00.000Z' },
    };
    const text = textOf(describeEvent('TASK_UPDATED', details, statusLabel));
    expect(text).toContain('moved this from To do to Done');
    expect(text).toContain('set priority to high');
    expect(text).toMatch(/and set the due date to (Sep 30|Oct 1), 2026/);
  });

  it('degrades to the change names for rows written before from/to existed', () => {
    expect(textOf(describeEvent('TASK_UPDATED', { changes: ['status'] }, statusLabel))).toBe('changed the status');
    expect(textOf(describeEvent('TASK_CREATED', { parentId: 'p' }, statusLabel))).toBe('created this subtask');
    expect(textOf(describeEvent('TASK_ASSIGNED', { to: { assignedTo: 'Sam' } }, statusLabel))).toBe('assigned this to Sam');
    expect(textOf(describeEvent('TASK_ASSIGNED', { to: { assignedTo: null } }, statusLabel))).toBe('unassigned this');
  });
});

describe('TaskActivity', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { ...ME, timezone: null } as never });
    vi.mocked(tasksApi.getActivity).mockReset();
    vi.mocked(tasksApi.addComment).mockReset();
    vi.mocked(tasksApi.deleteComment).mockReset();
  });

  const entries: TaskActivityEntry[] = [
    {
      kind: 'comment',
      id: 'c1',
      at: '2026-09-05T10:00:00.000Z',
      actor: { id: 'sam', name: 'Sam Lee', email: 'sam@example.com', avatarUrl: null },
      body: '@Walid can you take this?',
      mentions: ['me'],
      editedAt: null,
    },
    {
      kind: 'event',
      id: 'e1',
      at: '2026-09-04T10:00:00.000Z',
      actor: { id: 'sam', name: 'Sam Lee', email: 'sam@example.com', avatarUrl: null },
      action: 'TASK_CREATED',
      details: {},
    },
  ];

  it('renders comments and events, highlighting a mention', async () => {
    vi.mocked(tasksApi.getActivity).mockResolvedValue(axiosOk({ data: entries }));
    render(<TaskActivity taskId="t1" ownerId="sam" users={[SAM, PAT]} statuses={STATUSES} />);

    await screen.findByText('can you take this?', { exact: false });
    expect(screen.getByText('@Walid', { exact: false }).closest('.task-activity__mention')).toBeNull();
    expect(screen.getByText('created this task')).toBeInTheDocument();
    // Sam's comment: I am neither author nor owner, so no delete button.
    expect(screen.queryByRole('button', { name: 'Delete comment' })).toBeNull();
  });

  it('the owner may delete anyone\'s comment, the author may also edit', async () => {
    vi.mocked(tasksApi.getActivity).mockResolvedValue(axiosOk({ data: entries }));
    vi.mocked(tasksApi.deleteComment).mockResolvedValue(axiosOk(undefined));
    render(<TaskActivity taskId="t1" ownerId="me" users={[SAM]} statuses={STATUSES} />);

    const del = await screen.findByRole('button', { name: 'Delete comment' });
    expect(screen.queryByRole('button', { name: 'Edit comment' })).toBeNull();
    await userEvent.click(del);
    await waitFor(() => expect(tasksApi.deleteComment).toHaveBeenCalledWith('t1', 'c1'));
  });

  it('picking a user from the @ list inserts the name and sends the id', async () => {
    vi.mocked(tasksApi.getActivity).mockResolvedValue(axiosOk({ data: [] }));
    vi.mocked(tasksApi.addComment).mockResolvedValue(axiosOk({ data: {} as never }));
    render(<TaskActivity taskId="t1" ownerId="me" users={[SAM, PAT]} statuses={STATUSES} />);

    const box = await screen.findByPlaceholderText(/Add a comment/);
    await userEvent.type(box, 'Ping @sa');

    const list = screen.getByRole('listbox', { name: 'People to mention' });
    expect(within(list).getByText('Sam Lee')).toBeInTheDocument();
    expect(within(list).queryByText('pat.o')).toBeNull();
    await userEvent.keyboard('{Enter}');

    expect((box as HTMLTextAreaElement).value).toBe('Ping @Sam Lee ');
    await userEvent.type(box, 'please');
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));

    await waitFor(() =>
      expect(tasksApi.addComment).toHaveBeenCalledWith('t1', { body: 'Ping @Sam Lee please', mentions: ['sam'] })
    );
    expect((box as HTMLTextAreaElement).value).toBe('');
  });

  it('a mention removed from the text is not sent', async () => {
    vi.mocked(tasksApi.getActivity).mockResolvedValue(axiosOk({ data: [] }));
    vi.mocked(tasksApi.addComment).mockResolvedValue(axiosOk({ data: {} as never }));
    render(<TaskActivity taskId="t1" ownerId="me" users={[SAM]} statuses={STATUSES} />);

    const box = await screen.findByPlaceholderText(/Add a comment/);
    await userEvent.type(box, '@Sam');
    await userEvent.keyboard('{Enter}');
    expect((box as HTMLTextAreaElement).value).toBe('@Sam Lee ');

    await userEvent.clear(box);
    await userEvent.type(box, 'Never mind');
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));

    await waitFor(() => expect(tasksApi.addComment).toHaveBeenCalledWith('t1', { body: 'Never mind', mentions: [] }));
  });

  it('a name typed by hand that matches a user exactly is still a mention', async () => {
    vi.mocked(tasksApi.getActivity).mockResolvedValue(axiosOk({ data: [] }));
    vi.mocked(tasksApi.addComment).mockResolvedValue(axiosOk({ data: {} as never }));
    render(<TaskActivity taskId="t1" ownerId="me" users={[SAM, PAT]} statuses={STATUSES} />);

    const box = await screen.findByPlaceholderText(/Add a comment/);
    // Pat has no name, so the label is the local part of the email.
    await userEvent.type(box, 'Thanks @pat.o and @Sam Lee');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Comment' }));

    await waitFor(() => expect(tasksApi.addComment).toHaveBeenCalled());
    const sent = vi.mocked(tasksApi.addComment).mock.calls[0]![1];
    expect(sent.body).toBe('Thanks @pat.o and @Sam Lee');
    expect([...sent.mentions!].sort()).toEqual(['pat', 'sam']);
  });
});
