'use client'

import { format, isSameYear, parseISO } from 'date-fns'
import { ru } from 'date-fns/locale'
import { CalendarDays, ChevronDown } from 'lucide-react'
import * as React from 'react'

import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

function toISO(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}
function fromISO(s: string | null | undefined): Date | undefined {
  if (!s) return undefined
  const d = parseISO(s)
  return isNaN(d.getTime()) ? undefined : d
}

/** «28 сент. — 30 сент.», год — только если период не в текущем году. */
export function formatRangeLabel(from: string | null | undefined, to: string | null | undefined, empty = 'Весь период') {
  const a = fromISO(from)
  const b = fromISO(to)
  if (!a || !b) return empty
  const now = new Date()
  const withYear = !isSameYear(a, now) || !isSameYear(b, now)
  const f = withYear ? 'd MMM yyyy' : 'd MMM'
  if (toISO(a) === toISO(b)) return format(a, withYear ? 'd MMMM yyyy' : 'd MMMM', { locale: ru })
  return `${format(a, f, { locale: ru })} — ${format(b, f, { locale: ru })}`
}

export type DateRangePreset<K extends string = string> = { key: K; label: string }

export type DateRangePickerProps<K extends string = string> = {
  from: string | null | undefined
  to: string | null | undefined
  /** Период выбран в календаре (обе даты ISO 'YYYY-MM-DD'). */
  onRangeChange: (from: string, to: string) => void
  /** Быстрые периоды слева. Сами даты пресета считает страница. */
  presets?: DateRangePreset<K>[]
  activePreset?: K | string | null
  onPresetSelect?: (key: K) => void
  min?: string
  max?: string
  emptyLabel?: string
  align?: 'start' | 'center' | 'end'
  className?: string
  disabled?: boolean
}

/**
 * Выбор периода одной кнопкой: пресеты + календарь на два месяца.
 * Первый клик — начало, второй — конец, после второго окно закрывается.
 * Заменяет пары «С / По» из двух DatePicker, которые растягивались на всю ширину.
 */
export function DateRangePicker<K extends string = string>({
  from,
  to,
  onRangeChange,
  presets,
  activePreset,
  onPresetSelect,
  min,
  max,
  emptyLabel = 'Весь период',
  align = 'end',
  className,
  disabled,
}: DateRangePickerProps<K>) {
  const [open, setOpen] = React.useState(false)
  // Черновик: после первого клика есть только начало, конец ждём вторым кликом.
  const [draftFrom, setDraftFrom] = React.useState<Date | undefined>(undefined)
  const [twoMonths, setTwoMonths] = React.useState(true)

  React.useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)')
    const sync = () => setTwoMonths(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const a = fromISO(from)
  const b = fromISO(to)
  const selected = draftFrom ? { from: draftFrom, to: undefined } : a && b ? { from: a, to: b } : undefined

  const disabledMatcher = React.useMemo(() => {
    const lo = fromISO(min)
    const hi = fromISO(max)
    if (!lo && !hi) return undefined
    const m: { before?: Date; after?: Date } = {}
    if (lo) m.before = lo
    if (hi) m.after = hi
    return m as { before: Date; after: Date }
  }, [min, max])

  const handleDay = (day: Date) => {
    if (!draftFrom) {
      setDraftFrom(day)
      return
    }
    const [s, e] = day < draftFrom ? [day, draftFrom] : [draftFrom, day]
    setDraftFrom(undefined)
    onRangeChange(toISO(s), toISO(e))
    setOpen(false)
  }

  const defaultMonth = React.useMemo(() => {
    const anchor = b || new Date()
    // На два месяца показываем предыдущий + месяц конца периода.
    return twoMonths ? new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1) : anchor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, twoMonths])

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) setDraftFrom(undefined)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'inline-flex h-9 items-center gap-2 whitespace-nowrap rounded-xl border border-border bg-card px-3 text-sm text-foreground transition hover:border-amber-400/60 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
            className,
          )}
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-amber-400" />
          <span>{formatRangeLabel(from, to, emptyLabel)}</span>
          <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-auto max-w-[calc(100vw-1rem)] rounded-2xl border border-border bg-popover p-0 shadow-2xl">
        <div className="flex flex-col sm:flex-row">
          {presets && presets.length > 0 && (
            <div className="flex flex-wrap gap-1 border-b border-border p-2 sm:w-36 sm:flex-col sm:flex-nowrap sm:border-b-0 sm:border-r">
              {presets.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
                    setDraftFrom(undefined)
                    onPresetSelect?.(p.key)
                    setOpen(false)
                  }}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-left text-sm transition',
                    activePreset === p.key
                      ? 'bg-amber-500 font-medium text-white'
                      : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
          <div>
            <Calendar
              mode="range"
              numberOfMonths={twoMonths ? 2 : 1}
              defaultMonth={defaultMonth}
              selected={selected}
              disabled={disabledMatcher}
              onSelect={(_, day) => handleDay(day)}
            />
            <p className="px-4 pb-3 text-xs text-muted-foreground">
              {draftFrom ? `С ${format(draftFrom, 'd MMMM', { locale: ru })} — выберите конец периода` : 'Выберите начало и конец периода'}
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
