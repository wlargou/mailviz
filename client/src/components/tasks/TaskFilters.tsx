import { Dropdown, Button } from '@carbon/react';
import { Reset } from '@carbon/icons-react';
import { useTaskStore } from '../../store/taskStore';
import type { Label } from '../../types/task';

const statusItems = [
  { id: '', text: 'All Statuses' },
  { id: 'TODO', text: 'To Do' },
  { id: 'IN_PROGRESS', text: 'In Progress' },
  { id: 'DONE', text: 'Done' },
];

const priorityItems = [
  { id: '', text: 'All Priorities' },
  { id: 'LOW', text: 'Low' },
  { id: 'MEDIUM', text: 'Medium' },
  { id: 'HIGH', text: 'High' },
  { id: 'URGENT', text: 'Urgent' },
];

interface TaskFiltersProps {
  labels: Label[];
}

export function TaskFilters({ labels }: TaskFiltersProps) {
  const { filters, setFilter, resetFilters } = useTaskStore();

  const labelItems = [
    { id: '', text: 'All Labels' },
    ...labels.map((l) => ({ id: l.id, text: l.name })),
  ];

  return (
    <div className="task-filters">
      <div className="filter-item">
        <Dropdown
          id="filter-status"
          titleText="Status"
          label="All Statuses"
          items={statusItems}
          itemToString={(item) => item?.text || ''}
          selectedItem={statusItems.find((s) => s.id === (filters.status || '')) || statusItems[0]}
          onChange={({ selectedItem }) => setFilter('status', selectedItem?.id || undefined)}
        />
      </div>
      <div className="filter-item">
        <Dropdown
          id="filter-priority"
          titleText="Priority"
          label="All Priorities"
          items={priorityItems}
          itemToString={(item) => item?.text || ''}
          selectedItem={priorityItems.find((p) => p.id === (filters.priority || '')) || priorityItems[0]}
          onChange={({ selectedItem }) => setFilter('priority', selectedItem?.id || undefined)}
        />
      </div>
      <div className="filter-item">
        <Dropdown
          id="filter-label"
          titleText="Label"
          label="All Labels"
          items={labelItems}
          itemToString={(item) => item?.text || ''}
          selectedItem={labelItems.find((l) => l.id === (filters.labelId || '')) || labelItems[0]}
          onChange={({ selectedItem }) => setFilter('labelId', selectedItem?.id || undefined)}
        />
      </div>
      <Button kind="ghost" size="sm" renderIcon={Reset} onClick={resetFilters}>
        Reset
      </Button>
    </div>
  );
}
