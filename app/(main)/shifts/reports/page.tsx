'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarRange, ChevronRight, Loader2, RefreshCw } from 'lucide-react'

import { AdminPageHeader, AdminTableViewport, adminTableStickyTheadClass } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type ShiftRow = {
  id: string
  company_id: string
  operator_id: string | null
  status: 'open' | 'closed' | 'voided'
  shift_type: 'day' | 'night' | 'custom'
  opened_at: string
  closed_at: string | null
  opening_cash: number
  closing_cash: number | null
  closing_kaspi: number | null
  totals_json: Record<string, any> | null
  z_report_url: string | null
  x_report_url: string | null
  company?: { id: string; name: string; code: string | null } | null
  operator?: { id: string; full_name: string; short_name: string | null } | null
}

const SHIFT_TYPE_LABEL: Record<string, string> = {
  day: 'Дневная',
  night: 'Ночная',
  custom: 'Нестандарт',
}

const STATUS_LABEL: Record<string, string> = {
  open: 'Открыта',
  closed: 'Закрыта',
  voided: 'Аннулирована',
}

function fmtMoney(value: number | null | undefined) {
  const v = Number(value || 0)
  return v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'
}

function fmtDateTime(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })
}

function fmtDuration(opened: string | null, closed: string | null) {
  if (!opened || !closed) return '—'
  const ms = new Date(closed).getTime() - new Date(opened).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const totalMinutes = Math.floor(ms / 60000)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${h}ч ${m}м`
}

export default function ShiftReportsPage() {
  const [rows, setRows] = useState<ShiftRow[]>([])
  const [status, setStatus] = useState<'closed' | 'open' | 'all'>('closed')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useMemo(
    () => async (signal?: AbortSignal) => {
      setLoading(true)
      setError(null)
      try {
        const url = new URL('/api/admin/shifts/reports', window.location.origin)
        url.searchParams.set('status', status)
        url.searchParams.set('limit', '200')
        const res = await fetch(url.toString(), { signal, credentials: 'include' })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || 'Ошибка загрузки смен')
        setRows((data?.data?.shifts || []) as ShiftRow[])
      } catch (e: any) {
        if (e?.name === 'AbortError') return
        setError(e?.message || 'Ошибка загрузки')
      } finally {
        setLoading(false)
      }
    },
    [status],
  )

  useEffect(() => {
    const ctrl = new AbortController()
    load(ctrl.signal)
    return () => ctrl.abort()
  }, [load])

  return (
    <div className="app-page-wide space-y-6">
      <AdminPageHeader
        title="Отчёты смен"
        description="Закрытые смены точек: финансы, операции, отчёты Z/X"
        icon={<CalendarRange className="h-5 w-5" />}
        accent="emerald"
        backHref="/"
        actions={
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            {(['closed', 'open', 'all'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatus(value)}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  status === value
                    ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200'
                    : 'border-white/10 text-slate-400 hover:text-white'
                }`}
              >
                {value === 'closed' ? 'Закрытые' : value === 'open' ? 'Открытые' : 'Все'}
              </button>
            ))}
          </div>
        }
      />

      {error && (
        <Card className="border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
          {error}
        </Card>
      )}

      <Card className="overflow-hidden border-white/10">
        <AdminTableViewport>
          <table className="w-full text-sm">
            <thead className={adminTableStickyTheadClass}>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-3 py-2">Точка</th>
                <th className="px-3 py-2">Оператор</th>
                <th className="px-3 py-2">Тип</th>
                <th className="px-3 py-2">Открыта</th>
                <th className="px-3 py-2">Закрыта</th>
                <th className="px-3 py-2">Длит.</th>
                <th className="px-3 py-2 text-right">Продажи</th>
                <th className="px-3 py-2 text-right">Возвраты</th>
                <th className="px-3 py-2 text-right">Касса</th>
                <th className="px-3 py-2">Статус</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-slate-400">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-slate-400">
                    Нет смен по выбранному фильтру
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const totals = (row.totals_json || {}) as Record<string, any>
                  return (
                    <tr key={row.id} className="hover:bg-white/5">
                      <td className="px-3 py-2 text-white">{row.company?.name || '—'}</td>
                      <td className="px-3 py-2 text-slate-200">
                        {row.operator?.short_name || row.operator?.full_name || '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        {SHIFT_TYPE_LABEL[row.shift_type] || row.shift_type}
                      </td>
                      <td className="px-3 py-2 text-slate-300">{fmtDateTime(row.opened_at)}</td>
                      <td className="px-3 py-2 text-slate-300">{fmtDateTime(row.closed_at)}</td>
                      <td className="px-3 py-2 text-slate-400">
                        {fmtDuration(row.opened_at, row.closed_at)}
                      </td>
                      <td className="px-3 py-2 text-right text-emerald-300">
                        {fmtMoney(Number(totals.sales_total || 0))}
                      </td>
                      <td className="px-3 py-2 text-right text-rose-300">
                        {fmtMoney(Number(totals.returns_total || 0))}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-200">
                        {fmtMoney(Number(row.closing_cash || 0))}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            row.status === 'open'
                              ? 'bg-amber-500/15 text-amber-200'
                              : row.status === 'closed'
                                ? 'bg-emerald-500/15 text-emerald-200'
                                : 'bg-slate-500/15 text-slate-300'
                          }`}
                        >
                          {STATUS_LABEL[row.status] || row.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Link
                          href={`/shifts/reports/${row.id}`}
                          className="inline-flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200"
                        >
                          Открыть <ChevronRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </AdminTableViewport>
      </Card>
    </div>
  )
}
