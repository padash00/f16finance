'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search, ShieldCheck, ShieldX, RotateCcw, X } from 'lucide-react'

import { CAPABILITY_GROUPS } from '@/lib/core/capabilities'

const ROLE_LABELS: Record<string, string> = {
  owner: 'Владелец',
  manager: 'Руководитель',
  marketer: 'Маркетолог',
  other: 'Прочие',
  super_admin: 'Супер-админ',
}

function roleLabel(role: string | null): string {
  if (!role) return '—'
  return ROLE_LABELS[role] || role
}

type FlatCap = { id: string; label: string; pageLabel: string; groupLabel: string }

// Плоский список всех capabilities — строим один раз из каталога.
const ALL_CAPS: FlatCap[] = (() => {
  const out: FlatCap[] = []
  for (const group of CAPABILITY_GROUPS) {
    for (const page of group.pages) {
      for (const cap of page.capabilities) {
        out.push({ id: cap.id, label: cap.label, pageLabel: page.label, groupLabel: group.label })
      }
    }
  }
  return out
})()

const CAP_BY_ID = new Map(ALL_CAPS.map((c) => [c.id, c]))

/**
 * Панель индивидуальных прав одного сотрудника.
 *
 * Переопределения (user_capability_overrides) накладываются ПОВЕРХ прав роли:
 *  - «Разрешить» (granted=true)  — выдать право, даже если роль его не даёт
 *  - «Запретить» (granted=false) — отнять право, даже если роль его даёт
 *  - «По роли»   — удалить переопределение, право берётся из роли
 */
export function UserOverridesPanel({
  userId,
  staffName,
  role,
  onClose,
}: {
  userId: string
  staffName: string
  role: string | null
  onClose: () => void
}) {
  // capability → granted (override). Отсутствие ключа = «по роли».
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map())
  // capabilities, которые выдаёт роль (baseline) — чтобы показывать, от чего отклоняемся.
  const [roleCaps, setRoleCaps] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [ovRes, roleRes] = await Promise.all([
        fetch(`/api/admin/user-capability-overrides?user_id=${encodeURIComponent(userId)}`, { cache: 'no-store' }),
        fetch('/api/admin/role-capabilities', { cache: 'no-store' }),
      ])
      if (!ovRes.ok) throw new Error(`HTTP ${ovRes.status}`)
      const ovData = await ovRes.json()
      const ovMap = new Map<string, boolean>()
      for (const it of (ovData.items || []) as Array<{ capability: string; granted: boolean }>) {
        ovMap.set(it.capability, it.granted)
      }
      setOverrides(ovMap)

      if (roleRes.ok && role) {
        const roleData = await roleRes.json()
        const set = new Set<string>()
        for (const it of (roleData.items || []) as Array<{ role: string; capability: string; granted: boolean }>) {
          if (it.role === role && it.granted) set.add(it.capability)
        }
        setRoleCaps(set)
      }
    } catch (e: any) {
      setError(e?.message || 'load_failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // baseline для роли
  function roleGrants(capId: string): boolean {
    return roleCaps.has(capId)
  }

  async function setOverride(capId: string, action: 'allow' | 'deny' | 'reset') {
    setSaving(capId)
    const prev = new Map(overrides)
    // оптимистично
    setOverrides((m) => {
      const next = new Map(m)
      if (action === 'reset') next.delete(capId)
      else next.set(capId, action === 'allow')
      return next
    })
    try {
      const body =
        action === 'reset'
          ? { action: 'remove', user_id: userId, capability: capId }
          : { action: 'set', user_id: userId, capability: capId, granted: action === 'allow' }
      const res = await fetch('/api/admin/user-capability-overrides', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error || `HTTP ${res.status}`)
      }
    } catch (e: any) {
      setOverrides(prev)
      alert(`Ошибка: ${e?.message || 'не удалось сохранить'}`)
    } finally {
      setSaving(null)
    }
  }

  // Текущие исключения (есть override)
  const exceptions = useMemo(() => {
    return Array.from(overrides.entries())
      .map(([id, granted]) => ({ cap: CAP_BY_ID.get(id), id, granted }))
      .filter((x) => x.cap)
      .sort((a, b) => (a.cap!.groupLabel + a.cap!.label).localeCompare(b.cap!.groupLabel + b.cap!.label))
  }, [overrides])

  // Результаты поиска для добавления нового исключения
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return ALL_CAPS.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.pageLabel.toLowerCase().includes(q),
    ).slice(0, 40)
  }, [search])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl shadow-black/40"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Заголовок */}
        <div className="relative overflow-hidden border-b border-white/10 px-5 py-4">
          <div className="pointer-events-none absolute -left-10 -top-12 h-32 w-32 rounded-full bg-violet-500/15 blur-3xl" />
          <div className="relative flex items-center justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">Индивидуальные права — {staffName}</p>
              <p className="text-xs text-slate-400">
                Роль: <span className="text-slate-200">{roleLabel(role)}</span> · исключения поверх роли
              </p>
            </div>
            <button onClick={onClose} className="text-slate-500 transition-colors hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Загружаем…
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-rose-300">Не удалось загрузить: {error}</div>
        ) : (
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-xs leading-relaxed text-slate-400">
              <span className="text-emerald-300">Разрешить</span> — выдать право лично этому сотруднику, даже если роль его не даёт.{' '}
              <span className="text-rose-300">Запретить</span> — отнять право, даже если роль его даёт.{' '}
              <span className="text-slate-200">По роли</span> — убрать исключение.
            </p>

            {/* Текущие исключения */}
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Текущие исключения ({exceptions.length})
              </div>
              {exceptions.length === 0 ? (
                <p className="text-xs text-slate-500">Нет исключений — права полностью по роли «{roleLabel(role)}».</p>
              ) : (
                <div className="space-y-2">
                  {exceptions.map(({ cap, id, granted }) => (
                    <div
                      key={id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          {granted ? (
                            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                          ) : (
                            <ShieldX className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                          )}
                          <span className="truncate text-sm text-slate-200">{cap!.label}</span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {cap!.groupLabel} · {cap!.pageLabel} · по роли: {roleGrants(id) ? 'вкл' : 'выкл'}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            granted ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'
                          }`}
                        >
                          {granted ? 'разрешено' : 'запрещено'}
                        </span>
                        <button
                          onClick={() => setOverride(id, 'reset')}
                          disabled={saving === id}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300 transition-colors hover:bg-white/10 disabled:opacity-50"
                          title="Вернуть к роли"
                        >
                          {saving === id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                          по роли
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Добавить исключение через поиск */}
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Добавить / изменить исключение
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Найти право или страницу…"
                  className="w-full rounded-xl border border-white/10 bg-slate-950/50 py-2.5 pl-10 pr-3 text-sm text-white placeholder-slate-500 transition focus:border-emerald-400/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/15"
                />
              </div>

              {search.trim() && (
                <div className="mt-2 space-y-1">
                  {searchResults.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-slate-500">Ничего не найдено.</p>
                  ) : (
                    searchResults.map((c) => {
                      const ov = overrides.get(c.id)
                      const baseline = roleGrants(c.id)
                      return (
                        <div
                          key={c.id}
                          className="flex items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 hover:bg-white/5"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm text-slate-200">{c.label}</div>
                            <div className="text-[11px] text-slate-500">
                              {c.pageLabel} · по роли: {baseline ? 'вкл' : 'выкл'}
                              {ov !== undefined && (
                                <span className={ov ? ' text-emerald-400' : ' text-rose-400'}>
                                  {' '}· сейчас: {ov ? 'разрешено' : 'запрещено'}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              onClick={() => setOverride(c.id, 'allow')}
                              disabled={saving === c.id}
                              className={`rounded-lg border px-2.5 py-1 text-[11px] transition disabled:opacity-50 ${
                                ov === true
                                  ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200'
                                  : 'border-white/10 bg-white/5 text-slate-300 hover:bg-emerald-500/10'
                              }`}
                            >
                              разрешить
                            </button>
                            <button
                              onClick={() => setOverride(c.id, 'deny')}
                              disabled={saving === c.id}
                              className={`rounded-lg border px-2.5 py-1 text-[11px] transition disabled:opacity-50 ${
                                ov === false
                                  ? 'border-rose-400/50 bg-rose-500/20 text-rose-200'
                                  : 'border-white/10 bg-white/5 text-slate-300 hover:bg-rose-500/10'
                              }`}
                            >
                              запретить
                            </button>
                            {ov !== undefined && (
                              <button
                                onClick={() => setOverride(c.id, 'reset')}
                                disabled={saving === c.id}
                                className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-white/10 disabled:opacity-50"
                                title="Вернуть к роли"
                              >
                                <RotateCcw className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
