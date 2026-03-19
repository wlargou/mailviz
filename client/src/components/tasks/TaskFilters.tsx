import { useEffect, useState } from 'react';
import { Dropdown, Button } from '@carbon/react';
import { Reset } from '@carbon/icons-react';
import { useTaskStore } from '../../store/taskStore';
import { taskStatusesApi } from '../../api/taskStatuses';
import type { Label, TaskStatusConfig } from '../../types/task';

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
  const [statuses, setStatuses] = useState<{ id: string; text: string }[]>([{ id: '', text: 'All Statuses' }]);

  useEffect(() => {
    taskStatusesApi.getAll().then(({ data: res }) => {
      setStatuses([
        { id: '', text: 'All Statuses' },
        ...res.data.map((s: TaskStatusConfig) => ({ id: s.name, text: s.label })),
      ]);
    }).catch(() => {});
  }, []);

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
          items={statuses}
          itemToString={(item) => item?.text || ''}
          selectedItem={statuses.find((s) => s.id === (filters.status || '')) || statuses[0]}
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
