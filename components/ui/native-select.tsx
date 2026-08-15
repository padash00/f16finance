import * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * NativeSelect — обычный `<select>`, но одного вида со всем порталом.
 *
 * В проекте есть Radix-Select (`components/ui/select.tsx`) — он нужен там, где
 * список сложный: с иконками, группами, поиском. Для «выбрать одно из
 * нескольких» он избыточен, поэтому большинство страниц используют родной
 * `<select>`. Беда в том, что каждая страница до сих пор описывала его
 * оформление своей строкой классов, и они разъехались: где-то другой радиус,
 * где-то другой фокус, где-то текст бледнее нормы.
 *
 * Здесь эта строка одна. Оформление совпадает с `Input`, чтобы поле ввода и
 * выпадающий список в одном ряду выглядели одинаково.
 */
function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        'border-input h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base text-foreground shadow-xs transition-[color,box-shadow] outline-none md:text-sm',
        'dark:bg-input/30',
        'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
        'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}

export { NativeSelect }
