'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  CalendarRange,
  Coins,
  ExternalLink,
  Loader2,
  RefreshCw,
  Wallet,
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
  operator?: { id: string; name: string; short_name: string | null } | null
  closer?: { id: string; name: string; short_name: string | null } | null
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
          <div className="flex gap-2">
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
                Оператор: {shift.operator?.short_name || shift.operator?.name || '—'}
              </div>
              {shift.closer && (
                <div className="text-xs text-slate-500">
                  Закрыл: {shift.closer.short_name || shift.closer.name}
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
    </div>
  )
}
