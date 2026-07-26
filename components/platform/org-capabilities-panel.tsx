'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Search, ShieldOff } from 'lucide-react'

import { CAPABILITY_GROUPS, type CapabilitySeverity } from '@/lib/core/capabilities'

type Props = { organizationId: string }

const sevDot: Record<CapabilitySeverity, string> = {
  low: 'bg-slate-300 dark:bg-slate-600',
  medium: 'bg-amber-400',
  high: 'bg-rose-500',
}

/**
 * Пульт супер-админа: пер-организационный рубильник отдельных действий (кнопок).
 * Выключенное действие пропадает у ВСЕХ в этой орг (включая владельца), кроме
 * супер-админа. Дефолт — доступно (зелёный тумблер = вкл).
 */
export function OrgCapabilitiesPanel({ organizationId }: Props) {
  const [disabled, setDisabled] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/admin/organizations/capabilities?organization_id=${encodeURIComponent(organizationId)}`, { cache: 'no-store' })
        const data = await res.json().catch(() => null)
        if (!ignore && res.ok) setDisabled(new Set<string>(data?.disabled || []))
      } finally {
        if (!ignore) setLoading(false)
      }
    })()
    return () => { ignore = true }
  }, [organizationId])

  const q = query.trim().toLowerCase()
  // `.view` — доступ к странице (вкладка «Доступы (страницы)»), не действие.
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
                (!q ||
                  c.label.toLowerCase().includes(q) ||
                  c.id.toLowerCase().includes(q) ||
                  p.label.toLowerCase().includes(q)),
            ),
          }))
          .filter((p) => p.capabilities.length > 0),
      }))
      .filter((g) => g.pages.length > 0)
  }, [q])

  const send = async (items: { capability: string; disabled: boolean }[]) => {
    const ids = items.map((i) => i.capability)
    setBusy((prev) => { const n = new Set(prev); ids.forEach((i) => n.add(i)); return n })
    setError(null)
    // оптимистично
    setDisabled((prev) => {
      const n = new Set(prev)
      for (const i of items) { if (i.disabled) n.add(i.capability); else n.delete(i.capability) }
      return n
    })
    try {
      const res = await fetch('/api/admin/organizations/capabilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id: organizationId, items }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Ошибка сохранения')
      if (Array.isArray(data?.disabled)) setDisabled(new Set<string>(data.disabled))
    } catch (e: any) {
      setError(e.message)
      // откат — перечитаем
      const res = await fetch(`/api/admin/organizations/capabilities?organization_id=${encodeURIComponent(organizationId)}`, { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (res.ok) setDisabled(new Set<string>(data?.disabled || []))
    } finally {
      setBusy((prev) => { const n = new Set(prev); ids.forEach((i) => n.delete(i)); return n })
    }
  }

  const toggleOne = (capability: string) => send([{ capability, disabled: !disabled.has(capability) }])

  const setPage = (capIds: string[], disable: boolean) =>
    send(capIds.map((capability) => ({ capability, disabled: disable })))

  const totalDisabled = disabled.size

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <ShieldOff className="h-4 w-4 text-rose-400" />
          {totalDisabled > 0
            ? <span>Выключено действий: <span className="font-semibold text-rose-600 dark:text-rose-300">{totalDisabled}</span></span>
            : <span>Все действия доступны (дефолт)</span>}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск действия…"
            className="w-64 rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 outline-none focus:border-amber-400 dark:border-white/10 dark:bg-slate-900/60 dark:text-white"
          />
        </div>
      </div>

      {error ? <p className="text-sm text-rose-500">{error}</p> : null}

      <p className="text-[12px] text-slate-500">
        Тумблер выключен → действие пропадает у всех сотрудников этой организации, включая владельца. На тебя (супер-админа) не влияет.
      </p>

      {loading ? (
        <div className="py-10 text-center text-sm text-slate-400">Загрузка…</div>
      ) : groups.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-400">Ничего не найдено</div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const groupCapIds = group.pages.flatMap((p) => p.capabilities.map((c) => c.id))
            const groupDisabled = groupCapIds.filter((id) => disabled.has(id)).length
            const isOpen = q ? true : (openGroups[group.id] ?? false)
            return (
              <div key={group.id} className="overflow-hidden rounded-xl border border-slate-200 dark:border-white/10">
                <button
                  type="button"
                  onClick={() => setOpenGroups((p) => ({ ...p, [group.id]: !isOpen }))}
                  className="flex w-full items-center justify-between bg-slate-50 px-4 py-2.5 text-left dark:bg-white/[0.03]"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {group.label}
                    {groupDisabled > 0 ? (
                      <span className="rounded-md bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 dark:text-rose-300">
                        −{groupDisabled}
                      </span>
                    ) : null}
                  </span>
                  <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                {isOpen ? (
                  <div className="divide-y divide-slate-100 dark:divide-white/5">
                    {group.pages.map((page) => {
                      const pageCapIds = page.capabilities.map((c) => c.id)
                      const allOff = pageCapIds.every((id) => disabled.has(id))
                      return (
                        <div key={page.id} className="px-4 py-3">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{page.label}</span>
                            <button
                              type="button"
                              onClick={() => setPage(pageCapIds, !allOff)}
                              className="text-[11px] font-medium text-slate-400 transition hover:text-amber-600 dark:hover:text-amber-300"
                            >
                              {allOff ? 'Включить страницу' : 'Выключить страницу'}
                            </button>
                          </div>
                          <div className="grid gap-1.5 sm:grid-cols-2">
                            {page.capabilities.map((cap) => {
                              const off = disabled.has(cap.id)
                              const isBusy = busy.has(cap.id)
                              return (
                                <button
                                  key={cap.id}
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => toggleOne(cap.id)}
                                  className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left transition disabled:opacity-50 ${
                                    off
                                      ? 'border-rose-200 bg-rose-50 dark:border-rose-500/20 dark:bg-rose-500/10'
                                      : 'border-slate-200 bg-white hover:bg-slate-50 dark:border-white/10 dark:bg-slate-900/40 dark:hover:bg-white/[0.04]'
                                  }`}
                                >
                                  <span className="flex min-w-0 items-center gap-2">
                                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${sevDot[cap.severity || 'low']}`} />
                                    <span className="min-w-0">
                                      <span className={`block truncate text-sm ${off ? 'text-rose-700 line-through dark:text-rose-300' : 'text-slate-800 dark:text-slate-100'}`}>{cap.label}</span>
                                      <span className="block truncate text-[10px] text-slate-400">{cap.id}</span>
                                    </span>
                                  </span>
                                  {/* мини-тумблер */}
                                  <span className={`relative h-5 w-9 shrink-0 rounded-full transition ${off ? 'bg-slate-300 dark:bg-slate-600' : 'bg-emerald-500'}`}>
                                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${off ? 'left-0.5' : 'left-4'}`} />
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
          })}
        </div>
      )}
    </div>
  )
}
