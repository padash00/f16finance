'use client'

import { Fragment, use, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { useModalEscape } from '@/lib/client/use-modal-escape'
import {
  AlertTriangle,
  ArrowLeft,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  ExternalLink,
  FileDown,
  Loader2,
  Package,
  Printer,
  Receipt as ReceiptIcon,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  StickyNote,
  X,
  XCircle,
} from 'lucide-react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { buildStyledSheet, createWorkbook, downloadWorkbook } from '@/lib/excel/styled-export'

type ShiftDetail = {
  id: string
  company_id: string
  status: 'open' | 'closed' | 'voided'
  shift_type: 'day' | 'night' | 'custom'
  opened_at: string
  closed_at: string | null
  opening_cash: number
  opening_notes: string | null
  closing_cash: number | null
  closing_kaspi: number | null
  closing_kaspi_before_midnight: number | null
  closing_kaspi_after_midnight: number | null
  closing_notes: string | null
  z_report_url: string | null
  x_report_url: string | null
  totals_json: Record<string, any> | null
  handover_from_shift_id: string | null
  company?: { id: string; name: string; code: string | null } | null
  operator?: { id: string; full_name: string; short_name: string | null } | null
  closer?: { id: string; full_name: string; short_name: string | null } | null
}

type SaleItem = {
  id: string
  quantity: number
  unit_price: number
  total_price: number
  universal_name: string | null
  item: { id: string; name: string } | null
}

type Sale = {
  id: string
  sale_date: string
  shift: string
  payment_method: string
  cash_amount: number
  kaspi_amount: number
  total_amount: number
  comment: string | null
  sold_at: string
  source: string
  discount_amount: number | null
  loyalty_points_earned: number | null
  loyalty_points_spent: number | null
  loyalty_discount_amount: number | null
  operator: { id: string; full_name: string; short_name: string | null } | null
  customer: { id: string; name: string | null } | null
  items: SaleItem[] | null
}

type ReturnItem = {
  id: string
  quantity: number
  unit_price: number
  item: { id: string; name: string } | null
}

type Return = {
  id: string
  return_date: string
  shift: string
  payment_method: string
  cash_amount: number
  kaspi_amount: number
  total_amount: number
  comment: string | null
  returned_at: string
  source: string
  items: ReturnItem[] | null
}

type Incident = {
  id: string
  kind: 'violation' | 'bonus' | 'note'
  title: string
  description: string | null
  fine_amount: number
  bonus_amount: number
  severity: 'info' | 'normal' | 'warning' | 'critical'
  status: 'draft' | 'confirmed' | 'disputed' | 'voided'
  source: 'manual' | 'checklist' | 'auto' | 'import'
  occurred_at: string
  checklist_run_id: string | null
  subject?: { id: string; full_name: string; short_name: string | null } | null
  reporter?: { id: string; full_name: string; short_name: string | null } | null
  article?: { id: string; title: string; slug: string } | null
}

type IncidentsSummary = {
  fines_total: number
  bonuses_total: number
  count: number
}

type IncomeMeta = {
  coins?: number | null
  debts?: number | null
  start_cash?: number | null
  wipon?: number | null
  diff?: number | null
} | null

type IncomeRecord = {
  id: string
  date: string
  cash_amount: number | null
  kaspi_amount: number | null
  kaspi_before_midnight: number | null
  total_amount: number | null
  comment: string | null
  meta: IncomeMeta
} | null

type ClientDebt = {
  id: string
  client_name: string | null
  item_name: string | null
  quantity: number
  unit_price: number
  total_amount: number
  comment: string | null
  status: string
  created_at: string
}

type ChecklistRun = {
  id: string
  template_id: string
  status: 'in_progress' | 'completed' | 'skipped' | 'failed'
  started_at: string
  completed_at: string | null
  scheduled_at: string | null
  responses: Record<string, any> | null
  fines_total: number
  bonuses_total: number
  template: {
    id: string
    title: string
    schedule_type: 'opening' | 'periodic' | 'closing' | 'onboarding' | 'handover'
    recurrence_minutes: number | null
    blocks_shift: boolean
  } | null
  runner: { id: string; full_name: string; short_name: string | null } | null
  cosigner: { id: string; full_name: string; short_name: string | null } | null
}

const SCHEDULE_LABEL: Record<string, string> = {
  opening: 'Открытие',
  periodic: 'Обход',
  closing: 'Закрытие',
  onboarding: 'Онбординг',
  handover: 'Передача',
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Открыта',
  closed: 'Закрыта',
  voided: 'Аннулирована',
}

const SHIFT_TYPE_LABEL: Record<string, string> = {
  day: 'Дневная',
  night: 'Ночная',
  custom: 'Нестандарт',
}

function fmtMoney(value: number | null | undefined) {
  return Number(value || 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'
}

function fmtDateTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}

export default function ShiftReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const { can } = useCapabilities()
  const canCloseForce = can('shifts-reports.close_force')
  const canPurge = can('shifts-reports.purge')

  const [shift, setShift] = useState<ShiftDetail | null>(null)
  const [sales, setSales] = useState<Sale[]>([])
  const [returns, setReturns] = useState<Return[]>([])
  const [runs, setRuns] = useState<ChecklistRun[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [incidentsSummary, setIncidentsSummary] = useState<IncidentsSummary | null>(null)
  const [income, setIncome] = useState<IncomeRecord>(null)
  const [clientDebts, setClientDebts] = useState<ClientDebt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showZReport, setShowZReport] = useState(false)
  const [adminAction, setAdminAction] = useState<null | 'closeForce' | 'purge'>(null)
  const [adminBusy, setAdminBusy] = useState(false)
  const [purgeConfirm, setPurgeConfirm] = useState('')
  useModalEscape(!!adminAction, () => { if (!adminBusy) setAdminAction(null) })
  useModalEscape(showZReport, () => setShowZReport(false))

  const [salesSearch, setSalesSearch] = useState('')
  const [expandedSales, setExpandedSales] = useState<Set<string>>(new Set())
  const toggleSaleExpand = (saleId: string) => {
    setExpandedSales((prev) => {
      const next = new Set(prev)
      if (next.has(saleId)) next.delete(saleId)
      else next.add(saleId)
      return next
    })
  }

  const itemName = (it: SaleItem | ReturnItem) =>
    (it as any).item?.name || (it as any).universal_name || 'Без названия'

  const filteredSales = useMemo(() => {
    const q = salesSearch.trim().toLowerCase()
    if (!q) return sales
    return sales.filter((s) => {
      if ((s.payment_method || '').toLowerCase().includes(q)) return true
      if ((s.customer?.name || '').toLowerCase().includes(q)) return true
      if ((s.operator?.full_name || s.operator?.short_name || '').toLowerCase().includes(q))
        return true
      if ((s.comment || '').toLowerCase().includes(q)) return true
      if ((s.items || []).some((it) => itemName(it).toLowerCase().includes(q))) return true
      return false
    })
  }, [sales, salesSearch])

  const topItems = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; amount: number }>()
    for (const s of sales) {
      for (const it of s.items || []) {
        const name = itemName(it)
        const cur = map.get(name) || { name, qty: 0, amount: 0 }
        cur.qty += Number(it.quantity || 0)
        cur.amount += Number(it.total_price || 0)
        map.set(name, cur)
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)
  }, [sales])

  async function exportExcel() {
    if (!shift) return
    const wb = createWorkbook()
    const dateOpen = new Date(shift.opened_at).toLocaleDateString('ru-RU')
    const dateClose = shift.closed_at
      ? new Date(shift.closed_at).toLocaleDateString('ru-RU')
      : '—'
    const subtitle = `${shift.company?.name || '—'} • ${SHIFT_TYPE_LABEL[shift.shift_type] || shift.shift_type}`
    const info = `Период: ${dateOpen} → ${dateClose} | Чеков: ${sales.length} | Возвратов: ${returns.length}`

    buildStyledSheet(
      wb,
      'Продажи',
      subtitle,
      info,
      [
        { header: 'Время', key: 'time', width: 18, type: 'text' },
        { header: 'Состав', key: 'composition', width: 50, type: 'text' },
        { header: 'Оператор', key: 'operator', width: 22, type: 'text' },
        { header: 'Клиент', key: 'customer', width: 22, type: 'text' },
        { header: 'Оплата', key: 'payment', width: 14, type: 'text' },
        { header: 'Наличные', key: 'cash', width: 14, type: 'money' },
        { header: 'Безналичный', key: 'kaspi', width: 14, type: 'money' },
        { header: 'Скидка', key: 'discount', width: 12, type: 'money' },
        { header: 'Итого', key: 'total', width: 14, type: 'money' },
        { header: 'Комментарий', key: 'comment', width: 28, type: 'text' },
      ],
      sales.map((s) => ({
        time: fmtDateTime(s.sold_at),
        composition: (s.items || [])
          .map((it) => {
            const name = itemName(it)
            return Number(it.quantity || 0) > 1 ? `${name}×${it.quantity}` : name
          })
          .join(', '),
        operator: s.operator?.short_name || s.operator?.full_name || '',
        customer: s.customer?.name || '',
        payment: s.payment_method,
        cash: Number(s.cash_amount || 0),
        kaspi: Number(s.kaspi_amount || 0),
        discount:
          Number(s.discount_amount || 0) + Number(s.loyalty_discount_amount || 0),
        total: Number(s.total_amount || 0),
        comment: s.comment || '',
      })),
    )

    if (returns.length > 0) {
      buildStyledSheet(
        wb,
        'Возвраты',
        subtitle,
        `Возвратов: ${returns.length}`,
        [
          { header: 'Время', key: 'time', width: 18, type: 'text' },
          { header: 'Состав', key: 'composition', width: 50, type: 'text' },
          { header: 'Оплата', key: 'payment', width: 14, type: 'text' },
          { header: 'Наличные', key: 'cash', width: 14, type: 'money' },
          { header: 'Безналичный', key: 'kaspi', width: 14, type: 'money' },
          { header: 'Итого', key: 'total', width: 14, type: 'money' },
          { header: 'Комментарий', key: 'comment', width: 28, type: 'text' },
        ],
        returns.map((r) => ({
          time: fmtDateTime(r.returned_at),
          composition: (r.items || [])
            .map((it) => {
              const name = itemName(it)
              return Number(it.quantity || 0) > 1 ? `${name}×${it.quantity}` : name
            })
            .join(', '),
          payment: r.payment_method,
          cash: Number(r.cash_amount || 0),
          kaspi: Number(r.kaspi_amount || 0),
          total: Number(r.total_amount || 0),
          comment: r.comment || '',
        })),
      )
    }

    if (topItems.length > 0) {
      buildStyledSheet(
        wb,
        'Топ товаров',
        subtitle,
        `Топ ${topItems.length} по выручке`,
        [
          { header: '#', key: 'rank', width: 6, type: 'number', align: 'right' },
          { header: 'Товар', key: 'name', width: 40, type: 'text' },
          { header: 'Кол-во', key: 'qty', width: 12, type: 'number', align: 'right' },
          { header: 'Сумма', key: 'amount', width: 16, type: 'money' },
        ],
        topItems.map((t, i) => ({
          rank: i + 1,
          name: t.name,
          qty: t.qty,
          amount: t.amount,
        })),
      )
    }

    const dateForFile =
      (shift.closed_at || shift.opened_at).slice(0, 10) || new Date().toISOString().slice(0, 10)
    const companyCode = shift.company?.code || shift.company?.name || 'shift'
    await downloadWorkbook(wb, `shift_${companyCode}_${dateForFile}.xlsx`)
  }

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/shifts/reports/${id}`, { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Ошибка загрузки')
      setShift((data?.data?.shift || null) as ShiftDetail | null)
      setSales((data?.data?.sales || []) as Sale[])
      setReturns((data?.data?.returns || []) as Return[])
      setRuns((data?.data?.checklist_runs || []) as ChecklistRun[])
      setIncidents((data?.data?.incidents || []) as Incident[])
      setIncidentsSummary((data?.data?.incidents_summary || null) as IncidentsSummary | null)
      setIncome((data?.data?.income || null) as IncomeRecord)
      setClientDebts((data?.data?.client_debts || []) as ClientDebt[])
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const totals = (shift?.totals_json || {}) as Record<string, any>

  return (
    <div className="space-y-6 p-4 md:p-6">
      <AdminPageHeader
        title={shift ? `Смена • ${shift.company?.name || '—'}` : 'Смена'}
        description={
          shift
            ? `${SHIFT_TYPE_LABEL[shift.shift_type] || shift.shift_type} • ${fmtDateTime(shift.opened_at)} → ${fmtDateTime(shift.closed_at)}`
            : '—'
        }
        icon={<CalendarRange className="h-5 w-5" />}
        accent="emerald"
        backHref="/shifts/reports"
        actions={
          <div className="flex flex-wrap gap-2">
            {shift?.closed_at && (
              <Button variant="outline" size="sm" onClick={() => setShowZReport(true)}>
                <ReceiptIcon className="h-4 w-4" />
                Z-отчёт
              </Button>
            )}
            {shift && (
              <Button variant="outline" size="sm" onClick={exportExcel}>
                <FileDown className="h-4 w-4" />
                Excel
              </Button>
            )}
            {shift && shift.status === 'open' && canCloseForce && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAdminAction('closeForce')}
                className="border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
              >
                Закрыть смену
              </Button>
            )}
            {shift && canPurge && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setAdminAction('purge'); setPurgeConfirm('') }}
                className="border-rose-500/40 text-rose-200 hover:bg-rose-500/10"
              >
                Удалить смену
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Обновить
            </Button>
          </div>
        }
      />

      {error && (
        <Card className="border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          {error}
        </Card>
      )}

      {loading && !shift ? (
        <Card className="border-white/10 p-6 text-center text-slate-400">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </Card>
      ) : !shift ? (
        <Card className="border-white/10 p-6 text-center text-slate-400">
          Смена не найдена
          <div className="mt-2">
            <Link
              href="/shifts/reports"
              className="inline-flex items-center gap-1 text-xs text-emerald-300"
            >
              <ArrowLeft className="h-3 w-3" /> К списку
            </Link>
          </div>
        </Card>
      ) : (
        <>
          {/* ─── Z-ОТЧЁТ ─────────────────────────────────────────── */}
          <ZReport shift={shift} sales={sales} returns={returns} income={income} clientDebts={clientDebts} incidentsSummary={incidentsSummary} />

          {(shift.handover_from_shift_id || shift.closer) && (
            <div className="flex flex-wrap items-center gap-4 px-1 text-xs text-slate-500">
              {shift.closer && (
                <span>
                  Закрыл: <span className="text-slate-300">{shift.closer.short_name || shift.closer.full_name}</span>
                </span>
              )}
              {shift.handover_from_shift_id && (
                <Link
                  href={`/shifts/reports/${shift.handover_from_shift_id}`}
                  className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200"
                >
                  ← предыдущая смена (handover)
                </Link>
              )}
            </div>
          )}

          {(shift.z_report_url || shift.x_report_url || shift.opening_notes || shift.closing_notes) && (
            <Card className="border-white/10 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-400">Отчёты и заметки</div>
              <div className="mt-2 flex flex-wrap gap-3 text-sm">
                {shift.z_report_url && (
                  <a
                    href={shift.z_report_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200"
                  >
                    Z-отчёт <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {shift.x_report_url && (
                  <a
                    href={shift.x_report_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-emerald-300 hover:text-emerald-200"
                  >
                    X-отчёт <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              {shift.opening_notes && (
                <div className="mt-3 text-sm text-slate-300">
                  <div className="text-xs text-slate-500">Заметка при открытии:</div>
                  <div className="whitespace-pre-wrap">{shift.opening_notes}</div>
                </div>
              )}
              {shift.closing_notes && (
                <div className="mt-3 text-sm text-slate-300">
                  <div className="text-xs text-slate-500">Заметка при закрытии:</div>
                  <div className="whitespace-pre-wrap">{shift.closing_notes}</div>
                </div>
              )}
            </Card>
          )}

          <div className="grid gap-4 md:grid-cols-2">
          <Card className="overflow-hidden border-white/10">
            <div className="border-b border-white/5 px-4 py-2 text-sm font-medium text-white">
              Чек-листы • {runs.length}
            </div>
            <div className="divide-y divide-white/5">
              {runs.length === 0 ? (
                <div className="px-4 py-4 text-sm text-slate-400">Чек-листы за смену не запускались</div>
              ) : (
                runs.map((run) => {
                  const respKeys = Object.keys((run.responses || {}) as object)
                  const passed = respKeys.filter((k) => {
                    const r = (run.responses as any)[k]
                    return r?.passed === true || r?.value === true
                  }).length
                  return (
                    <div key={run.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {run.status === 'completed' ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        ) : run.status === 'failed' ? (
                          <XCircle className="h-4 w-4 text-rose-400" />
                        ) : (
                          <Circle className="h-4 w-4 text-amber-400" />
                        )}
                        <span className="text-sm text-white">
                          {run.template?.title || 'Без названия'}
                        </span>
                        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase text-slate-400">
                          {SCHEDULE_LABEL[run.template?.schedule_type || ''] ||
                            run.template?.schedule_type ||
                            ''}
                        </span>
                        {run.template?.blocks_shift && (
                          <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] uppercase text-rose-300">
                            blocks
                          </span>
                        )}
                        <span className="ml-auto text-xs text-slate-400">
                          {fmtDateTime(run.started_at)}
                          {run.completed_at && <> → {fmtDateTime(run.completed_at)}</>}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                        {run.runner && (
                          <span>
                            Исполнитель: {run.runner.short_name || run.runner.full_name}
                          </span>
                        )}
                        {run.cosigner && (
                          <span>
                            Co-sign: {run.cosigner.short_name || run.cosigner.full_name}
                          </span>
                        )}
                        {respKeys.length > 0 && (
                          <span>
                            Отвечено: {passed}/{respKeys.length}
                          </span>
                        )}
                        {Number(run.fines_total) > 0 && (
                          <span className="text-rose-300">−{fmtMoney(run.fines_total)}</span>
                        )}
                        {Number(run.bonuses_total) > 0 && (
                          <span className="text-emerald-300">+{fmtMoney(run.bonuses_total)}</span>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </Card>

          <Card className="overflow-hidden border-white/10">
            <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2 text-sm font-medium text-white">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <span>Инциденты • {incidents.length}</span>
              {incidentsSummary && incidentsSummary.fines_total > 0 && (
                <span className="ml-auto text-xs text-rose-300">
                  −{fmtMoney(incidentsSummary.fines_total)}
                </span>
              )}
              {incidentsSummary && incidentsSummary.bonuses_total > 0 && (
                <span className={`text-xs text-emerald-300 ${incidentsSummary.fines_total > 0 ? '' : 'ml-auto'}`}>
                  +{fmtMoney(incidentsSummary.bonuses_total)}
                </span>
              )}
            </div>
            <div className="divide-y divide-white/5">
              {incidents.length === 0 ? (
                <div className="px-4 py-4 text-sm text-slate-400">
                  За эту смену инцидентов нет
                </div>
              ) : (
                incidents.map((inc) => (
                  <div key={inc.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {inc.kind === 'violation' ? (
                        <ShieldAlert className="h-4 w-4 text-rose-400" />
                      ) : inc.kind === 'bonus' ? (
                        <Sparkles className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <StickyNote className="h-4 w-4 text-slate-400" />
                      )}
                      <span className="text-sm text-white">{inc.title}</span>
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase text-slate-400">
                        {inc.source}
                      </span>
                      {inc.status !== 'confirmed' && (
                        <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase text-amber-300">
                          {inc.status}
                        </span>
                      )}
                      <span className="ml-auto text-xs text-slate-400">
                        {fmtDateTime(inc.occurred_at)}
                      </span>
                    </div>
                    {inc.description && (
                      <div className="mt-1 text-xs text-slate-400">{inc.description}</div>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                      {inc.subject && (
                        <span>Сотрудник: {inc.subject.short_name || inc.subject.full_name}</span>
                      )}
                      {inc.reporter && (
                        <span>Кто записал: {inc.reporter.short_name || inc.reporter.full_name}</span>
                      )}
                      {Number(inc.fine_amount) > 0 && (
                        <span className="text-rose-300">−{fmtMoney(inc.fine_amount)}</span>
                      )}
                      {Number(inc.bonus_amount) > 0 && (
                        <span className="text-emerald-300">+{fmtMoney(inc.bonus_amount)}</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
          </div>

          {topItems.length > 0 && (
            <Card className="overflow-hidden border-white/10">
              <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2 text-sm font-medium text-white">
                <Package className="h-4 w-4 text-emerald-400" />
                Топ товаров за смену
                <span className="ml-auto text-xs text-slate-400">по выручке</span>
              </div>
              <div className="grid gap-px bg-white/5 sm:grid-cols-2">
                {topItems.map((t, i) => (
                  <div
                    key={t.name}
                    className="flex items-center gap-3 bg-slate-950 px-4 py-2 text-sm"
                  >
                    <span className="w-5 text-right text-xs text-slate-500">{i + 1}</span>
                    <span className="flex-1 truncate text-slate-200">{t.name}</span>
                    <span className="text-xs text-slate-400 tabular-nums">×{t.qty}</span>
                    <span className="w-24 text-right text-emerald-300 tabular-nums">
                      {fmtMoney(t.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="overflow-hidden border-white/10">
            <div className="flex flex-wrap items-center gap-3 border-b border-white/5 px-4 py-2 text-sm font-medium text-white">
              <span>
                Продажи • {filteredSales.length}
                {filteredSales.length !== sales.length && (
                  <span className="text-slate-400"> из {sales.length}</span>
                )}
              </span>
              <div className="ml-auto relative">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  value={salesSearch}
                  onChange={(e) => setSalesSearch(e.target.value)}
                  placeholder="Поиск по товару, клиенту, оператору…"
                  className="h-8 w-72 rounded-md border border-white/10 bg-white/[0.03] pl-7 pr-2 text-xs text-slate-200 outline-none placeholder:text-slate-500 focus:border-emerald-500/40"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white/5">
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="w-6 px-2 py-2"></th>
                    <th className="px-3 py-2">Время</th>
                    <th className="px-3 py-2">Состав</th>
                    <th className="px-3 py-2">Оператор</th>
                    <th className="px-3 py-2">Клиент</th>
                    <th className="px-3 py-2">Оплата</th>
                    <th className="px-3 py-2 text-right">Наличные</th>
                    <th className="px-3 py-2 text-right">Безналичный</th>
                    <th className="px-3 py-2 text-right">Скидка</th>
                    <th className="px-3 py-2 text-right">Итого</th>
                    <th className="px-3 py-2">Комментарий</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredSales.length === 0 ? (
                    <tr>
                      <td colSpan={11} className="px-3 py-4 text-center text-slate-400">
                        {sales.length === 0 ? 'Нет продаж' : 'Ничего не найдено'}
                      </td>
                    </tr>
                  ) : (
                    filteredSales.map((s) => {
                      const items = s.items || []
                      const composition = items
                        .map((it) => {
                          const name = itemName(it)
                          const qty = Number(it.quantity || 0)
                          return qty > 1 ? `${name}×${qty}` : name
                        })
                        .join(', ')
                      const discount =
                        Number(s.discount_amount || 0) + Number(s.loyalty_discount_amount || 0)
                      const isExpanded = expandedSales.has(s.id)
                      const hasItems = items.length > 0
                      return (
                        <Fragment key={s.id}>
                          <tr
                            className={`hover:bg-white/5 ${hasItems ? 'cursor-pointer' : ''}`}
                            onClick={() => hasItems && toggleSaleExpand(s.id)}
                          >
                            <td className="px-2 py-2 text-slate-500">
                              {hasItems ? (
                                isExpanded ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )
                              ) : null}
                            </td>
                            <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{fmtDateTime(s.sold_at)}</td>
                            <td className="px-3 py-2 text-slate-300 max-w-[280px] truncate">
                              {composition || <span className="text-slate-500">—</span>}
                            </td>
                            <td className="px-3 py-2 text-slate-400">
                              {s.operator?.short_name || s.operator?.full_name || '—'}
                            </td>
                            <td className="px-3 py-2 text-slate-400">
                              {s.customer?.name || '—'}
                            </td>
                            <td className="px-3 py-2 text-slate-300">{s.payment_method}</td>
                            <td className="px-3 py-2 text-right text-slate-200">
                              {fmtMoney(s.cash_amount)}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-200">
                              {fmtMoney(s.kaspi_amount)}
                            </td>
                            <td className="px-3 py-2 text-right text-amber-300">
                              {discount > 0 ? fmtMoney(discount) : '—'}
                              {Number(s.loyalty_points_spent || 0) > 0 && (
                                <div className="text-[10px] text-slate-500">
                                  −{Number(s.loyalty_points_spent)} б.
                                </div>
                              )}
                              {Number(s.loyalty_points_earned || 0) > 0 && (
                                <div className="text-[10px] text-emerald-400/70">
                                  +{Number(s.loyalty_points_earned)} б.
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right text-emerald-300">
                              {fmtMoney(s.total_amount)}
                            </td>
                            <td className="px-3 py-2 text-slate-400">{s.comment || '—'}</td>
                          </tr>
                          {isExpanded && hasItems && (
                            <tr className="bg-white/[0.02]">
                              <td></td>
                              <td colSpan={10} className="px-4 py-3">
                                <div className="rounded-md border border-white/10 bg-slate-950/40 p-3">
                                  <div className="mb-2 text-[10px] uppercase tracking-wider text-slate-500">
                                    Позиции чека ({items.length})
                                  </div>
                                  <div className="grid gap-1 text-xs">
                                    {items.map((it) => {
                                      const qty = Number(it.quantity || 0)
                                      const total = Number(it.total_price || 0)
                                      const unit = Number(it.unit_price || 0)
                                      return (
                                        <div
                                          key={it.id}
                                          className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-b border-white/5 py-1 last:border-0"
                                        >
                                          <span className="text-slate-200">{itemName(it)}</span>
                                          <span className="text-slate-500 tabular-nums">
                                            ×{qty}
                                          </span>
                                          <span className="text-slate-500 tabular-nums">
                                            {fmtMoney(unit)}
                                          </span>
                                          <span className="w-24 text-right text-emerald-300 tabular-nums">
                                            {fmtMoney(total)}
                                          </span>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="overflow-hidden border-white/10">
            <div className="border-b border-white/5 px-4 py-2 text-sm font-medium text-white">
              Возвраты • {returns.length}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white/5">
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-2">Время</th>
                    <th className="px-3 py-2">Состав</th>
                    <th className="px-3 py-2">Оплата</th>
                    <th className="px-3 py-2 text-right">Наличные</th>
                    <th className="px-3 py-2 text-right">Безналичный</th>
                    <th className="px-3 py-2 text-right">Итого</th>
                    <th className="px-3 py-2">Комментарий</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {returns.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-4 text-center text-slate-400">
                        Нет возвратов
                      </td>
                    </tr>
                  ) : (
                    returns.map((r) => {
                      const composition = (r.items || [])
                        .map((it) => {
                          const name = it.item?.name || 'Без названия'
                          const qty = Number(it.quantity || 0)
                          return qty > 1 ? `${name}×${qty}` : name
                        })
                        .join(', ')
                      return (
                        <tr key={r.id} className="hover:bg-white/5">
                          <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{fmtDateTime(r.returned_at)}</td>
                          <td className="px-3 py-2 text-slate-300 max-w-[280px]">
                            {composition || <span className="text-slate-500">—</span>}
                          </td>
                          <td className="px-3 py-2 text-slate-300">{r.payment_method}</td>
                          <td className="px-3 py-2 text-right text-slate-200">
                            {fmtMoney(r.cash_amount)}
                          </td>
                          <td className="px-3 py-2 text-right text-slate-200">
                            {fmtMoney(r.kaspi_amount)}
                          </td>
                          <td className="px-3 py-2 text-right text-rose-300">
                            {fmtMoney(r.total_amount)}
                          </td>
                          <td className="px-3 py-2 text-slate-400">{r.comment || '—'}</td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* Принудительное закрытие смены */}
      {adminAction === 'closeForce' && shift && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[200] grid place-items-center bg-black/60 p-4" onClick={() => !adminBusy && setAdminAction(null)}>
          <Card onClick={(e) => e.stopPropagation()} className="w-full max-w-md border-amber-500/30 p-5">
            <h3 className="text-base font-semibold">Закрыть смену принудительно</h3>
            <p className="mt-1 text-xs text-slate-400">
              Смена будет помечена как закрытая без отправки отчёта. Используется для тестов.
              Если у этой смены есть продажи — они останутся в системе.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAdminAction(null)} disabled={adminBusy}>Отмена</Button>
              <Button
                onClick={async () => {
                  setAdminBusy(true)
                  try {
                    const res = await fetch(`/api/admin/shifts/reports/${shift.id}`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'closeForce', note: 'Закрытие из админки' }),
                    })
                    const json = await res.json()
                    if (!res.ok) throw new Error(json.detail || json.error || 'Ошибка')
                    setAdminAction(null)
                    await load()
                  } catch (e: any) {
                    alert(e?.message || 'Ошибка')
                  } finally {
                    setAdminBusy(false)
                  }
                }}
                disabled={adminBusy}
                className="bg-amber-500 hover:bg-amber-600"
              >
                {adminBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Закрыть смену'}
              </Button>
            </div>
          </Card>
        </div>,
        document.body,
      )}

      {/* Полное удаление смены (только super-admin) */}
      {adminAction === 'purge' && shift && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[200] grid place-items-center bg-black/70 p-4" onClick={() => !adminBusy && setAdminAction(null)}>
          <Card onClick={(e) => e.stopPropagation()} className="w-full max-w-md border-rose-500/40 bg-rose-950/30 p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-6 w-6 shrink-0 text-rose-300" />
              <div>
                <h3 className="text-base font-semibold text-rose-100">Полное удаление смены</h3>
                <p className="mt-1 text-xs text-rose-200/80">
                  Удалится сама смена + все продажи + возвраты + чек-листы + инциденты + связанные движения.
                  Остатки витрины откатятся (вернутся к состоянию до начала смены).
                  Это <strong>нельзя отменить</strong>.
                </p>
              </div>
            </div>
            <div className="mt-4">
              <p className="mb-1.5 text-xs text-rose-200">
                Введите фразу <code className="rounded bg-rose-500/20 px-1.5 py-0.5">УДАЛИТЬ СМЕНУ</code> для подтверждения:
              </p>
              <input
                value={purgeConfirm}
                onChange={(e) => setPurgeConfirm(e.target.value)}
                placeholder="УДАЛИТЬ СМЕНУ"
                className="h-10 w-full rounded-lg border border-rose-500/40 bg-black/30 px-3 text-sm outline-none focus:border-rose-400"
                autoFocus
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAdminAction(null)} disabled={adminBusy}>Отмена</Button>
              <Button
                onClick={async () => {
                  setAdminBusy(true)
                  try {
                    const res = await fetch(`/api/admin/shifts/reports/${shift.id}`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'purge', confirm: purgeConfirm.trim() }),
                    })
                    const json = await res.json()
                    if (!res.ok) throw new Error(json.detail || json.message || json.error || 'Ошибка')
                    alert(`Смена удалена. Откачено продаж: ${json?.data?.sales_deleted || 0}, возвратов: ${json?.data?.returns_deleted || 0}, остатков: ${json?.data?.showcase_restored || 0}`)
                    window.location.href = '/shifts/reports'
                  } catch (e: any) {
                    alert(e?.message || 'Ошибка')
                  } finally {
                    setAdminBusy(false)
                  }
                }}
                disabled={adminBusy || purgeConfirm.trim() !== 'УДАЛИТЬ СМЕНУ'}
                className="bg-rose-500 hover:bg-rose-600"
              >
                {adminBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Удалить навсегда'}
              </Button>
            </div>
          </Card>
        </div>,
        document.body,
      )}

      {/* Z-отчёт смены — модалка в стиле кассового чека */}
      {showZReport && shift && (
        <ZReportModal
          shift={shift}
          totals={totals}
          sales={sales}
          returns={returns}
          incidents={incidents}
          onClose={() => setShowZReport(false)}
        />
      )}
    </div>
  )
}

function ZReportModal({
  shift,
  totals,
  sales,
  returns,
  incidents,
  onClose,
}: {
  shift: ShiftDetail
  totals: Record<string, any>
  sales: Sale[]
  returns: Return[]
  incidents: Incident[]
  onClose: () => void
}) {
  const fmt = (n: number | null | undefined) =>
    Math.round(Number(n || 0)).toLocaleString('ru-RU')
  const dateOpen = new Date(shift.opened_at).toLocaleString('ru-RU')
  const dateClose = shift.closed_at ? new Date(shift.closed_at).toLocaleString('ru-RU') : '—'
  const cashSales = sales.reduce((s, x) => s + Number(x.cash_amount || 0), 0)
  const kaspiSales = sales.reduce((s, x) => s + Number(x.kaspi_amount || 0), 0)
  const totalSales = sales.reduce((s, x) => s + Number(x.total_amount || 0), 0)
  const totalReturns = returns.reduce((s, x) => s + Number(x.total_amount || 0), 0)
  const cashReturns = returns.reduce((s, x) => s + Number(x.cash_amount || 0), 0)
  const kaspiReturns = returns.reduce((s, x) => s + Number(x.kaspi_amount || 0), 0)
  const declaredCash = Number(shift.closing_cash || 0)
  const declaredKaspi = Number(shift.closing_kaspi || 0)
  const cashDelta = declaredCash - (cashSales - cashReturns)
  const totalIncidents = incidents.length
  const finesAmount = incidents.reduce((s, i) => s + Number(i.fine_amount || 0), 0)

  function handlePrint() {
    window.print()
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div id="z-print-root" className="fixed inset-0 z-[200] grid place-items-center bg-black/60 p-4 print:static print:bg-transparent print:p-0 print:block" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl print:max-h-none print:rounded-none print:shadow-none print:overflow-visible dark:bg-slate-50" onClick={(e) => e.stopPropagation()}>
        {/* Шапка диалога — скрыта при печати */}
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 print:hidden">
          <h3 className="text-sm font-semibold text-slate-900">Z-отчёт смены</h3>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Z-отчёт — стиль кассового чека */}
        <div className="overflow-auto bg-white p-5 font-mono text-[13px] leading-snug text-black">
          <div className="text-center">
            <div className="text-lg font-bold tracking-wider">Z-ОТЧЁТ</div>
            <div className="mt-0.5 text-xs">{shift.company?.name || '—'}</div>
            {shift.company?.code && (
              <div className="mt-0.5 text-xs">Код: {shift.company.code}</div>
            )}
          </div>
          <div className="my-2 border-t border-dashed border-black" />
          <div className="space-y-0.5 text-xs">
            <div className="flex justify-between"><span>Открыта:</span><span>{dateOpen}</span></div>
            <div className="flex justify-between"><span>Закрыта:</span><span>{dateClose}</span></div>
            <div className="flex justify-between"><span>Смена:</span><span>{shift.shift_type === 'day' ? 'Дневная' : shift.shift_type === 'night' ? 'Ночная' : 'Кастом'}</span></div>
            <div className="flex justify-between"><span>Открыл:</span><span className="truncate">{shift.operator?.full_name || '—'}</span></div>
            {shift.closer && (
              <div className="flex justify-between"><span>Закрыл:</span><span className="truncate">{shift.closer.full_name}</span></div>
            )}
          </div>

          <div className="my-2 border-t border-dashed border-black" />
          <div className="text-center text-xs font-semibold">ПРОДАЖИ</div>
          <div className="mt-1 space-y-0.5 text-xs">
            <div className="flex justify-between"><span>Чеков</span><span>{sales.length}</span></div>
            <div className="flex justify-between"><span>Сумма</span><span className="tabular-nums">{fmt(totalSales)} ₸</span></div>
            <div className="flex justify-between"><span>  ↳ Наличными</span><span className="tabular-nums">{fmt(cashSales)} ₸</span></div>
            <div className="flex justify-between"><span>  ↳ Безналичный</span><span className="tabular-nums">{fmt(kaspiSales)} ₸</span></div>
          </div>

          {returns.length > 0 && (
            <>
              <div className="my-2 border-t border-dashed border-black" />
              <div className="text-center text-xs font-semibold">ВОЗВРАТЫ</div>
              <div className="mt-1 space-y-0.5 text-xs">
                <div className="flex justify-between"><span>Возвратов</span><span>{returns.length}</span></div>
                <div className="flex justify-between"><span>Сумма</span><span className="tabular-nums">−{fmt(totalReturns)} ₸</span></div>
                <div className="flex justify-between"><span>  ↳ Наличными</span><span className="tabular-nums">−{fmt(cashReturns)} ₸</span></div>
                <div className="flex justify-between"><span>  ↳ Безналичный</span><span className="tabular-nums">−{fmt(kaspiReturns)} ₸</span></div>
              </div>
            </>
          )}

          <div className="my-2 border-t border-dashed border-black" />
          <div className="text-center text-xs font-semibold">КАССА</div>
          <div className="mt-1 space-y-0.5 text-xs">
            <div className="flex justify-between"><span>Старт</span><span className="tabular-nums">{fmt(shift.opening_cash)} ₸</span></div>
            <div className="flex justify-between"><span>Заявлено налом</span><span className="tabular-nums">{fmt(declaredCash)} ₸</span></div>
            <div className="flex justify-between"><span>Заявлено Безналичный</span><span className="tabular-nums">{fmt(declaredKaspi)} ₸</span></div>
            <div className="flex justify-between"><span>Расчётно нал</span><span className="tabular-nums">{fmt(cashSales - cashReturns)} ₸</span></div>
            <div className={`flex justify-between font-semibold ${cashDelta < 0 ? 'text-red-700' : cashDelta > 0 ? 'text-green-700' : ''}`}>
              <span>Расхождение</span>
              <span className="tabular-nums">{cashDelta > 0 ? '+' : ''}{fmt(cashDelta)} ₸</span>
            </div>
          </div>

          {totalIncidents > 0 && (
            <>
              <div className="my-2 border-t border-dashed border-black" />
              <div className="text-center text-xs font-semibold">ИНЦИДЕНТЫ</div>
              <div className="mt-1 space-y-0.5 text-xs">
                <div className="flex justify-between"><span>Всего</span><span>{totalIncidents}</span></div>
                {finesAmount > 0 && (
                  <div className="flex justify-between"><span>Штрафы</span><span className="tabular-nums">{fmt(finesAmount)} ₸</span></div>
                )}
              </div>
            </>
          )}

          <div className="my-2 border-t-2 border-double border-black" />
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-bold">ИТОГ ПО СМЕНЕ</span>
            <span className="text-lg font-bold tabular-nums">{fmt(totalSales - totalReturns)} ₸</span>
          </div>

          {shift.opening_notes && (
            <div className="mt-3 text-xs">
              <div className="font-semibold">Открытие:</div>
              <div className="mt-0.5">{shift.opening_notes}</div>
            </div>
          )}
          {shift.closing_notes && (
            <div className="mt-2 text-xs">
              <div className="font-semibold">Закрытие:</div>
              <div className="mt-0.5">{shift.closing_notes}</div>
            </div>
          )}

          <div className="my-3 border-t border-dashed border-black" />
          <div className="text-center text-[10px] text-slate-500">
            Документ сгенерирован {new Date().toLocaleString('ru-RU')}
            <br />
            ID смены: {shift.id.slice(-8)}
          </div>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          @page {
            size: 80mm auto;
            margin: 5mm;
          }
          html, body {
            background: white !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          /* Скрываем всю страницу */
          body > * {
            display: none !important;
          }
          /* Кроме принт-контейнера — он живёт в body через Portal */
          body > #z-print-root {
            display: block !important;
            position: static !important;
            background: white !important;
            padding: 0 !important;
          }
          #z-print-root > div {
            box-shadow: none !important;
            max-height: none !important;
            max-width: 100% !important;
            width: 100% !important;
            border-radius: 0 !important;
            overflow: visible !important;
          }
          /* Запрещаем разрывы внутри секций */
          #z-print-root .border-dashed,
          #z-print-root .text-center {
            page-break-inside: avoid;
            break-inside: avoid;
          }
        }
      `}</style>
    </div>,
    document.body,
  )
}

// ════════════════════════════════════════════════════════════════════
//  Z-REPORT — полноценный отчёт смены
// ════════════════════════════════════════════════════════════════════

function ZReport({
  shift,
  sales,
  returns,
  income,
  clientDebts,
  incidentsSummary,
}: {
  shift: ShiftDetail
  sales: Sale[]
  returns: Return[]
  income: IncomeRecord
  clientDebts: ClientDebt[]
  incidentsSummary: IncidentsSummary | null
}) {
  const isOpen = shift.status === 'open'
  // Для X-отчёта (смена открыта) totals_json может быть пустым — считаем «на лету»
  const totals = (shift.totals_json || {}) as Record<string, any>
  const meta = (income?.meta || {}) as IncomeMeta
  const coins = Number(meta?.coins ?? 0)
  const wipon = Number(meta?.wipon ?? 0)
  const debtsCash = Number(meta?.debts ?? 0)
  const startCashFromMeta = Number(meta?.start_cash ?? shift.opening_cash ?? 0)

  // Если смена открыта — считаем продажи/возвраты на лету из массивов sales/returns
  const computedSalesCash = isOpen ? sales.reduce((s, x) => s + Number(x.cash_amount || 0), 0) : Number(totals?.sales_cash || 0)
  const computedSalesKaspi = isOpen ? sales.reduce((s, x) => s + Number(x.kaspi_amount || 0), 0) : Number(totals?.sales_kaspi || 0)
  const computedReturnsCash = isOpen ? returns.reduce((s, x) => s + Number(x.cash_amount || 0), 0) : Number(totals?.returns_cash || 0)
  const computedReturnsKaspi = isOpen ? returns.reduce((s, x) => s + Number(x.kaspi_amount || 0), 0) : Number(totals?.returns_kaspi || 0)

  const salesCash = computedSalesCash
  const returnsCash = computedReturnsCash
  const closingCash = Number(shift.closing_cash || 0)

  // Ожидаемая касса = старт + продажи нал − возвраты нал − wipon (выплаты) + долги (полученные нал)
  const expectedCash = startCashFromMeta + salesCash - returnsCash - wipon + debtsCash
  const cashDiff = isOpen ? 0 : closingCash - expectedCash

  const salesKaspi = computedSalesKaspi
  const returnsKaspi = computedReturnsKaspi
  const closingKaspi = Number(shift.closing_kaspi || 0)
  const expectedKaspi = salesKaspi - returnsKaspi
  const kaspiDiff = isOpen ? 0 : closingKaspi - expectedKaspi

  const totalRevenue = isOpen
    ? salesCash - returnsCash + salesKaspi - returnsKaspi
    : (income?.cash_amount || 0) + (income?.kaspi_amount || 0)
  const checkCount = sales.length || Number(totals?.sales_count || 0)
  const avgCheck = checkCount > 0 ? Math.round(totalRevenue / checkCount) : 0

  // Топ товаров
  const topItems = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; amount: number }>()
    for (const s of sales) {
      const key = String(s.id) // нет breakdown по позициям в этом select; пропустим если нет items
      // sales не содержит item-level details, используем total_amount
      const existing = map.get(s.comment || 'Прочее') || { name: s.comment || 'Прочее', qty: 0, amount: 0 }
      existing.qty += 1
      existing.amount += Number(s.total_amount || 0)
      map.set(existing.name, existing)
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount).slice(0, 5)
  }, [sales])

  return (
    <Card className={`p-6 print:bg-white print:text-black ${
      isOpen
        ? 'border-amber-500/30 bg-gradient-to-br from-slate-950 via-slate-950 to-amber-950/10'
        : 'border-emerald-500/20 bg-gradient-to-br from-slate-950 via-slate-950 to-emerald-950/10'
    }`}>
      <div className="flex items-start justify-between flex-wrap gap-4 mb-5 pb-4 border-b border-white/10">
        <div>
          <div className={`text-[11px] uppercase tracking-[0.2em] ${
            isOpen ? 'text-amber-300/80' : 'text-emerald-300/70'
          }`}>
            {isOpen ? '📊 X-отчёт · СМЕНА ОТКРЫТА' : '✓ Z-отчёт смены'}
          </div>
          <h2 className="text-2xl font-semibold text-white mt-1">
            {shift.company?.name || '—'} · {SHIFT_TYPE_LABEL[shift.shift_type]}
          </h2>
          <div className="text-xs text-slate-400 mt-1">
            {fmtDateTime(shift.opened_at)}
            {' → '}
            {isOpen ? <span className="text-amber-300">сейчас (в работе)</span> : fmtDateTime(shift.closed_at)}
            {shift.operator && <> · 👤 {shift.operator.short_name || shift.operator.full_name}</>}
          </div>
          {isOpen && (
            <div className="mt-2 text-xs text-amber-300/80">
              Отчёт промежуточный — данные обновляются по мере продаж. Z-отчёт сформируется при закрытии смены.
            </div>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="border-white/10 bg-white/5"
          onClick={() => window.print()}
        >
          🖨 Печать
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Касса */}
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-wider text-emerald-300/80 font-semibold">📦 Касса (купюры)</div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-1.5 text-sm">
            <ZRow label="Старт смены" value={startCashFromMeta} />
            <ZRow label="Продаж за смену (нал)" value={salesCash} positive />
            <ZRow label="Возвратов (нал)" value={-returnsCash} negative={returnsCash > 0} />
            {debtsCash > 0 && <ZRow label="Долги получены (нал)" value={debtsCash} positive />}
            {wipon > 0 && <ZRow label="Выплаты wipon / прочее" value={-wipon} negative />}
            <div className="border-t border-white/10 my-2" />
            <ZRow label={isOpen ? 'Должно быть в кассе сейчас' : 'Должно быть в кассе'} value={expectedCash} bold />
            {!isOpen && (
              <>
                <ZRow label="Фактически в кассе" value={closingCash} bold />
                <div className="border-t border-white/10 my-2" />
                <div
                  className={`flex justify-between items-center py-1 px-2 rounded ${
                    Math.abs(cashDiff) < 1
                      ? 'bg-emerald-500/10 text-emerald-300'
                      : cashDiff < 0
                        ? 'bg-rose-500/10 text-rose-300'
                        : 'bg-amber-500/10 text-amber-300'
                  }`}
                >
                  <span className="font-semibold">
                    {Math.abs(cashDiff) < 1 ? '✓ Сходится' : cashDiff < 0 ? '⚠ Недостача' : '⚠ Излишек'}
                  </span>
                  <span className="font-bold">{cashDiff >= 0 ? '+' : ''}{fmtMoney(cashDiff)}</span>
                </div>
              </>
            )}
            {coins > 0 && (
              <div className="text-xs text-slate-500 pt-2">в т.ч. мелочью: {fmtMoney(coins)}</div>
            )}
          </div>
        </div>

        {/* Безнал */}
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-wider text-blue-300/80 font-semibold">💳 Безнал</div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-1.5 text-sm">
            <ZRow label="Продажи безнал (всего)" value={salesKaspi} positive />
            {Number(shift.closing_kaspi_before_midnight || 0) > 0 && (
              <ZRow label="  до 00:00" value={Number(shift.closing_kaspi_before_midnight || 0)} muted />
            )}
            {Number(shift.closing_kaspi_after_midnight || 0) > 0 && (
              <ZRow label="  после 00:00" value={Number(shift.closing_kaspi_after_midnight || 0)} muted />
            )}
            <ZRow label="Возвраты безнал" value={-returnsKaspi} negative={returnsKaspi > 0} />
            <div className="border-t border-white/10 my-2" />
            <ZRow label={isOpen ? 'Сейчас на безнале' : 'Должно быть'} value={expectedKaspi} bold />
            {!isOpen && (
              <>
                <ZRow label="Фактически закрыто" value={closingKaspi} bold />
                {Math.abs(kaspiDiff) >= 1 && (
                  <div
                    className={`flex justify-between items-center py-1 px-2 mt-2 rounded ${
                      kaspiDiff < 0 ? 'bg-rose-500/10 text-rose-300' : 'bg-amber-500/10 text-amber-300'
                    }`}
                  >
                    <span className="font-semibold">{kaspiDiff < 0 ? '⚠ Недостача' : '⚠ Излишек'}</span>
                    <span className="font-bold">{kaspiDiff >= 0 ? '+' : ''}{fmtMoney(kaspiDiff)}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Итого */}
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-1.5 text-sm">
            <div className="text-[10px] uppercase tracking-wider text-emerald-300/80 font-semibold mb-1">
              💰 {isOpen ? 'Выручка на сейчас' : 'Итого выручка'}
            </div>
            <ZRow label="Нал (купюры)" value={isOpen ? salesCash - returnsCash : income?.cash_amount || 0} />
            <ZRow label="Безнал" value={isOpen ? salesKaspi - returnsKaspi : income?.kaspi_amount || 0} />
            <div className="border-t border-emerald-500/20 my-2" />
            <div className="flex justify-between items-center py-1 px-2 rounded bg-emerald-500/15 text-emerald-200">
              <span className="font-semibold">{isOpen ? 'СЕЙЧАС' : 'ВСЕГО за смену'}</span>
              <span className="font-bold text-lg">{fmtMoney(totalRevenue)}</span>
            </div>
            <div className="text-xs text-slate-400 mt-2 flex justify-between">
              <span>Чеков: <span className="text-white font-semibold">{checkCount}</span></span>
              <span>Средний: <span className="text-white font-semibold">{fmtMoney(avgCheck)}</span></span>
            </div>
            {!isOpen && income && (
              <Link
                href={`/income`}
                className="block mt-2 text-xs text-emerald-300 hover:text-emerald-200"
              >
                📎 Открыть запись /income →
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Долги клиентов */}
      {clientDebts.length > 0 && (
        <div className="mt-4">
          <div className="text-xs uppercase tracking-wider text-rose-300/80 font-semibold mb-2">📋 Долги клиентов на смене ({clientDebts.length})</div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-1 text-sm">
            {clientDebts.slice(0, 10).map((d) => (
              <div key={d.id} className="flex justify-between items-center text-slate-300 text-xs">
                <span className="truncate">
                  • {d.client_name || '—'} · {d.item_name || '—'}
                  {d.quantity > 1 && <span className="text-slate-500"> ×{d.quantity}</span>}
                </span>
                <span className="font-mono text-rose-300 shrink-0 ml-2">{fmtMoney(d.total_amount)}</span>
              </div>
            ))}
            {clientDebts.length > 10 && (
              <div className="text-xs text-slate-500 pt-1">…и ещё {clientDebts.length - 10}</div>
            )}
          </div>
        </div>
      )}

      {/* Инциденты */}
      {incidentsSummary && incidentsSummary.count > 0 && (
        <div className="mt-4">
          <div className="text-xs uppercase tracking-wider text-amber-300/80 font-semibold mb-2">⚠ Инциденты</div>
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm grid grid-cols-3 gap-3">
            <div>
              <div className="text-[10px] text-slate-500 uppercase">Всего</div>
              <div className="text-white font-semibold">{incidentsSummary.count}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase">Штрафы</div>
              <div className="text-rose-300 font-semibold">{fmtMoney(incidentsSummary.fines_total)}</div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase">Бонусы</div>
              <div className="text-emerald-300 font-semibold">{fmtMoney(incidentsSummary.bonuses_total)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Заметки */}
      {(shift.opening_notes || shift.closing_notes) && (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {shift.opening_notes && (
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm">
              <div className="text-[10px] text-slate-500 uppercase mb-1">📝 При открытии</div>
              <div className="text-slate-300 italic">«{shift.opening_notes}»</div>
            </div>
          )}
          {shift.closing_notes && (
            <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-sm">
              <div className="text-[10px] text-slate-500 uppercase mb-1">📝 При закрытии</div>
              <div className="text-slate-300 italic">«{shift.closing_notes}»</div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function ZRow({
  label,
  value,
  bold,
  positive,
  negative,
  muted,
}: {
  label: string
  value: number
  bold?: boolean
  positive?: boolean
  negative?: boolean
  muted?: boolean
}) {
  const color = muted
    ? 'text-slate-500'
    : positive
      ? 'text-emerald-300'
      : negative
        ? 'text-rose-300'
        : 'text-slate-200'
  return (
    <div className="flex justify-between items-center">
      <span className={`text-slate-400 ${muted ? 'text-xs' : ''}`}>{label}</span>
      <span className={`${color} ${bold ? 'font-bold text-white' : ''} font-mono tabular-nums`}>
        {fmtMoney(value)}
      </span>
    </div>
  )
}
