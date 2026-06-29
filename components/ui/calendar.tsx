'use client'

import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DayPicker } from 'react-day-picker'

import { cn } from '@/lib/utils'

export type CalendarProps = React.ComponentProps<typeof DayPicker>

/**
 * Единый красивый календарь для всего приложения. Работает на светлой и тёмной теме.
 * Поверх react-day-picker v9. Выпадающие месяц/год + стрелки навигации.
 */
export function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      locale={ru}
      weekStartsOn={1}
      captionLayout="dropdown"
      startMonth={new Date(2021, 0)}
      endMonth={new Date(2035, 11)}
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
          'rounded-lg border border-border bg-white dark:bg-slate-800 text-foreground text-sm font-medium px-2 py-1 cursor-pointer outline-none hover:border-amber-400 focus:border-amber-500 capitalize',
        nav: 'absolute inset-x-0 top-0 flex items-center justify-between px-1 z-10',
        button_previous:
          'h-8 w-8 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:bg-slate-100 dark:hover:bg-white/10 transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer',
        button_next:
          'h-8 w-8 inline-flex items-center justify-center rounded-lg text-muted-foreground hover:bg-slate-100 dark:hover:bg-white/10 transition disabled:opacity-30 disabled:pointer-events-none cursor-pointer',
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday: 'text-slate-400 dark:text-slate-500 w-9 font-medium text-[0.65rem] uppercase tracking-wide',
        week: 'flex w-full mt-1',
        day: 'h-9 w-9 text-center text-sm p-0 relative',
        day_button:
          'h-9 w-9 inline-flex items-center justify-center rounded-lg font-normal text-slate-700 dark:text-slate-200 ' +
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
      }}
      {...props}
    />
  )
}
