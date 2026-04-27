'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, AlertCircle, Loader2, Search, UserMinus, UserCheck, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

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
  dismissal_reason: string | null
  dismissed_by: string | null
  dismissed_by_name: string | null
  monthly_salary: number | null
}

type Tab = 'active' | 'dismissed'
type KindFilter = 'all' | 'staff' | 'operator'

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
        body: JSON.stringify({ kind: dismissTarget.kind, id: dismissTarget.id, reason: dismissReason.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Не удалось уволить')
      setDismissTarget(null)
      setDismissReason('')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setBusyId(null)
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
    <div className="app-page-tight max-w-6xl mx-auto py-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/dashboard">
          <Button variant="outline" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="w-6 h-6" /> Кадры
          </h1>
          <p className="text-sm text-muted-foreground">Активные и уволенные сотрудники: операторы и администрация</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={() => setTab('active')}
          className={`px-4 py-2 rounded-lg text-sm border ${tab === 'active' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40' : 'border-gray-700 text-gray-400 hover:text-white'}`}
        >
          Активные · <span className="font-bold">{counts.active}</span>
        </button>
        <button
          onClick={() => setTab('dismissed')}
          className={`px-4 py-2 rounded-lg text-sm border ${tab === 'dismissed' ? 'bg-red-500/15 text-red-300 border-red-500/40' : 'border-gray-700 text-gray-400 hover:text-white'}`}
        >
          Уволенные · <span className="font-bold">{counts.dismissed}</span>
        </button>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as KindFilter)}
            className="h-9 px-3 rounded-md border bg-background text-sm"
          >
            <option value="all">Все типы</option>
            <option value="operator">Только операторы</option>
            <option value="staff">Только админ-сотрудники</option>
          </select>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              placeholder="Поиск по имени, телефону, email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-8 pr-3 rounded-md border bg-background text-sm w-64"
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Загрузка…</div>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {tab === 'active' ? 'Активных сотрудников не найдено' : 'Уволенных сотрудников нет'}
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((emp) => {
            const busy = busyId === emp.id
            const dismissed = !!emp.dismissed_at
            return (
              <Card key={`${emp.kind}-${emp.id}`} className="p-4 flex items-start justify-between gap-4">
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
                    <div className="mt-2 p-2 rounded bg-red-500/10 border border-red-500/30 text-xs">
                      <div className="text-red-300 font-medium">
                        Уволен: {new Date(emp.dismissed_at!).toLocaleDateString('ru-RU')}
                        {emp.dismissed_by_name && <> · кем: {emp.dismissed_by_name}</>}
                      </div>
                      {emp.dismissal_reason && (
                        <div className="text-muted-foreground italic mt-1">«{emp.dismissal_reason}»</div>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setDismissTarget(null)}>
          <div className="bg-background border rounded-xl p-5 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1">Уволить сотрудника</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {dismissTarget.full_name} ({dismissTarget.kind === 'operator' ? 'оператор' : 'админ'})
            </p>
            <label className="block text-sm font-medium mb-1">Причина увольнения</label>
            <textarea
              value={dismissReason}
              onChange={(e) => setDismissReason(e.target.value)}
              placeholder="Укажите причину (минимум 5 символов)"
              rows={4}
              className="w-full px-3 py-2 rounded-md border bg-background text-sm mb-4"
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
