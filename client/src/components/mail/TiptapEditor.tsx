import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import FontFamily from '@tiptap/extension-font-family';
import Highlight from '@tiptap/extension-highlight';
import type { Editor } from '@tiptap/react';

interface TiptapEditorProps {
  content?: string;
  onUpdate?: (html: string) => void;
  editorRef?: React.MutableRefObject<Editor | null>;
  onEditorReady?: (editor: Editor) => void;
  placeholder?: string;
}

export function TiptapEditor({ content, onUpdate, editorRef, onEditorReady, placeholder }: TiptapEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
      Placeholder.configure({
        placeholder: placeholder || 'Write your message...',
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      TextStyle,
      Color,
      FontFamily,
      Highlight.configure({
        multicolor: true,
      }),
    ],
    content: content || '',
    onUpdate: ({ editor: e }) => {
      onUpdate?.(e.getHTML());
    },
  });

  useEffect(() => {
    if (editor) {
      if (editorRef) editorRef.current = editor;
      onEditorReady?.(editor);
    }
  }, [editor, editorRef, onEditorReady]);

  return (
    <div className="compose-editor">
      <EditorContent editor={editor} />
    </div>
  );
}
