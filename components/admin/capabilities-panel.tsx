'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Lock, RotateCcw, ShieldAlert, ShieldCheck, Search } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  CAPABILITY_GROUPS,
  type Capability,
  type CapabilityGroup,
  type CapabilityPage,
} from '@/lib/core/capabilities'

type RoleCapability = { role: string; capability: string; granted: boolean }

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
  if (sev === 'high') return <ShieldAlert className="h-3 w-3 text-red-400" />
  if (sev === 'medium') return <ShieldCheck className="h-3 w-3 text-amber-400" />
  return null
}

export function CapabilitiesPanel() {
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

  async function resetRole(role: string) {
    if (!confirm(`Открыть все права для роли «${roleLabel(role)}»?`)) return
    setSavingKey(`reset:${role}`)

    // Оптимистично включаем все capabilities для роли
    const previousItems = items
    setItems((prev) => {
      const otherRoles = prev.filter((it) => it.role !== role)
      const allCaps: typeof prev = []
      for (const group of CAPABILITY_GROUPS) {
        for (const page of group.pages) {
          for (const cap of page.capabilities) {
            allCaps.push({ role, capability: cap.id, granted: true })
          }
        }
      }
      return [...otherRoles, ...allCaps]
    })

    try {
      const res = await fetch('/api/admin/role-capabilities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'reset_role', role }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (e: any) {
      setItems(previousItems)
      alert(`Ошибка: ${e?.message}`)
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
      <Card className="p-6">
        <div className="flex items-center gap-3 text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Загружаем права...
        </div>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="border-red-500/30 bg-red-500/5 p-6 text-red-200">
        Не удалось загрузить: {error}
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Сводка по ролям */}
      <Card className="border-white/10 bg-slate-950/50 p-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-slate-300">Сводка:</span>
          {roles.map((role) => {
            const s = summary[role] || { granted: 0, total: 0 }
            const pct = s.total ? Math.round((s.granted / s.total) * 100) : 0
            return (
              <span
                key={role}
                className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-slate-300"
                title={`${s.granted} из ${s.total} прав включено`}
              >
                <span className="font-medium text-white">{roleLabel(role)}</span>
                <span className="text-slate-400">{s.granted}/{s.total}</span>
                <span className={pct === 100 ? 'text-emerald-400' : pct > 50 ? 'text-amber-400' : 'text-rose-400'}>
                  {pct}%
                </span>
              </span>
            )
          })}
        </div>
      </Card>

      {/* Поиск */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[280px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по правам и страницам..."
            className="border-white/10 bg-slate-900/60 pl-10 text-sm text-white"
          />
        </div>
        <Button onClick={load} variant="outline" size="sm" className="border-white/10">
          <RotateCcw className="mr-2 h-3.5 w-3.5" />
          Обновить
        </Button>
      </div>

      {/* Дерево разделов */}
      <div className="space-y-3">
        {filteredGroups.map((group) => {
          // Если идёт поиск — раскрываем найденное независимо от collapsed
          const groupCollapsed = search.trim() ? false : collapsedGroups.has(group.id)
          return (
            <Card key={group.id} className="border-white/10 bg-slate-950/50 overflow-hidden">
              <button
                onClick={() => toggleGroup(group.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-white/5"
              >
                <div className="flex items-center gap-2">
                  {groupCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  <span className="font-semibold text-white">{group.label}</span>
                  <span className="text-xs text-slate-500">
                    ({group.pages.length} стр., {group.pages.reduce((acc, p) => acc + p.capabilities.length, 0)} прав)
                  </span>
                </div>
              </button>

              {!groupCollapsed && (
                <div className="border-t border-white/5">
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
                    />
                  ))}
                </div>
              )}
            </Card>
          )
        })}
      </div>

      {/* Действия для роли */}
      <Card className="border-white/10 bg-slate-950/50 p-4">
        <div className="text-sm font-semibold text-white mb-2">Быстрые действия</div>
        <div className="flex flex-wrap gap-2">
          {roles.map((role) => (
            <Button
              key={role}
              variant="outline"
              size="sm"
              className="border-amber-500/30 text-amber-200 hover:bg-amber-500/10"
              disabled={savingKey === `reset:${role}`}
              onClick={() => resetRole(role)}
            >
              {savingKey === `reset:${role}` ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Lock className="mr-2 h-3.5 w-3.5" />
              )}
              Открыть всё для «{roleLabel(role)}»
            </Button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Это включает все 265 прав для выбранной роли. Используется как сброс к «всё открыто».
        </p>
      </Card>
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
}) {
  const allCapIds = page.capabilities.map((c) => c.id)
  const effectivelyCollapsed = forceExpand ? false : collapsed

  return (
    <div className="border-b border-white/5 last:border-b-0">
      <button
        onClick={onToggleCollapse}
        className="flex w-full items-center justify-between gap-2 px-6 py-2 text-left transition hover:bg-white/5"
      >
        <div className="flex items-center gap-2">
          {effectivelyCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-slate-500" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-500" />}
          <span className="text-sm font-medium text-slate-200">{page.label}</span>
          <span className="text-xs text-slate-500" title={page.path}>
            {page.capabilities.length} {page.capabilities.length === 1 ? 'действие' : 'действий'}
          </span>
        </div>
      </button>

      {!effectivelyCollapsed && (
        <div className="px-6 pb-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-slate-400">
                <th className="py-1 pr-3 w-1/3">Действие</th>
                {roles.map((role) => (
                  <th key={role} className="py-1 px-2 text-center text-[11px]">
                    {roleLabel(role)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-slate-200">
              {page.capabilities.map((cap) => (
                <tr key={cap.id} className="border-t border-white/5">
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
                          onClick={() => !isSuperAdminRow && onToggle(role, cap.id, !granted)}
                          disabled={saving || isSuperAdminRow}
                          className={`inline-flex h-5 w-9 items-center rounded-full transition ${
                            granted ? 'bg-emerald-500/40' : 'bg-slate-700'
                          } ${saving ? 'opacity-50' : ''} ${isSuperAdminRow ? 'cursor-not-allowed opacity-70' : ''}`}
                          title={
                            isSuperAdminRow
                              ? 'Супер-админ обходит все проверки прав в коде — настройка не нужна'
                              : granted
                                ? 'Право включено — клик чтобы отключить'
                                : 'Право отключено — клик чтобы включить'
                          }
                        >
                          <span
                            className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
                              granted ? 'translate-x-4' : 'translate-x-0.5'
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
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">Пакетно по роли:</span>
            {roles.map((role) => (
              <div key={role} className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5">
                <span className="text-[11px] text-slate-300">{roleLabel(role)}:</span>
                <button
                  onClick={() => onBulkSet(role, allCapIds, true)}
                  disabled={savingKey === `bulk:${role}`}
                  className="text-[11px] text-emerald-300 hover:underline"
                >
                  все вкл
                </button>
                <span className="text-slate-600">·</span>
                <button
                  onClick={() => onBulkSet(role, allCapIds, false)}
                  disabled={savingKey === `bulk:${role}`}
                  className="text-[11px] text-rose-300 hover:underline"
                >
                  все выкл
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
