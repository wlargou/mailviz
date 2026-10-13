import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TaskCreateModal } from './TaskCreateModal';
import { EMPTY_TASK_FORM, taskToForm } from './TaskFormFields';

/**
 * The new-task panel started from a task — "Duplicate" on a company's page:
 * the title and what the work is come in; when it is due, its reminders and
 * repeats, and how far it got do not.
 */

vi.mock('../../api/taskStatuses', () => ({
  taskStatusesApi: {
    getAll: vi.fn().mockResolvedValue({ data: { data: [{ id: 's1', name: 'TODO', label: 'To do', color: '#4589ff', position: 0, isTerminal: false, createdAt: '' }] } }),
  },
}));
vi.mock('../../api/customers', () => ({
  customersApi: {
    getAll: vi.fn().mockResolvedValue({ data: { data: [{ id: 'c1', name: 'Attijariwafa' }] } }),
    getById: vi.fn().mockResolvedValue({ data: { data: { id: 'c1', name: 'Attijariwafa' } } }),
  },
}));

describe('taskToForm', () => {
  it('carries what the work is, and leaves its dates, reminders and repeats behind', () => {
    const form = taskToForm({
      description: 'Cluster + GPU',
      priority: 'HIGH',
      customerId: 'c1',
      labels: [{ id: 'l1', name: 'Infra', color: '#000', createdAt: '' }],
      estimatedMinutes: 120,
    });
    expect(form).toEqual({
      ...EMPTY_TASK_FORM,
      description: 'Cluster + GPU',
      priority: 'HIGH',
      customerId: 'c1',
      labelIds: ['l1'],
      effortIndex: 6,
    });
  });

  it('reads an empty description as empty', () => {
    expect(taskToForm({ description: null, priority: 'LOW', customerId: null, labels: [], estimatedMinutes: null }).description).toBe('');
  });
});

describe('TaskCreateModal — duplicating', () => {
  it('opens on the task it copies, under its own title', async () => {
    render(
      <TaskCreateModal
        open
        onClose={vi.fn()}
        onCreated={vi.fn()}
        labels={[]}
        initial={{ title: 'Provisionnement MLOps', form: { ...EMPTY_TASK_FORM, description: 'Cluster + GPU', priority: 'HIGH', customerId: 'c1' } }}
      />
    );
    await waitFor(() => expect(screen.getByDisplayValue('Provisionnement MLOps')).toBeInTheDocument());
    expect(screen.getByDisplayValue('Cluster + GPU')).toBeInTheDocument();
    expect(screen.getByText('Duplicate task')).toBeInTheDocument();
  });

  it('is a plain new task otherwise', async () => {
    render(<TaskCreateModal open onClose={vi.fn()} onCreated={vi.fn()} labels={[]} />);
    expect(await screen.findByText('New task')).toBeInTheDocument();
    expect(screen.queryByText('Duplicate task')).toBeNull();
  });
});
