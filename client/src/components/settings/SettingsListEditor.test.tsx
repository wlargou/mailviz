import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { SettingsListEditor, type SettingsListEditorProps, type SettingsListItem } from './SettingsListEditor';

/**
 * The one editor behind FOUR settings sections — task statuses, company
 * categories, labels and deal partners.
 *
 * That is what makes it worth testing hard: the four used to be 130 lines
 * apiece and had already drifted apart, so collapsing them traded four
 * independent bugs for one shared blast radius. A regression here does not
 * break a section, it breaks all four at once, and two of them (statuses,
 * categories) define the Kanban board's columns.
 *
 * The cases below are grouped by what each one prevents:
 *
 *  - **Add**: the guard against creating an unnamed row. `onAdd` must never see
 *    an empty or untrimmed string, and the button must not offer itself while
 *    there is nothing to add.
 *  - **Rename**: renames go through a transient input, so the risk is the
 *    *cancel* path — Escape has to discard, and an emptied field must not
 *    rename a Kanban column to "".
 *  - **Delete**: the parent looks the row up by identity, so the whole item goes
 *    back, not just its id.
 *  - **Colour**: statuses, categories and labels all colour-code by it.
 *  - **Opt-in columns**: partners have no colour and no order; the component
 *    must not render affordances whose handlers were never passed.
 */

const STATUS_COLORS = [
  { hex: '#4589ff', label: 'Blue' },
  { hex: '#42be65', label: 'Green' },
  { hex: '#da1e28', label: 'Red' },
] as const;

const ITEMS: SettingsListItem[] = [
  { id: 's1', label: 'To do', color: '#4589ff', badge: 'TODO' },
  { id: 's2', label: 'In progress', color: '#42be65', badge: 'IN_PROGRESS' },
];

const handlers = {
  onAdd: vi.fn(),
  onRename: vi.fn(),
  onRecolor: vi.fn(),
  onEditSecondary: vi.fn(),
  onDelete: vi.fn(),
  onReorder: vi.fn(),
};

/** The task-statuses configuration, minus drag-reorder. */
function baseProps(overrides: Partial<SettingsListEditorProps> = {}): SettingsListEditorProps {
  return {
    items: ITEMS,
    labelHeading: 'Label',
    badgeHeading: 'Key',
    addPlaceholder: 'e.g. Blocked',
    addLabel: 'Add status',
    emptyMessage: 'No statuses yet — your board has no columns.',
    colors: STATUS_COLORS,
    onAdd: handlers.onAdd,
    onRename: handlers.onRename,
    onRecolor: handlers.onRecolor,
    onDelete: handlers.onDelete,
    ...overrides,
  };
}

function renderEditor(overrides: Partial<SettingsListEditorProps> = {}) {
  return render(<SettingsListEditor {...baseProps(overrides)} />);
}

/** Mirrors SettingsPage's own sensor set — `useSensors` is a hook, so it needs a component. */
function ReorderableEditor({ onReorder }: { onReorder: (event: DragEndEvent) => void }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  return <SettingsListEditor {...baseProps({ sensors, onReorder })} />;
}

/** The rename field has no accessible name (Carbon `labelText=""`), so it goes by id. */
function editFieldFor(id: string): HTMLInputElement {
  const input = document.getElementById(`edit-${id}`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`no rename field open for ${id}`);
  return input;
}

describe('SettingsListEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('lists every item with its label and immutable key', () => {
      renderEditor();

      expect(screen.getByText('To do')).toBeInTheDocument();
      expect(screen.getByText('In progress')).toBeInTheDocument();
      // The badge is the key a Kanban column is stored under — showing the
      // label alone makes two similarly-named statuses indistinguishable.
      expect(screen.getByText('TODO')).toBeInTheDocument();
      expect(screen.getByText('IN_PROGRESS')).toBeInTheDocument();
    });

    it('shows the section-specific empty message when there is nothing to list', () => {
      // Each of the four sections passes its own consequence sentence ("deals
      // cannot be created until you add one"). A hardcoded "No items" would
      // silently drop all four.
      renderEditor({ items: [] });

      expect(screen.getByText('No statuses yet — your board has no columns.')).toBeInTheDocument();
    });
  });

  describe('add', () => {
    it('calls onAdd with the typed label and clears the field', async () => {
      const user = userEvent.setup();
      renderEditor();

      await user.type(screen.getByRole('textbox', { name: 'Add status' }), 'Blocked');
      await user.click(screen.getByRole('button', { name: 'Add status' }));

      expect(handlers.onAdd).toHaveBeenCalledWith('Blocked');
      // Not clearing leaves the text sitting there after the row appears, and
      // the next click adds a duplicate.
      await waitFor(() =>
        expect(screen.getByRole('textbox', { name: 'Add status' })).toHaveValue('')
      );
    });

    it('adds on Enter without reaching for the button', async () => {
      const user = userEvent.setup();
      renderEditor();

      await user.type(screen.getByRole('textbox', { name: 'Add status' }), 'Blocked{Enter}');

      expect(handlers.onAdd).toHaveBeenCalledWith('Blocked');
    });

    it('disables Add while the field is empty or only whitespace', async () => {
      const user = userEvent.setup();
      renderEditor();

      const addButton = screen.getByRole('button', { name: 'Add status' });
      expect(addButton).toBeDisabled();

      // Whitespace is not a name. Enabling here creates a row whose label is
      // blank, which then cannot be told apart from any other blank row.
      await user.type(screen.getByRole('textbox', { name: 'Add status' }), '   ');
      expect(addButton).toBeDisabled();

      await user.type(screen.getByRole('textbox', { name: 'Add status' }), 'Blocked');
      expect(addButton).toBeEnabled();
    });

    it('never sends an untrimmed or empty label', async () => {
      const user = userEvent.setup();
      renderEditor();

      await user.type(screen.getByRole('textbox', { name: 'Add status' }), '  Blocked  {Enter}');

      expect(handlers.onAdd).toHaveBeenCalledWith('Blocked');
    });

    it('refuses to add whitespace on Enter, where no disabled button guards it', async () => {
      // Enter bypasses the button entirely, so `commitAdd` has to repeat the
      // check itself. This is the hole the disabled prop does not cover.
      const user = userEvent.setup();
      renderEditor();

      await user.type(screen.getByRole('textbox', { name: 'Add status' }), '   {Enter}');

      expect(handlers.onAdd).not.toHaveBeenCalled();
    });

    it('disables Add while a request is already in flight', async () => {
      // Two clicks in a row otherwise create two identical statuses.
      //
      // The field has to be filled first. `disabled={busy || !newLabel.trim()}`
      // is already true on an empty field, so asserting against a blank form
      // proves nothing about `busy` — dropping the flag entirely left this
      // green, and with it the double-submit guard it exists for.
      const user = userEvent.setup();
      const { rerender } = render(<SettingsListEditor {...baseProps({ busy: false })} />);

      await user.type(screen.getByRole('textbox', { name: 'Add status' }), 'Blocked');
      expect(screen.getByRole('button', { name: 'Add status' })).toBeEnabled();

      rerender(<SettingsListEditor {...baseProps({ busy: true })} />);
      expect(screen.getByRole('button', { name: 'Add status' })).toBeDisabled();
    });
  });

  describe('rename', () => {
    it('opens a rename field seeded with the current label', async () => {
      const user = userEvent.setup();
      renderEditor();

      await user.click(screen.getByRole('button', { name: 'Rename To do' }));

      expect(editFieldFor('s1')).toHaveValue('To do');
    });

    it('commits the trimmed new label on Enter', async () => {
      const user = userEvent.setup();
      renderEditor();

      await user.click(screen.getByRole('button', { name: 'Rename To do' }));
      await user.clear(editFieldFor('s1'));
      await user.type(editFieldFor('s1'), '  Backlog  {Enter}');

      expect(handlers.onRename).toHaveBeenCalledWith('s1', 'Backlog');
    });

    it('commits on blur, so clicking away is not silent data loss', async () => {
      const user = userEvent.setup();
      renderEditor();

      await user.click(screen.getByRole('button', { name: 'Rename To do' }));
      await user.clear(editFieldFor('s1'));
      await user.type(editFieldFor('s1'), 'Backlog');
      await user.tab();

      await waitFor(() => expect(handlers.onRename).toHaveBeenCalledWith('s1', 'Backlog'));
    });

    it('discards the edit on Escape without saving — REGRESSION', async () => {
      // Escape must close the field *and* prevent the pending blur from
      // committing. If the field merely lost focus, unmounting it would still
      // run `commitEdit` and the rename the user just cancelled would be saved.
      const user = userEvent.setup();
      renderEditor();

      await user.click(screen.getByRole('button', { name: 'Rename To do' }));
      await user.clear(editFieldFor('s1'));
      await user.type(editFieldFor('s1'), 'Backlog{Escape}');

      expect(handlers.onRename).not.toHaveBeenCalled();
      // The field is gone and the original label is back on screen.
      expect(document.getElementById('edit-s1')).toBeNull();
      expect(screen.getByText('To do')).toBeInTheDocument();
    });

    it('does not rename a column to an empty string', async () => {
      // Emptying the field and pressing Enter reads as "cancel", not "wipe the
      // name". A blank Kanban column heading cannot be recovered from the UI.
      const user = userEvent.setup();
      renderEditor();

      await user.click(screen.getByRole('button', { name: 'Rename To do' }));
      await user.clear(editFieldFor('s1'));
      await user.keyboard('{Enter}');

      expect(handlers.onRename).not.toHaveBeenCalled();
      expect(screen.getByText('To do')).toBeInTheDocument();
    });

    it('edits only the row whose rename was clicked', async () => {
      const user = userEvent.setup();
      renderEditor();

      await user.click(screen.getByRole('button', { name: 'Rename In progress' }));

      expect(editFieldFor('s2')).toHaveValue('In progress');
      expect(document.getElementById('edit-s1')).toBeNull();
    });
  });

  describe('delete', () => {
    it('hands the whole item back, not just its id', async () => {
      // SettingsPage looks the real record up from what it receives; passing an
      // id alone, or the wrong row, deletes the wrong status.
      const user = userEvent.setup();
      renderEditor();

      await user.click(screen.getByRole('button', { name: 'Delete In progress' }));

      expect(handlers.onDelete).toHaveBeenCalledWith(ITEMS[1]);
      expect(handlers.onDelete).toHaveBeenCalledTimes(1);
    });
  });

  describe('colour', () => {
    it('applies the picked colour to the right row and closes the picker', async () => {
      const user = userEvent.setup();
      renderEditor();

      await user.click(screen.getByRole('button', { name: 'Change colour for In progress' }));
      const palette = screen.getByRole('group', { name: 'Colours' });
      await user.click(within(palette).getByRole('button', { name: 'Red' }));

      expect(handlers.onRecolor).toHaveBeenCalledWith('s2', '#da1e28');
      expect(screen.queryByRole('group', { name: 'Colours' })).not.toBeInTheDocument();
    });

    it('opens one palette at a time', async () => {
      // Both swatches share `colorOpenFor`. Two palettes open at once means the
      // second click's colour can land on the first row.
      const user = userEvent.setup();
      renderEditor();

      await user.click(screen.getByRole('button', { name: 'Change colour for To do' }));
      await user.click(screen.getByRole('button', { name: 'Change colour for In progress' }));

      expect(screen.getAllByRole('group', { name: 'Colours' })).toHaveLength(1);
    });

    it('reports whether its palette is open through aria-expanded', async () => {
      const user = userEvent.setup();
      renderEditor();

      const swatch = screen.getByRole('button', { name: 'Change colour for To do' });
      expect(swatch).toHaveAttribute('aria-expanded', 'false');

      await user.click(swatch);
      expect(swatch).toHaveAttribute('aria-expanded', 'true');

      await user.click(swatch);
      expect(swatch).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('opt-in columns', () => {
    it('hides the colour column entirely when no palette is supplied', () => {
      // The deal-partners configuration. A swatch with no `onRecolor` behind it
      // is a control that silently does nothing.
      renderEditor({ colors: undefined, onRecolor: undefined });

      expect(screen.queryByRole('button', { name: /Change colour/ })).not.toBeInTheDocument();
      expect(screen.queryByText('Colour')).not.toBeInTheDocument();
    });

    it('hides the key column when no badge heading is supplied', () => {
      // Labels and partners have no immutable key to show.
      renderEditor({ badgeHeading: undefined });

      expect(screen.queryByText('TODO')).not.toBeInTheDocument();
    });

    it('saves the secondary column on blur when one is configured', async () => {
      const user = userEvent.setup();
      const items: SettingsListItem[] = [{ id: 'p1', label: 'Dell', secondary: 'https://dell.example' }];
      renderEditor({
        items,
        badgeHeading: undefined,
        colors: undefined,
        onRecolor: undefined,
        secondaryHeading: 'Registration URL',
        onEditSecondary: handlers.onEditSecondary,
      });

      const url = document.getElementById('secondary-p1');
      expect(url).toBeInstanceOf(HTMLInputElement);
      expect(url).toHaveValue('https://dell.example');

      await user.clear(url as HTMLInputElement);
      await user.type(url as HTMLInputElement, 'https://partner.example');
      await user.tab();

      await waitFor(() =>
        expect(handlers.onEditSecondary).toHaveBeenCalledWith('p1', 'https://partner.example')
      );
    });

    it('offers no drag handle when reordering was not wired up', () => {
      // Labels and partners have no `position`, so a handle would reorder
      // nothing and the change would vanish on reload.
      renderEditor();

      expect(screen.queryByRole('button', { name: /Reorder/ })).not.toBeInTheDocument();
    });
  });

  describe('reorder', () => {
    it('renders a labelled drag handle per row once sensors are supplied', () => {
      // Statuses and categories mount the SortableRow path; a crash or a
      // missing handle there is what takes both sections down at once.
      render(<ReorderableEditor onReorder={handlers.onReorder} />);

      expect(screen.getByRole('button', { name: 'Reorder To do' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reorder In progress' })).toBeInTheDocument();
    });

    it('keeps rename, delete and colour working on sortable rows', async () => {
      // The sortable path re-wraps every cell. Regressions here look like "drag
      // works but nothing else does".
      const user = userEvent.setup();
      render(<ReorderableEditor onReorder={handlers.onReorder} />);

      await user.click(screen.getByRole('button', { name: 'Delete To do' }));
      expect(handlers.onDelete).toHaveBeenCalledWith(ITEMS[0]);

      await user.click(screen.getByRole('button', { name: 'Change colour for To do' }));
      expect(screen.getByRole('group', { name: 'Colours' })).toBeInTheDocument();
    });

    it('hands the drag result to onReorder', async () => {
      // A real keyboard drag, because nothing else in this file fires one:
      // removing `onDragEnd={onReorder}` from the DndContext — severing
      // reordering completely — left every test here green. dnd-kit's
      // KeyboardSensor is the only sensor that works in jsdom; PointerSensor
      // needs a pointer distance no synthetic event supplies.
      const user = userEvent.setup();
      render(<ReorderableEditor onReorder={handlers.onReorder} />);

      screen.getByRole('button', { name: 'Reorder To do' }).focus();
      await user.keyboard('{ }');        // pick the row up
      await user.keyboard('{ArrowDown}'); // move it past the next one
      await user.keyboard('{ }');        // drop it

      expect(handlers.onReorder).toHaveBeenCalledTimes(1);
      const event = handlers.onReorder.mock.calls[0][0] as DragEndEvent;
      expect(event.active.id).toBe('s1');
    });
  });
});
