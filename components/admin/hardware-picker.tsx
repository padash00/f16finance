'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'

export type HardwareItem = {
  id: string
  kind: string
  brand: string
  model: string
  meta?: { hz?: number } | null
}

/**
 * Выбор модели железа из справочника.
 *
 * Обычный список тут не годится: моделей мышей больше сотни, и мотать их
 * колесом невозможно. Поэтому поиск по мере ввода, группировка по бренду и
 * возможность вписать своё — новинки выходят чаще, чем обновляется справочник,
 * и упереться в «нет в списке» никто не должен.
 */
export function HardwarePicker({
  label,
  placeholder,
  value,
  items,
  onChange,
  onPick,
}: {
  label: string
  placeholder?: string
  value: string
  items: HardwareItem[]
  onChange: (value: string) => void
  /** Выбрали строку справочника — например, чтобы подставить частоту монитора. */
  onPick?: (item: HardwareItem) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = needle
      ? items.filter(
          (item) =>
            item.model.toLowerCase().includes(needle) || item.brand.toLowerCase().includes(needle),
        )
      : items

    const byBrand = new Map<string, HardwareItem[]>()
    for (const item of filtered.slice(0, 300)) {
      const list = byBrand.get(item.brand) || []
      list.push(item)
      byBrand.set(item.brand, list)
    }
    return Array.from(byBrand.entries())
  }, [items, query])

  const hasCatalog = items.length > 0

  return (
    <div ref={boxRef} className="relative text-[10px] text-muted-foreground">
      <span className="mb-0.5 block">{label}</span>

      <div className="flex items-center gap-1">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => hasCatalog && setOpen(true)}
          placeholder={placeholder}
          className="w-full rounded border border-slate-200 bg-background px-2 py-1 text-xs dark:border-white/20"
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            title="Очистить"
            className="grid h-6 w-6 shrink-0 place-items-center rounded border border-slate-200 text-muted-foreground hover:text-foreground dark:border-white/20"
          >
            <X className="h-3 w-3" />
          </button>
        ) : null}
        {hasCatalog ? (
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            title="Выбрать из списка"
            className="grid h-6 w-6 shrink-0 place-items-center rounded border border-slate-200 text-muted-foreground hover:text-foreground dark:border-white/20"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        ) : null}
      </div>

      {open && hasCatalog && (
        <div className="absolute z-30 mt-1 max-h-72 w-full min-w-[240px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-white/15 dark:bg-slate-950">
          <div className="flex items-center gap-2 border-b border-slate-200 px-2.5 py-2 dark:border-white/10">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по модели или бренду"
              className="w-full bg-transparent text-xs outline-none"
            />
          </div>

          <div className="max-h-60 overflow-y-auto py-1">
            {groups.length === 0 && (
              <div className="px-3 py-3 text-xs text-muted-foreground">
                Ничего не нашлось. Впишите модель вручную в поле выше.
              </div>
            )}

            {groups.map(([brand, list]) => (
              <div key={brand}>
                <div className="sticky top-0 bg-slate-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground dark:bg-slate-900">
                  {brand}
                </div>
                {list.map((item) => {
                  const active = item.model === value
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onChange(item.model)
                        onPick?.(item)
                        setOpen(false)
                        setQuery('')
                      }}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition hover:bg-slate-100 dark:hover:bg-white/5 ${
                        active ? 'text-emerald-700 dark:text-emerald-300' : 'text-foreground'
                      }`}
                    >
                      <span className="truncate">{item.model}</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {item.meta?.hz ? (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-muted-foreground dark:bg-white/10">
                            {item.meta.hz} Гц
                          </span>
                        ) : null}
                        {active ? <Check className="h-3 w-3" /> : null}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
