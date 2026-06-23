'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ClipboardList, Loader2, Lock, Plus, RefreshCw, Trash2, Undo2, Users } from 'lucide-react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type Loc = { id: string; name: string; location_type: string; company?: { name?: string | null } | null }
type ActListRow = { id: string; status: string; comment: string | null; opened_at: string; closed_at: string | null; locationName: string; totalItems: number; countedItems: number }
type FormData = { operators: Array<{ id: string; name: string }>; otherOperators?: Array<{ id: string; name: string }>; categories: Array<{ id: string; name: string }> }
type Assignment = { operator_id: string; category_id: string | null }
type ReportRow = { item_id: string; name: string; expected: number; counted: number; variance: number; countedBy: string | null; conflict?: boolean; counts?: Array<{ qty: number; by: string | null }> }
type CloseRow = { item_id: string; name: string; expected: number; counted: number; movedIn: number; movedOut: number; final: number; variance: number; shrinkage: number; surplus: number }
type CloseSummary = { movedItems: number; movedIn: number; movedOut: number; shrinkageItems: number; shrinkageQty: number; surplusItems: number; surplusQty: number }
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
  const [reverting, setReverting] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [assignDebt, setAssignDebt] = useState(false)
  const [debtsCreated, setDebtsCreated] = useState<number | null>(null)
  const [closeReport, setCloseReport] = useState<CloseRow[] | null>(null)
  const [closeSummary, setCloseSummary] = useState<CloseSummary | null>(null)

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
      if (res.ok) setFormData({ operators: j?.data?.operators || [], otherOperators: j?.data?.otherOperators || [], categories: j?.data?.categories || [] })
    })()
  }, [view, locationId])

  const openDetail = useCallback(async (id: string, keepReport = false) => {
    setDetailId(id)
    setView('detail')
    setDetail(null)
    if (!keepReport) {
      setCloseReport(null)
      setCloseSummary(null)
      setDebtsCreated(null)
    }
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

  const closeAct = async (force = false) => {
    if (!detailId) return
    const ok = force
      ? confirm('Принудительно закрыть акт?\n\nБлокировки игнорируются: заявки склад ↔ витрина в пути, расхождения двойного счёта, отсутствие подсчёта. Посчитанные позиции проведутся (расхождение двойного счёта берётся по последнему счёту), непосчитанные останутся без изменений.')
      : confirm('Закрыть акт и провести ревизию? Остатки будут обновлены.')
    if (!ok) return
    setClosing(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/store/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'close', act_id: detailId, assignDebt, force }) })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.message || j?.error || 'Ошибка закрытия')
      setCloseReport((j?.data?.report || []) as CloseRow[])
      setCloseSummary((j?.data?.summary || null) as CloseSummary | null)
      setDebtsCreated(Number(j?.data?.debtsCreated || 0))
      await loadActs()
      await openDetail(detailId, true)
    } catch (e: any) {
      setError(e?.message || 'Не удалось закрыть акт')
    } finally {
      setClosing(false)
    }
  }

  const cancelAct = async () => {
    if (!detailId) return
    if (!confirm('Отменить акт? Снимок и введённые подсчёты будут отброшены. Остатки НЕ изменятся (акт ещё не проведён). Акт станет «Отменён».')) return
    setCanceling(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/store/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel', act_id: detailId }) })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.message || j?.error || 'Ошибка отмены')
      await loadActs()
      setView('list')
    } catch (e: any) {
      setError(e?.message || 'Не удалось отменить акт')
    } finally {
      setCanceling(false)
    }
  }

  const revertAct = async () => {
    if (!detailId) return
    if (!confirm('Откатить ревизию?\n\nОстатки вернутся к состоянию до проведения акта (изменения ревизии развернутся; продажи/движения после ревизии сохранятся). Созданные этим актом активные долги будут удалены. Акт станет «Отменён». Действие необратимо.')) return
    setReverting(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/store/audit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'revert', act_id: detailId }) })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.message || j?.error || 'Ошибка отката')
      alert(`Откат выполнен. Возвращено позиций: ${j?.data?.reversedItems ?? 0}. Удалено долгов: ${j?.data?.debtsRemoved ?? 0}.`)
      setCloseReport(null)
      setCloseSummary(null)
      await loadActs()
      await openDetail(detailId)
    } catch (e: any) {
      setError(e?.message || 'Не удалось откатить акт')
    } finally {
      setReverting(false)
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

  // Для текущего/исторического вида (без closeReport) — грубая прикидка по detail.report.
  const totals = useMemo(() => {
    const rows = detail?.report || []
    let short = 0
    let surplus = 0
    for (const r of rows) {
      if (r.variance < 0) short += -r.variance
      else if (r.variance > 0) surplus += r.variance
    }
    return { short, surplus }
  }, [detail?.report])

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

        {error ? <Card className="border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error}</Card> : null}

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
                      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${a.status === 'open' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : a.status === 'closed' ? 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300' : 'bg-red-500/15 text-red-700 dark:text-red-300'}`}>
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
        {error ? <Card className="border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error}</Card> : null}

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
            <div className="flex border border-slate-200 dark:border-white/10">
              <button type="button" onClick={() => setMode('single')} className={`flex-1 px-3 py-2 text-xs transition ${mode === 'single' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'text-muted-foreground hover:text-foreground'}`}>Обычный</button>
              <button type="button" onClick={() => setMode('double')} className={`flex-1 border-l border-slate-200 dark:border-white/10 px-3 py-2 text-xs transition ${mode === 'double' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'text-muted-foreground hover:text-foreground'}`}>Двойной слепой</button>
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
                <div className="text-xs text-muted-foreground">У этой точки нет назначенных операторов — можно добавить с других точек ниже.</div>
              ) : null}
              {assignments.map((a, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Select value={a.operator_id} onValueChange={(v) => setAssignments((p) => p.map((x, i) => (i === idx ? { ...x, operator_id: v } : x)))}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Оператор" /></SelectTrigger>
                    <SelectContent>
                      {formData.operators.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                      {formData.otherOperators && formData.otherOperators.length > 0 ? (
                        <>
                          <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">С других точек (в помощь)</div>
                          {formData.otherOperators.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                        </>
                      ) : null}
                    </SelectContent>
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
  const detailRows: ReportRow[] = (detail?.report || []) as ReportRow[]
  const isOpen = detail?.act.status === 'open'
  const hasConflicts = isOpen && !closeReport && detailRows.some((r) => r.conflict)
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
      {error ? <Card className="border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error}</Card> : null}

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
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-slate-200 dark:bg-white/[0.05]">
                      <div className="h-full bg-amber-500 transition-all" style={{ width: `${p.total ? Math.min(100, (p.counted / p.total) * 100) : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {detail.assignments.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] px-2.5 py-1 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" /> {a.operatorName} · {a.categoryName || 'Вся локация'}
                  </span>
                ))}
              </div>
            )}
            {isOpen ? (
              <div className="space-y-2 border-t border-slate-200 dark:border-white/5 pt-3">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={assignDebt} onChange={(e) => setAssignDebt(e.target.checked)} className="h-4 w-4 accent-amber-500" />
                  Повесить недостачу долгом на ответственных (удержится из зарплаты)
                </label>
                {hasConflicts ? <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">Есть расхождения между счётчиками — решите их (примите значение или на пересчёт), затем закрывайте.</div> : null}
                <Button onClick={() => void closeAct(false)} disabled={closing || detail.countedItems === 0 || hasConflicts} className="w-full gap-2 bg-amber-600 hover:bg-amber-700">
                  {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                  Закрыть акт и провести
                </Button>
                <button
                  type="button"
                  onClick={() => void closeAct(true)}
                  disabled={closing}
                  className="w-full rounded-md border border-rose-500/30 px-3 py-2 text-xs text-rose-700 dark:text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-50"
                >
                  Принудительно закрыть (обойти блокировки)
                </button>
                <p className="text-[11px] text-muted-foreground">Принудительно — когда акт «завис»: есть заявки в пути, расхождения или операторы не досчитали. Проведёт что посчитано, остальное не тронет. Только для владельца.</p>
                <button
                  type="button"
                  onClick={() => void cancelAct()}
                  disabled={canceling}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-200 dark:border-white/10 px-3 py-2 text-xs text-muted-foreground transition hover:border-rose-500/40 hover:text-rose-700 dark:hover:text-rose-300 disabled:opacity-50"
                >
                  {canceling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                  Отменить акт (вернуть как было)
                </button>
                <p className="text-[11px] text-muted-foreground">Отмена — акт ещё не проведён: снимок и подсчёты отбрасываются, остатки не меняются. Используйте, если ревизию открыли по ошибке.</p>
              </div>
            ) : null}
            {debtsCreated && debtsCreated > 0 ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">Создано долгов: {debtsCreated} — удержатся из зарплаты ответственных.</div>
            ) : null}
            {detail.act.status === 'closed' ? (
              <div className="space-y-2 border-t border-slate-200 dark:border-white/5 pt-3">
                <button
                  type="button"
                  onClick={() => void revertAct()}
                  disabled={reverting}
                  className="flex w-full items-center justify-center gap-2 rounded-md border border-rose-500/40 px-3 py-2.5 text-sm font-medium text-rose-700 dark:text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-50"
                >
                  {reverting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                  Откатить ревизию
                </button>
                <p className="text-[11px] text-muted-foreground">Вернёт остатки к состоянию до проведения (изменения ревизии развернутся, продажи после — сохранятся) и удалит созданные акты долги. Акт станет «Отменён». Только для владельца.</p>
              </div>
            ) : null}
          </Card>

          {/* Результат ревизии (после закрытия) — расхождения по позициям */}
          {closeReport ? (
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-medium text-foreground">Результат ревизии</div>
                <div className="flex gap-3 text-xs tabular-nums">
                  <span className="text-rose-400">недостача {fmt(closeSummary?.shrinkageQty || 0)}</span>
                  <span className="text-emerald-400">излишек {fmt(closeSummary?.surplusQty || 0)}</span>
                </div>
              </div>

              {/* Сводка: движения во время ревизии учтены в факте, не считаются пропажей */}
              {closeSummary && closeSummary.movedItems > 0 ? (
                <div className="mb-3 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-700 dark:text-sky-300">
                  Во время ревизии были движения по {closeSummary.movedItems} поз.
                  {closeSummary.movedIn > 0 ? ` приход +${fmt(closeSummary.movedIn)}` : ''}
                  {closeSummary.movedOut > 0 ? ` продажи −${fmt(closeSummary.movedOut)}` : ''}
                  {' '}— учтены в итоге, не записаны как недостача.
                </div>
              ) : null}

              {closeReport.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">Нет данных.</div>
              ) : (
                <div className="space-y-1">
                  {closeReport
                    .slice()
                    .sort((a, b) => (b.shrinkage + b.surplus) - (a.shrinkage + a.surplus) || Math.abs(b.variance) - Math.abs(a.variance))
                    .map((r) => {
                      const moved = r.movedIn > 0 || r.movedOut > 0
                      return (
                        <div key={r.item_id} className="border-b border-slate-100 dark:border-white/5 py-1.5 last:border-0">
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="min-w-0 truncate text-foreground">{r.name}</span>
                            <div className="flex shrink-0 items-center gap-3 tabular-nums">
                              <span className="text-xs text-muted-foreground">сист. {fmt(r.expected)}</span>
                              <span className="text-xs text-muted-foreground">факт {fmt(r.counted)}</span>
                              <span className="text-xs text-foreground">итог {fmt(r.final)}</span>
                              {r.shrinkage > 0 ? (
                                <span className="w-20 text-right font-medium text-rose-400">−{fmt(r.shrinkage)}</span>
                              ) : r.surplus > 0 ? (
                                <span className="w-20 text-right font-medium text-emerald-400">+{fmt(r.surplus)}</span>
                              ) : (
                                <span className="w-20 text-right text-muted-foreground">сошлось</span>
                              )}
                            </div>
                          </div>
                          {moved ? (
                            <div className="mt-0.5 text-[11px] text-sky-400/80 tabular-nums">
                              во время ревизии:{r.movedIn > 0 ? ` приход +${fmt(r.movedIn)}` : ''}{r.movedOut > 0 ? ` продажи −${fmt(r.movedOut)}` : ''}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                </div>
              )}
            </Card>
          ) : (
            /* Подсчёт в процессе / исторический акт */
            <Card className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-medium text-foreground">{isOpen ? 'Подсчитано (расхождение раскроется при закрытии)' : 'Расхождение'}</div>
                {!isOpen ? (
                  <div className="flex gap-3 text-xs tabular-nums">
                    <span className="text-rose-400">недостача {fmt(totals.short)}</span>
                    <span className="text-emerald-400">излишек {fmt(totals.surplus)}</span>
                  </div>
                ) : null}
              </div>
              {detailRows.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">Пока ничего не посчитано.</div>
              ) : (
                <div className="space-y-1">
                  {detailRows
                    .slice()
                    .sort((a, b) => (b.conflict ? 1 : 0) - (a.conflict ? 1 : 0) || Math.abs(b.variance) - Math.abs(a.variance))
                    .map((r) =>
                      r.conflict && isOpen ? (
                        <div key={r.item_id} className="border-b border-slate-100 dark:border-white/5 py-2 last:border-0">
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <span className="min-w-0 truncate text-foreground">{r.name}</span>
                            <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 dark:text-rose-300">расхождение</span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            {(r.counts || []).map((c: any, i: number) => (
                              <button key={i} type="button" onClick={() => void resolveItem(r.item_id, c.qty)} title="Принять это значение" className="rounded border border-slate-200 dark:border-white/10 px-2 py-1 text-xs tabular-nums text-foreground transition hover:border-amber-400/40 hover:text-amber-700 dark:hover:text-amber-300">
                                {c.by || 'счёт'}: {fmt(c.qty)}
                              </button>
                            ))}
                            <button type="button" onClick={() => void recountItem(r.item_id)} className="rounded border border-amber-500/30 px-2 py-1 text-xs text-amber-700 dark:text-amber-300 transition hover:bg-amber-500/10">на пересчёт</button>
                          </div>
                        </div>
                      ) : (
                        <div key={r.item_id} className="flex items-center justify-between gap-3 border-b border-slate-100 dark:border-white/5 py-1.5 text-sm last:border-0">
                          <span className="min-w-0 truncate text-foreground">{r.name}</span>
                          <div className="flex items-center gap-4 tabular-nums">
                            {!isOpen ? <span className="text-xs text-muted-foreground">сист. {fmt(r.expected)}</span> : null}
                            <span className="text-xs text-muted-foreground">факт {fmt(r.counted)}</span>
                            <span className={`w-16 text-right font-medium ${r.variance < 0 ? 'text-rose-400' : r.variance > 0 ? 'text-emerald-400' : 'text-muted-foreground'}`}>{r.variance > 0 ? '+' : ''}{fmt(r.variance)}</span>
                          </div>
                        </div>
                      ),
                    )}
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  )
}
