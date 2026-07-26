'use client'

import { useEffect, useRef, useState } from 'react'
import { ru } from 'date-fns/locale'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { DayPicker } from 'react-day-picker'

import { cn } from '@/lib/utils'

export type CalendarProps = React.ComponentProps<typeof DayPicker>

// Кастомная выпадашка (месяц/год) с поиском — печатаешь, список фильтруется.
// Заменяет нативный <select> react-day-picker (по нему нельзя искать год).
function SearchableDropdown(props: any) {
  const { options = [], value, onChange } = props
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const current = options.find((o: any) => String(o.value) === String(value))
  const q = query.trim().toLowerCase()
  const filtered = q ? options.filter((o: any) => String(o.label).toLowerCase().includes(q)) : options

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const pick = (v: string) => {
    onChange?.({ target: { value: v } } as any)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-sm font-medium capitalize text-foreground outline-none transition hover:border-amber-400 focus:border-amber-500"
      >
        {current?.label ?? value}
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-36 overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
          <div className="p-1.5">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск…"
              inputMode="numeric"
              className="w-full rounded-lg border border-border bg-surface-muted px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-amber-400"
            />
          </div>
          <div className="max-h-52 overflow-y-auto pb-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-xs text-muted-foreground">Ничего не найдено</div>
            ) : (
              filtered.map((o: any) => {
                const active = String(o.value) === String(value)
                return (
                  <button
                    key={o.value}
                    type="button"
                    disabled={o.disabled}
                    onClick={() => pick(String(o.value))}
                    className={`block w-full px-3 py-1.5 text-left text-sm capitalize transition ${active ? 'bg-amber-500 font-semibold text-white' : 'text-body hover:bg-surface-hover'} ${o.disabled ? 'opacity-30' : ''}`}
                  >
                    {o.label}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Единый красивый календарь для всего приложения. Работает на светлой и тёмной теме.
 * Поверх react-day-picker v9. Выпадающие месяц/год + стрелки навигации.
 */
export function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  // Широкий диапазон лет: с 1920 (для дат рождения и т.п.) до текущего+5.
  // Список года — нативный <select>, длинный список скроллится сам.
  // Можно переопределить через props (startMonth/endMonth).
  const nowYear = new Date().getFullYear()
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      locale={ru}
      weekStartsOn={1}
      captionLayout="dropdown"
      startMonth={new Date(1920, 0)}
      endMonth={new Date(nowYear + 5, 11)}
      className={cn('p-3', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-4',
        // relative — чтобы абсолютные стрелки навигации позиционировались внутри месяца
        month: 'relative space-y-3',
        month_caption: 'flex justify-center items-center h-9 px-9',
        caption_label: 'hidden',
        dropdowns: 'flex items-center gap-1.5',
        dropdown_root: 'relative inline-flex items-center',
        dropdown:
          'rounded-lg border border-border bg-card text-foreground text-sm font-medium px-2 py-1 cursor-pointer outline-none hover:border-amber-400 focus:border-amber-500 capitalize',
        nav: 'absolute inset-x-0 top-0 flex items-center justify-between px-1 z-10',
        button_previous:
          'h-8 w-8 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-hover transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer',
        button_next:
          'h-8 w-8 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-hover transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'text-faint w-9 font-medium text-[0.65rem] uppercase tracking-wide',
        week: 'flex w-full mt-1',
        day: 'h-9 w-9 text-center text-sm p-0 relative',
        day_button:
          'h-9 w-9 inline-flex items-center justify-center rounded-lg font-normal text-body ' +
          'hover:bg-amber-100 dark:hover:bg-amber-500/15 transition cursor-pointer ' +
          'aria-selected:bg-amber-500 aria-selected:text-white aria-selected:font-semibold aria-selected:hover:bg-amber-500',
        today: 'font-semibold text-amber-600 dark:text-amber-300 [&_button]:ring-1 [&_button]:ring-amber-400/50',
        outside: 'text-slate-300 dark:text-slate-600',
        disabled: 'opacity-30',
        range_start: '[&_button]:rounded-r-none',
        range_end: '[&_button]:rounded-l-none',
        range_middle:
          '[&_button]:!bg-amber-100 dark:[&_button]:!bg-amber-500/15 [&_button]:!text-slate-900 dark:[&_button]:!text-white [&_button]:!rounded-none',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: cls }) =>
          orientation === 'left' ? (
            <ChevronLeft className={cn('h-4 w-4', cls)} />
          ) : (
            <ChevronRight className={cn('h-4 w-4', cls)} />
          ),
        Dropdown: SearchableDropdown,
      }}
      {...props}
    />
  )
}
