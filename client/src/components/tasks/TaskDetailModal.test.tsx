import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { tasksApi } from '../../api/tasks';
import { TaskDetailModal } from './TaskDetailModal';
import { useTaskStore } from '../../store/taskStore';
import type { Task, Label } from '../../types/task';

/**
 * The edit panel.
 *
 * It used to be handed a whole `Task` captured when the row was clicked. That
 * one decision caused three separate defects, and these pin all three:
 *
 *  - the object went stale, and this form PATCHes every field, so saving wrote
 *    old values back over newer ones;
 *  - two of the three views fetch from an endpoint that omits `mailToTask`, so
 *    what the panel could render depended on which tab you opened it from;
 *  - the label field mounted one render BEFORE the values were seeded, and
 *    Carbon's `MultiSelect` here is uncontrolled, so it showed the *previous*
 *    task's labels — which the next save would write.
 */

vi.mock('../../api/tasks', () => ({
  tasksApi: {
    getById: vi.fn(),
    update: vi.fn(),
    assignTask: vi.fn(),
    getTaskShares: vi.fn(),
    getActivity: vi.fn().mockResolvedValue({ data: { data: [] } }),
  },
}));
vi.mock('../../api/taskStatuses', () => ({
  taskStatusesApi: {
    getAll: vi.fn().mockResolvedValue({
      data: { data: [{ id: 's1', name: 'TODO', label: 'To do', color: '#4589ff', position: 0, isTerminal: false, createdAt: '' }] },
    }),
  },
}));
vi.mock('../../api/auth', () => ({ authApi: { getUsers: vi.fn().mockResolvedValue({ data: { data: [] } }) } }));

function axiosOk<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() } };
}

const LABELS: Label[] = [
  { id: 'l1', name: 'Billing', color: '#d02670' },
  { id: 'l2', name: 'Presales', color: '#0f62fe' },
  { id: 'l3', name: 'Support', color: '#007d79' },
] as Label[];

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Renew the contract',
    description: null,
    status: 'TODO',
    priority: 'MEDIUM',
    dueDate: null,
    position: 0,
    customerId: null,
    assignedToId: null,
    assignedTo: null,
    estimatedMinutes: null,
    userId: 'user-1',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
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
    ...overrides,
  } as Task;
}

/**
 * How many labels the field is showing.
 *
 * Read off Carbon's selection badge rather than by text, because the panel also
 * renders a date picker and `getByText('2')` matches the 2nd of the month.
 */
function shownLabelCount(): number {
  // Carbon renders the count as a filter Tag inside the field.
  const badge = document.querySelector('.cds--multi-select .cds--tag__label');
  const n = Number(badge?.textContent?.trim());
  return Number.isFinite(n) ? n : 0;
}

function renderPanel(taskId: string | null) {
  return render(
    <TaskDetailModal
      taskId={taskId}
      open={!!taskId}
      onClose={vi.fn()}
      onUpdated={vi.fn()}
      labels={LABELS}
    />
  );
}

const initial = useTaskStore.getState();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(tasksApi.getById).mockReset();
  useTaskStore.setState(initial, true);
});

describe('TaskDetailModal', () => {
  it('fetches the task it was asked for instead of being handed one', async () => {
    vi.mocked(tasksApi.getById).mockResolvedValue(axiosOk({ data: makeTask({ title: 'Fresh from the server' }) }));

    renderPanel('task-1');

    expect(await screen.findByDisplayValue('Fresh from the server')).toBeInTheDocument();
    expect(tasksApi.getById).toHaveBeenCalledWith('task-1');
  });

  it('shows the labels the task actually has', async () => {
    // The first half of the uncontrolled-MultiSelect bug: because the field
    // mounted before the seed ran, the FIRST task opened showed an empty Labels
    // control however many labels it had.
    vi.mocked(tasksApi.getById).mockResolvedValue(
      axiosOk({ data: makeTask({ labels: [LABELS[0], LABELS[1]] }) })
    );

    renderPanel('task-1');

    await screen.findByDisplayValue('Renew the contract');
    expect(shownLabelCount()).toBe(2);
  });

  it('does not show the previous task’s labels when a different task is opened', async () => {
    // The second half, and the one that lost data: opening a labelled task and
    // then an unlabelled one left the earlier task's chips in the field. Touch
    // the control and save, and those labels were written onto a task that
    // never had them.
    const user = userEvent.setup();
    const onUpdated = vi.fn();
    vi.mocked(tasksApi.getById).mockResolvedValue(
      axiosOk({ data: makeTask({ id: 'labelled', labels: [LABELS[0], LABELS[1]] }) })
    );
    const { rerender } = render(
      <TaskDetailModal taskId="labelled" open onClose={vi.fn()} onUpdated={onUpdated} labels={LABELS} />
    );
    await waitFor(() => expect(shownLabelCount()).toBe(2));

    vi.mocked(tasksApi.getById).mockResolvedValue(
      axiosOk({ data: makeTask({ id: 'bare', title: 'No labels here', labels: [] }) })
    );
    rerender(
      <TaskDetailModal taskId="bare" open onClose={vi.fn()} onUpdated={onUpdated} labels={LABELS} />
    );

    await screen.findByDisplayValue('No labels here');
    expect(shownLabelCount()).toBe(0);

    // Saving an untouched form must send nothing at all. That is the sharper
    // form of the same assertion: if the field had inherited the previous
    // task's two labels, they would differ from this task's empty set, and the
    // save would write them onto a task that never had any.
    await user.click(screen.getByRole('button', { name: /Save/i }));
    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
    expect(tasksApi.update).not.toHaveBeenCalled();
  });

  it('keeps the label field on screen when there are no labels', async () => {
    // It used to be gated on `labels.length > 0`, and a failed labelsApi fetch
    // is swallowed into an empty array upstream — so a network blip removed the
    // control entirely and looked identical to an account with no labels. An
    // absent field is not a way to report an error.
    vi.mocked(tasksApi.getById).mockResolvedValue(axiosOk({ data: makeTask() }));

    render(
      <TaskDetailModal taskId="task-1" open onClose={vi.fn()} onUpdated={vi.fn()} labels={[]} />
    );

    await screen.findByDisplayValue('Renew the contract');
    expect(screen.getByText('Labels')).toBeInTheDocument();
    expect(screen.getByText('No labels available. Add some in Settings.')).toBeInTheDocument();
  });

  it('closes and announces when the task has been deleted underneath it', async () => {
    const onClose = vi.fn();
    vi.mocked(tasksApi.getById).mockRejectedValue({ response: { status: 404 } });

    render(
      <TaskDetailModal taskId="gone" open onClose={onClose} onUpdated={vi.fn()} labels={LABELS} />
    );

    // And the lists are told, so the row the user clicked stops being offered.
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(useTaskStore.getState().tasksVersion).toBe(1);
  });

  it('offers a retry rather than an empty form when the load fails', async () => {
    vi.mocked(tasksApi.getById).mockRejectedValue({ response: { status: 500 } });

    renderPanel('task-1');

    expect(await screen.findByText('Could not load this task')).toBeInTheDocument();
    // Never a form seeded with nothing — that is how a blank Save wipes a task.
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
  });

  describe('sends only what changed', () => {
    /**
     * Writing the whole form back on every save meant a user who edited one
     * field rewrote seven others from whatever the form held — reverting
     * anything changed elsewhere in between, and destroying values the form
     * could not represent.
     *
     * Every assertion here is an exact `toEqual` on the payload. An
     * `objectContaining` would pass against the old all-fields payload too,
     * which makes it no evidence at all.
     */
    const FULL = () =>
      makeTask({
        title: 'Original',
        description: 'Original body',
        status: 'TODO',
        priority: 'HIGH',
        dueDate: '2026-09-30T00:00:00.000Z',
        labels: [LABELS[0], LABELS[1]],
        customerId: 'cust-1',
        estimatedMinutes: 60,
      });

    async function editTitleAndSave(user: ReturnType<typeof userEvent.setup>, to = 'New') {
      const field = await screen.findByDisplayValue('Original');
      await user.clear(field);
      await user.type(field, to);
      await user.click(screen.getByRole('button', { name: /Save/i }));
      await waitFor(() => expect(tasksApi.update).toHaveBeenCalled());
      return vi.mocked(tasksApi.update).mock.calls[0][1];
    }

    it('sends the one field the user edited, and nothing else', async () => {
      const user = userEvent.setup();
      vi.mocked(tasksApi.getById).mockResolvedValue(axiosOk({ data: FULL() }));
      renderPanel('task-1');

      expect(await editTitleAndSave(user)).toEqual({ title: 'New' });
    });

    it('does not treat a decoded title as an edit', async () => {
      // The form holds `Renew A & B`; the row holds `Renew A &amp; B`. Diffing
      // the form against the ROW reports every entity-bearing title as changed
      // — re-sending exactly the rows this is meant to leave alone.
      const user = userEvent.setup();
      vi.mocked(tasksApi.getById).mockResolvedValue(
        axiosOk({ data: makeTask({ title: 'Renew A &amp; B' }) })
      );
      renderPanel('task-1');

      await screen.findByDisplayValue('Renew A & B');
      await user.click(screen.getByRole('button', { name: /Save/i }));

      await waitFor(() => expect(tasksApi.update).not.toHaveBeenCalled());
    });

    it('leaves an estimate the slider cannot represent alone', async () => {
      // 45 minutes is not on the ladder, so the slider snaps to None. Saving
      // used to write that None back and delete the estimate, without the user
      // touching the control.
      const user = userEvent.setup();
      vi.mocked(tasksApi.getById).mockResolvedValue(
        axiosOk({ data: makeTask({ title: 'Original', estimatedMinutes: 45 }) })
      );
      renderPanel('task-1');

      expect(await editTitleAndSave(user)).toEqual({ title: 'New' });
    });

    it('clears a description the user emptied', async () => {
      // `description.trim() || undefined` sent no key at all, and clearing a
      // description was a silent no-op. The column is nullable but the
      // validator is not, so '' is how it clears.
      const user = userEvent.setup();
      vi.mocked(tasksApi.getById).mockResolvedValue(
        axiosOk({ data: makeTask({ description: 'Some body text' }) })
      );
      renderPanel('task-1');

      const box = await screen.findByDisplayValue('Some body text');
      await user.clear(box);
      await user.click(screen.getByRole('button', { name: /Save/i }));

      await waitFor(() => expect(tasksApi.update).toHaveBeenCalled());
      expect(vi.mocked(tasksApi.update).mock.calls[0][1]).toEqual({ description: '' });
    });

    it('ignores a label set that was toggled off and back on', async () => {
      // Selection order drifts, and sending labelIds reaches a
      // delete-then-recreate rewrite — so an order-sensitive compare would
      // clobber a label change made elsewhere for no reason.
      const user = userEvent.setup();
      vi.mocked(tasksApi.getById).mockResolvedValue(
        axiosOk({ data: makeTask({ title: 'Original', labels: [LABELS[0], LABELS[1]] }) })
      );
      renderPanel('task-1');
      await screen.findByDisplayValue('Original');

      await user.click(screen.getByRole('combobox', { name: /Labels/i }));
      await user.click(await screen.findByRole('option', { name: 'Billing' }));
      await user.click(await screen.findByRole('option', { name: 'Billing' }));
      await user.keyboard('{Escape}');

      expect(await editTitleAndSave(user)).toEqual({ title: 'New' });
    });

    it('sends an empty list when the last label is removed', async () => {
      const user = userEvent.setup();
      vi.mocked(tasksApi.getById).mockResolvedValue(
        axiosOk({ data: makeTask({ labels: [LABELS[0]] }) })
      );
      renderPanel('task-1');
      await screen.findByDisplayValue('Renew the contract');

      await user.click(screen.getByRole('combobox', { name: /Labels/i }));
      await user.click(await screen.findByRole('option', { name: 'Billing' }));
      await user.keyboard('{Escape}');
      await user.click(screen.getByRole('button', { name: /Save/i }));

      await waitFor(() => expect(tasksApi.update).toHaveBeenCalled());
      expect(vi.mocked(tasksApi.update).mock.calls[0][1]).toEqual({ labelIds: [] });
    });

    it('sends nothing at all when the user changed nothing', async () => {
      const user = userEvent.setup();
      const onUpdated = vi.fn();
      vi.mocked(tasksApi.getById).mockResolvedValue(axiosOk({ data: FULL() }));
      render(
        <TaskDetailModal taskId="task-1" open onClose={vi.fn()} onUpdated={onUpdated} labels={LABELS} />
      );

      await screen.findByDisplayValue('Original');
      await user.click(screen.getByRole('button', { name: /Save/i }));

      // Still closes and still reports success — an empty PATCH would be
      // audited as a change to every field.
      await waitFor(() => expect(onUpdated).toHaveBeenCalled());
      expect(tasksApi.update).not.toHaveBeenCalled();
    });
  });
});

