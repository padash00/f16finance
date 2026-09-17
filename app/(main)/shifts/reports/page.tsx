'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarRange, ChevronRight, Loader2, RefreshCw } from 'lucide-react'

import { AdminPageHeader, AdminTableViewport, adminTableStickyTheadClass } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { SortableTh } from '@/components/ui/sortable-th'
import { useTableSort } from '@/lib/client/use-table-sort'
import type { SortColumns, SortState } from '@/lib/core/table-sort'

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

// Для сортировки по столбцу «Статус»: сначала открытые смены, потом закрытые, аннулированные — в конце
const STATUS_RANK: Record<string, number> = { open: 0, closed: 1, voided: 2 }

type ShiftSortKey =
  | 'company'
  | 'operator'
  | 'type'
  | 'opened'
  | 'closed'
  | 'duration'
  | 'sales'
  | 'returns'
  | 'cash'
  | 'status'

const SHIFT_SORT_INITIAL: SortState<ShiftSortKey> = { key: 'opened', dir: 'desc' }

function shiftDurationMs(row: ShiftRow) {
  if (!row.opened_at || !row.closed_at) return null
  const ms = new Date(row.closed_at).getTime() - new Date(row.opened_at).getTime()
  return Number.isFinite(ms) && ms > 0 ? ms : null
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

function fmtDuration(ms: number | null) {
  if (ms === null) return '—'
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
  // Сервер отдаёт максимум 500 смен за запрос. Раньше страница молча просила 200
  // и выглядела как «вся история» — теперь лимит выбирается и подписан под таблицей.
  const [limit, setLimit] = useState<200 | 500>(200)

  const load = useMemo(
    () => async (signal?: AbortSignal) => {
      setLoading(true)
      setError(null)
      try {
        const url = new URL('/api/admin/shifts/reports', window.location.origin)
        url.searchParams.set('status', status)
        url.searchParams.set('limit', String(limit))
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
    [status, limit],
  )

  useEffect(() => {
    const ctrl = new AbortController()
    load(ctrl.signal)
    return () => ctrl.abort()
  }, [load])

  const sortColumns = useMemo<SortColumns<ShiftRow, ShiftSortKey>>(
    () => ({
      company: { get: (r) => r.company?.name || null },
      operator: { get: (r) => r.operator?.short_name || r.operator?.full_name || null },
      type: { get: (r) => SHIFT_TYPE_LABEL[r.shift_type] || r.shift_type },
      opened: { get: (r) => r.opened_at || null, defaultDir: 'desc' },
      closed: { get: (r) => r.closed_at || null, defaultDir: 'desc' },
      duration: { get: (r) => shiftDurationMs(r), defaultDir: 'desc' },
      sales: { get: (r) => Number((r.totals_json || {}).sales_total || 0) || null, defaultDir: 'desc' },
      returns: { get: (r) => Number((r.totals_json || {}).returns_total || 0) || null, defaultDir: 'desc' },
      cash: { get: (r) => Number(r.closing_cash || 0) || null, defaultDir: 'desc' },
      status: { get: (r) => STATUS_RANK[r.status] ?? 99 },
    }),
    [],
  )
  const { sort, toggle, sortedRows } = useTableSort<ShiftRow, ShiftSortKey>({
    storageKey: 'shifts.reportsSort',
    columns: sortColumns,
    initial: SHIFT_SORT_INITIAL,
    rows,
  })
  const sortHead = (label: string, key: ShiftSortKey, align: 'left' | 'right' | 'center' = 'left') => (
    <SortableTh label={label} sortKey={key} sort={sort} onSort={toggle} align={align} className="px-3 py-2" />
  )

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
                    ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200'
                    : 'border-border text-muted-foreground hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {value === 'closed' ? 'Закрытые' : value === 'open' ? 'Открытые' : 'Все'}
              </button>
            ))}
            <span className="ml-2 text-xs text-muted-foreground">Показать:</span>
            {([200, 500] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setLimit(value)}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  limit === value
                    ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200'
                    : 'border-border text-muted-foreground hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                последние {value}
              </button>
            ))}
          </div>
        }
      />

      {error && (
        <Card className="border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-200">
          {error}
        </Card>
      )}

      <Card className="overflow-hidden border-border">
        <AdminTableViewport>
          <table className="w-full min-w-[1100px] text-sm">
            <thead className={adminTableStickyTheadClass}>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                {sortHead('Точка', 'company')}
                {sortHead('Оператор', 'operator')}
                {sortHead('Тип', 'type')}
                {sortHead('Открыта', 'opened')}
                {sortHead('Закрыта', 'closed')}
                {sortHead('Длит.', 'duration')}
                {sortHead('Продажи', 'sales', 'right')}
                {sortHead('Возвраты', 'returns', 'right')}
                {sortHead('Касса', 'cash', 'right')}
                {sortHead('Статус', 'status')}
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-white/5">
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
                sortedRows.map((row) => {
                  const totals = (row.totals_json || {}) as Record<string, any>
                  return (
                    <tr key={row.id} className="hover:bg-surface-muted">
                      <td className="px-3 py-2 text-foreground">{row.company?.name || '—'}</td>
                      <td className="px-3 py-2 text-body">
                        {row.operator?.short_name || row.operator?.full_name || '—'}
                      </td>
                      <td className="px-3 py-2 text-body">
                        {SHIFT_TYPE_LABEL[row.shift_type] || row.shift_type}
                      </td>
                      <td className="px-3 py-2 text-body">{fmtDateTime(row.opened_at)}</td>
                      <td className="px-3 py-2 text-body">{fmtDateTime(row.closed_at)}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {fmtDuration(shiftDurationMs(row))}
                      </td>
                      <td className="px-3 py-2 text-right text-emerald-600 dark:text-emerald-300">
                        {fmtMoney(Number(totals.sales_total || 0))}
                      </td>
                      <td className="px-3 py-2 text-right text-rose-600 dark:text-rose-300">
                        {fmtMoney(Number(totals.returns_total || 0))}
                      </td>
                      <td className="px-3 py-2 text-right text-body">
                        {fmtMoney(Number(row.closing_cash || 0))}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            row.status === 'open'
                              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-200'
                              : row.status === 'closed'
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200'
                                : 'bg-slate-500/15 text-body'
                          }`}
                        >
                          {STATUS_LABEL[row.status] || row.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Link
                          href={`/shifts/reports/${row.id}`}
                          className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-300 hover:text-emerald-700 dark:hover:text-emerald-200"
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
        {rows.length > 0 && (
          <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            {rows.length >= limit
              ? `Показаны последние ${rows.length} смен — это предел выборки, более ранние не загружены.`
              : `Показаны все ${rows.length} смен по фильтру.`}
          </div>
        )}
      </Card>
    </div>
  )
}
