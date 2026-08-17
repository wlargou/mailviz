import { useState, useRef, useEffect, useCallback } from 'react';
import { Button, OverflowMenu, OverflowMenuItem } from '@carbon/react';
import {
  TextBold,
  TextItalic,
  TextUnderline,
  TextStrikethrough,
  ListBulleted,
  ListNumbered,
  Quotes,
  Link as LinkIcon,
  Subtract,
  TextAlignLeft,
  TextAlignCenter,
  TextAlignRight,
  TextAlignJustify,
  TextIndentMore,
  TextIndentLess,
  TextClearFormat,
  TextFont,
  TextScale,
  TextColor,
  Attachment,
} from '@carbon/icons-react';
import type { Editor } from '@tiptap/react';
import {
  blue30, blue40, blue50, blue60,
  gray10, gray50, gray70, gray100,
  green20, green40, green50,
  orange40, purple30, purple40, purple60,
  red40, red50, red60,
  teal60, white, yellow30,
} from '@carbon/colors';

interface ComposeToolbarProps {
  editor: Editor | null;
  onAttach?: () => void;
}

const FONT_FAMILIES = [
  { label: 'Sans Serif', value: 'IBM Plex Sans, Helvetica Neue, Arial, sans-serif' },
  { label: 'Serif', value: 'Georgia, Times New Roman, serif' },
  { label: 'Monospace', value: 'IBM Plex Mono, Courier New, monospace' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: 'Trebuchet MS, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Courier New', value: 'Courier New, monospace' },
];

const FONT_SIZES = [
  { label: 'Small', value: '0.75rem' },
  { label: 'Normal', value: '' },
  { label: 'Large', value: '1.125rem' },
  { label: 'Huge', value: '1.5rem' },
];

/**
 * The text-colour swatches.
 *
 * Literal values rather than `var(--cds-*)` on purpose: these are written into
 * the message body and have to survive in the recipient's mail client, which has
 * none of this app's CSS. Taking them from `@carbon/colors` keeps them traceable
 * to the palette instead of being 21 anonymous hex strings — every one was
 * already a real Carbon colour, so nothing here changes what is rendered.
 */
const TEXT_COLORS: Array<{ value: string; name: string }> = [
  { value: gray100, name: 'Gray 100' }, { value: gray70, name: 'Gray 70' },
  { value: gray50, name: 'Gray 50' }, { value: gray10, name: 'Gray 10' },
  { value: white, name: 'White' },
  { value: red60, name: 'Red 60' }, { value: orange40, name: 'Orange 40' },
  { value: yellow30, name: 'Yellow 30' }, { value: green50, name: 'Green 50' },
  { value: teal60, name: 'Teal 60' },
  { value: blue60, name: 'Blue 60' }, { value: blue50, name: 'Blue 50' },
  { value: purple60, name: 'Purple 60' }, { value: red50, name: 'Red 50' },
  { value: red40, name: 'Red 40' },
  { value: blue40, name: 'Blue 40' }, { value: blue30, name: 'Blue 30' },
  { value: purple40, name: 'Purple 40' }, { value: purple30, name: 'Purple 30' },
  { value: green40, name: 'Green 40' }, { value: green20, name: 'Green 20' },
];

/**
 * The colour-swatch popover.
 *
 * The font and size pickers moved to Carbon's `OverflowMenu`; a 21-swatch grid is
 * not a menu, so this one stays bespoke. What it gained is the accessibility the
 * hand-rolled version never had: a real button trigger carrying
 * `aria-haspopup`/`aria-expanded`, Escape to dismiss, and focus returned to the
 * trigger afterwards rather than left nowhere.
 */
function ColorDropdown({
  children,
  icon,
  label,
}: {
  children: React.ReactNode;
  icon: React.ComponentType<{ size?: number }>;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  return (
    <div
      className="compose-toolbar__dropdown"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          close(true);
        }
      }}
    >
      <Button
        ref={triggerRef}
        kind="ghost"
        size="sm"
        hasIconOnly
        iconDescription={label}
        renderIcon={icon}
        aria-haspopup="true"
        aria-expanded={open}
        // Two paths, deliberately. `mousedown` with preventDefault is what keeps
        // the editor's selection alive for a mouse user — but preventing the
        // default also prevents focus, and a button that never receives focus
        // never sees Enter. So the keyboard is handled separately. `click` is not
        // used for either: mouse clicks fire mousedown *and* click, which would
        // toggle twice and leave the popover shut.
        onMouseDown={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      />
      {open && (
        <div
          className="compose-toolbar__dropdown-menu"
          onMouseDown={(e) => e.preventDefault()}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function ComposeToolbar({ editor, onAttach }: ComposeToolbarProps) {
  if (!editor) return null;

  const handleLink = () => {
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL', previousUrl);
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
  };

  const handleFontFamily = (value: string) => {
    if (value) {
      editor.chain().focus().setFontFamily(value).run();
    } else {
      editor.chain().focus().unsetFontFamily().run();
    }
  };

  const handleFontSize = (value: string) => {
    if (value) {
      editor.chain().focus().setMark('textStyle', { fontSize: value }).run();
    } else {
      editor.chain().focus().unsetMark('textStyle').run();
    }
  };

  const handleColor = (color: string) => {
    editor.chain().focus().setColor(color).run();
  };

  const handleClearFormat = () => {
    editor.chain().focus().clearNodes().unsetAllMarks().run();
  };

  const handleIndent = (direction: 'indent' | 'outdent') => {
    if (editor.isActive('bulletList') || editor.isActive('orderedList')) {
      if (direction === 'indent') {
        editor.chain().focus().sinkListItem('listItem').run();
      } else {
        editor.chain().focus().liftListItem('listItem').run();
      }
    }
  };

  return (
    <div className="compose-toolbar">
      {/* Font family. Carbon's OverflowMenu rather than a hand-rolled div: the
          previous version had no keyboard navigation and no ARIA at all, so the
          font and size pickers were mouse-only. The handlers all end in
          `editor.chain().focus()`, which is why moving from onMouseDown to
          onClick does not cost the editor its selection. */}
      <OverflowMenu
        size="sm"
        renderIcon={TextFont}
        iconDescription="Font"
        aria-label="Font"
        flipped
      >
        {FONT_FAMILIES.map((f) => (
          <OverflowMenuItem
            key={f.value}
            itemText={<span style={{ fontFamily: f.value }}>{f.label}</span>}
            onClick={() => handleFontFamily(f.value)}
          />
        ))}
      </OverflowMenu>

      <OverflowMenu
        size="sm"
        renderIcon={TextScale}
        iconDescription="Text size"
        aria-label="Text size"
        flipped
      >
        {FONT_SIZES.map((size) => (
          <OverflowMenuItem
            key={size.label}
            itemText={<span style={{ fontSize: size.value || '0.875rem' }}>{size.label}</span>}
            onClick={() => handleFontSize(size.value)}
          />
        ))}
      </OverflowMenu>

      <div className="compose-toolbar__separator" />

      {/* Text Formatting */}
      <Button kind="ghost" size="sm" hasIconOnly iconDescription="Bold" renderIcon={TextBold}
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={editor.isActive('bold') ? 'compose-toolbar__btn--active' : ''} />
      <Button kind="ghost" size="sm" hasIconOnly iconDescription="Italic" renderIcon={TextItalic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={editor.isActive('italic') ? 'compose-toolbar__btn--active' : ''} />
      <Button kind="ghost" size="sm" hasIconOnly iconDescription="Underline" renderIcon={TextUnderline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        className={editor.isActive('underline') ? 'compose-toolbar__btn--active' : ''} />

      {/* Text Color Dropdown */}
      <ColorDropdown icon={TextColor} label="Text colour">
        <div className="compose-toolbar__color-grid" role="group" aria-label="Text colour">
          {TEXT_COLORS.map((color) => (
            <button
              key={color.value}
              type="button"
              className="compose-toolbar__color-swatch"
              style={{ backgroundColor: color.value }}
              // A hex string is not a name. Screen readers announced "#0f62fe".
              aria-label={color.name}
              title={color.name}
              onMouseDown={(e) => { e.preventDefault(); handleColor(color.value); }}
            />
          ))}
        </div>
      </ColorDropdown>

      <div className="compose-toolbar__separator" />

      {/* Alignment */}
      <Button kind="ghost" size="sm" hasIconOnly iconDescription="Align left" renderIcon={TextAlignLeft}
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
        className={editor.isActive({ textAlign: 'left' }) ? 'compose-toolbar__btn--active' : ''} />
      <Button kind="ghost" size="sm" hasIconOnly iconDescription="Align center" renderIcon={TextAlignCenter}
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
        className={editor.isActive({ textAlign: 'center' }) ? 'compose-toolbar__btn--active' : ''} />
      <Button kind="ghost" size="sm" hasIconOnly iconDescription="Align right" renderIcon={TextAlignRight}
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
        className={editor.isActive({ textAlign: 'right' }) ? 'compose-toolbar__btn--active' : ''} />
      <Button kind="ghost" size="sm" hasIconOnly iconDescription="Justify" renderIcon={TextAlignJustify}
        onClick={() => editor.chain().focus().setTextAlign('justify').run()}
        className={editor.isActive({ textAlign: 'justify' }) ? 'compose-toolbar__btn--active' : ''} />

      <div className="compose-toolbar__separator" />

      {/* Lists */}
      <Button kind="ghost" size="sm" hasIconOnly iconDescription="Numbered list" renderIcon={ListNumbered}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={editor.isActive('orderedList') ? 'compose-toolbar__btn--active' : ''} />
      <Button kind="ghost" size="sm" hasIconOnly iconDescription="Bullet list" renderIcon={ListBulleted}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={editor.isActive('bulletList') ? 'compose-toolbar__btn--active' : ''} />

      <div className="compose-toolbar__separator" />

      {/* Indent */}
      <Button kind="ghost" size="sm" hasIconOnly iconDescription="Decrease indent" renderIcon={TextIndentLess}
        onClick={() => handleIndent('outdent')} />
      <Button kind="ghost" size="sm" hasIconOnly iconDescription="Increase indent" renderIcon={TextIndentMore}
        onClick={() => handleIndent('indent')} />

      <div className="compose-toolbar__separator" />

      {/* Block */}
      <Button kind="ghost" size="sm" hasIconOnly iconDescription="Blockquote" renderIcon={Quotes}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={editor.isActive('blockquote') ? 'compose-toolbar__btn--active' : ''} />
      <Button kind="ghost" size="sm" hasIconOnly iconDescription="Strikethrough" renderIcon={TextStrikethrough}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        className={editor.isActive('strike') ? 'compose-toolbar__btn--active' : ''} />

      <div className="compose-toolbar__separator" />

      {/* Utilities */}
      <Button kind="ghost" size="sm" hasIconOnly iconDescription="Link" renderIcon={LinkIcon}
        onClick={handleLink}
        className={editor.isActive('link') ? 'compose-toolbar__btn--active' : ''} />
      <Button kind="ghost" size="sm" hasIconOnly iconDescription="Horizontal rule" renderIcon={Subtract}
        onClick={() => editor.chain().focus().setHorizontalRule().run()} />
      <Button kind="ghost" size="sm" hasIconOnly iconDescription="Clear formatting" renderIcon={TextClearFormat}
        onClick={handleClearFormat} />

      {onAttach && (
        <>
          <div className="compose-toolbar__separator" />
          <Button kind="ghost" size="sm" hasIconOnly iconDescription="Attach files" renderIcon={Attachment}
            onClick={onAttach} />
        </>
      )}
    </div>
  );
}
