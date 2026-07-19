'use client'

/**
 * Инпут суммы с живым форматом тысяч: печатаете 25000 — видите «25 000».
 * Наружу отдаёт чистую числовую строку (без пробелов), так что drop-in
 * замена обычного Input в формах сумм:
 *
 *   <MoneyInput value={form.cash} onValueChange={(v) => setForm({...form, cash: v})} />
 */

import { forwardRef } from 'react'

import { Input } from '@/components/ui/input'

function formatThousands(raw: string): string {
  const clean = raw.replace(/[^\d.,]/g, '')
  if (!clean) return ''
  const [intPart, ...rest] = clean.split(/[.,]/)
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return rest.length ? `${grouped},${rest.join('')}` : grouped
}

function unformat(display: string): string {
  return display.replace(/\s/g, '').replace(',', '.')
}

type MoneyInputProps = Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'type'> & {
  value: string
  onValueChange: (numeric: string) => void
}

export const MoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onValueChange, inputMode = 'decimal', ...rest },
  ref,
) {
  return (
    <Input
      ref={ref}
      type="text"
      inputMode={inputMode}
      value={formatThousands(String(value ?? ''))}
      onChange={(e) => onValueChange(unformat(e.target.value))}
      {...rest}
    />
  )
})
