'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, RotateCcw, ShieldAlert, ShieldCheck, Search } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { CAPABILITY_GROUPS, isDenyByDefault, type Capability, type CapabilityPage } from '@/lib/core/capabilities'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { useNavSession } from '@/lib/nav/use-nav-session'
import { getPathFeature } from '@/lib/nav/sections'

type RoleCapability = { role: string; capability: string; granted: boolean }

// Soft modern: тёмный, плавные закругления, мягкие тени, изумруд/синий акценты.
const card = 'rounded-2xl border border-border bg-white dark:bg-slate-900/60 shadow-lg shadow-black/20'

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

/**
 * Роли, чьи тумблеры ничего не решают — рантайм пропускает их мимо проверок:
 *   super_admin — обходит requireCapability и proxy.ts;
 *   owner       — loadUserCapabilities() отдаёт ему весь каталог и не применяет
 *                 снятия (lib/server/capabilities.ts).
 * Показываем их как «всё включено» и блокируем переключатели, иначе панель
 * рисует ограничения, которых на самом деле нет.
 */
const ALWAYS_FULL_ROLES = new Set(['super_admin', 'owner'])

function isAlwaysFull(role: string): boolean {
  return ALWAYS_FULL_ROLES.has(role)
}

function lockedRoleHint(role: string): string {
  return role === 'owner'
    ? 'Владелец организации всегда имеет полный доступ — набор страниц ограничивает пакет, а не права'
    : 'Супер-админ обходит все проверки прав в коде — настройка не нужна'
}

function severityBadge(sev: Capability['severity']) {
  if (sev === 'high') return <ShieldAlert className="h-3 w-3 text-rose-400" />
  if (sev === 'medium') return <ShieldCheck className="h-3 w-3 text-amber-400" />
  return null
}

export function CapabilitiesPanel({ scope = 'global' }: { scope?: 'global' | 'org' } = {}) {
  const { can } = useCapabilities()
  // Фичи пакета орг: в org-скоупе (владелец) показываем в матрице ТОЛЬКО страницы,
  // доступные организации по пакету — нельзя раздавать доступ к тому, чего у орг
  // нет. Супер-админ (global) видит весь каталог. featuresAllAccess (орг без
  // пакета / F16) — не фильтруем.
  const { orgFeatures, featuresAllAccess } = useNavSession()
  // Слой прав: global → role_capabilities (суперадмин), org → org_role_capabilities
  // (владелец режет свои роли внутри своей организации).
  const endpoint = scope === 'org' ? '/api/admin/org-role-capabilities' : '/api/admin/role-capabilities'
  const [items, setItems] = useState<RoleCapability[]>([])
  const [roles, setRoles] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  // Заглушка «Загружаем права…» — только на первом заходе. После пресета или
  // «Обновить» матрица должна оставаться на месте, а не схлопываться.
  const [firstLoad, setFirstLoad] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // Фокус на роли: '' — матрица всех ролей сразу (широкая), иначе одна колонка
  // + счётчики «открыто из» по каждой группе и странице. Основной сценарий —
  // «покажи, что видит вот этот сотрудник», а не сравнение девяти ролей.
  const [focusRole, setFocusRole] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'granted' | 'denied'>('all')
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
      const res = await fetch(endpoint, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setItems(data.items || [])
      setRoles(data.roles || [])
    } catch (e: any) {
      setError(e?.message || 'load_failed')
    } finally {
      setLoading(false)
      setFirstLoad(false)
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

  /** Грант с учётом ролей-обходчиков (owner/super_admin всегда имеют всё). */
  function effectiveGranted(role: string, capability: string): boolean {
    return isAlwaysFull(role) || isGranted(role, capability)
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
      const res = await fetch(endpoint, {
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
      const res = await fetch(endpoint, {
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
      const res = await fetch(endpoint, {
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

  /**
   * Выгрузка среза прав одной роли — открывает окно печати (→ «Сохранить в PDF»).
   * Считает по тому же каталогу, что рисует матрица (entitledGroups), поэтому
   * цифры в отчёте всегда совпадают со сводкой наверху страницы.
   */
  function exportRole(role: string) {
    const full = isAlwaysFull(role)
    const rows = entitledGroups.flatMap((group) =>
      group.pages.flatMap((page) =>
        page.capabilities.map((cap) => ({
          group: group.label,
          page: page.label,
          path: page.path,
          label: cap.label,
          id: cap.id,
          severity: cap.severity,
          granted: effectiveGranted(role, cap.id),
        })),
      ),
    )

    const total = rows.length
    const grantedCount = rows.filter((r) => r.granted).length
    const pct = total ? Math.round((grantedCount / total) * 100) : 0

    // Страницы, которые роль реально видит = включённое право `<page>.view`.
    const visiblePages = entitledGroups.flatMap((group) =>
      group.pages
        .filter((page) => {
          const viewId = `${page.id}.view`
          if (!page.capabilities.some((c) => c.id === viewId)) return false
          return effectiveGranted(role, viewId)
        })
        .map((page) => ({ group: group.label, label: page.label, path: page.path })),
    )

    const esc = (s: string) =>
      String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

    const w = window.open('', '_blank', 'width=900,height=1000')
    if (!w) {
      alert('Браузер заблокировал всплывающее окно — разрешите popup для этого сайта.')
      return
    }

    const capRows = rows
      .map(
        (r) => `<tr class="${r.granted ? '' : 'off'}">
          <td class="grp">${esc(r.group)}</td>
          <td>${esc(r.page)}</td>
          <td>${esc(r.label)}${r.severity === 'high' ? ' <span class="sev">critical</span>' : ''}</td>
          <td class="mono">${esc(r.id)}</td>
          <td class="st">${r.granted ? '<span class="yes">открыто</span>' : '<span class="no">закрыто</span>'}</td>
        </tr>`,
      )
      .join('')

    const pageRows = visiblePages
      .map((p) => `<li><b>${esc(p.label)}</b> <span class="mono">${esc(p.path)}</span> <span class="grp">${esc(p.group)}</span></li>`)
      .join('')

    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Права роли — ${esc(roleLabel(role))}</title>
    <style>
    @page{size:A4;margin:12mm}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,'Segoe UI',Arial,sans-serif;font-size:11.5px;color:#1a1a1a;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .wrap{max-width:820px;margin:0 auto}
    .hd{border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:14px}
    .hd h1{font-size:19px;font-weight:800}
    .hd .m{color:#666;font-size:11px;margin-top:3px}
    .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
    .kpi{border:1px solid #eee;border-radius:8px;padding:9px 10px;text-align:center}
    .kpi .kl{font-size:9px;text-transform:uppercase;letter-spacing:.4px;color:#999}
    .kpi .kv{font-size:17px;font-weight:800;margin-top:3px;font-variant-numeric:tabular-nums}
    .note{border:1px solid #fde68a;background:#fffbeb;border-radius:8px;padding:9px 11px;margin-bottom:16px;font-size:11px;color:#78350f}
    .sec{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.9px;color:#999;margin:18px 0 7px}
    ul{list-style:none}
    li{padding:3px 0;border-bottom:1px solid #f4f4f5}
    table{width:100%;border-collapse:collapse}
    thead th{text-align:left;font-size:9.5px;text-transform:uppercase;letter-spacing:.5px;color:#999;padding:6px;border-bottom:2px solid #111}
    tbody td{padding:4px 6px;border-bottom:1px solid #f2f2f2;vertical-align:top}
    tbody tr.off{color:#9ca3af}
    .grp{color:#9ca3af;font-size:10px}
    .mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10px;color:#6b7280}
    .st{white-space:nowrap;text-align:right}
    .yes{color:#059669;font-weight:700}
    .no{color:#dc2626}
    .sev{color:#dc2626;font-size:9px;text-transform:uppercase;letter-spacing:.4px}
    .foot{margin-top:20px;padding-top:8px;border-top:1px solid #eee;color:#aaa;font-size:10px}
    .bar{position:sticky;top:0;z-index:9;display:flex;gap:8px;justify-content:center;padding:10px;background:#f4f4f5;border-bottom:1px solid #e4e4e7;margin:-12mm -12mm 12px}
    .bar button{border:none;border-radius:8px;padding:8px 20px;font-size:13px;font-weight:600;cursor:pointer}
    .bar .p{background:#059669;color:#fff}.bar .c{background:#e4e4e7;color:#111}
    @media print{.bar{display:none}}
    </style></head>
    <body>
      <div class="bar"><button class="p" onclick="window.print()">🖨 Сохранить в PDF</button><button class="c" onclick="window.close()">Закрыть</button></div>
      <div class="wrap">
        <div class="hd">
          <h1>Права роли «${esc(roleLabel(role))}»</h1>
          <div class="m">Слой: ${scope === 'org' ? 'организация' : 'платформа'} · Сформировано ${esc(new Date().toLocaleString('ru-RU'))}</div>
        </div>
        <div class="kpis">
          <div class="kpi"><div class="kl">Открыто прав</div><div class="kv">${grantedCount}</div></div>
          <div class="kpi"><div class="kl">Закрыто</div><div class="kv">${total - grantedCount}</div></div>
          <div class="kpi"><div class="kl">Всего в каталоге</div><div class="kv">${total}</div></div>
          <div class="kpi"><div class="kl">Доля доступа</div><div class="kv">${pct}%</div></div>
        </div>
        ${
          full
            ? `<div class="note"><b>Роль обходит проверки прав в коде.</b> ${esc(lockedRoleHint(role))}. Настройки в матрице на неё не влияют.</div>`
            : `<div class="note"><b>Модель fail-open.</b> Роль базово получает весь каталог, а на /access права только <b>отнимаются</b>. «Открыто ${grantedCount}» означает, что явно снято ${total - grantedCount} — остальное досталось по умолчанию, включая права, добавленные в систему позже.<br>Исключение — права с пометкой «только явно» (оценка бизнеса): они не достаются никому, кроме владельца, пока их не выдадут поимённо.</div>`
        }
        <div class="sec">Видит страницы (${visiblePages.length})</div>
        <ul>${pageRows || '<li>— ни одной</li>'}</ul>
        <div class="sec">Все действия каталога (${total})</div>
        <table>
          <thead><tr><th>Раздел</th><th>Страница</th><th>Действие</th><th>ID</th><th class="st">Статус</th></tr></thead>
          <tbody>${capRows}</tbody>
        </table>
        <div class="foot">Orda Control · срез прав роли «${esc(role)}»</div>
      </div>
    </body></html>`)
    w.document.close()
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

  // Страница доступна организации? В org-скоупе — только если её фича входит в
  // пакет (или это базовая страница без фичи). global/allAccess — всё доступно.
  const isPageEntitled = (page: CapabilityPage): boolean => {
    if (scope !== 'org' || featuresAllAccess) return true
    const feat = getPathFeature(page.path)
    if (!feat) return true // базовая страница — всегда
    return orgFeatures.includes(feat)
  }

  // Каталог, урезанный до фич пакета орг (для owner-скоупа).
  const entitledGroups = useMemo(() => {
    if (scope !== 'org' || featuresAllAccess) return CAPABILITY_GROUPS
    return CAPABILITY_GROUPS
      .map((group) => ({ ...group, pages: group.pages.filter(isPageEntitled) }))
      .filter((group) => group.pages.length > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, featuresAllAccess, orgFeatures])

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    // Фильтр по статусу работает только в режиме фокуса — без выбранной роли
    // «открытые» бессмысленны (у каждой роли свой ответ).
    const byStatus = focusRole && statusFilter !== 'all'
    if (!q && !byStatus) return entitledGroups
    return entitledGroups
      .map((group) => ({
        ...group,
        pages: group.pages
          .map((page) => ({
            ...page,
            capabilities: page.capabilities.filter((c) => {
              if (
                q &&
                !c.label.toLowerCase().includes(q) &&
                !c.id.toLowerCase().includes(q) &&
                !page.label.toLowerCase().includes(q)
              ) {
                return false
              }
              if (!byStatus) return true
              const granted = effectiveGranted(focusRole, c.id)
              return statusFilter === 'granted' ? granted : !granted
            }),
          }))
          .filter((page) => page.capabilities.length > 0),
      }))
      .filter((group) => group.pages.length > 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, entitledGroups, focusRole, statusFilter, grantedMap])

  // Сводка по ролям — по страницам, доступным орг (entitledGroups).
  const summary = useMemo(() => {
    const totals: Record<string, { granted: number; total: number }> = {}
    for (const role of roles) totals[role] = { granted: 0, total: 0 }
    for (const group of entitledGroups) {
      for (const page of group.pages) {
        for (const cap of page.capabilities) {
          for (const role of roles) {
            totals[role].total++
            // Супер-админ и владелец всегда имеют всё (bypass в коде)
            if (effectiveGranted(role, cap.id)) {
              totals[role].granted++
            }
          }
        }
      }
    }
    return totals
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roles, grantedMap, entitledGroups])

  // Счётчики «открыто из» по разделам и страницам для выбранной роли. Считаем по
  // полному каталогу, а не по отфильтрованному — иначе при фильтре «только
  // закрытые» заголовок показывал бы «0 из 0».
  const focusCounts = useMemo(() => {
    const groups = new Map<string, { granted: number; total: number }>()
    const pages = new Map<string, { granted: number; total: number }>()
    if (!focusRole) return { groups, pages }
    for (const group of entitledGroups) {
      const g = { granted: 0, total: 0 }
      for (const page of group.pages) {
        const p = { granted: 0, total: 0 }
        for (const cap of page.capabilities) {
          p.total++
          if (effectiveGranted(focusRole, cap.id)) p.granted++
        }
        pages.set(page.id, p)
        g.granted += p.granted
        g.total += p.total
      }
      groups.set(group.id, g)
    }
    return { groups, pages }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRole, entitledGroups, grantedMap])

  // Роли-колонки в матрице: в режиме фокуса — одна.
  const visibleRoles = focusRole ? [focusRole] : roles

  function setAllCollapsed(collapsed: boolean) {
    if (collapsed) {
      setCollapsedGroups(new Set(entitledGroups.map((g) => g.id)))
      setCollapsedPages(new Set(entitledGroups.flatMap((g) => g.pages.map((p) => p.id))))
    } else {
      setCollapsedGroups(new Set())
      setCollapsedPages(new Set())
    }
  }

  if (firstLoad) {
    return (
      <div className={`${card} p-6`}>
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Загружаем права…
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-500/30 bg-rose-500/[0.07] p-6 text-rose-700 dark:text-rose-200">
        Не удалось загрузить: {error}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {scope === 'org' && (
        <div className="rounded-2xl border border-sky-400/30 bg-sky-500/[0.06] p-4 text-sm text-sky-800 dark:text-sky-200">
          Здесь вы настраиваете права ролей <b>только для своей организации</b>. Платформенные значения по умолчанию задаёт поставщик; ваши изменения не влияют на другие компании. «Сбросить к дефолту» вернёт роль к платформенному значению.
        </div>
      )}
      {/* Сводка по ролям — клик по чипу включает режим фокуса на роли */}
      <div className={`${card} p-4`}>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-body">Сводка:</span>
          {roles.map((role) => {
            const s = summary[role] || { granted: 0, total: 0 }
            const pct = s.total ? Math.round((s.granted / s.total) * 100) : 0
            const active = focusRole === role
            return (
              <button
                key={role}
                onClick={() => setFocusRole(active ? '' : role)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition ${
                  active
                    ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200'
                    : 'border-border bg-slate-100 dark:bg-white/5 text-body hover:bg-slate-200 dark:hover:bg-white/10'
                }`}
                title={active ? 'Показать все роли' : `Показать только «${roleLabel(role)}» — ${s.granted} из ${s.total} прав`}
              >
                <span className="font-medium text-foreground">{roleLabel(role)}</span>
                <span className="text-muted-foreground">{s.granted}/{s.total}</span>
                <span className={pct === 100 ? 'text-emerald-400' : pct > 50 ? 'text-amber-400' : 'text-rose-400'}>
                  {pct}%
                </span>
              </button>
            )
          })}
          <span className="text-muted-foreground">— клик по роли покажет только её</span>
        </div>
      </div>

      {/* Поиск */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[280px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по правам и страницам…"
            className="rounded-xl border-border bg-white dark:bg-slate-950/50 pl-10 text-sm text-foreground"
          />
        </div>
        <button onClick={load} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-slate-100 dark:bg-white/5 px-3.5 py-2 text-xs font-medium text-body transition-colors hover:bg-slate-200 dark:hover:bg-white/10">
          <RotateCcw className="h-3.5 w-3.5" />
          Обновить
        </button>
        <select
          className="rounded-xl border border-border bg-slate-100 dark:bg-white/5 px-3.5 py-2 text-xs font-medium text-body transition-colors hover:bg-slate-200 dark:hover:bg-white/10 focus:outline-none"
          value=""
          onChange={(e) => {
            const role = e.target.value
            if (role) exportRole(role)
            e.target.value = ''
          }}
          title="Выгрузить в PDF: что роль видит и что ей открыто"
        >
          <option value="">📄 Экспорт прав роли…</option>
          {roles.map((role) => (
            <option key={role} value={role}>{roleLabel(role)}</option>
          ))}
        </select>
        <button
          onClick={() => setAllCollapsed(false)}
          className="rounded-xl border border-border bg-slate-100 dark:bg-white/5 px-3 py-2 text-xs font-medium text-body transition-colors hover:bg-slate-200 dark:hover:bg-white/10"
        >
          Развернуть всё
        </button>
        <button
          onClick={() => setAllCollapsed(true)}
          className="rounded-xl border border-border bg-slate-100 dark:bg-white/5 px-3 py-2 text-xs font-medium text-body transition-colors hover:bg-slate-200 dark:hover:bg-white/10"
        >
          Свернуть всё
        </button>
      </div>

      {/* Режим фокуса: одна роль + фильтр по статусу */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Показать роль:</span>
        <select
          value={focusRole}
          onChange={(e) => setFocusRole(e.target.value)}
          className="rounded-xl border border-border bg-white dark:bg-slate-950/50 px-3 py-1.5 font-medium text-foreground focus:outline-none"
        >
          <option value="">Все роли (матрица)</option>
          {roles.map((role) => (
            <option key={role} value={role}>{roleLabel(role)}</option>
          ))}
        </select>

        {focusRole && (
          <>
            <div className="inline-flex overflow-hidden rounded-xl border border-border">
              {([
                ['all', 'Все'],
                ['granted', 'Открытые'],
                ['denied', 'Закрытые'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setStatusFilter(value)}
                  className={`px-3 py-1.5 font-medium transition ${
                    statusFilter === value
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200'
                      : 'bg-slate-100 dark:bg-white/5 text-body hover:bg-slate-200 dark:hover:bg-white/10'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-muted-foreground">
              {roleLabel(focusRole)}: открыто{' '}
              <b className="text-foreground">{summary[focusRole]?.granted ?? 0}</b> из{' '}
              {summary[focusRole]?.total ?? 0}
            </span>
            {isAlwaysFull(focusRole) && (
              <span className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2.5 py-1 text-amber-700 dark:text-amber-200">
                {lockedRoleHint(focusRole)}
              </span>
            )}
            <button
              onClick={() => { setFocusRole(''); setStatusFilter('all') }}
              className="rounded-xl border border-border bg-slate-100 dark:bg-white/5 px-3 py-1.5 font-medium text-body transition-colors hover:bg-slate-200 dark:hover:bg-white/10"
            >
              Сбросить
            </button>
          </>
        )}
      </div>

      {/* Дерево разделов */}
      <div className="space-y-3">
        {filteredGroups.map((group) => {
          // Если идёт поиск — раскрываем найденное независимо от collapsed
          const groupCollapsed = search.trim() ? false : collapsedGroups.has(group.id)
          return (
            <div key={group.id} className={`${card} overflow-hidden`}>
              <button
                onClick={() => toggleGroup(group.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-muted"
              >
                <div className="flex items-center gap-2">
                  {groupCollapsed ? <ChevronRight className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-emerald-300" />}
                  <span className="font-semibold text-foreground">{group.label}</span>
                  <span className="text-xs text-slate-500">
                    ({group.pages.length} стр., {group.pages.reduce((acc, p) => acc + p.capabilities.length, 0)} прав)
                  </span>
                  {focusRole && focusCounts.groups.has(group.id) && (
                    <span className="rounded-full border border-border bg-slate-100 dark:bg-white/5 px-2 py-0.5 text-[11px] text-body">
                      {roleLabel(focusRole)}: <b className="text-foreground">{focusCounts.groups.get(group.id)!.granted}</b>
                      {' из '}{focusCounts.groups.get(group.id)!.total}
                    </span>
                  )}
                </div>
              </button>

              {!groupCollapsed && (
                <div className="border-t border-border">
                  {group.pages.map((page) => (
                    <PageRow
                      key={page.id}
                      page={page}
                      roles={visibleRoles}
                      isGranted={isGranted}
                      onToggle={toggleOne}
                      onBulkSet={bulkSet}
                      savingKey={savingKey}
                      collapsed={collapsedPages.has(page.id)}
                      onToggleCollapse={() => togglePage(page.id)}
                      forceExpand={!!search.trim() || (!!focusRole && statusFilter !== 'all')}
                      focusRole={focusRole}
                      focusCount={focusCounts.pages.get(page.id) || null}
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
          <div className="mb-2 text-sm font-semibold text-foreground">Умное управление правами</div>
          <p className="mb-3 text-xs text-muted-foreground">
            При включении любого действия (например <span className="text-emerald-300">expenses.create</span>)
            автоматически включаются зависимости (страница <span className="text-emerald-300">expenses.view</span>),
            чтобы не было ошибки «Нет доступа к странице».
          </p>
        </div>

        {roles.filter((r) => !isAlwaysFull(r)).map((role) => {
          const otherRoles = roles.filter((r) => r !== role && r !== 'super_admin')
          return (
            <div key={role} className="rounded-xl border border-border bg-surface-muted p-3">
              <div className="mb-2 text-sm font-medium text-foreground">{roleLabel(role)}</div>
              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-1.5 text-emerald-700 dark:text-emerald-200 transition-colors hover:bg-emerald-500/20 disabled:opacity-50"
                  disabled={savingKey?.startsWith(`preset:${role}:`)}
                  onClick={() => applyPreset(role, 'reset_role', scope === 'org'
                    ? `Сбросить роль «${roleLabel(role)}» к платформенному дефолту (снять ваши изменения)?`
                    : `Включить ВСЁ для роли «${roleLabel(role)}»?`)}
                >
                  {scope === 'org' ? '↩ Сбросить к дефолту' : '✓ Включить всё'}
                </button>
                <button
                  className="inline-flex items-center gap-1.5 rounded-xl border border-sky-400/30 bg-sky-500/10 px-3 py-1.5 text-sky-700 dark:text-sky-200 transition-colors hover:bg-sky-500/20 disabled:opacity-50"
                  disabled={savingKey?.startsWith(`preset:${role}:`)}
                  onClick={() => applyPreset(role, 'view_only', `Только просмотр для роли «${roleLabel(role)}»?\n\nВсе *.view = ВКЛ, остальные действия = ВЫКЛ.`)}
                >
                  👁 Только просмотр
                </button>
                <button
                  className="inline-flex items-center gap-1.5 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-rose-700 dark:text-rose-200 transition-colors hover:bg-rose-500/20 disabled:opacity-50"
                  disabled={savingKey?.startsWith(`preset:${role}:`)}
                  onClick={() => applyPreset(role, 'clear_all', `Закрыть ВСЁ для роли «${roleLabel(role)}»?\n\nПользователь не сможет открыть ни одну страницу.`)}
                >
                  ✗ Закрыть всё
                </button>
                {otherRoles.length > 0 && (
                  <select
                    className="rounded-xl border border-violet-400/30 bg-violet-500/10 px-3 py-1.5 text-violet-700 dark:text-violet-200 transition-colors hover:bg-violet-500/20 focus:outline-none disabled:opacity-50"
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
                  <Loader2 className="mt-2 h-4 w-4 animate-spin text-slate-400" />
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
  focusRole = '',
  focusCount = null,
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
  focusRole?: string
  focusCount?: { granted: number; total: number } | null
}) {
  const allCapIds = page.capabilities.map((c) => c.id)
  const effectivelyCollapsed = forceExpand ? false : collapsed
  // Право «просмотр страницы» = видимость страницы для роли (если есть в каталоге).
  const viewCapId = `${page.id}.view`
  const hasViewCap = page.capabilities.some((c) => c.id === viewCapId)

  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex w-full items-center justify-between gap-2 px-5 py-2.5">
        <button
          onClick={onToggleCollapse}
          className="flex flex-1 items-center gap-2 text-left transition hover:opacity-80"
        >
          {effectivelyCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-slate-500" /> : <ChevronDown className="h-3.5 w-3.5 text-body" />}
          <span className="text-sm font-medium text-body">{page.label}</span>
          <span className="text-xs text-slate-500" title={page.path}>
            {page.capabilities.length} {page.capabilities.length === 1 ? 'действие' : 'действий'}
          </span>
          {focusRole && focusCount && (
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] ${
                focusCount.granted === 0
                  ? 'bg-rose-500/10 text-rose-600 dark:text-rose-300'
                  : focusCount.granted === focusCount.total
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
              }`}
            >
              {focusCount.granted} из {focusCount.total}
            </span>
          )}
        </button>
        {hasViewCap && canToggle && (
          <div className="flex shrink-0 items-center gap-1">
            <span className="mr-0.5 text-[11px] text-slate-500">видят:</span>
            {roles.filter((r) => !isAlwaysFull(r)).map((role) => {
              const visible = isGranted(role, viewCapId)
              const saving = savingKey === `${role}:${viewCapId}`
              return (
                <button
                  key={role}
                  onClick={() => onToggle(role, viewCapId, !visible)}
                  disabled={saving}
                  className={`rounded-full border px-2 py-0.5 text-[11px] transition disabled:opacity-50 ${
                    visible
                      ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200 hover:bg-emerald-500/25'
                      : 'border-border bg-slate-100 dark:bg-white/5 text-slate-500 line-through hover:bg-slate-200 dark:hover:bg-white/10'
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
        <div className="px-5 pb-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium text-muted-foreground">
                <th className="w-1/3 py-1 pr-3">Действие</th>
                {roles.map((role) => (
                  <th key={role} className="px-2 py-1 text-center text-[11px]">
                    {roleLabel(role)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-body">
              {page.capabilities.map((cap) => (
                <tr key={cap.id} className="border-t border-slate-100 dark:border-white/5">
                  <td className="py-1.5 pr-3 align-top">
                    <div className="flex items-center gap-1.5" title={cap.id}>
                      {severityBadge(cap.severity)}
                      <span>{cap.label}</span>
                      {isDenyByDefault(cap.id) && (
                        <span
                          className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
                          title="Это право не достаётся по умолчанию, как остальные: пока переключатель выключен, раздела нет ни у кого, кроме владельца. Включите его роли явно, если хотите открыть."
                        >
                          только явно
                        </span>
                      )}
                    </div>
                  </td>
                  {roles.map((role) => {
                    const locked = isAlwaysFull(role)
                    // Супер-админ и владелец обходят проверки прав в коде (см.
                    // proxy.ts и loadUserCapabilities). Отрисовываем как всегда
                    // включено, свитч заблокирован.
                    const granted = locked ? true : isGranted(role, cap.id)
                    const key = `${role}:${cap.id}`
                    const saving = savingKey === key
                    return (
                      <td key={role} className="px-2 py-1.5 text-center align-top">
                        <button
                          onClick={() => canToggle && !locked && onToggle(role, cap.id, !granted)}
                          disabled={saving || locked || !canToggle}
                          className={`inline-flex h-5 w-9 items-center rounded-full transition ${
                            granted ? 'bg-emerald-500/80' : 'bg-slate-300 dark:bg-slate-700'
                          } ${saving ? 'opacity-50' : ''} ${(locked || !canToggle) ? 'cursor-not-allowed opacity-70' : ''}`}
                          title={
                            !canToggle
                              ? 'Нет прав для изменения'
                              : locked
                                ? lockedRoleHint(role)
                                : granted
                                  ? 'Право включено — клик чтобы отключить'
                                  : 'Право отключено — клик чтобы включить'
                          }
                        >
                          <span
                            className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
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
          {canBulk && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Пакетно по роли:</span>
              {roles.filter((r) => !isAlwaysFull(r)).map((role) => (
                <div key={role} className="inline-flex items-center gap-1 rounded-full border border-border bg-slate-100 dark:bg-white/5 px-2 py-0.5">
                  <span className="text-[11px] text-body">{roleLabel(role)}:</span>
                  <button
                    onClick={() => onBulkSet(role, allCapIds, true)}
                    disabled={savingKey === `bulk:${role}`}
                    className="text-[11px] text-emerald-600 dark:text-emerald-300 hover:underline"
                  >
                    все вкл
                  </button>
                  <span className="text-slate-600">·</span>
                  <button
                    onClick={() => {
                      if (confirm(`Выключить ВСЕ действия страницы «${page.label}» для роли «${roleLabel(role)}»?\n\nСтраница станет недоступна этой роли.`)) {
                        onBulkSet(role, allCapIds, false)
                      }
                    }}
                    disabled={savingKey === `bulk:${role}`}
                    className="text-[11px] text-rose-600 dark:text-rose-300 hover:underline"
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
