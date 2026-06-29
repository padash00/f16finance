'use client'

import { ru } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DayPicker } from 'react-day-picker'

import { cn } from '@/lib/utils'

export type CalendarProps = React.ComponentProps<typeof DayPicker>

/**
 * Единый красивый календарь для всего приложения. Работает на светлой и тёмной теме.
 * Поверх react-day-picker v9. Используется внутри DatePicker / DateRangePicker.
 */
export function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      locale={ru}
      weekStartsOn={1}
      className={cn('p-3', className)}
      classNames={{
        months: 'flex flex-col sm:flex-row gap-4',
        month: 'space-y-3',
        month_caption: 'flex justify-center pt-1 pb-1 relative items-center h-8',
        caption_label: 'text-sm font-semibold text-slate-900 dark:text-white capitalize',
        nav: 'flex items-center gap-1 absolute inset-x-1 top-1 justify-between',
        button_previous:
          'h-7 w-7 inline-flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 transition disabled:opacity-30',
        button_next:
          'h-7 w-7 inline-flex items-center justify-center rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10 transition disabled:opacity-30',
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
