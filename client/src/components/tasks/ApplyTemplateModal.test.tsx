import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosHeaders, type AxiosResponse } from 'axios';
import { taskTemplatesApi, type TaskTemplate } from '../../api/taskTemplates';
import { ApplyTemplateModal } from './ApplyTemplateModal';
import { SaveAsTemplateModal } from './SaveAsTemplateModal';
import { useTaskStore } from '../../store/taskStore';

/**
 * Applying and saving task templates.
 *
 * What the modals own is the payload: the chosen template, the anchor day
 * and the company go to instantiate; the task id and the name go to
 * from-task. And applying is a task change, so every view refetches.
 */

vi.mock('../../api/taskTemplates', () => ({
  taskTemplatesApi: { getAll: vi.fn(), instantiate: vi.fn(), fromTask: vi.fn() },
}));
vi.mock('../../api/customers', () => ({
  customersApi: {
    getAll: vi.fn().mockResolvedValue({ data: { data: [] } }),
    getById: vi.fn().mockResolvedValue({ data: { data: { id: 'acme', name: 'Acme' } } }),
  },
}));

function axiosOk<T>(data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: new AxiosHeaders(), config: { headers: new AxiosHeaders() } };
}

const TEMPLATES: TaskTemplate[] = [
  { id: 'tpl-1', name: 'Onboarding', description: 'Kickoff to first review', items: [{ title: 'Kickoff' }], taskCount: 3, usageCount: 2, lastUsedAt: null, createdAt: '', updatedAt: '' },
  { id: 'tpl-2', name: 'Renewal', description: null, items: [{ title: 'Call' }], taskCount: 1, usageCount: 0, lastUsedAt: null, createdAt: '', updatedAt: '' },
];

describe('ApplyTemplateModal', () => {
  beforeEach(() => {
    vi.mocked(taskTemplatesApi.getAll).mockReset();
    vi.mocked(taskTemplatesApi.instantiate).mockReset();
    useTaskStore.setState({ tasksVersion: 0 });
  });

  it('applies the chosen template against today and the company, and refreshes every view', async () => {
    vi.mocked(taskTemplatesApi.getAll).mockResolvedValue(axiosOk({ data: TEMPLATES }));
    vi.mocked(taskTemplatesApi.instantiate).mockResolvedValue(axiosOk({ data: { tasks: [], created: 3 } }));
    const onClose = vi.fn();
    render(<ApplyTemplateModal open onClose={onClose} customerId="acme" />);

    const picker = await screen.findByRole('combobox', { name: /Template/ });
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    await userEvent.click(picker);
    await userEvent.click(await screen.findByRole('option', { name: 'Onboarding (3)' }));
    expect(screen.getByText('Kickoff to first review')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Create 3 tasks' }));

    await waitFor(() => expect(taskTemplatesApi.instantiate).toHaveBeenCalled());
    const [id, payload] = vi.mocked(taskTemplatesApi.instantiate).mock.calls[0]!;
    expect(id).toBe('tpl-1');
    expect(payload.customerId).toBe('acme');
    // Today, to the day.
    expect(new Date(payload.anchorDate!).toDateString()).toBe(new Date().toDateString());
    expect(useTaskStore.getState().tasksVersion).toBe(1);
    expect(onClose).toHaveBeenCalled();
  });

  it('says where templates come from when there are none', async () => {
    vi.mocked(taskTemplatesApi.getAll).mockResolvedValue(axiosOk({ data: [] }));
    render(<ApplyTemplateModal open onClose={vi.fn()} />);

    expect(await screen.findByText('No templates yet')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Template/ })).toBeDisabled();
  });
});

describe('SaveAsTemplateModal', () => {
  it('sends the task id with the name and note, and suggests the title', async () => {
    vi.mocked(taskTemplatesApi.fromTask).mockResolvedValue(axiosOk({ data: TEMPLATES[0] }));
    const onClose = vi.fn();
    render(<SaveAsTemplateModal open taskId="t1" suggestedName="Renew the contract" onClose={onClose} />);

    const name = screen.getByLabelText('Template name') as HTMLInputElement;
    expect(name.value).toBe('Renew the contract');
    await userEvent.clear(name);
    await userEvent.type(name, 'Renewal playbook');
    await userEvent.type(screen.getByLabelText('Description (optional)'), 'For every renewal');
    await userEvent.click(screen.getByRole('button', { name: 'Save template' }));

    await waitFor(() =>
      expect(taskTemplatesApi.fromTask).toHaveBeenCalledWith({ taskId: 't1', name: 'Renewal playbook', description: 'For every renewal' })
    );
    expect(onClose).toHaveBeenCalled();
  });
});
