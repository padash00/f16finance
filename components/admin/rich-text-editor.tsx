'use client'

import { useEffect } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Redo,
  Strikethrough,
  Table as TableIcon,
  Underline as UnderlineIcon,
  Undo,
} from 'lucide-react'

const COLOR_SWATCHES = [
  { label: 'Белый', value: '#f8fafc' },
  { label: 'Жёлтый', value: '#fde047' },
  { label: 'Зелёный', value: '#34d399' },
  { label: 'Синий', value: '#60a5fa' },
  { label: 'Красный', value: '#fb7185' },
]

const HIGHLIGHT_SWATCHES = [
  { label: 'Жёлтый маркер', value: '#713f12' },
  { label: 'Зелёный маркер', value: '#064e3b' },
  { label: 'Красный маркер', value: '#7f1d1d' },
]

type Props = {
  value: string
  onChange: (html: string) => void
  className?: string
}

export function RichTextEditor({ value, onChange, className }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { class: 'text-amber-600 dark:text-amber-300 underline' },
      }),
      Image.configure({ inline: false, allowBase64: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: value || '',
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class:
          [
            'min-h-[360px] max-w-none px-5 py-4 text-sm leading-7 text-slate-700 dark:text-slate-100 focus:outline-none',
            '[&_p]:my-3 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
            '[&_h1]:my-5 [&_h1]:text-3xl [&_h1]:font-black [&_h1]:leading-tight [&_h1]:text-slate-900 dark:[&_h1]:text-white',
            '[&_h2]:my-4 [&_h2]:text-2xl [&_h2]:font-black [&_h2]:leading-tight [&_h2]:text-amber-700 dark:[&_h2]:text-amber-100',
            '[&_h3]:my-3 [&_h3]:text-xl [&_h3]:font-bold [&_h3]:leading-tight [&_h3]:text-slate-700 dark:[&_h3]:text-slate-100',
            '[&_strong]:font-black [&_em]:italic [&_u]:underline [&_s]:line-through',
            '[&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-7 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-7 [&_li]:my-1',
            '[&_blockquote]:my-4 [&_blockquote]:border-l-4 [&_blockquote]:border-amber-300/70 [&_blockquote]:bg-amber-50 dark:[&_blockquote]:bg-amber-950/20 [&_blockquote]:px-4 [&_blockquote]:py-2 [&_blockquote]:italic [&_blockquote]:text-amber-800 dark:[&_blockquote]:text-amber-50',
            '[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-slate-200 dark:[&_pre]:border-slate-700 [&_pre]:bg-white dark:[&_pre]:bg-slate-950 [&_pre]:p-4 [&_pre]:text-xs [&_code]:rounded [&_code]:bg-slate-100 dark:[&_code]:bg-slate-800/80 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-amber-700 dark:[&_code]:text-amber-100 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
            '[&_a]:font-semibold [&_a]:text-amber-600 dark:[&_a]:text-amber-300 [&_a]:underline [&_img]:my-4 [&_img]:max-h-[420px] [&_img]:rounded-xl [&_img]:border [&_img]:border-slate-200 dark:[&_img]:border-slate-800',
            '[&_mark]:rounded [&_mark]:px-1 [&_mark]:text-slate-900 dark:[&_mark]:text-white',
            '[&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_table]:overflow-hidden [&_table]:rounded-xl',
            '[&_th]:border [&_th]:border-slate-200 dark:[&_th]:border-slate-700 [&_th]:bg-slate-50 dark:[&_th]:bg-slate-800 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-bold',
            '[&_td]:border [&_td]:border-slate-200 dark:[&_td]:border-slate-700 [&_td]:px-3 [&_td]:py-2',
          ].join(' '),
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
  })

  useEffect(() => {
    if (!editor) return
    if (editor.getHTML() !== value) {
      editor.commands.setContent(value || '', { emitUpdate: false })
    }
  }, [value, editor])

  if (!editor) {
    return (
      <div className={`rounded-2xl border border-slate-200 dark:border-slate-700/70 bg-white dark:bg-slate-950/70 p-6 text-sm text-slate-500 ${className ?? ''}`}>
        Загрузка редактора…
      </div>
    )
  }

  const insertLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Введите URL:', previous || 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url, target: '_blank' }).run()
  }

  const insertImage = () => {
    const url = window.prompt('URL картинки:', 'https://')
    if (!url) return
    editor.chain().focus().setImage({ src: url }).run()
  }

  const insertTable = () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
  }

  return (
    <div className={`overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-700/70 bg-white dark:bg-slate-950/70 ${className ?? ''}`}>
      <div className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80 px-2 py-2" onMouseDown={(event) => event.preventDefault()}>
        <ToolGroup>
          <ToolButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Отменить (Ctrl+Z)">
            <Undo className="h-4 w-4" />
          </ToolButton>
          <ToolButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Повторить (Ctrl+Y)">
            <Redo className="h-4 w-4" />
          </ToolButton>
        </ToolGroup>

        <ToolGroup>
          <ToolButton active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Заголовок 1">
            <Heading1 className="h-4 w-4" />
          </ToolButton>
          <ToolButton active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Заголовок 2">
            <Heading2 className="h-4 w-4" />
          </ToolButton>
          <ToolButton active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Заголовок 3">
            <Heading3 className="h-4 w-4" />
          </ToolButton>
        </ToolGroup>

        <ToolGroup>
          <ToolButton active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Жирный (Ctrl+B)">
            <Bold className="h-4 w-4" />
          </ToolButton>
          <ToolButton active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Курсив (Ctrl+I)">
            <Italic className="h-4 w-4" />
          </ToolButton>
          <ToolButton active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Подчёркнутый (Ctrl+U)">
            <UnderlineIcon className="h-4 w-4" />
          </ToolButton>
          <ToolButton active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="Зачёркнутый">
            <Strikethrough className="h-4 w-4" />
          </ToolButton>
          <ToolButton active={editor.isActive('highlight')} onClick={() => editor.chain().focus().toggleHighlight({ color: '#fde047' }).run()} title="Маркер">
            <Highlighter className="h-4 w-4" />
          </ToolButton>
        </ToolGroup>

        <ToolGroup>
          {COLOR_SWATCHES.map((color) => (
            <ToolButton
              key={color.value}
              active={editor.isActive('textStyle', { color: color.value })}
              onClick={() => editor.chain().focus().setColor(color.value).run()}
              title={`Цвет текста: ${color.label}`}
            >
              <span className="h-4 w-4 rounded-full border border-white/20" style={{ backgroundColor: color.value }} />
            </ToolButton>
          ))}
          <ToolButton onClick={() => editor.chain().focus().unsetColor().run()} title="Сбросить цвет">
            <span className="text-[10px] font-black">A</span>
          </ToolButton>
        </ToolGroup>

        <ToolGroup>
          {HIGHLIGHT_SWATCHES.map((color) => (
            <ToolButton
              key={color.value}
              active={editor.isActive('highlight', { color: color.value })}
              onClick={() => editor.chain().focus().toggleHighlight({ color: color.value }).run()}
              title={color.label}
            >
              <span className="h-4 w-4 rounded border border-white/20" style={{ backgroundColor: color.value }} />
            </ToolButton>
          ))}
          <ToolButton onClick={() => editor.chain().focus().unsetHighlight().run()} title="Убрать маркер">
            <Highlighter className="h-4 w-4 opacity-50" />
          </ToolButton>
        </ToolGroup>

        <ToolGroup>
          <ToolButton active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()} title="Слева">
            <AlignLeft className="h-4 w-4" />
          </ToolButton>
          <ToolButton active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} title="По центру">
            <AlignCenter className="h-4 w-4" />
          </ToolButton>
          <ToolButton active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()} title="Справа">
            <AlignRight className="h-4 w-4" />
          </ToolButton>
        </ToolGroup>

        <ToolGroup>
          <ToolButton active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Маркированный список">
            <List className="h-4 w-4" />
          </ToolButton>
          <ToolButton active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Нумерованный список">
            <ListOrdered className="h-4 w-4" />
          </ToolButton>
          <ToolButton active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Цитата">
            <Quote className="h-4 w-4" />
          </ToolButton>
          <ToolButton active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="Блок кода">
            <Code className="h-4 w-4" />
          </ToolButton>
        </ToolGroup>

        <ToolGroup>
          <ToolButton onClick={insertLink} active={editor.isActive('link')} title="Ссылка">
            <LinkIcon className="h-4 w-4" />
          </ToolButton>
          <ToolButton onClick={insertImage} title="Картинка по URL">
            <ImageIcon className="h-4 w-4" />
          </ToolButton>
          <ToolButton onClick={insertTable} title="Таблица 3x3">
            <TableIcon className="h-4 w-4" />
          </ToolButton>
        </ToolGroup>
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}

function ToolGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5 border-r border-slate-200 dark:border-slate-800 pr-1.5 last:border-r-0">{children}</div>
}

function ToolButton({
  children,
  onClick,
  active,
  disabled,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`grid h-8 w-8 place-items-center rounded-md transition ${
        active
          ? 'bg-amber-300/20 text-amber-700 dark:text-amber-200'
          : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 disabled:opacity-30 disabled:hover:bg-transparent'
      }`}
    >
      {children}
    </button>
  )
}
