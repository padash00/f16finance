'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ClipboardList, Loader2, Lock, Plus, RefreshCw, Trash2, Users } from 'lucide-react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type Loc = { id: string; name: string; location_type: string; company?: { name?: string | null } | null }
type ActListRow = { id: string; status: string; comment: string | null; opened_at: string; closed_at: string | null; locationName: string; totalItems: number; countedItems: number }
type FormData = { operators: Array<{ id: string; name: string }>; categories: Array<{ id: string; name: string }> }
type Assignment = { operator_id: string; category_id: string | null }
type ReportRow = { item_id: string; name: string; expected: number; counted: number; variance: number; countedBy: string | null; conflict?: boolean; counts?: Array<{ qty: number; by: string | null }> }
type Detail = {
  act: { id: string; status: string; comment: string | null; opened_at: string; closed_at: string | null }
  location: Loc | null
  assignments: Array<{ id: string; operatorName: string; categoryName: string | null }>
  progress?: Array<{ operatorName: string; counted: number; total: number }>
  totalItems: number
  countedItems: number
  report: ReportRow[]
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2))
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
const locLabel = (l: Loc | null) => (l ? `${l.company?.name ? l.company.name + ' · ' : ''}${l.location_type === 'point_display' ? 'Витрина' : l.location_type === 'warehouse' ? 'Склад' : l.name}` : '—')

export default function StoreAuditPage() {
  const [view, setView] = useState<'list' | 'create' | 'detail'>('list')
  const [acts, setActs] = useState<ActListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [locations, setLocations] = useState<Loc[]>([])
  const [locationId, setLocationId] = useState('')
  const [formData, setFormData] = useState<FormData | null>(null)
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [comment, setComment] = useState('')
  const [mode, setMode] = useState<'single' | 'double'>('single')
  const [creating, setCreating] = useState(false)

  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailId, setDetailId] = useState('')
  const [closing, setClosing] = useState(false)
  const [assignDebt, setAssignDebt] = useState(false)
  const [debtsCreated, setDebtsCreated] = useState<number | null>(null)
  const [closeReport, setCloseReport] = useState<Array<{ name?: string; item_id: string; counted: number; expected: number; variance: number; final: number; soldAfter: number }> | null>(null)

  const loadActs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/store/audit', { cache: 'no-store' })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.error || 'Ошибка')
      setActs(j?.data || [])
      setError(null)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить акты')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadActs()
    void (async () => {
      const res = await fetch('/api/admin/store/revisions?scope=all', { cache: 'no-store' })
      const j = await res.json().catch(() => null)
      if (res.ok) setLocations((j?.data?.locations || []) as Loc[])
    })()
  }, [loadActs])

  // загрузка операторов/категорий при выборе локации в форме создания
  useEffect(() => {
    if (view !== 'create' || !locationId) return
    setFormData(null)
    setAssignments([])
    void (async () => {
      const res = await fetch(`/api/admin/store/audit?form=${encodeURIComponent(locationId)}`, { cache: 'no-store' })
      const j = await res.json().catch(() => null)
      if (res.ok) setFormData({ operators: j?.data?.operators || [], categories: j?.data?.categories || [] })
    })()
  }, [view, locationId])

  const openDetail = useCallback(async (id: string) => {
    setDetailId(id)
    setView('detail')
    setDetail(null)
    setCloseReport(null)
    const res = await fetch(`/api/admin/store/audit?act=${encodeURIComponent(id)}`, { cache: 'no-store' })
    const j = await res.json().catch(() => null)
    if (res.ok) setDetail(j?.data || null)
    else setError(j?.error || 'Ошибка загрузки акта')
  }, [])

  // Живой опрос: пока открыта деталь НЕзакрытого акта — каждые 4с тихо подтягиваем
  // подсчёты операторов и прогресс (без мигания), чтобы видеть подсчёт в реальном времени.
  useEffect(() => {
    if (view !== 'detail' || !detailId || detail?.act.status !== 'open') return
    const t = setInterval(() => {
      fetch(`/api/admin/store/audit?act=${encodeURIComponent(detailId)}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (j?.data) setDetail(j.data) })
        .catch(() => {})
    }, 4000)
    return () => clearInterval(t)
  }, [view, detailId, detail?.act.status])

  const createAct = async () => {
    if (!locationId || assignments.filter((a) => a.operator_id).length === 0) {
      setError('Выберите локацию и хотя бы одного оператора')
      return
    }
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/store/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', location_id: locationId, comment, mode, assignments: assignments.filter((a) => a.operator_id) }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.error || 'Ошибка создания')
      await loadActs()
      await openDetail(j.data.id)
    } catch (e: any) {
      setError(e?.message || 'Не удалось создать акт')
    } finally {
      setCreating(false)
    }
  }

  const closeAct = async () => {
    if (!detailId) return
    if (!confirm('Закрыть акт и провести ревизию? Остатки будут обновлены.')) return
    setClosing(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/store/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'close', act_id: detailId, assignDebt }) })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.message || j?.error || 'Ошибка закрытия')
      const rep = (j?.data?.report || []) as any[]
      const named = rep.map((r) => ({ ...r, name: detail?.report.find((x) => x.item_id === r.item_id)?.name || r.item_id }))
      setCloseReport(named)
      setDebtsCreated(Number(j?.data?.debtsCreated || 0))
      await loadActs()
      await openDetail(detailId)
    } catch (e: any) {
      setError(e?.message || 'Не удалось закрыть акт')
    } finally {
      setClosing(false)
    }
  }

  const recountItem = async (itemId: string) => {
    await fetch('/api/admin/store/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recount', act_id: detailId, item_id: itemId }) })
    await openDetail(detailId)
  }
  const resolveItem = async (itemId: string, qty: number) => {
    await fetch('/api/admin/store/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resolve', act_id: detailId, item_id: itemId, qty }) })
    await openDetail(detailId)
  }

  const totals = useMemo(() => {
    const rows = closeReport || detail?.report || []
    let short = 0
    let surplus = 0
    for (const r of rows) {
      if (r.variance < 0) short += -r.variance
      else if (r.variance > 0) surplus += r.variance
    }
    return { short, surplus }
  }, [closeReport, detail?.report])

  // ── Список ───────────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="app-page-wide space-y-4">
        <AdminPageHeader
          title="Аудит-ревизии"
          description="Слепой подсчёт несколькими операторами по секциям"
          icon={<ClipboardList className="h-5 w-5" />}
          accent="emerald"
          backHref="/store/revisions"
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => void loadActs()} className="h-9 gap-1.5">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                Обновить
              </Button>
              <Button size="sm" onClick={() => { setView('create'); setLocationId(''); setAssignments([]); setComment(''); setMode('single') }} className="h-9 gap-1.5 bg-amber-600 hover:bg-amber-700">
                <Plus className="h-3.5 w-3.5" />
                Новый акт
              </Button>
            </>
          }
        />

        {error ? <Card className="border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</Card> : null}

        {loading ? (
          <Card className="flex items-center gap-3 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Загрузка…</Card>
        ) : acts.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Актов пока нет. Создайте первый аудит-акт.</Card>
        ) : (
          <div className="space-y-2">
            {acts.map((a) => (
              <button key={a.id} type="button" onClick={() => void openDetail(a.id)} className="block w-full text-left">
                <Card className="flex items-center justify-between gap-3 p-4 transition hover:border-amber-400/40">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${a.status === 'open' ? 'bg-emerald-500/15 text-emerald-300' : a.status === 'closed' ? 'bg-zinc-500/15 text-zinc-300' : 'bg-red-500/15 text-red-300'}`}>
                        {a.status === 'open' ? 'Открыт' : a.status === 'closed' ? 'Закрыт' : 'Отменён'}
                      </span>
                      <span className="truncate text-sm font-medium text-foreground">{a.locationName}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">{fmtDate(a.opened_at)} · посчитано {a.countedItems} из {a.totalItems}{a.comment ? ` · ${a.comment}` : ''}</div>
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">{a.totalItems ? Math.round((a.countedItems / a.totalItems) * 100) : 0}%</div>
                </Card>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Создание ────────────────────────────────────────────────────────────
  if (view === 'create') {
    return (
      <div className="app-page-tight space-y-4">
        <AdminPageHeader
          title="Новый аудит-акт"
          description="Зафиксируйте снимок остатков и назначьте операторов на секции"
          icon={<ClipboardList className="h-5 w-5" />}
          accent="emerald"
          backHref="/store/audit"
          actions={
            <Button variant="ghost" size="sm" onClick={() => setView('list')} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Назад</Button>
          }
        />
        {error ? <Card className="border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</Card> : null}

        <Card className="space-y-4 p-4">
          <div className="space-y-1.5">
            <Label>Что считаем (локация)</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger><SelectValue placeholder="Выберите витрину или склад" /></SelectTrigger>
              <SelectContent>
                {locations.map((l) => <SelectItem key={l.id} value={l.id}>{locLabel(l)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Режим подсчёта</Label>
            <div className="flex border border-white/10">
              <button type="button" onClick={() => setMode('single')} className={`flex-1 px-3 py-2 text-xs transition ${mode === 'single' ? 'bg-amber-500/15 text-amber-300' : 'text-muted-foreground hover:text-foreground'}`}>Обычный</button>
              <button type="button" onClick={() => setMode('double')} className={`flex-1 border-l border-white/10 px-3 py-2 text-xs transition ${mode === 'double' ? 'bg-amber-500/15 text-amber-300' : 'text-muted-foreground hover:text-foreground'}`}>Двойной слепой</button>
            </div>
            <p className="text-[11px] text-muted-foreground">{mode === 'double' ? 'Назначьте 2 операторов на одну секцию — посчитают независимо, расхождение пойдёт на пересчёт.' : 'Один оператор на секцию.'}</p>
          </div>

          {locationId && !formData ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Загрузка операторов…</div> : null}

          {formData ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> Операторы и секции</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => setAssignments((p) => [...p, { operator_id: '', category_id: null }])} className="h-8 gap-1"><Plus className="h-3.5 w-3.5" /> Добавить</Button>
              </div>
              {formData.operators.length === 0 ? (
                <div className="text-xs text-muted-foreground">У этой точки нет назначенных операторов.</div>
              ) : null}
              {assignments.map((a, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Select value={a.operator_id} onValueChange={(v) => setAssignments((p) => p.map((x, i) => (i === idx ? { ...x, operator_id: v } : x)))}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Оператор" /></SelectTrigger>
                    <SelectContent>{formData.operators.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={a.category_id || 'all'} onValueChange={(v) => setAssignments((p) => p.map((x, i) => (i === idx ? { ...x, category_id: v === 'all' ? null : v } : x)))}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Секция" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Вся локация</SelectItem>
                      {formData.categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="ghost" size="icon" onClick={() => setAssignments((p) => p.filter((_, i) => i !== idx))}><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label>Комментарий</Label>
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Например: плановая ревизия за июнь" />
          </div>

          <Button onClick={createAct} disabled={creating || !locationId} className="w-full gap-2 bg-amber-600 hover:bg-amber-700">
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Открыть акт
          </Button>
          <p className="text-xs text-muted-foreground">При открытии фиксируется снимок остатков. Операторы считают вслепую — системную цифру они не видят.</p>
        </Card>
      </div>
    )
  }

  // ── Детали / закрытие ────────────────────────────────────────────────────
  const rows: any[] = (closeReport || detail?.report || []) as any[]
  const isOpen = detail?.act.status === 'open'
  const hasConflicts = isOpen && !closeReport && rows.some((r) => r.conflict)
  return (
    <div className="app-page-tight space-y-4">
      <AdminPageHeader
        title="Аудит-акт"
        description="Подсчёт, расхождения и проведение ревизии"
        icon={<ClipboardList className="h-5 w-5" />}
        accent="emerald"
        backHref="/store/audit"
        actions={
          <Button variant="ghost" size="sm" onClick={() => { setView('list'); void loadActs() }} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> К списку</Button>
        }
      />
      {error ? <Card className="border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</Card> : null}

      {!detail ? (
        <Card className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Загрузка…</Card>
      ) : (
        <>
          <Card className="space-y-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-foreground">{locLabel(detail.location)}</div>
                <div className="text-xs text-muted-foreground">{fmtDate(detail.act.opened_at)} · {isOpen ? 'открыт' : 'закрыт'}{detail.act.comment ? ` · ${detail.act.comment}` : ''}</div>
              </div>
              <div className="text-right text-xs text-muted-foreground tabular-nums">посчитано {detail.countedItems} из {detail.totalItems}</div>
            </div>
            {/* Прогресс по операторам */}
            {detail.progress && detail.progress.length > 0 ? (
              <div className="space-y-2">
                {detail.progress.map((p, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-foreground"><Users className="h-3 w-3 text-muted-foreground" /> {p.operatorName}</span>
                      <span className="text-muted-foreground tabular-nums">{p.counted} / {p.total}</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-white/[0.05]">
                      <div className="h-full bg-amber-500 transition-all" style={{ width: `${p.total ? Math.min(100, (p.counted / p.total) * 100) : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {detail.assignments.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" /> {a.operatorName} · {a.categoryName || 'Вся локация'}
                  </span>
                ))}
              </div>
            )}
            {isOpen ? (
              <div className="space-y-2 border-t border-white/5 pt-3">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={assignDebt} onChange={(e) => setAssignDebt(e.target.checked)} className="h-4 w-4 accent-amber-500" />
                  Повесить недостачу долгом на ответственных (удержится из зарплаты)
                </label>
                {hasConflicts ? <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">Есть расхождения между счётчиками — решите их (примите значение или на пересчёт), затем закрывайте.</div> : null}
                <Button onClick={closeAct} disabled={closing || detail.countedItems === 0 || hasConflicts} className="w-full gap-2 bg-amber-600 hover:bg-amber-700">
                  {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                  Закрыть акт и провести
                </Button>
              </div>
            ) : null}
            {debtsCreated && debtsCreated > 0 ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">Создано долгов: {debtsCreated} — удержатся из зарплаты ответственных.</div>
            ) : null}
          </Card>

          {/* Расхождение */}
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-medium text-foreground">{closeReport ? 'Результат ревизии' : isOpen ? 'Подсчитано (расхождение раскроется при закрытии)' : 'Расхождение'}</div>
              <div className="flex gap-3 text-xs tabular-nums">
                <span className="text-rose-400">недостача {fmt(totals.short)}</span>
                <span className="text-emerald-400">излишек {fmt(totals.surplus)}</span>
              </div>
            </div>
            {rows.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Пока ничего не посчитано.</div>
            ) : (
              <div className="space-y-1">
                {rows
                  .slice()
                  .sort((a, b) => (b.conflict ? 1 : 0) - (a.conflict ? 1 : 0) || Math.abs(b.variance) - Math.abs(a.variance))
                  .map((r) =>
                    r.conflict && isOpen && !closeReport ? (
                      <div key={r.item_id} className="border-b border-white/5 py-2 last:border-0">
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="min-w-0 truncate text-foreground">{r.name}</span>
                          <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-300">расхождение</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          {(r.counts || []).map((c: any, i: number) => (
                            <button key={i} type="button" onClick={() => void resolveItem(r.item_id, c.qty)} title="Принять это значение" className="rounded border border-white/10 px-2 py-1 text-xs tabular-nums text-foreground transition hover:border-amber-400/40 hover:text-amber-300">
                              {c.by || 'счёт'}: {fmt(c.qty)}
                            </button>
                          ))}
                          <button type="button" onClick={() => void recountItem(r.item_id)} className="rounded border border-amber-500/30 px-2 py-1 text-xs text-amber-300 transition hover:bg-amber-500/10">на пересчёт</button>
                        </div>
                      </div>
                    ) : (
                      <div key={r.item_id} className="flex items-center justify-between gap-3 border-b border-white/5 py-1.5 text-sm last:border-0">
                        <span className="min-w-0 truncate text-foreground">{r.name}</span>
                        <div className="flex items-center gap-4 tabular-nums">
                          {!isOpen || closeReport ? <span className="text-xs text-muted-foreground">сист. {fmt(r.expected)}</span> : null}
                          <span className="text-xs text-muted-foreground">факт {fmt(r.counted)}</span>
                          <span className={`w-16 text-right font-medium ${r.variance < 0 ? 'text-rose-400' : r.variance > 0 ? 'text-emerald-400' : 'text-muted-foreground'}`}>{r.variance > 0 ? '+' : ''}{fmt(r.variance)}</span>
                        </div>
                      </div>
                    ),
                  )}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
