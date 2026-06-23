'use client'

import { useEffect, useState } from 'react'
import { Save, X } from 'lucide-react'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { RichTextEditor } from './rich-text-editor'
import {
  emptyCategoryValue,
  type CategoryEditorValue,
  type CategoryKindValue,
} from './knowledge-editor-types'

export { emptyCategoryValue }
export type { CategoryEditorValue }

const KIND_LABELS: Record<CategoryKindValue, string> = {
  rules: 'Правила',
  faq: 'FAQ',
  salary: 'Зарплата',
  problem: 'Проблемы',
  checklist: 'Чек-лист',
}

type CompanyOption = { id: string; name: string }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialValue?: CategoryEditorValue
  companies: CompanyOption[]
  saving: boolean
  onSubmit: (value: CategoryEditorValue) => Promise<void> | void
}

export function CategoryEditorDialog({ open, onOpenChange, initialValue, companies, saving, onSubmit }: Props) {
  const [value, setValue] = useState<CategoryEditorValue>(initialValue || emptyCategoryValue)

  useEffect(() => {
    if (open) setValue(initialValue || emptyCategoryValue)
  }, [open, initialValue])

  const isEditing = Boolean(value.id)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="!max-w-[1000px] flex h-[88vh] flex-col gap-0 overflow-hidden border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 p-0 text-slate-900 dark:text-slate-100"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 px-6 py-4">
          <DialogTitle className="text-base font-bold text-amber-700 dark:text-amber-100">
            {isEditing ? 'Редактирование категории' : 'Новая категория'}
          </DialogTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-400 dark:hover:border-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
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
              <Label>Тип</Label>
              <Select
                value={value.kind}
                onChange={(event) => setValue({ ...value, kind: event.target.value as CategoryKindValue })}
              >
                {Object.entries(KIND_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Порядок</Label>
              <Input
                value={value.sort_order}
                onChange={(event) => setValue({ ...value, sort_order: event.target.value })}
                inputMode="numeric"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Описание</Label>
            <RichTextEditor value={value.description} onChange={(html) => setValue({ ...value, description: html })} />
          </div>

          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/50 px-4 py-3 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={value.is_active}
              onChange={(event) => setValue({ ...value, is_active: event.target.checked })}
            />
            Активная категория
          </label>
        </form>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 px-6 py-4">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-2xl border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-500"
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
