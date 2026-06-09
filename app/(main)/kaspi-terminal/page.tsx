'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useCompanies } from '@/hooks/use-companies'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { AlertTriangle, CheckCircle2, CreditCard, GitCompareArrows, ListOrdered, Pencil, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react'
import { AdminPageHeader } from '@/components/admin/admin-page-header'

type Row = {
  id: string
  date: string
  company_id: string
  amount: number
  note: string | null
}

type ReconRow = {
  date: string
  company_id: string
  company_name: string
  terminal: number
  incomes: number
  diff: number
}

type ReconTotals = { terminal: number; incomes: number; diff: number }
type ReconData = { rows: ReconRow[]; totals: ReconTotals }

type Tab = 'entries' | 'reconciliation'

const fmt = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

const todayISO = () => new Date().toISOString().slice(0, 10)
const monthAgoISO = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10) }

export default function KaspiTerminalPage() {
  const { companies } = useCompanies()
  const { can } = useCapabilities()
  const canCreate = can('kaspi-terminal.create')
  const canEdit = can('kaspi-terminal.edit')
  const canDelete = can('kaspi-terminal.delete')

  const [tab, setTab] = useState<Tab>('entries')

  // Фильтры
  const [from, setFrom] = useState(monthAgoISO())
  const [to, setTo] = useState(todayISO())
  const [filterCompany, setFilterCompany] = useState('')

  // Данные
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Сверка
  const [recon, setRecon] = useState<ReconData | null>(null)
  const [reconLoading, setReconLoading] = useState(false)
  const [reconError, setReconError] = useState<string | null>(null)
  const [reconTolerance, setReconTolerance] = useState('100')

  // Новая запись
  const [newDate, setNewDate] = useState(todayISO())
  const [newCompany, setNewCompany] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [newNote, setNewNote] = useState('')
  const [saving, setSaving] = useState(false)

  // Редактирование
  const [editId, setEditId] = useState<string | null>(null)
  const [editDate, setEditDate] = useState('')
  const [editCompany, setEditCompany] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editNote, setEditNote] = useState('')

  useEffect(() => {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    const f = sp.get('from')
    const t = sp.get('to')
    const tab = sp.get('tab')
    const isISO = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
    if (f && isISO(f)) setFrom(f)
    if (t && isISO(t)) setTo(t)
    if (tab === 'reconciliation' || tab === 'recon') setTab('reconciliation')
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !companies?.length) return
    const c = new URLSearchParams(window.location.search).get('company_id')
    if (c && companies.some((co) => co.id === c)) setFilterCompany(c)
  }, [companies])

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ from, to })
      if (filterCompany) params.set('company_id', filterCompany)
      const res = await fetch(`/api/admin/kaspi-terminal?${params}`)
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setRows(body.data ?? [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      if (silent) setRefreshing(false); else setLoading(false)
    }
  }, [from, to, filterCompany])

  useEffect(() => { load() }, [load])

  const loadRecon = useCallback(async () => {
    setReconLoading(true)
    setReconError(null)
    try {
      const params = new URLSearchParams({ from, to })
      if (filterCompany) params.set('company_id', filterCompany)
      const res = await fetch(`/api/admin/kaspi-terminal/reconciliation?${params}`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
      setRecon(body.data as ReconData)
    } catch (e: any) {
      setReconError(e.message)
      setRecon(null)
    } finally {
      setReconLoading(false)
    }
  }, [from, to, filterCompany])

  useEffect(() => {
    if (tab === 'reconciliation') loadRecon()
  }, [tab, loadRecon])

  const mutate = async (payload: unknown) => {
    const res = await fetch('/api/admin/kaspi-terminal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    return body
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newDate || !newCompany || !newAmount) return
    setSaving(true)
    try {
      const resp = await mutate({ action: 'create', payload: { date: newDate, company_id: newCompany, amount: Number(newAmount), note: newNote || null } })
      const created = resp?.data as Row | undefined
      if (created) {
        // Оптимистично добавляем в state — без перезагрузки таблицы
        setRows(prev => [created, ...prev].sort((a, b) => b.date.localeCompare(a.date)))
      } else {
        load(true)
      }
      setNewAmount('')
      setNewNote('')
    } catch (e: any) { alert(e.message) }
    setSaving(false)
  }

  const handleSaveEdit = async () => {
    if (!editId) return
    setSaving(true)
    try {
      const resp = await mutate({ action: 'update', id: editId, payload: { date: editDate, company_id: editCompany, amount: Number(editAmount), note: editNote || null } })
      const updated = resp?.data as Row | undefined
      if (updated) {
        setRows(prev => prev.map(r => r.id === updated.id ? updated : r).sort((a, b) => b.date.localeCompare(a.date)))
      } else {
        load(true)
      }
      setEditId(null)
    } catch (e: any) { alert(e.message) }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить запись?')) return
    // Оптимистичное удаление — мгновенный UX
    const prev = rows
    setRows(rows.filter(r => r.id !== id))
    try {
      await mutate({ action: 'delete', id })
    } catch (e: any) {
      setRows(prev)
      alert(e.message)
    }
  }

  const companyName = (id: string) => companies.find(c => c.id === id)?.name || id

  const totalAmount = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows])

  return (
    <div className="app-page-wide space-y-6">
      <AdminPageHeader
        title="Безналичный терминал"
        description="Суточные итоги с терминала — без привязки к оператору"
        icon={<CreditCard className="h-5 w-5" />}
        accent="emerald"
        backHref="/"
        toolbar={(
          <div className="flex gap-1 border-b border-border">
            {([
              { id: 'entries' as const, label: 'Записи', icon: ListOrdered },
              { id: 'reconciliation' as const, label: 'Сверка с доходами', icon: GitCompareArrows },
            ]).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  tab === id ? 'border-blue-500 text-blue-400' : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        )}
      />

      {/* Фильтры */}
      <Card className="p-4 border-border bg-card">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">С</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="bg-input border border-border rounded-lg px-3 py-2 text-sm focus:border-blue-500" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">По</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="bg-input border border-border rounded-lg px-3 py-2 text-sm focus:border-blue-500" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Компания</label>
            <select value={filterCompany} onChange={e => setFilterCompany(e.target.value)}
              className="bg-input border border-border rounded-lg px-3 py-2 text-sm focus:border-blue-500 [color-scheme:dark]">
              <option value="">Все компании</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {tab === 'reconciliation' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Допуск ±₸</label>
              <input
                type="number"
                value={reconTolerance}
                onChange={(e) => setReconTolerance(e.target.value)}
                min="0"
                step="1"
                className="bg-input border border-border rounded-lg px-3 py-2 text-sm focus:border-blue-500 w-28"
              />
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => tab === 'reconciliation' ? loadRecon() : load(true)}
            disabled={tab === 'reconciliation' ? reconLoading : (loading || refreshing)}
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${(tab === 'reconciliation' ? reconLoading : (loading || refreshing)) ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
          {tab === 'entries' && totalAmount > 0 && (
            <div className="ml-auto text-sm font-medium text-blue-300">
              Итого: {fmt(totalAmount)}
            </div>
          )}
        </div>
      </Card>

      {tab === 'entries' && (
      <>
      {/* Форма добавления — только для тех у кого есть kaspi-terminal.create */}
      {canCreate && (
      <Card className="p-4 border-border bg-card">
        <h2 className="text-sm font-semibold text-foreground mb-3">Добавить запись</h2>
        <form onSubmit={handleAdd} className="flex flex-wrap gap-2 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Дата</label>
            <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
              className="bg-input border border-border rounded-lg px-3 py-2 text-sm focus:border-blue-500" required />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Компания</label>
            <select value={newCompany} onChange={e => setNewCompany(e.target.value)}
              className="bg-input border border-border rounded-lg px-3 py-2 text-sm focus:border-blue-500 [color-scheme:dark]" required>
              <option value="">— выбери —</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">Сумма Безналичный ₸</label>
            <input type="number" value={newAmount} onChange={e => setNewAmount(e.target.value)}
              placeholder="0" min="1" step="1"
              className="bg-input border border-border rounded-lg px-3 py-2 text-sm focus:border-blue-500 w-36" required />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-40">
            <label className="text-xs text-muted-foreground">Заметка (необязательно)</label>
            <input value={newNote} onChange={e => setNewNote(e.target.value)}
              placeholder="Например: терминал №2"
              className="bg-input border border-border rounded-lg px-3 py-2 text-sm focus:border-blue-500" />
          </div>
          <Button type="submit" disabled={saving || !newDate || !newCompany || !newAmount}
            className="bg-blue-600 hover:bg-blue-700">
            <Plus className="w-4 h-4 mr-1" /> Добавить
          </Button>
        </form>
      </Card>
      )}

      {/* Таблица */}
      <Card className="border-border bg-card overflow-hidden">
        {error && <div className="px-4 py-3 text-sm text-rose-400 border-b border-border">{error}</div>}
        {loading && <div className="px-4 py-6 text-center text-sm text-muted-foreground">Загрузка...</div>}
        {!loading && rows.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Нет записей за выбранный период
          </div>
        )}
        {!loading && rows.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 text-left">Дата</th>
                <th className="px-4 py-3 text-left">Компания</th>
                <th className="px-4 py-3 text-right">Безналичный сумма</th>
                <th className="px-4 py-3 text-left">Заметка</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id} className="border-b border-border/50 hover:bg-white/5 transition-colors">
                  {editId === row.id ? (
                    <>
                      <td className="px-4 py-2">
                        <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                          className="bg-input border border-border rounded px-2 py-1 text-xs w-36" />
                      </td>
                      <td className="px-4 py-2">
                        <select value={editCompany} onChange={e => setEditCompany(e.target.value)}
                          className="bg-input border border-border rounded px-2 py-1 text-xs [color-scheme:dark]">
                          {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <input type="number" value={editAmount} onChange={e => setEditAmount(e.target.value)}
                          className="bg-input border border-border rounded px-2 py-1 text-xs w-32 text-right" />
                      </td>
                      <td className="px-4 py-2">
                        <input value={editNote} onChange={e => setEditNote(e.target.value)}
                          className="bg-input border border-border rounded px-2 py-1 text-xs w-full" />
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex gap-1 justify-end">
                          <Button size="icon" className="h-7 w-7 bg-green-600 hover:bg-green-700" onClick={handleSaveEdit} disabled={saving}>
                            <Save className="w-3 h-3" />
                          </Button>
                          <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setEditId(null)}>
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 font-medium">{row.date}</td>
                      <td className="px-4 py-3 text-muted-foreground">{companyName(row.company_id)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-blue-300">{fmt(row.amount)}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{row.note || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          {canEdit && (
                            <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-blue-400"
                              onClick={() => { setEditId(row.id); setEditDate(row.date); setEditCompany(row.company_id); setEditAmount(String(row.amount)); setEditNote(row.note || '') }}>
                              <Pencil className="w-3 h-3" />
                            </Button>
                          )}
                          {canDelete && (
                            <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-red-400" onClick={() => handleDelete(row.id)}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-white/5">
                <td colSpan={2} className="px-4 py-3 text-xs text-muted-foreground">{rows.length} записей</td>
                <td className="px-4 py-3 text-right font-bold text-blue-300">{fmt(totalAmount)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        )}
      </Card>
      </>
      )}

      {tab === 'reconciliation' && (
        <ReconciliationView
          data={recon}
          loading={reconLoading}
          error={reconError}
          tolerance={Math.max(0, Number(reconTolerance) || 0)}
        />
      )}
    </div>
  )
}

function ReconciliationView({
  data,
  loading,
  error,
  tolerance,
}: {
  data: ReconData | null
  loading: boolean
  error: string | null
  tolerance: number
}) {
  const rows = data?.rows || []
  const totals = data?.totals || { terminal: 0, incomes: 0, diff: 0 }

  const problemCount = useMemo(
    () => rows.filter((r) => Math.abs(r.diff) > tolerance).length,
    [rows, tolerance],
  )
  const cleanCount = rows.length - problemCount

  return (
    <>
      <Card className="p-4 border-border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Сверка терминала с доходами</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Сравнение суммы с Безналичный POS терминала и Безналичный-поступлений в доходах за день × точку.
              Допуск ±{tolerance.toLocaleString('ru-RU')} ₸ — расхождения в пределах допуска считаются совпадением.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2">
              <p className="text-[10px] uppercase text-muted-foreground tracking-wide">Терминал</p>
              <p className="text-sm font-bold text-blue-300">{fmt(totals.terminal)}</p>
            </div>
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
              <p className="text-[10px] uppercase text-muted-foreground tracking-wide">Доходы</p>
              <p className="text-sm font-bold text-emerald-300">{fmt(totals.incomes)}</p>
            </div>
            <div className={`rounded-lg border px-3 py-2 ${
              Math.abs(totals.diff) > tolerance
                ? 'border-red-500/30 bg-red-500/5'
                : 'border-white/10 bg-white/5'
            }`}>
              <p className="text-[10px] uppercase text-muted-foreground tracking-wide">Разница</p>
              <p className={`text-sm font-bold ${
                Math.abs(totals.diff) > tolerance ? 'text-red-300' : 'text-muted-foreground'
              }`}>
                {totals.diff > 0 ? '+' : ''}{fmt(totals.diff)}
              </p>
            </div>
          </div>
        </div>
      </Card>

      <Card className="border-border bg-card overflow-hidden">
        {error && <div className="px-4 py-3 text-sm text-rose-400 border-b border-border">{error}</div>}
        {loading && <div className="px-4 py-6 text-center text-sm text-muted-foreground">Загрузка...</div>}
        {!loading && rows.length === 0 && !error && (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">
            Нет данных за выбранный период
          </div>
        )}
        {!loading && rows.length > 0 && (
          <>
            <div className="flex items-center gap-3 px-4 py-2 border-b border-border bg-white/[0.02] text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                Расхождений: <strong className="text-red-300">{problemCount}</strong>
              </span>
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                Совпадений (в допуске): <strong className="text-emerald-300">{cleanCount}</strong>
              </span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 text-left">Дата</th>
                  <th className="px-4 py-3 text-left">Точка</th>
                  <th className="px-4 py-3 text-right">Терминал</th>
                  <th className="px-4 py-3 text-right">Доходы (Безналичный)</th>
                  <th className="px-4 py-3 text-right">Разница</th>
                  <th className="px-4 py-3 text-center">Статус</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const abs = Math.abs(r.diff)
                  const isOk = abs <= tolerance
                  const rowBg = isOk ? '' : r.diff > 0 ? 'bg-amber-500/[0.04]' : 'bg-red-500/[0.04]'
                  return (
                    <tr key={`${r.date}|${r.company_id}`} className={`border-b border-border/50 ${rowBg}`}>
                      <td className="px-4 py-3 font-medium">{r.date}</td>
                      <td className="px-4 py-3 text-muted-foreground">{r.company_name}</td>
                      <td className="px-4 py-3 text-right font-semibold text-blue-300">{fmt(r.terminal)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-300">{fmt(r.incomes)}</td>
                      <td
                        className={`px-4 py-3 text-right font-bold ${
                          isOk ? 'text-muted-foreground' : r.diff > 0 ? 'text-amber-300' : 'text-red-300'
                        }`}
                      >
                        {r.diff > 0 ? '+' : ''}{fmt(r.diff)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isOk ? (
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 className="w-3 h-3" /> OK
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20">
                            <AlertTriangle className="w-3 h-3" />
                            {r.diff > 0 ? 'Не внесли' : 'Лишний доход'}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </>
        )}
      </Card>
    </>
  )
}
