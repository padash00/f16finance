'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useCompanies } from '@/hooks/use-companies'
import { Plus, Pencil, Trash2, Save, X, CreditCard, RefreshCw } from 'lucide-react'

type Row = {
  id: string
  date: string
  company_id: string
  amount: number
  note: string | null
}

const fmt = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

const todayISO = () => new Date().toISOString().slice(0, 10)
const monthAgoISO = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10) }

export default function KaspiTerminalPage() {
  const { companies } = useCompanies()

  // Фильтры
  const [from, setFrom] = useState(monthAgoISO())
  const [to, setTo] = useState(todayISO())
  const [filterCompany, setFilterCompany] = useState('')

  // Данные
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  const load = useCallback(async () => {
    setLoading(true)
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
      setLoading(false)
    }
  }, [from, to, filterCompany])

  useEffect(() => { load() }, [load])

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
      await mutate({ action: 'create', payload: { date: newDate, company_id: newCompany, amount: Number(newAmount), note: newNote || null } })
      setNewAmount('')
      setNewNote('')
      load()
    } catch (e: any) { alert(e.message) }
    setSaving(false)
  }

  const handleSaveEdit = async () => {
    if (!editId) return
    setSaving(true)
    try {
      await mutate({ action: 'update', id: editId, payload: { date: editDate, company_id: editCompany, amount: Number(editAmount), note: editNote || null } })
      setEditId(null)
      load()
    } catch (e: any) { alert(e.message) }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить запись?')) return
    try {
      await mutate({ action: 'delete', id })
      load()
    } catch (e: any) { alert(e.message) }
  }

  const companyName = (id: string) => companies.find(c => c.id === id)?.name || id

  const totalAmount = useMemo(() => rows.reduce((s, r) => s + r.amount, 0), [rows])

  return (
    <div className="app-page max-w-5xl space-y-6">
      {/* Заголовок */}
      <div className="flex items-center gap-4">
        <div className="p-3 bg-blue-500/10 rounded-xl">
          <CreditCard className="w-8 h-8 text-blue-400" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-foreground">Kaspi POS терминал</h1>
          <p className="text-muted-foreground mt-1">Суточные итоги с терминала — без привязки к оператору</p>
        </div>
      </div>

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
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} /> Обновить
          </Button>
          {totalAmount > 0 && (
            <div className="ml-auto text-sm font-medium text-blue-300">
              Итого: {fmt(totalAmount)}
            </div>
          )}
        </div>
      </Card>

      {/* Форма добавления */}
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
            <label className="text-xs text-muted-foreground">Сумма Kaspi ₸</label>
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
                <th className="px-4 py-3 text-right">Kaspi сумма</th>
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
                          <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-blue-400"
                            onClick={() => { setEditId(row.id); setEditDate(row.date); setEditCompany(row.company_id); setEditAmount(String(row.amount)); setEditNote(row.note || '') }}>
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-red-400" onClick={() => handleDelete(row.id)}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
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
    </div>
  )
}
