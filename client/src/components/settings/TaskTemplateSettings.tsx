import { useCallback, useEffect, useState } from 'react';
import { Button, SkeletonText, Tag, TextInput } from '@carbon/react';
import { Checkmark, Close, Edit, TrashCan } from '@carbon/icons-react';
import { formatDistanceToNow } from 'date-fns';
import { taskTemplatesApi, type TaskTemplate } from '../../api/taskTemplates';
import { useUIStore } from '../../store/uiStore';
import { EmptyState } from '../shared/EmptyState';
import { ConfirmDeleteModal } from '../shared/ConfirmDeleteModal';
import { apiErrorMessage } from '../../utils/apiError';

/**
 * The account's task templates: rename, describe, delete.
 *
 * A template is authored from a task ("Save as template" in the panel) and
 * applied from the Tasks page; here is where it is named and retired. The
 * tree itself is not edited here — re-save the task to change the shape.
 */
export function TaskTemplateSettings() {
  const addNotification = useUIStore((s) => s.addNotification);
  const [templates, setTemplates] = useState<TaskTemplate[] | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; description: string } | null>(null);
  const [deleting, setDeleting] = useState<TaskTemplate | null>(null);

  const load = useCallback(async () => {
    try {
      const { data: res } = await taskTemplatesApi.getAll();
      setTemplates(res.data);
    } catch {
      setTemplates([]);
      addNotification({ kind: 'error', title: 'Could not load task templates' });
    }
  }, [addNotification]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!editing || !editing.name.trim()) return;
    try {
      await taskTemplatesApi.update(editing.id, { name: editing.name.trim(), description: editing.description.trim() || null });
      setEditing(null);
      await load();
    } catch (err) {
      addNotification({ kind: 'error', title: 'Could not rename the template', subtitle: apiErrorMessage(err, '') });
    }
  };

  const remove = async () => {
    if (!deleting) return;
    try {
      await taskTemplatesApi.delete(deleting.id);
      addNotification({ kind: 'success', title: `Template “${deleting.name}” deleted` });
      setDeleting(null);
      await load();
    } catch {
      addNotification({ kind: 'error', title: 'Could not delete the template' });
    }
  };

  if (templates === null) return <SkeletonText paragraph lineCount={3} />;
  if (templates.length === 0) {
    return (
      <EmptyState
        size="sm"
        title="No task templates yet"
        description="Open a task on the Tasks page and choose “Save as template” to keep its subtasks, checklist and timing."
      />
    );
  }

  return (
    <>
      <ul className="template-list">
        {templates.map((t) => (
          <li key={t.id} className="template-list__row">
            {editing?.id === t.id ? (
              <div className="template-list__edit">
                <TextInput
                  id={`template-name-${t.id}`}
                  labelText="Name"
                  hideLabel
                  size="sm"
                  value={editing.name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditing({ ...editing, name: e.target.value })}
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === 'Enter') void save();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
                <TextInput
                  id={`template-description-${t.id}`}
                  labelText="Description"
                  hideLabel
                  size="sm"
                  placeholder="Description (optional)"
                  value={editing.description}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditing({ ...editing, description: e.target.value })}
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === 'Enter') void save();
                    if (e.key === 'Escape') setEditing(null);
                  }}
                />
                <Button kind="primary" size="sm" hasIconOnly renderIcon={Checkmark} iconDescription="Save" onClick={() => void save()} disabled={!editing.name.trim()} />
                <Button kind="ghost" size="sm" hasIconOnly renderIcon={Close} iconDescription="Cancel" onClick={() => setEditing(null)} />
              </div>
            ) : (
              <>
                <div className="template-list__main">
                  <span className="template-list__name">{t.name}</span>
                  {t.description && <span className="template-list__description">{t.description}</span>}
                  <span className="template-list__meta">
                    <Tag size="sm" type="cool-gray">{t.taskCount} {t.taskCount === 1 ? 'task' : 'tasks'}</Tag>
                    {t.usageCount > 0 && (
                      <span>
                        Used {t.usageCount} {t.usageCount === 1 ? 'time' : 'times'}
                        {t.lastUsedAt ? `, last ${formatDistanceToNow(new Date(t.lastUsedAt), { addSuffix: true })}` : ''}
                      </span>
                    )}
                  </span>
                </div>
                <div className="template-list__actions">
                  <Button kind="ghost" size="sm" hasIconOnly renderIcon={Edit} iconDescription={`Rename ${t.name}`} onClick={() => setEditing({ id: t.id, name: t.name, description: t.description ?? '' })} />
                  <Button kind="danger--ghost" size="sm" hasIconOnly renderIcon={TrashCan} iconDescription={`Delete ${t.name}`} onClick={() => setDeleting(t)} />
                </div>
              </>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDeleteModal
        open={!!deleting}
        title={deleting?.name ?? ''}
        entityLabel="task template"
        consequence="Tasks already created from it are not affected."
        onClose={() => setDeleting(null)}
        onConfirm={() => void remove()}
      />
    </>
  );
}
