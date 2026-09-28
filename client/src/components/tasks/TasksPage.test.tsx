import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { TasksPage } from './TasksPage';

/**
 * The page header is where a task is created, in every view.
 *
 * "New task" used to live in the List and By Company toolbars, so the Kanban
 * board — which has no toolbar — could not create one, and "From template"
 * sat alone in the header. The views are stubbed: what is pinned is that the
 * header's actions reach the two creation dialogs whichever tab is open.
 */

vi.mock('./TaskListView', () => ({ TaskListView: () => <div>list view</div> }));
vi.mock('./TaskKanbanView', () => ({ TaskKanbanView: () => <div>kanban view</div> }));
vi.mock('./TaskByCompanyView', () => ({ TaskByCompanyView: () => <div>company view</div> }));
vi.mock('./TaskCreateModal', () => ({
  TaskCreateModal: ({ open }: { open: boolean }) => (open ? <div>create dialog</div> : null),
}));
vi.mock('./ApplyTemplateModal', () => ({
  ApplyTemplateModal: ({ open }: { open: boolean }) => (open ? <div>template dialog</div> : null),
}));
vi.mock('./TaskDetailModal', () => ({ TaskDetailModal: () => null }));
vi.mock('../../store/taskStore', () => {
  const state = {
    tasks: [], loading: false, fetchTasks: vi.fn(), setFilter: vi.fn(),
    filters: {}, currentPage: 1, pageSize: 20, tasksVersion: 0, taskChanged: vi.fn(),
  };
  const useTaskStore = (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state);
  return { useTaskStore };
});
vi.mock('../../api/labels', () => ({ labelsApi: { getAll: vi.fn().mockResolvedValue({ data: { data: [] } }) } }));

function renderPage() {
  render(
    <MemoryRouter>
      <TasksPage />
    </MemoryRouter>,
  );
}

describe('TasksPage header', () => {
  it('creates a task from the Kanban board', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('tab', { name: 'Kanban Board' }));
    expect(await screen.findByText('kanban view')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'New task' }));

    expect(screen.getByText('create dialog')).toBeInTheDocument();
    expect(screen.queryByText('template dialog')).not.toBeInTheDocument();
  });

  it('offers From template from the same button', async () => {
    const user = userEvent.setup();
    renderPage();

    // The combo's second half: Carbon names it "Additional actions".
    await user.click(screen.getByRole('button', { name: /additional actions/i }));
    // jsdom leaves Carbon's open menu `visibility: hidden` and unnamed, so
    // the item is found by its text (see CLAUDE.md, OverflowMenu in jsdom).
    const items = await screen.findAllByRole('menuitem', { hidden: true });
    const fromTemplate = items.find((i) => i.textContent?.includes('From template'));
    expect(fromTemplate).toBeDefined();
    await user.click(fromTemplate!);

    expect(screen.getByText('template dialog')).toBeInTheDocument();
    expect(screen.queryByText('create dialog')).not.toBeInTheDocument();
  });
});
