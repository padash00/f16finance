'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, AlertCircle, ChevronDown, ChevronRight, Loader2, Search, UserMinus, UserCheck, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type DismissalType = 'voluntary' | 'mutual_agreement' | 'cause' | 'contract_end' | 'other'

const DISMISSAL_TYPE_LABELS: Record<DismissalType, string> = {
  voluntary: 'По собственному желанию',
  mutual_agreement: 'По соглашению сторон',
  cause: 'По статье',
  contract_end: 'Истёк срок договора',
  other: 'Другое',
}

type HrEmployee = {
  kind: 'staff' | 'operator'
  id: string
  full_name: string
  short_name: string | null
  position: string | null
  role: string | null
  phone: string | null
  email: string | null
  is_active: boolean
  dismissed_at: string | null
  dismissal_date: string | null
  dismissal_type: string | null
  dismissal_reason: string | null
  dismissed_by: string | null
  dismissed_by_name: string | null
  monthly_salary: number | null
}

type HistoryEntry = {
  id: string
  action: string
  payload: any
  created_at: string
  actor_name: string | null
}

type Tab = 'active' | 'dismissed'
type KindFilter = 'all' | 'staff' | 'operator'
const shortDate = (value: string) =>
  new Date(value).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })

const ACTION_LABEL: Record<string, string> = {
  dismiss: 'Уволен',
  restore: 'Восстановлен',
  create: 'Создан',
  update: 'Изменён',
  archive: 'В архив',
  activate: 'Активирован',
  deactivate: 'Деактивирован',
}

export default function HrPage() {
  const [items, setItems] = useState<HrEmployee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('active')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [dismissTarget, setDismissTarget] = useState<HrEmployee | null>(null)
  const [dismissReason, setDismissReason] = useState('')
  const [dismissDate, setDismissDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [dismissType, setDismissType] = useState<DismissalType>('voluntary')
  const [historyOpen, setHistoryOpen] = useState<Record<string, boolean>>({})
  const [historyData, setHistoryData] = useState<Record<string, HistoryEntry[]>>({})
  const [historyLoading, setHistoryLoading] = useState<Record<string, boolean>>({})

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/hr', { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Не удалось загрузить список')
      setItems(json.data || [])
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const counts = useMemo(() => {
    let active = 0, dismissed = 0
    for (const it of items) {
      if (it.dismissed_at) dismissed++
      else if (it.is_active) active++
    }
    return { active, dismissed }
  }, [items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((it) => {
      const isDismissed = !!it.dismissed_at
      if (tab === 'active' && (isDismissed || !it.is_active)) return false
      if (tab === 'dismissed' && !isDismissed) return false
      if (kindFilter !== 'all' && it.kind !== kindFilter) return false
      if (q) {
        const hay = `${it.full_name} ${it.short_name || ''} ${it.position || ''} ${it.role || ''} ${it.phone || ''} ${it.email || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [items, tab, kindFilter, search])

  function openDismiss(emp: HrEmployee) {
    setDismissTarget(emp)
    setDismissReason('')
    setDismissDate(new Date().toISOString().slice(0, 10))
    setDismissType('voluntary')
  }

  async function confirmDismiss() {
    if (!dismissTarget) return
    if (dismissReason.trim().length < 5) {
      setError('Причина обязательна (≥ 5 символов)')
      return
    }
    setBusyId(dismissTarget.id)
    setError(null)
    try {
      const res = await fetch('/api/admin/hr/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: dismissTarget.kind,
          id: dismissTarget.id,
          reason: dismissReason.trim(),
          dismissal_date: dismissDate,
          dismissal_type: dismissType,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Не удалось уволить')
      setDismissTarget(null)
      setDismissReason('')
      setHistoryData((s) => {
        const copy = { ...s }
        delete copy[`${dismissTarget.kind}-${dismissTarget.id}`]
        return copy
      })
      await load()
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setBusyId(null)
    }
  }

  async function toggleHistory(emp: HrEmployee) {
    const key = `${emp.kind}-${emp.id}`
    const isOpen = historyOpen[key]
    if (isOpen) {
      setHistoryOpen((s) => ({ ...s, [key]: false }))
      return
    }
    setHistoryOpen((s) => ({ ...s, [key]: true }))
    if (historyData[key]) return
    setHistoryLoading((s) => ({ ...s, [key]: true }))
    try {
      const res = await fetch(`/api/admin/hr/history?kind=${emp.kind}&id=${encodeURIComponent(emp.id)}`, { cache: 'no-store' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Не удалось загрузить историю')
      setHistoryData((s) => ({ ...s, [key]: json.data || [] }))
    } catch (e: any) {
      setError(e?.message || 'Ошибка истории')
    } finally {
      setHistoryLoading((s) => ({ ...s, [key]: false }))
    }
  }

  async function restore(emp: HrEmployee) {
    if (!window.confirm(`Восстановить ${emp.full_name}? Сотрудник снова станет активным.`)) return
    setBusyId(emp.id)
    setError(null)
    try {
      const res = await fetch('/api/admin/hr/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: emp.kind, id: emp.id }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Не удалось восстановить')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="app-page max-w-[1500px] space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-900/30 via-gray-900 to-slate-900/40 p-6 border border-indigo-500/20">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500 rounded-full blur-3xl opacity-15 pointer-events-none" />
        <div className="absolute -bottom-10 -left-8 w-56 h-56 bg-cyan-500 rounded-full blur-3xl opacity-10 pointer-events-none" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start gap-3">
            <Link href="/dashboard">
              <Button variant="outline" size="icon" className="border-white/20 bg-white/5 hover:bg-white/10">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2 text-white">
                <Users className="w-6 h-6 text-indigo-300" /> Кадры
              </h1>
              <p className="text-sm text-gray-300">Активные и уволенные сотрудники: операторы и администрация</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:gap-3 w-full lg:w-auto">
            <Card className="px-3 py-2 border-emerald-500/25 bg-emerald-500/10">
              <div className="text-[11px] uppercase tracking-wide text-emerald-300/90">Активные</div>
              <div className="text-lg font-bold text-emerald-200">{counts.active}</div>
            </Card>
            <Card className="px-3 py-2 border-red-500/25 bg-red-500/10">
              <div className="text-[11px] uppercase tracking-wide text-red-300/90">Уволенные</div>
              <div className="text-lg font-bold text-red-200">{counts.dismissed}</div>
            </Card>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      <Card className="p-4 bg-gray-900/70 border-gray-800">
        <div className="flex flex-col xl:flex-row xl:items-center gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setTab('active')}
              className={`px-4 py-2 rounded-lg text-sm border transition ${
                tab === 'active'
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                  : 'border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'
              }`}
            >
              Активные · <span className="font-bold">{counts.active}</span>
            </button>
            <button
              onClick={() => setTab('dismissed')}
              className={`px-4 py-2 rounded-lg text-sm border transition ${
                tab === 'dismissed'
                  ? 'bg-red-500/15 text-red-300 border-red-500/40'
                  : 'border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'
              }`}
            >
              Уволенные · <span className="font-bold">{counts.dismissed}</span>
            </button>
          </div>

          <div className="xl:ml-auto flex flex-col sm:flex-row gap-2 w-full xl:w-auto">
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as KindFilter)}
              className="h-10 px-3 rounded-lg border border-gray-700 bg-gray-800 text-sm w-full sm:w-[240px]"
            >
              <option value="all">Все типы</option>
              <option value="operator">Только операторы</option>
              <option value="staff">Только админ-сотрудники</option>
            </select>
            <div className="relative w-full sm:w-[320px]">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                placeholder="Поиск по имени, телефону, email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 pl-8 pr-3 rounded-lg border border-gray-700 bg-gray-800 text-sm w-full"
              />
            </div>
          </div>
        </div>
      </Card>

      {loading ? (
        <Card className="py-12 text-center text-muted-foreground bg-gray-900/60 border-gray-800">
          <Loader2 className="w-5 h-5 animate-spin mx-auto mb-3" />
          Загрузка...
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground bg-gray-900/60 border-gray-800">
          {tab === 'active' ? 'Активных сотрудников не найдено' : 'Уволенных сотрудников нет'}
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {filtered.map((emp) => {
            const busy = busyId === emp.id
            const dismissed = !!emp.dismissed_at
            return (
              <Card
                key={`${emp.kind}-${emp.id}`}
                className={`p-4 flex items-start justify-between gap-4 border transition ${
                  dismissed
                    ? 'bg-red-500/5 border-red-500/25'
                    : 'bg-gray-900/60 border-gray-800 hover:border-gray-600'
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold">{emp.full_name || '—'}</span>
                    <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${emp.kind === 'operator' ? 'border-blue-500/40 text-blue-400 bg-blue-500/10' : 'border-amber-500/40 text-amber-400 bg-amber-500/10'}`}>
                      {emp.kind === 'operator' ? 'Оператор' : 'Админ'}
                    </span>
                    {emp.role && (
                      <span className="text-[10px] uppercase text-muted-foreground">· {emp.role}</span>
                    )}
                    {emp.position && (
                      <span className="text-[10px] uppercase text-muted-foreground">· {emp.position}</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-1">
                    {emp.phone && <span>📞 {emp.phone}</span>}
                    {emp.email && <span>✉ {emp.email}</span>}
                    {emp.monthly_salary != null && <span>💰 {emp.monthly_salary.toLocaleString('ru-RU')} ₸/мес</span>}
                  </div>
                  {dismissed && (
                    <div className="mt-2 p-2 rounded-md bg-red-500/10 border border-red-500/30 text-xs">
                      <div className="text-red-300 font-medium flex flex-wrap gap-x-2">
                        <span>Уволен: {shortDate(emp.dismissal_date || emp.dismissed_at!)}</span>
                        {emp.dismissed_by_name && <span>· кем: {emp.dismissed_by_name}</span>}
                        {emp.dismissal_type && (
                          <span className="px-1.5 py-0.5 rounded border border-red-500/40 text-[10px] uppercase">
                            {DISMISSAL_TYPE_LABELS[emp.dismissal_type as DismissalType] || emp.dismissal_type}
                          </span>
                        )}
                      </div>
                      {emp.dismissal_reason && (
                        <div className="text-muted-foreground italic mt-1">«{emp.dismissal_reason}»</div>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => toggleHistory(emp)}
                    className="mt-2 flex items-center gap-1 text-[11px] text-gray-400 hover:text-white transition"
                  >
                    {historyOpen[`${emp.kind}-${emp.id}`] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    История
                  </button>

                  {historyOpen[`${emp.kind}-${emp.id}`] && (
                    <div className="mt-2 pl-2 border-l border-gray-700 text-xs space-y-1">
                      {historyLoading[`${emp.kind}-${emp.id}`] ? (
                        <div className="text-gray-500 italic">Загрузка истории…</div>
                      ) : (historyData[`${emp.kind}-${emp.id}`] || []).length === 0 ? (
                        <div className="text-gray-500 italic">Нет записей</div>
                      ) : (
                        (historyData[`${emp.kind}-${emp.id}`] || []).map((h) => (
                          <div key={h.id} className="text-gray-400">
                            <span className="text-gray-300">{ACTION_LABEL[h.action] || h.action}</span>
                            <span className="text-gray-500"> · {new Date(h.created_at).toLocaleString('ru-RU')}</span>
                            {h.actor_name && <span className="text-gray-500"> · {h.actor_name}</span>}
                            {h.action === 'dismiss' && h.payload?.reason && (
                              <div className="italic text-gray-500 ml-2">
                                {h.payload?.dismissal_type && DISMISSAL_TYPE_LABELS[h.payload.dismissal_type as DismissalType] && (
                                  <>[{DISMISSAL_TYPE_LABELS[h.payload.dismissal_type as DismissalType]}] </>
                                )}
                                «{h.payload.reason}»
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <div className="shrink-0">
                  {dismissed ? (
                    <Button size="sm" variant="outline" onClick={() => restore(emp)} disabled={busy}>
                      {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <UserCheck className="w-3 h-3 mr-1" />}
                      Восстановить
                    </Button>
                  ) : (
                    <Button size="sm" variant="destructive" onClick={() => openDismiss(emp)} disabled={busy}>
                      <UserMinus className="w-3 h-3 mr-1" /> Уволить
                    </Button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {dismissTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setDismissTarget(null)}>
          <div className="bg-gray-950 border border-white/10 rounded-2xl p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1">Уволить сотрудника</h3>
            <p className="text-sm text-gray-400 mb-4">
              {dismissTarget.full_name} ({dismissTarget.kind === 'operator' ? 'оператор' : 'админ'})
            </p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-sm font-medium mb-1">Дата увольнения</label>
                <input
                  type="date"
                  value={dismissDate}
                  onChange={(e) => setDismissDate(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-gray-700 bg-gray-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Тип</label>
                <select
                  value={dismissType}
                  onChange={(e) => setDismissType(e.target.value as DismissalType)}
                  className="w-full h-10 px-3 rounded-lg border border-gray-700 bg-gray-900 text-sm"
                >
                  {(Object.keys(DISMISSAL_TYPE_LABELS) as DismissalType[]).map((t) => (
                    <option key={t} value={t}>{DISMISSAL_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </div>
            </div>
            <label className="block text-sm font-medium mb-1">Причина увольнения</label>
            <textarea
              value={dismissReason}
              onChange={(e) => setDismissReason(e.target.value)}
              placeholder="Укажите причину (минимум 5 символов)"
              rows={4}
              className="w-full px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 text-sm mb-4"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setDismissTarget(null)}>Отмена</Button>
              <Button variant="destructive" onClick={confirmDismiss} disabled={busyId === dismissTarget.id}>
                {busyId === dismissTarget.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserMinus className="w-4 h-4 mr-2" />}
                Уволить
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
