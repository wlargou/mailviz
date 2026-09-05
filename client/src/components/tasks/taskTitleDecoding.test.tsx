import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { TaskListView } from './TaskListView';
import { KanbanCard } from './KanbanCard';
import { useTaskStore } from '../../store/taskStore';
import type { Task } from '../../types/task';

/**
 * Task titles reach the screen decoded, on every surface that shows them.
 *
 * A task converted from mail takes the Gmail subject verbatim, and Gmail sends
 * subjects HTML-entity-encoded. React escapes on output, so rendering one raw
 * puts a literal "&amp;" in front of the user — which is exactly what these
 * views were doing.
 *
 * The negative assertion is the one that matters. Querying for the decoded
 * text alone passes trivially whenever the encoded form happens to contain it
 * as a substring, so each case also proves the raw entity is gone.
 */

vi.mock('../../api/taskStatuses', () => ({
  taskStatusesApi: {
    getAll: vi.fn().mockResolvedValue({
      data: { data: [{ id: 's1', name: 'TODO', label: 'To do', color: '#4589ff', position: 0, isTerminal: false, createdAt: '' }] },
    }),
  },
}));
vi.mock('../../api/tasks', () => ({ tasksApi: { update: vi.fn(), delete: vi.fn() } }));

const ENCODED = 'Devis Q3 &amp; facturation &lt;Ben&gt; &#39;26';
const DECODED = "Devis Q3 & facturation <Ben> '26";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: ENCODED,
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
  };
}

const initialTaskState = useTaskStore.getState();
beforeEach(() => {
  vi.clearAllMocks();
  useTaskStore.setState(initialTaskState, true);
});

describe('task titles are decoded before display', () => {
  it('in List View — the surface the bug was reported on', () => {
    render(
      <MemoryRouter>
        <TaskListView
          tasks={[makeTask()]}
          loading={false}
          labels={[]}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onCreateNew={vi.fn()}
        />
      </MemoryRouter>
    );

    expect(screen.getByText(DECODED)).toBeInTheDocument();
    expect(screen.queryByText(ENCODED)).not.toBeInTheDocument();
  });

  it('on a Kanban card', () => {
    render(
      <DndContext>
        <SortableContext items={['task-1']}>
          <KanbanCard task={makeTask()} onClick={vi.fn()} />
        </SortableContext>
      </DndContext>
    );

    expect(screen.getByText(DECODED)).toBeInTheDocument();
    expect(screen.queryByText(ENCODED)).not.toBeInTheDocument();
  });

  it('leaves a title with no entities exactly as it is', () => {
    // Guards the other direction: a decoder that mangles ordinary text would
    // pass both cases above and still be wrong.
    const plain = 'Renew the maintenance contract';
    render(
      <DndContext>
        <SortableContext items={['task-1']}>
          <KanbanCard task={makeTask({ title: plain })} onClick={vi.fn()} />
        </SortableContext>
      </DndContext>
    );

    expect(screen.getByText(plain)).toBeInTheDocument();
  });
});
