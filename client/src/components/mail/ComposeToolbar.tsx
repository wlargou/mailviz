import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@carbon/react';
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

// Carbon Design System color palette
const TEXT_COLORS = [
  '#161616', '#525252', '#8d8d8d', '#f4f4f4', '#ffffff',
  '#da1e28', '#ff832b', '#f1c21b', '#24a148', '#007d79',
  '#0f62fe', '#4589ff', '#8a3ffc', '#fa4d56', '#ff8389',
  '#78a9ff', '#a6c8ff', '#be95ff', '#d4bbff', '#42be65', '#a7f0ba',
];

function DropdownMenu({ children, trigger }: { children: React.ReactNode; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="compose-toolbar__dropdown" ref={ref}>
      <div onMouseDown={(e) => { e.preventDefault(); setOpen((o) => !o); }}>
        {trigger}
      </div>
      {open && (
        <div className="compose-toolbar__dropdown-menu" onMouseDown={(e) => e.preventDefault()}>
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
      {/* Font Family Dropdown */}
      <DropdownMenu
        trigger={
          <Button kind="ghost" size="sm" hasIconOnly iconDescription="Font" renderIcon={TextFont} />
        }
      >
        {FONT_FAMILIES.map((f) => (
          <div
            key={f.value}
            className={`compose-toolbar__dropdown-item${editor.isActive('textStyle', { fontFamily: f.value }) ? ' compose-toolbar__dropdown-item--active' : ''}`}
            onMouseDown={(e) => { e.preventDefault(); handleFontFamily(f.value); }}
            style={{ fontFamily: f.value }}
          >
            {f.label}
          </div>
        ))}
      </DropdownMenu>

      {/* Font Size Dropdown */}
      <DropdownMenu
        trigger={
          <Button kind="ghost" size="sm" hasIconOnly iconDescription="Text size" renderIcon={TextScale} />
        }
      >
        {FONT_SIZES.map((s) => (
          <div
            key={s.label}
            className="compose-toolbar__dropdown-item"
            onMouseDown={(e) => { e.preventDefault(); handleFontSize(s.value); }}
            style={{ fontSize: s.value || '0.875rem' }}
          >
            {s.label}
          </div>
        ))}
      </DropdownMenu>

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
      <DropdownMenu
        trigger={
          <Button kind="ghost" size="sm" hasIconOnly iconDescription="Text color" renderIcon={TextColor} />
        }
      >
        <div className="compose-toolbar__color-grid">
          {TEXT_COLORS.map((color) => (
            <button
              key={color}
              className="compose-toolbar__color-swatch"
              style={{ backgroundColor: color }}
              title={color}
              onMouseDown={(e) => { e.preventDefault(); handleColor(color); }}
            />
          ))}
        </div>
      </DropdownMenu>

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
