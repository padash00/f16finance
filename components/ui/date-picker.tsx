'use client'

import { format, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { CalendarDays } from 'lucide-react'
import * as React from 'react'

import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

function toISO(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}
function fromISO(s: string | null | undefined): Date | undefined {
  if (!s) return undefined
  try {
    const d = parseISO(s)
    return isNaN(d.getTime()) ? undefined : d
  } catch {
    return undefined
  }
}

export type DatePickerProps = {
  value: string | null | undefined
  onChange: (iso: string) => void
  /** Минимальная дата (ISO) — раньше неё нельзя выбрать. */
  min?: string
  /** Максимальная дата (ISO) — позже неё нельзя выбрать. */
  max?: string
  placeholder?: string
  className?: string
  disabled?: boolean
  align?: 'start' | 'center' | 'end'
}

/**
 * Красивый выбор даты вместо нативного <input type="date">.
 * value/onChange работают с ISO-строкой 'YYYY-MM-DD', как нативный инпут.
 */
export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = 'Выберите дату',
  className,
  disabled,
  align = 'start',
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const selected = fromISO(value)
  const minDate = fromISO(min)
  const maxDate = fromISO(max)

  const disabledMatcher =
    minDate || maxDate ? { before: minDate as Date, after: maxDate as Date } : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex w-full items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 text-left text-sm text-foreground transition hover:border-amber-400 focus:border-amber-500 outline-none disabled:opacity-50',
            className,
          )}
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
          <span className={cn(!selected && 'text-slate-400 dark:text-slate-500')}>
            {selected ? format(selected, 'd MMMM yyyy', { locale: ru }) : placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-auto rounded-2xl border border-border bg-white dark:bg-slate-900 p-0 shadow-2xl"
      >
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected || maxDate}
          disabled={disabledMatcher}
          onSelect={(d) => {
            if (d) {
              onChange(toISO(d))
              setOpen(false)
            }
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
