import { useState } from 'react';
import { TextInput, Dropdown, Button } from '@carbon/react';
import { Add } from '@carbon/icons-react';
import { tasksApi } from '../../api/tasks';
import { useUIStore } from '../../store/uiStore';
import type { TaskPriority } from '../../types/task';

const priorityItems = [
  { id: 'LOW', text: 'Low' },
  { id: 'MEDIUM', text: 'Medium' },
  { id: 'HIGH', text: 'High' },
  { id: 'URGENT', text: 'Urgent' },
];

interface QuickAddTaskProps {
  onTaskCreated: () => void;
}

export function QuickAddTask({ onTaskCreated }: QuickAddTaskProps) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM');
  const [loading, setLoading] = useState(false);
  const addNotification = useUIStore((s) => s.addNotification);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setLoading(true);
    try {
      await tasksApi.create({ title: title.trim(), priority });
      setTitle('');
      setPriority('MEDIUM');
      addNotification({ kind: 'success', title: 'Task created', subtitle: title.trim() });
      onTaskCreated();
    } catch {
      addNotification({ kind: 'error', title: 'Failed to create task' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <form className="quick-add-form" onSubmit={handleSubmit}>
        <div className="quick-add-title">
          <TextInput
            id="quick-add-title"
            labelText=""
            placeholder="What needs to be done?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="quick-add-priority">
          <Dropdown
            id="quick-add-priority"
            titleText=""
            label="Priority"
            items={priorityItems}
            itemToString={(item) => item?.text || ''}
            selectedItem={priorityItems.find((p) => p.id === priority)}
            onChange={({ selectedItem }) => {
              if (selectedItem) setPriority(selectedItem.id as TaskPriority);
            }}
          />
        </div>
        <Button
          type="submit"
          size="md"
          renderIcon={Add}
          disabled={!title.trim() || loading}
        >
          Add
        </Button>
      </form>
    </div>
  );
}
