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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 font-mono" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden border border-white/15 bg-[#0B0C0A] text-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Заголовок */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">Индивидуальные права — {staffName}</p>
            <p className="text-[11px] text-white/40">
              Роль: <span className="text-white/70">{roleLabel(role)}</span> · исключения поверх роли
            </p>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-10 text-white/40">
            <Loader2 className="h-4 w-4 animate-spin" /> <span className="text-xs uppercase tracking-wider">Загружаем…</span>
          </div>
        ) : error ? (
          <div className="p-6 text-sm text-[#FF3B30]">Не удалось загрузить: {error}</div>
        ) : (
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <p className="border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-white/50">
              <span className="text-[#00E676]">Разрешить</span> — выдать право лично этому сотруднику, даже если роль его не даёт.{' '}
              <span className="text-[#FF3B30]">Запретить</span> — отнять право, даже если роль его даёт.{' '}
              <span className="text-white/70">По роли</span> — убрать исключение.
            </p>

            {/* Текущие исключения */}
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                Текущие исключения ({exceptions.length})
              </div>
              {exceptions.length === 0 ? (
                <p className="text-xs text-white/40">Нет исключений — права полностью по роли «{roleLabel(role)}».</p>
              ) : (
                <div className="space-y-px">
                  {exceptions.map(({ cap, id, granted }) => (
                    <div
                      key={id}
                      className="flex items-center justify-between gap-2 border border-white/10 bg-white/[0.02] px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          {granted ? (
                            <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#00E676]" />
                          ) : (
                            <ShieldX className="h-3.5 w-3.5 shrink-0 text-[#FF3B30]" />
                          )}
                          <span className="truncate text-sm text-white/85">{cap!.label}</span>
                        </div>
                        <div className="text-[11px] text-white/35">
                          {cap!.groupLabel} · {cap!.pageLabel} · по роли: {roleGrants(id) ? 'вкл' : 'выкл'}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span
                          className={`px-1.5 py-0.5 text-[11px] uppercase tracking-wider ${
                            granted ? 'bg-[#00E676]/15 text-[#00E676]' : 'bg-[#FF3B30]/15 text-[#FF3B30]'
                          }`}
                        >
                          {granted ? 'разрешено' : 'запрещено'}
                        </span>
                        <button
                          onClick={() => setOverride(id, 'reset')}
                          disabled={saving === id}
                          className="inline-flex items-center gap-1 border border-white/15 px-1.5 py-0.5 text-[11px] text-white/60 hover:bg-white/5 disabled:opacity-50"
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
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                Добавить / изменить исключение
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Найти право или страницу…"
                  className="w-full border border-white/15 bg-black py-2 pl-10 pr-3 text-sm text-white placeholder-white/25 focus:border-[#FFB800] focus:outline-none"
                />
              </div>

              {search.trim() && (
                <div className="mt-2 space-y-px">
                  {searchResults.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-white/40">Ничего не найдено.</p>
                  ) : (
                    searchResults.map((c) => {
                      const ov = overrides.get(c.id)
                      const baseline = roleGrants(c.id)
                      return (
                        <div
                          key={c.id}
                          className="flex items-center justify-between gap-2 px-2 py-1.5 hover:bg-white/5"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm text-white/85">{c.label}</div>
                            <div className="text-[11px] text-white/35">
                              {c.pageLabel} · по роли: {baseline ? 'вкл' : 'выкл'}
                              {ov !== undefined && (
                                <span className={ov ? ' text-[#00E676]' : ' text-[#FF3B30]'}>
                                  {' '}· сейчас: {ov ? 'разрешено' : 'запрещено'}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              onClick={() => setOverride(c.id, 'allow')}
                              disabled={saving === c.id}
                              className={`border px-2 py-0.5 text-[11px] transition disabled:opacity-50 ${
                                ov === true
                                  ? 'border-[#00E676]/50 bg-[#00E676]/20 text-[#00E676]'
                                  : 'border-white/15 text-white/60 hover:bg-[#00E676]/10'
                              }`}
                            >
                              разрешить
                            </button>
                            <button
                              onClick={() => setOverride(c.id, 'deny')}
                              disabled={saving === c.id}
                              className={`border px-2 py-0.5 text-[11px] transition disabled:opacity-50 ${
                                ov === false
                                  ? 'border-[#FF3B30]/50 bg-[#FF3B30]/20 text-[#FF3B30]'
                                  : 'border-white/15 text-white/60 hover:bg-[#FF3B30]/10'
                              }`}
                            >
                              запретить
                            </button>
                            {ov !== undefined && (
                              <button
                                onClick={() => setOverride(c.id, 'reset')}
                                disabled={saving === c.id}
                                className="border border-white/15 px-1.5 py-0.5 text-[11px] text-white/50 hover:bg-white/5 disabled:opacity-50"
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
