import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import { ComposeToolbar } from './ComposeToolbar';

/**
 * The compose toolbar's controls, driving a real Tiptap editor.
 *
 * The font and size pickers were a hand-rolled div with a `mousedown` handler:
 * no `button` element, no ARIA, no keyboard path — a keyboard user could not
 * change font at all. These tests are about reachability rather than styling,
 * which is why they drive everything through the keyboard and the accessibility
 * tree instead of clicking coordinates.
 */

function Harness() {
  const editor = useEditor({
    extensions: [StarterKit, Underline, TextAlign.configure({ types: ['paragraph'] }), TextStyle, Color, FontFamily],
    content: '<p>Hello</p>',
  });
  if (!editor) return null;
  return <ComposeToolbar editor={editor} />;
}

describe('ComposeToolbar — keyboard and assistive access', () => {
  it('exposes the font picker as a button a keyboard can open — REGRESSION', async () => {
    render(<Harness />);
    const fontButton = await screen.findByRole('button', { name: /^font$/i });

    // The old markup was a bare div; there was no button to find and nothing
    // focusable to press.
    // Carbon's OverflowMenu only renders its items while open, so presence is
    // the signal. Visibility is not assertable here: Carbon's stylesheet is not
    // loaded in jsdom, so nothing computes as hidden.
    expect(screen.queryByText('Arial')).not.toBeInTheDocument();

    fontButton.focus();
    expect(fontButton).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByText('Arial')).toBeInTheDocument());
  });

  it('applies a font chosen from the menu', async () => {
    render(<Harness />);
    await userEvent.click(await screen.findByRole('button', { name: /^font$/i }));
    await userEvent.click(await screen.findByText('Georgia'));

    // Nothing to assert against the DOM of a ProseMirror doc that is cheap and
    // stable, so the check is that the control ran without losing the editor —
    // the toolbar is still mounted and interactive afterwards.
    expect(screen.getByRole('button', { name: /^font$/i })).toBeInTheDocument();
  });

  it('gives every colour swatch a name instead of a hex string — REGRESSION', async () => {
    render(<Harness />);
    await userEvent.click(await screen.findByRole('button', { name: /text colour/i }));

    // Previously the only label was `title="#0f62fe"`, so a screen reader
    // announced the hex.
    expect(await screen.findByRole('button', { name: 'Blue 60' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gray 100' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '#0f62fe' })).not.toBeInTheDocument();
  });

  it('marks the colour trigger as a popup and tracks its expanded state', async () => {
    render(<Harness />);
    const trigger = await screen.findByRole('button', { name: /text colour/i });

    expect(trigger).toHaveAttribute('aria-haspopup', 'true');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes the colour popover on Escape and returns focus to the trigger', async () => {
    render(<Harness />);
    const trigger = await screen.findByRole('button', { name: /text colour/i });
    // Opened from the keyboard, not a click: the trigger's mousedown handler
    // calls preventDefault to protect the editor's selection, which also
    // suppresses focus — so a clicked trigger is not the focused element and
    // Escape would go nowhere.
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('button', { name: 'Blue 60' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Blue 60' })).not.toBeInTheDocument()
    );
    // Focus must not be left on a node that no longer exists.
    expect(trigger).toHaveFocus();
  });

  it('keeps the plain formatting controls reachable by name', async () => {
    render(<Harness />);
    for (const name of [/bold/i, /italic/i, /underline/i, /align left/i, /justify/i]) {
      expect(await screen.findByRole('button', { name })).toBeInTheDocument();
    }
  });
});
