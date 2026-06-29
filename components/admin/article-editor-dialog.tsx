'use client'

import { useEffect, useState } from 'react'
import { Save, X } from 'lucide-react'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { RichTextEditor } from './rich-text-editor'
import { emptyArticleValue, type ArticleEditorValue } from './knowledge-editor-types'

export { emptyArticleValue }
export type { ArticleEditorValue }

type CategoryOption = { id: string; title: string; company_id: string | null }
type CompanyOption = { id: string; name: string }

const SEVERITY_LABELS = {
  info: 'Информация',
  normal: 'Обычно',
  warning: 'Важно',
  critical: 'Критично',
} as const

const AUDIENCE_OPTIONS = [
  { value: 'operator', label: 'Оператор' },
  { value: 'cashier', label: 'Кассир' },
  { value: 'manager', label: 'Менеджер' },
  { value: 'owner', label: 'Owner' },
  { value: 'client', label: 'Клиент (киоск)' },
  { value: 'public', label: 'Публично' },
  { value: 'kiosk', label: 'Киоск' },
] as const

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialValue?: ArticleEditorValue
  categories: CategoryOption[]
  companies: CompanyOption[]
  saving: boolean
  onSubmit: (value: ArticleEditorValue) => Promise<void> | void
}

export function ArticleEditorDialog({
  open,
  onOpenChange,
  initialValue,
  categories,
  companies,
  saving,
  onSubmit,
}: Props) {
  const [value, setValue] = useState<ArticleEditorValue>(initialValue || emptyArticleValue)

  useEffect(() => {
    if (open) {
      setValue(initialValue || emptyArticleValue)
    }
  }, [open, initialValue])

  const isEditing = Boolean(value.id)

  const filteredCategories = categories.filter((c) => !value.company_id || !c.company_id || c.company_id === value.company_id)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="!max-w-[1100px] flex h-[92vh] flex-col gap-0 overflow-hidden border-slate-200 dark:border-slate-800 bg-card p-0 text-slate-900 dark:text-slate-100"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 px-6 py-4">
          <DialogTitle className="text-base font-bold text-amber-700 dark:text-amber-100">
            {isEditing ? 'Редактирование материала' : 'Новый материал'}
          </DialogTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="grid h-9 w-9 place-items-center rounded-xl border border-border text-muted-foreground hover:border-slate-400 dark:hover:border-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
          onSubmit={async (event) => {
            event.preventDefault()
            await onSubmit(value)
          }}
        >
          <div className="space-y-2">
            <Label>Название</Label>
            <Input value={value.title} onChange={(event) => setValue({ ...value, title: event.target.value })} required />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Точка</Label>
              <Select value={value.company_id} onChange={(event) => setValue({ ...value, company_id: event.target.value })}>
                <option value="">Для всех точек</option>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Категория</Label>
              <Select value={value.category_id} onChange={(event) => setValue({ ...value, category_id: event.target.value })}>
                <option value="">Без категории</option>
                {filteredCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.title}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Важность</Label>
              <Select
                value={value.severity}
                onChange={(event) => setValue({ ...value, severity: event.target.value as ArticleEditorValue['severity'] })}
              >
                {Object.entries(SEVERITY_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Краткое описание</Label>
            <textarea
              value={value.summary}
              onChange={(event) => setValue({ ...value, summary: event.target.value })}
              className="min-h-20 w-full rounded-2xl border border-slate-200 dark:border-slate-700/70 bg-white dark:bg-slate-950/70 px-4 py-3 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-amber-400/80"
            />
          </div>

          <div className="space-y-2">
            <Label>Содержимое</Label>
            <RichTextEditor value={value.content} onChange={(content) => setValue({ ...value, content })} />
          </div>

          <div className="space-y-2">
            <Label>Аудитория</Label>
            <div className="flex flex-wrap gap-2">
              {AUDIENCE_OPTIONS.map((opt) => {
                const checked = value.audience.includes(opt.value)
                return (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() =>
                      setValue({
                        ...value,
                        audience: checked
                          ? value.audience.filter((v) => v !== opt.value)
                          : [...value.audience, opt.value],
                      })
                    }
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      checked
                        ? 'border-amber-300/70 bg-amber-300/15 text-amber-700 dark:text-amber-100'
                        : 'border-border bg-white dark:bg-slate-900/70 text-muted-foreground hover:border-slate-400 dark:hover:border-slate-500'
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label>Теги (через запятую)</Label>
              <Input value={value.tags} onChange={(event) => setValue({ ...value, tags: event.target.value })} placeholder="касса, смена" />
            </div>
            <div className="space-y-2">
              <Label>Штраф ₸</Label>
              <Input value={value.related_fine_amount} onChange={(event) => setValue({ ...value, related_fine_amount: event.target.value })} inputMode="numeric" />
            </div>
            <div className="space-y-2">
              <Label>Бонус ₸</Label>
              <Input value={value.related_bonus_amount} onChange={(event) => setValue({ ...value, related_bonus_amount: event.target.value })} inputMode="numeric" />
            </div>
            <div className="space-y-2">
              <Label>Порядок</Label>
              <Input value={value.sort_order} onChange={(event) => setValue({ ...value, sort_order: event.target.value })} inputMode="numeric" />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/50 px-4 py-3 text-sm text-body">
              <input type="checkbox" checked={value.is_published} onChange={(event) => setValue({ ...value, is_published: event.target.checked })} />
              Опубликовано для операторов
            </label>
            <label className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-950/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-100">
              <input type="checkbox" checked={value.requires_confirmation} onChange={(event) => setValue({ ...value, requires_confirmation: event.target.checked })} />
              Требует подтверждения оператором
            </label>
          </div>
        </form>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 px-6 py-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-2xl border border-border px-4 py-2.5 text-sm font-semibold text-body hover:border-slate-400 dark:hover:border-slate-500"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              await onSubmit(value)
            }}
            className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 px-5 py-2.5 text-sm font-black text-slate-950 transition hover:brightness-110 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {isEditing ? 'Сохранить' : 'Создать'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Label({ children }: { children: string }) {
  return <label className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{children}</label>
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="w-full rounded-2xl border border-slate-200 dark:border-slate-700/70 bg-white dark:bg-slate-950/70 px-4 py-3 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-amber-400/80"
    />
  )
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="w-full rounded-2xl border border-slate-200 dark:border-slate-700/70 bg-white dark:bg-slate-950/70 px-4 py-3 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-amber-400/80"
    />
  )
}
