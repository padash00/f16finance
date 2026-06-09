'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Lock, RotateCcw, ShieldAlert, ShieldCheck, Search } from 'lucide-react'

import { Input } from '@/components/ui/input'
import {
  CAPABILITY_GROUPS,
  type Capability,
  type CapabilityPage,
} from '@/lib/core/capabilities'
import { useCapabilities } from '@/lib/client/use-capabilities'

type RoleCapability = { role: string; capability: string; granted: boolean }

// Industrial: тёплый чёрный, 1px-границы, янтарь-сигнал, семантика вкл(зелёный)/выкл(красный).
const SIGNAL = '#FFB800'
const card = 'border border-white/10 bg-white/[0.015]'

const ROLE_LABELS: Record<string, string> = {
  owner: 'Владелец',
  manager: 'Руководитель',
  marketer: 'Маркетолог',
  other: 'Прочие',
  super_admin: 'Супер-админ',
}

function roleLabel(role: string): string {
  return ROLE_LABELS[role] || role.charAt(0).toUpperCase() + role.slice(1)
}

function severityBadge(sev: Capability['severity']) {
  if (sev === 'high') return <ShieldAlert className="h-3 w-3 text-[#FF3B30]" />
  if (sev === 'medium') return <ShieldCheck className="h-3 w-3 text-[#FFB800]" />
  return null
}

export function CapabilitiesPanel() {
  const { can } = useCapabilities()
  const [items, setItems] = useState<RoleCapability[]>([])
  const [roles, setRoles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // По умолчанию всё свёрнуто — пользователь раскрывает только нужные разделы.
  // Это сильно ускоряет рендер при 65 страницах и 265 capabilities.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(CAPABILITY_GROUPS.map((g) => g.id)),
  )
  const [collapsedPages, setCollapsedPages] = useState<Set<string>>(
    () => {
      const s = new Set<string>()
      for (const g of CAPABILITY_GROUPS) for (const p of g.pages) s.add(p.id)
      return s
    },
  )

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/role-capabilities', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setItems(data.items || [])
      setRoles(data.roles || [])
    } catch (e: any) {
      setError(e?.message || 'load_failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  // Карта быстрого доступа: "role:capability" → granted
  const grantedMap = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const it of items) m.set(`${it.role}:${it.capability}`, it.granted)
    return m
  }, [items])

  function isGranted(role: string, capability: string): boolean {
    return grantedMap.get(`${role}:${capability}`) === true
  }

  async function toggleOne(role: string, capability: string, granted: boolean) {
    const key = `${role}:${capability}`
    setSavingKey(key)
    // оптимистичное обновление
    setItems((prev) => {
      const idx = prev.findIndex((p) => p.role === role && p.capability === capability)
      if (idx >= 0) {
        const next = prev.slice()
        next[idx] = { ...next[idx], granted }
        return next
      }
      return [...prev, { role, capability, granted }]
    })

    try {
      const res = await fetch('/api/admin/role-capabilities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'set', role, capability, granted }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
    } catch (e: any) {
      alert(`Ошибка: ${e?.message || 'не удалось сохранить'}`)
      load()
    } finally {
      setSavingKey(null)
    }
  }

  async function bulkSet(role: string, capabilities: string[], granted: boolean) {
    if (!capabilities.length) return
    setSavingKey(`bulk:${role}`)

    // Оптимистичное применение пакетного изменения — без перезагрузки списка
    const capSet = new Set(capabilities)
    const previousItems = items
    setItems((prev) => {
      const next = prev.map((it) =>
        it.role === role && capSet.has(it.capability) ? { ...it, granted } : it,
      )
      // Добавляем недостающие
      const existing = new Set(next.filter((it) => it.role === role).map((it) => it.capability))
      for (const cap of capabilities) {
        if (!existing.has(cap)) next.push({ role, capability: cap, granted })
      }
      return next
    })

    try {
      const res = await fetch('/api/admin/role-capabilities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'bulk_set', role, capabilities, granted }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
    } catch (e: any) {
      // Откатываем оптимистичное изменение
      setItems(previousItems)
      alert(`Ошибка: ${e?.message || 'не удалось сохранить'}`)
    } finally {
      setSavingKey(null)
    }
  }

  // Универсальный пресет: применяет одно из 'reset_role' | 'view_only' | 'clear_all' | 'copy_from'
  async function applyPreset(
    role: string,
    preset: 'reset_role' | 'view_only' | 'clear_all' | 'copy_from',
    confirmText: string,
    extraBody?: Record<string, unknown>,
  ) {
    if (!confirm(confirmText)) return
    setSavingKey(`preset:${role}:${preset}`)
    try {
      const res = await fetch('/api/admin/role-capabilities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: preset, role, ...(extraBody || {}) }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      await load()
    } catch (e: any) {
      alert(`Ошибка: ${e?.message || 'не удалось'}`)
    } finally {
      setSavingKey(null)
    }
  }

  function togglePage(pageId: string) {
    setCollapsedPages((s) => {
      const next = new Set(s)
      if (next.has(pageId)) next.delete(pageId)
      else next.add(pageId)
      return next
    })
  }

  function toggleGroup(groupId: string) {
    setCollapsedGroups((s) => {
      const next = new Set(s)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return CAPABILITY_GROUPS
    return CAPABILITY_GROUPS
      .map((group) => ({
        ...group,
        pages: group.pages
          .map((page) => ({
            ...page,
            capabilities: page.capabilities.filter(
              (c) =>
                c.label.toLowerCase().includes(q) ||
                c.id.toLowerCase().includes(q) ||
                page.label.toLowerCase().includes(q),
            ),
          }))
          .filter((page) => page.capabilities.length > 0),
      }))
      .filter((group) => group.pages.length > 0)
  }, [search])

  // Сводка по ролям
  const summary = useMemo(() => {
    const totals: Record<string, { granted: number; total: number }> = {}
    for (const role of roles) totals[role] = { granted: 0, total: 0 }
    for (const group of CAPABILITY_GROUPS) {
      for (const page of group.pages) {
        for (const cap of page.capabilities) {
          for (const role of roles) {
            totals[role].total++
            // Супер-админ всегда имеет всё (bypass в коде)
            if (role === 'super_admin' || isGranted(role, cap.id)) {
              totals[role].granted++
            }
          }
        }
      }
    }
    return totals
  }, [roles, grantedMap])

  if (loading) {
    return (
      <div className={`${card} p-6`}>
        <div className="flex items-center gap-3 text-white/40">
          <Loader2 className="h-4 w-4 animate-spin" /> <span className="text-xs uppercase tracking-wider">Загружаем права…</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="border border-[#FF3B30]/30 bg-[#FF3B30]/[0.06] p-6 text-[#FF3B30]">
        Не удалось загрузить: {error}
      </div>
    )
  }

  return (
    <div className="space-y-3 font-mono text-white">
      {/* Сводка по ролям */}
      <div className={`${card} p-4`}>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">Сводка</span>
          {roles.map((role) => {
            const s = summary[role] || { granted: 0, total: 0 }
            const pct = s.total ? Math.round((s.granted / s.total) * 100) : 0
            return (
              <span
                key={role}
                className="inline-flex items-center gap-1.5 border border-white/10 bg-white/5 px-2 py-1 text-white/70"
                title={`${s.granted} из ${s.total} прав включено`}
              >
                <span className="font-semibold text-white">{roleLabel(role)}</span>
                <span className="tabular-nums text-white/40">{s.granted}/{s.total}</span>
                <span className={`tabular-nums ${pct === 100 ? 'text-[#00E676]' : pct > 50 ? 'text-[#FFB800]' : 'text-[#FF3B30]'}`}>
                  {pct}%
                </span>
              </span>
            )
          })}
        </div>
      </div>

      {/* Поиск */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[280px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по правам и страницам…"
            className="rounded-none border-white/15 bg-black pl-10 font-mono text-sm text-white"
          />
        </div>
        <button onClick={load} className="inline-flex items-center gap-1.5 border border-white/15 px-3 py-2 text-xs text-white/70 transition-colors hover:bg-white/5">
          <RotateCcw className="h-3.5 w-3.5" />
          Обновить
        </button>
      </div>

      {/* Дерево разделов */}
      <div className="space-y-px">
        {filteredGroups.map((group) => {
          // Если идёт поиск — раскрываем найденное независимо от collapsed
          const groupCollapsed = search.trim() ? false : collapsedGroups.has(group.id)
          return (
            <div key={group.id} className={`${card} overflow-hidden`}>
              <button
                onClick={() => toggleGroup(group.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-white/5"
              >
                <div className="flex items-center gap-2">
                  {groupCollapsed ? <ChevronRight className="h-4 w-4 text-white/40" /> : <ChevronDown className="h-4 w-4" style={{ color: SIGNAL }} />}
                  <span className="text-sm font-semibold uppercase tracking-wider text-white">{group.label}</span>
                  <span className="tabular-nums text-[11px] text-white/30">
                    {group.pages.length} стр · {group.pages.reduce((acc, p) => acc + p.capabilities.length, 0)} прав
                  </span>
                </div>
              </button>

              {!groupCollapsed && (
                <div className="border-t border-white/10">
                  {group.pages.map((page) => (
                    <PageRow
                      key={page.id}
                      page={page}
                      roles={roles}
                      isGranted={isGranted}
                      onToggle={toggleOne}
                      onBulkSet={bulkSet}
                      savingKey={savingKey}
                      collapsed={collapsedPages.has(page.id)}
                      onToggleCollapse={() => togglePage(page.id)}
                      forceExpand={!!search.trim()}
                      canToggle={can('access.toggle_capability')}
                      canBulk={can('access.bulk_capabilities')}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Действия для роли */}
      {can('access.reset_to_defaults') && (
      <div className={`${card} space-y-4 p-4`}>
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">Умное управление правами</div>
          <p className="mb-3 text-xs text-white/50">
            При включении любого действия (например <span className="text-[#FFB800]">expenses.create</span>)
            автоматически включаются зависимости (страница <span className="text-[#FFB800]">expenses.view</span>),
            чтобы не было ошибки «Нет доступа к странице».
          </p>
        </div>

        {roles.filter((r) => r !== 'super_admin').map((role) => {
          const otherRoles = roles.filter((r) => r !== role && r !== 'super_admin')
          return (
            <div key={role} className="border border-white/10 bg-black/30 p-3">
              <div className="mb-2 text-sm font-semibold text-white">{roleLabel(role)}</div>
              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  className="inline-flex items-center gap-1.5 border border-[#00E676]/35 px-3 py-1.5 text-[#00E676] transition-colors hover:bg-[#00E676]/10 disabled:opacity-50"
                  disabled={savingKey?.startsWith(`preset:${role}:`)}
                  onClick={() => applyPreset(role, 'reset_role', `Включить ВСЁ для роли «${roleLabel(role)}»?`)}
                >
                  ✓ Включить всё
                </button>
                <button
                  className="inline-flex items-center gap-1.5 border border-white/20 px-3 py-1.5 text-white/70 transition-colors hover:bg-white/5 disabled:opacity-50"
                  disabled={savingKey?.startsWith(`preset:${role}:`)}
                  onClick={() => applyPreset(role, 'view_only', `Только просмотр для роли «${roleLabel(role)}»?\n\nВсе *.view = ВКЛ, остальные действия = ВЫКЛ.`)}
                >
                  👁 Только просмотр
                </button>
                <button
                  className="inline-flex items-center gap-1.5 border border-[#FF3B30]/35 px-3 py-1.5 text-[#FF3B30] transition-colors hover:bg-[#FF3B30]/10 disabled:opacity-50"
                  disabled={savingKey?.startsWith(`preset:${role}:`)}
                  onClick={() => applyPreset(role, 'clear_all', `Закрыть ВСЁ для роли «${roleLabel(role)}»?\n\nПользователь не сможет открыть ни одну страницу.`)}
                >
                  ✗ Закрыть всё
                </button>
                {otherRoles.length > 0 && (
                  <select
                    className="border border-white/20 bg-black px-2 py-1.5 text-xs text-white/70 focus:border-[#FFB800] focus:outline-none disabled:opacity-50"
                    disabled={savingKey?.startsWith(`preset:${role}:`)}
                    value=""
                    onChange={(e) => {
                      const source = e.target.value
                      if (!source) return
                      applyPreset(role, 'copy_from', `Скопировать права с «${roleLabel(source)}» в «${roleLabel(role)}»?`, { copy_from_role: source })
                    }}
                  >
                    <option value="">📋 Скопировать с роли…</option>
                    {otherRoles.map((r) => (
                      <option key={r} value={r}>{roleLabel(r)}</option>
                    ))}
                  </select>
                )}
                {savingKey?.startsWith(`preset:${role}:`) && (
                  <Loader2 className="mt-2 h-4 w-4 animate-spin text-white/40" />
                )}
              </div>
            </div>
          )
        })}
      </div>
      )}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
// Подкомпонент: одна страница с её capabilities
// ───────────────────────────────────────────────────────────────────────────

function PageRow({
  page,
  roles,
  isGranted,
  onToggle,
  onBulkSet,
  savingKey,
  collapsed,
  onToggleCollapse,
  forceExpand = false,
  canToggle = true,
  canBulk = true,
}: {
  page: CapabilityPage
  roles: string[]
  isGranted: (role: string, cap: string) => boolean
  onToggle: (role: string, capability: string, granted: boolean) => void
  onBulkSet: (role: string, capabilities: string[], granted: boolean) => void
  savingKey: string | null
  collapsed: boolean
  onToggleCollapse: () => void
  forceExpand?: boolean
  canToggle?: boolean
  canBulk?: boolean
}) {
  const allCapIds = page.capabilities.map((c) => c.id)
  const effectivelyCollapsed = forceExpand ? false : collapsed
  // Право «просмотр страницы» = видимость страницы для роли (если есть в каталоге).
  const viewCapId = `${page.id}.view`
  const hasViewCap = page.capabilities.some((c) => c.id === viewCapId)

  return (
    <div className="border-b border-white/10 last:border-b-0">
      <div className="flex w-full items-center justify-between gap-2 px-6 py-2">
        <button
          onClick={onToggleCollapse}
          className="flex flex-1 items-center gap-2 text-left transition hover:opacity-80"
        >
          {effectivelyCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-white/35" /> : <ChevronDown className="h-3.5 w-3.5 text-white/55" />}
          <span className="text-sm font-medium text-white/85">{page.label}</span>
          <span className="tabular-nums text-[11px] text-white/30" title={page.path}>
            {page.capabilities.length} {page.capabilities.length === 1 ? 'действие' : 'действий'}
          </span>
        </button>
        {hasViewCap && canToggle && (
          <div className="flex shrink-0 items-center gap-1">
            <span className="mr-0.5 text-[11px] uppercase tracking-wider text-white/30">видят:</span>
            {roles.filter((r) => r !== 'super_admin').map((role) => {
              const visible = isGranted(role, viewCapId)
              const saving = savingKey === `${role}:${viewCapId}`
              return (
                <button
                  key={role}
                  onClick={() => onToggle(role, viewCapId, !visible)}
                  disabled={saving}
                  className={`border px-1.5 py-0.5 text-[11px] transition disabled:opacity-50 ${
                    visible
                      ? 'border-[#00E676]/40 bg-[#00E676]/15 text-[#00E676] hover:bg-[#00E676]/25'
                      : 'border-white/10 bg-white/5 text-white/35 line-through hover:bg-white/10'
                  }`}
                  title={visible ? `${roleLabel(role)}: страница видна — клик чтобы скрыть` : `${roleLabel(role)}: страница скрыта — клик чтобы показать`}
                >
                  {roleLabel(role)}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {!effectivelyCollapsed && (
        <div className="px-6 pb-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] font-medium uppercase tracking-wider text-white/40">
                <th className="w-1/3 py-1 pr-3">Действие</th>
                {roles.map((role) => (
                  <th key={role} className="px-2 py-1 text-center text-[11px]">
                    {roleLabel(role)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-white/80">
              {page.capabilities.map((cap) => (
                <tr key={cap.id} className="border-t border-white/10">
                  <td className="py-1.5 pr-3 align-top">
                    <div className="flex items-center gap-1.5" title={cap.id}>
                      {severityBadge(cap.severity)}
                      <span>{cap.label}</span>
                    </div>
                  </td>
                  {roles.map((role) => {
                    const isSuperAdminRow = role === 'super_admin'
                    // Супер-админ обходит проверки прав в коде (см. proxy.ts и
                    // requireCapability). Отрисовываем как всегда включено,
                    // свитч заблокирован.
                    const granted = isSuperAdminRow ? true : isGranted(role, cap.id)
                    const key = `${role}:${cap.id}`
                    const saving = savingKey === key
                    return (
                      <td key={role} className="py-1.5 px-2 text-center align-top">
                        <button
                          onClick={() => canToggle && !isSuperAdminRow && onToggle(role, cap.id, !granted)}
                          disabled={saving || isSuperAdminRow || !canToggle}
                          className={`inline-flex h-5 w-9 items-center border transition ${
                            granted ? 'border-[#FFB800]/50 bg-[#FFB800]/30' : 'border-white/15 bg-white/5'
                          } ${saving ? 'opacity-50' : ''} ${(isSuperAdminRow || !canToggle) ? 'cursor-not-allowed opacity-70' : ''}`}
                          title={
                            !canToggle
                              ? 'Нет прав для изменения'
                              : isSuperAdminRow
                                ? 'Супер-админ обходит все проверки прав в коде — настройка не нужна'
                                : granted
                                  ? 'Право включено — клик чтобы отключить'
                                  : 'Право отключено — клик чтобы включить'
                          }
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transition-transform ${
                              granted ? 'translate-x-4 bg-[#FFB800]' : 'translate-x-0.5 bg-white/60'
                            }`}
                          />
                        </button>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {canBulk && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-white/30">Пакетно по роли:</span>
              {roles.map((role) => (
                <div key={role} className="inline-flex items-center gap-1 border border-white/10 bg-white/5 px-1.5 py-0.5">
                  <span className="text-[11px] text-white/60">{roleLabel(role)}:</span>
                  <button
                    onClick={() => onBulkSet(role, allCapIds, true)}
                    disabled={savingKey === `bulk:${role}`}
                    className="text-[11px] text-[#00E676] hover:underline"
                  >
                    все вкл
                  </button>
                  <span className="text-white/20">·</span>
                  <button
                    onClick={() => {
                      if (confirm(`Выключить ВСЕ действия страницы «${page.label}» для роли «${roleLabel(role)}»?\n\nСтраница станет недоступна этой роли.`)) {
                        onBulkSet(role, allCapIds, false)
                      }
                    }}
                    disabled={savingKey === `bulk:${role}`}
                    className="text-[11px] text-[#FF3B30] hover:underline"
                  >
                    все выкл
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
