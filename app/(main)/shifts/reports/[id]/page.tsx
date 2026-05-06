'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  CalendarRange,
  CheckCircle2,
  Circle,
  Coins,
  ExternalLink,
  Loader2,
  Printer,
  Receipt as ReceiptIcon,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  StickyNote,
  Wallet,
  X,
  XCircle,
} from 'lucide-react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

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
  const [shift, setShift] = useState<ShiftDetail | null>(null)
  const [sales, setSales] = useState<Sale[]>([])
  const [returns, setReturns] = useState<Return[]>([])
  const [runs, setRuns] = useState<ChecklistRun[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [incidentsSummary, setIncidentsSummary] = useState<IncidentsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showZReport, setShowZReport] = useState(false)
  const [adminAction, setAdminAction] = useState<null | 'closeForce' | 'purge'>(null)
  const [adminBusy, setAdminBusy] = useState(false)
  const [purgeConfirm, setPurgeConfirm] = useState('')

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
            {shift && shift.status === 'open' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAdminAction('closeForce')}
                className="border-amber-500/40 text-amber-200 hover:bg-amber-500/10"
              >
                Закрыть смену
              </Button>
            )}
            {shift && (
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
          <div className="grid gap-3 md:grid-cols-3">
            <Card className="border-white/10 p-4">
              <div className="text-xs uppercase tracking-wide text-slate-400">Статус</div>
              <div className="mt-1 text-lg text-white">
                {STATUS_LABEL[shift.status] || shift.status}
              </div>
              <div className="mt-2 text-xs text-slate-500">
                Оператор: {shift.operator?.short_name || shift.operator?.full_name || '—'}
              </div>
              {shift.closer && (
                <div className="text-xs text-slate-500">
                  Закрыл: {shift.closer.short_name || shift.closer.full_name}
                </div>
              )}
              {shift.handover_from_shift_id && (
                <Link
                  href={`/shifts/reports/${shift.handover_from_shift_id}`}
                  className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-300"
                >
                  Handover ← предыдущая
                </Link>
              )}
            </Card>

            <Card className="border-white/10 p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-400">
                <Wallet className="h-3 w-3" /> Касса
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div className="text-slate-500">Открытие:</div>
                <div className="text-right text-slate-200">{fmtMoney(shift.opening_cash)}</div>
                <div className="text-slate-500">Закрытие:</div>
                <div className="text-right text-slate-200">{fmtMoney(shift.closing_cash)}</div>
                <div className="text-slate-500">Kaspi:</div>
                <div className="text-right text-slate-200">{fmtMoney(shift.closing_kaspi)}</div>
                {(shift.closing_kaspi_before_midnight || shift.closing_kaspi_after_midnight) && (
                  <>
                    <div className="text-xs text-slate-500">  до 00:00</div>
                    <div className="text-right text-xs text-slate-400">
                      {fmtMoney(shift.closing_kaspi_before_midnight)}
                    </div>
                    <div className="text-xs text-slate-500">  после 00:00</div>
                    <div className="text-right text-xs text-slate-400">
                      {fmtMoney(shift.closing_kaspi_after_midnight)}
                    </div>
                  </>
                )}
              </div>
            </Card>

            <Card className="border-white/10 p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-400">
                <Coins className="h-3 w-3" /> Итоги
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div className="text-slate-500">Продажи:</div>
                <div className="text-right text-emerald-300">
                  {fmtMoney(Number(totals.sales_total || 0))}
                </div>
                <div className="text-slate-500">Возвраты:</div>
                <div className="text-right text-rose-300">
                  {fmtMoney(Number(totals.returns_total || 0))}
                </div>
                <div className="text-slate-500">Net:</div>
                <div className="text-right text-white">
                  {fmtMoney(Number(totals.net_total || 0))}
                </div>
                <div className="text-slate-500">Чеков:</div>
                <div className="text-right text-slate-200">{Number(totals.sales_count || 0)}</div>
              </div>
            </Card>
          </div>

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

          <Card className="overflow-hidden border-white/10">
            <div className="border-b border-white/5 px-4 py-2 text-sm font-medium text-white">
              Продажи • {sales.length}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-white/5">
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-2">Время</th>
                    <th className="px-3 py-2">Оплата</th>
                    <th className="px-3 py-2 text-right">Cash</th>
                    <th className="px-3 py-2 text-right">Kaspi</th>
                    <th className="px-3 py-2 text-right">Итого</th>
                    <th className="px-3 py-2">Комментарий</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {sales.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-center text-slate-400">
                        Нет продаж
                      </td>
                    </tr>
                  ) : (
                    sales.map((s) => (
                      <tr key={s.id} className="hover:bg-white/5">
                        <td className="px-3 py-2 text-slate-300">{fmtDateTime(s.sold_at)}</td>
                        <td className="px-3 py-2 text-slate-300">{s.payment_method}</td>
                        <td className="px-3 py-2 text-right text-slate-200">
                          {fmtMoney(s.cash_amount)}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-200">
                          {fmtMoney(s.kaspi_amount)}
                        </td>
                        <td className="px-3 py-2 text-right text-emerald-300">
                          {fmtMoney(s.total_amount)}
                        </td>
                        <td className="px-3 py-2 text-slate-400">{s.comment || '—'}</td>
                      </tr>
                    ))
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
                    <th className="px-3 py-2">Оплата</th>
                    <th className="px-3 py-2 text-right">Cash</th>
                    <th className="px-3 py-2 text-right">Kaspi</th>
                    <th className="px-3 py-2 text-right">Итого</th>
                    <th className="px-3 py-2">Комментарий</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {returns.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-center text-slate-400">
                        Нет возвратов
                      </td>
                    </tr>
                  ) : (
                    returns.map((r) => (
                      <tr key={r.id} className="hover:bg-white/5">
                        <td className="px-3 py-2 text-slate-300">{fmtDateTime(r.returned_at)}</td>
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
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* Принудительное закрытие смены */}
      {adminAction === 'closeForce' && shift && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => !adminBusy && setAdminAction(null)}>
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
        </div>
      )}

      {/* Полное удаление смены (только super-admin) */}
      {adminAction === 'purge' && shift && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => !adminBusy && setAdminAction(null)}>
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
        </div>
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

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 print:relative print:bg-transparent print:p-0">
      <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl print:max-h-none print:rounded-none print:shadow-none dark:bg-slate-50">
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
            <div className="flex justify-between"><span>  ↳ Kaspi</span><span className="tabular-nums">{fmt(kaspiSales)} ₸</span></div>
          </div>

          {returns.length > 0 && (
            <>
              <div className="my-2 border-t border-dashed border-black" />
              <div className="text-center text-xs font-semibold">ВОЗВРАТЫ</div>
              <div className="mt-1 space-y-0.5 text-xs">
                <div className="flex justify-between"><span>Возвратов</span><span>{returns.length}</span></div>
                <div className="flex justify-between"><span>Сумма</span><span className="tabular-nums">−{fmt(totalReturns)} ₸</span></div>
                <div className="flex justify-between"><span>  ↳ Наличными</span><span className="tabular-nums">−{fmt(cashReturns)} ₸</span></div>
                <div className="flex justify-between"><span>  ↳ Kaspi</span><span className="tabular-nums">−{fmt(kaspiReturns)} ₸</span></div>
              </div>
            </>
          )}

          <div className="my-2 border-t border-dashed border-black" />
          <div className="text-center text-xs font-semibold">КАССА</div>
          <div className="mt-1 space-y-0.5 text-xs">
            <div className="flex justify-between"><span>Старт</span><span className="tabular-nums">{fmt(shift.opening_cash)} ₸</span></div>
            <div className="flex justify-between"><span>Заявлено налом</span><span className="tabular-nums">{fmt(declaredCash)} ₸</span></div>
            <div className="flex justify-between"><span>Заявлено Kaspi</span><span className="tabular-nums">{fmt(declaredKaspi)} ₸</span></div>
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
          body * {
            visibility: hidden;
          }
          .fixed.inset-0 {
            position: absolute !important;
            inset: 0 !important;
            background: white !important;
          }
          .fixed.inset-0 * {
            visibility: visible;
          }
        }
      `}</style>
    </div>
  )
}
