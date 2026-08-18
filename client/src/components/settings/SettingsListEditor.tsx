import { useCallback, useState } from 'react';
import {
  Button,
  StructuredListBody,
  StructuredListCell,
  StructuredListHead,
  StructuredListRow,
  StructuredListWrapper,
  Tag,
  TextInput,
} from '@carbon/react';
import { Add, Draggable, Edit, TrashCan } from '@carbon/icons-react';
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * The one editor behind Task statuses, Company categories, Labels and Deal
 * partners.
 *
 * Those four were 130 lines apiece of the same thing — a list of coloured,
 * renameable rows with add, delete and sometimes drag-reorder — written out four
 * times in a 1,364-line page holding 37 pieces of state. Divergence had already
 * started: two supported reordering and two did not, for no reason anyone
 * intended.
 *
 * Capabilities are opt-in per instance rather than assumed, so partners (a URL,
 * no colour, no order) and labels (a colour, no order) both fit without the
 * component pretending they are the same shape.
 */

export interface SettingsListItem {
  id: string;
  label: string;
  color?: string | null;
  /** Rendered as a Tag — the immutable key behind a status, e.g. `IN_PROGRESS`. */
  badge?: string | null;
  /** A second editable text column, e.g. a partner's registration URL. */
  secondary?: string | null;
}

export interface SettingsListEditorProps {
  items: SettingsListItem[];
  /** Column heading for the name, e.g. "Label" or "Name". */
  labelHeading: string;
  badgeHeading?: string;
  secondaryHeading?: string;
  addPlaceholder: string;
  addLabel?: string;
  emptyMessage: string;
  /** Palette for the colour swatch. Omit to hide the colour column entirely. */
  colors?: ReadonlyArray<{ hex: string; label: string }>;
  /** Omit to disable drag-reorder. Pass the result of dnd-kit's `useSensors`. */
  sensors?: ReturnType<typeof useSensors>;
  onReorder?: (event: DragEndEvent) => void;
  onAdd: (label: string) => void | Promise<void>;
  onRename: (id: string, label: string) => void | Promise<void>;
  onRecolor?: (id: string, color: string) => void | Promise<void>;
  onEditSecondary?: (id: string, value: string) => void | Promise<void>;
  onDelete: (item: SettingsListItem) => void;
  /** Disables Add while a request is in flight. */
  busy?: boolean;
}

interface SortableRowProps {
  id: string;
  dragDescription: string;
  children: React.ReactNode;
}

/**
 * A `StructuredListRow` that reorders by pointer drag or from the keyboard.
 *
 * Carbon attaches its own internal ref to the rendered `<div role="row">`, so a
 * ref passed as a prop is discarded — the handle cell resolves the row with
 * `closest()` and hands *that* to dnd-kit, which keeps Carbon's table markup and
 * column alignment intact.
 */
function SortableRow({ id, dragDescription, children }: SortableRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const rowRef = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node ? node.closest<HTMLElement>('.cds--structured-list-row') : null);
    },
    [setNodeRef]
  );

  return (
    <StructuredListRow
      className={`settings-sortable-row${isDragging ? ' settings-sortable-row--dragging' : ''}`}
      // `x` is zeroed so rows only ever travel along the list's vertical axis.
      style={{ transform: CSS.Translate.toString(transform && { ...transform, x: 0 }), transition }}
    >
      <StructuredListCell className="settings-drag-cell">
        <div className="settings-drag-handle" ref={rowRef}>
          <Button
            kind="ghost"
            size="sm"
            hasIconOnly
            iconDescription={dragDescription}
            renderIcon={Draggable}
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
          />
        </div>
      </StructuredListCell>
      {children}
    </StructuredListRow>
  );
}

export function SettingsListEditor({
  items,
  labelHeading,
  badgeHeading,
  secondaryHeading,
  addPlaceholder,
  addLabel = 'Add',
  emptyMessage,
  colors,
  sensors,
  onReorder,
  onAdd,
  onRename,
  onRecolor,
  onEditSecondary,
  onDelete,
  busy = false,
}: SettingsListEditorProps) {
  const [newLabel, setNewLabel] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [colorOpenFor, setColorOpenFor] = useState<string | null>(null);

  const reorderable = Boolean(sensors && onReorder);
  const showColor = Boolean(colors);

  function beginEdit(item: SettingsListItem) {
    setEditingId(item.id);
    setEditValue(item.label);
  }

  async function commitEdit(id: string) {
    const value = editValue.trim();
    setEditingId(null);
    if (value) await onRename(id, value);
  }

  async function commitAdd() {
    const value = newLabel.trim();
    if (!value) return;
    setNewLabel('');
    await onAdd(value);
  }

  const rowContent = (item: SettingsListItem) => (
    <>
      {showColor && (
        <StructuredListCell>
          <div className="settings-color-swatch-wrapper">
            <button
              type="button"
              className="settings-status-dot"
              style={{ backgroundColor: item.color ?? undefined }}
              aria-label={`Change colour for ${item.label}`}
              aria-expanded={colorOpenFor === item.id}
              onClick={() => setColorOpenFor(colorOpenFor === item.id ? null : item.id)}
            />
            {colorOpenFor === item.id && (
              <div className="settings-color-popover" role="group" aria-label="Colours">
                {colors!.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    className={`settings-color-option${item.color === c.hex ? ' settings-color-option--selected' : ''}`}
                    style={{ backgroundColor: c.hex }}
                    aria-label={c.label}
                    onClick={() => {
                      setColorOpenFor(null);
                      void onRecolor?.(item.id, c.hex);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </StructuredListCell>
      )}

      <StructuredListCell>
        {editingId === item.id ? (
          <TextInput
            id={`edit-${item.id}`}
            labelText=""
            hideLabel
            size="sm"
            value={editValue}
            autoFocus
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => void commitEdit(item.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void commitEdit(item.id);
              if (e.key === 'Escape') setEditingId(null);
            }}
          />
        ) : (
          <span>{item.label}</span>
        )}
      </StructuredListCell>

      {badgeHeading && (
        <StructuredListCell>
          {item.badge ? <Tag size="sm" type="gray">{item.badge}</Tag> : null}
        </StructuredListCell>
      )}

      {secondaryHeading && (
        <StructuredListCell>
          <TextInput
            id={`secondary-${item.id}`}
            labelText=""
            hideLabel
            size="sm"
            placeholder="—"
            defaultValue={item.secondary ?? ''}
            onBlur={(e) => void onEditSecondary?.(item.id, e.target.value)}
          />
        </StructuredListCell>
      )}

      <StructuredListCell className="settings-row-actions">
        <Button
          kind="ghost"
          size="sm"
          hasIconOnly
          iconDescription={`Rename ${item.label}`}
          renderIcon={Edit}
          onClick={() => beginEdit(item)}
        />
        <Button
          kind="ghost"
          size="sm"
          hasIconOnly
          iconDescription={`Delete ${item.label}`}
          renderIcon={TrashCan}
          onClick={() => onDelete(item)}
        />
      </StructuredListCell>
    </>
  );

  const list = (
    <StructuredListWrapper isCondensed className="settings-list">
      <StructuredListHead>
        <StructuredListRow head>
          {reorderable && <StructuredListCell head className="settings-drag-cell">{''}</StructuredListCell>}
          {showColor && <StructuredListCell head>Colour</StructuredListCell>}
          <StructuredListCell head>{labelHeading}</StructuredListCell>
          {badgeHeading && <StructuredListCell head>{badgeHeading}</StructuredListCell>}
          {secondaryHeading && <StructuredListCell head>{secondaryHeading}</StructuredListCell>}
          <StructuredListCell head>{''}</StructuredListCell>
        </StructuredListRow>
      </StructuredListHead>
      <StructuredListBody>
        {items.length === 0 ? (
          <StructuredListRow>
            <StructuredListCell className="settings-list__empty">{emptyMessage}</StructuredListCell>
          </StructuredListRow>
        ) : reorderable ? (
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            {items.map((item) => (
              <SortableRow key={item.id} id={item.id} dragDescription={`Reorder ${item.label}`}>
                {rowContent(item)}
              </SortableRow>
            ))}
          </SortableContext>
        ) : (
          items.map((item) => (
            <StructuredListRow key={item.id}>{rowContent(item)}</StructuredListRow>
          ))
        )}
      </StructuredListBody>
    </StructuredListWrapper>
  );

  return (
    <div className="settings-list-editor">
      {reorderable ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onReorder}>
          {list}
        </DndContext>
      ) : (
        list
      )}

      <div className="settings-list-editor__add">
        <TextInput
          id={`add-${labelHeading.toLowerCase().replace(/\s+/g, '-')}`}
          labelText={addLabel}
          hideLabel
          size="sm"
          placeholder={addPlaceholder}
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitAdd();
          }}
        />
        <Button
          kind="tertiary"
          size="sm"
          renderIcon={Add}
          disabled={busy || !newLabel.trim()}
          onClick={() => void commitAdd()}
        >
          {addLabel}
        </Button>
      </div>
    </div>
  );
}
