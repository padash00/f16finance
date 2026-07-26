'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'

import { CAPABILITY_GROUPS } from '@/lib/core/capabilities'

type Props = {
  /** Множество ВЫКЛЮЧЕННЫХ (исключённых из пакета) кодов действий. */
  excluded: Set<string>
  onToggle: (capId: string) => void
  onSetMany: (capIds: string[], exclude: boolean) => void
}

/**
 * Пикер действий для пакета: по умолчанию всё включено (зелёный тумблер),
 * выключаешь ненужные — они попадают в capability_codes пакета (исключения).
 */
export function CapabilityExcludePicker({ excluded, onToggle, onSetMany }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const q = query.trim().toLowerCase()

  // `.view` — доступ к странице (управляется вкладкой «Доступы (страницы)»),
  // а не действие. В пикере действий его не показываем.
  const groups = useMemo(() => {
    return CAPABILITY_GROUPS
      .map((g) => ({
        ...g,
        pages: g.pages
          .map((p) => ({
            ...p,
            capabilities: p.capabilities.filter(
              (c) =>
                !c.id.endsWith('.view') &&
                (!q || c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q) || p.label.toLowerCase().includes(q)),
            ),
          }))
          .filter((p) => p.capabilities.length > 0),
      }))
      .filter((g) => g.pages.length > 0)
  }, [q])

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск действия…"
          className="w-full rounded-xl border border-border bg-white py-2 pl-9 pr-3 text-sm text-foreground dark:bg-white/5"
        />
      </div>
      <div className="max-h-[400px] space-y-2 overflow-y-auto rounded-xl border border-border bg-surface-muted p-3">
        {groups.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Ничего не найдено</div>
        ) : (
          groups.map((group) => {
            const capIds = group.pages.flatMap((p) => p.capabilities.map((c) => c.id))
            const offCount = capIds.filter((id) => excluded.has(id)).length
            const isOpen = q ? true : (open[group.id] ?? false)
            return (
              <div key={group.id} className="overflow-hidden rounded-lg border border-border bg-white dark:bg-white/5">
                <button type="button" onClick={() => setOpen((p) => ({ ...p, [group.id]: !isOpen }))} className="flex w-full items-center justify-between px-3 py-2 text-left">
                  <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                    {group.label}
                    {offCount > 0 ? <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 dark:text-rose-300">−{offCount}</span> : null}
                  </span>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen ? (
                  <div className="divide-y divide-border">
                    {group.pages.map((page) => {
                      const pageCapIds = page.capabilities.map((c) => c.id)
                      const allOff = pageCapIds.every((id) => excluded.has(id))
                      return (
                        <div key={page.id} className="px-3 py-2">
                          <div className="mb-1.5 flex items-center justify-between">
                            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{page.label}</span>
                            <button type="button" onClick={() => onSetMany(pageCapIds, !allOff)} className="text-[11px] font-medium text-muted-foreground hover:text-foreground">
                              {allOff ? 'вернуть страницу' : 'убрать страницу'}
                            </button>
                          </div>
                          <div className="grid gap-1 sm:grid-cols-2">
                            {page.capabilities.map((cap) => {
                              const off = excluded.has(cap.id)
                              return (
                                <button
                                  key={cap.id}
                                  type="button"
                                  onClick={() => onToggle(cap.id)}
                                  className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left transition ${off ? 'border-rose-200 bg-rose-50 dark:border-rose-500/20 dark:bg-rose-500/10' : 'border-border bg-white dark:bg-white/5 hover:border-emerald-300'}`}
                                >
                                  <span className={`min-w-0 truncate text-xs ${off ? 'text-rose-700 line-through dark:text-rose-300' : 'text-foreground'}`}>{cap.label}</span>
                                  <span className={`relative h-4 w-8 shrink-0 rounded-full transition ${off ? 'bg-slate-300 dark:bg-slate-600' : 'bg-emerald-500'}`}>
                                    <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${off ? 'left-0.5' : 'left-[18px]'}`} />
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
