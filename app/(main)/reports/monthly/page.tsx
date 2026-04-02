'use client'

import { useCallback, useEffect, useState } from 'react'
import { buildStyledSheet, createWorkbook, downloadWorkbook } from '@/lib/excel/styled-export'
import { FileSpreadsheet, RefreshCw, Download, TrendingUp, ShoppingCart, Tag, Percent } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCompanies } from '@/hooks/use-companies'

// ─── Types ─────────────────────────────────────────────────────────────────────

type DailyRow = {
  date: string
  count: number
  total: number
  cash: number
  kaspi: number
  card: number
  online: number
  discount: number
}

type Totals = {
  count: number
  total: number
  cash: number
  kaspi: number
  card: number
  online: number
  discount: number
  avg_check: number
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatMoney(v: number) {
  return new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 0 }).format(v)
}

const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

function dayName(dateStr: string) {
  return DAY_NAMES[new Date(dateStr).getDay()]
}

async function downloadCSV(daily: DailyRow[], totals: Totals, year: number, month: number) {
  const wb = createWorkbook()
  const monthName = new Date(year, month - 1, 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
  const dataRows = daily.map(d => ({
    date: d.date,
    dayName: dayName(d.date),
    count: d.count,
    total: d.total,
    cash: d.cash,
    kaspi: d.kaspi,
    card: d.card,
    online: d.online,
    discount: d.discount,
  }))
  dataRows.push({ _isTotals: true, date: 'ИТОГО', dayName: '', count: totals.count, total: totals.total, cash: totals.cash, kaspi: totals.kaspi, card: totals.card, online: totals.online, discount: totals.discount } as any)
  buildStyledSheet(wb, 'Отчёт', `Месячный отчёт — ${monthName}`, `Период: ${year}-${String(month).padStart(2, '0')} | Дней: ${daily.length}`, [
    { header: 'Дата', key: 'date', width: 13, type: 'text' },
    { header: 'День', key: 'dayName', width: 8, type: 'text' },
    { header: 'Продаж', key: 'count', width: 10, type: 'number', align: 'right' },
    { header: 'Выручка', key: 'total', width: 16, type: 'money' },
    { header: 'Наличные', key: 'cash', width: 15, type: 'money' },
    { header: 'Kaspi', key: 'kaspi', width: 15, type: 'money' },
    { header: 'Карта', key: 'card', width: 15, type: 'money' },
    { header: 'Онлайн', key: 'online', width: 15, type: 'money' },
    { header: 'Скидки', key: 'discount', width: 13, type: 'money' },
  ], dataRows)
  await downloadWorkbook(wb, `otchet_${year}_${String(month).padStart(2, '0')}.xlsx`)
}

function getMonthName(month: number) {
  return new Date(2000, month - 1, 1).toLocaleDateString('ru-RU', { month: 'long' })
}

// ─── Main Component ────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear()
const YEARS = [CURRENT_YEAR - 1, CURRENT_YEAR]
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

export default function MonthlyReportPage() {
  const { companies } = useCompanies()
  const [year, setYear] = useState(CURRENT_YEAR)
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [companyId, setCompanyId] = useState('')
  const [daily, setDaily] = useState<DailyRow[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ year: String(year), month: String(month) })
      if (companyId) params.set('company_id', companyId)
      const res = await fetch(`/api/admin/reports/monthly?${params.toString()}`)
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Ошибка загрузки')
      setDaily(j.data?.daily || [])
      setTotals(j.data?.totals || null)
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить отчёт')
    } finally {
      setLoading(false)
    }
  }, [year, month, companyId])

  useEffect(() => {
    void load()
  }, [load])

  const hasData = daily.length > 0 && totals !== null

  // Payment methods for bar visualization
  const paymentMethods = hasData && totals ? [
    { label: 'Наличные', value: totals.cash, color: 'bg-emerald-500' },
    { label: 'Kaspi', value: totals.kaspi, color: 'bg-sky-500' },
    { label: 'Карта', value: totals.card, color: 'bg-violet-500' },
    { label: 'Онлайн', value: totals.online, color: 'bg-amber-500' },
  ] : []

  const maxPayment = paymentMethods.length > 0 ? Math.max(...paymentMethods.map(p => p.value), 1) : 1

  return (
    <div className="app-page">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileSpreadsheet className="h-6 w-6 text-emerald-400" />
            Ежемесячный отчёт
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Бухгалтерский и налоговый отчёт
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {YEARS.map(y => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(month)} onValueChange={v => setMonth(Number(v))}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map(m => (
                <SelectItem key={m} value={String(m)} className="capitalize">{getMonthName(m)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {companies.length > 0 && (
            <Select value={companyId || '__all'} onValueChange={v => setCompanyId(v === '__all' ? '' : v)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Все компании" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Все компании</SelectItem>
                {companies.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Загрузить
          </Button>
          {hasData && totals && (
            <Button variant="outline" size="sm" onClick={() => downloadCSV(daily, totals, year, month)}>
              <Download className="mr-2 h-4 w-4" />
              Скачать Excel
            </Button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          Загрузка...
        </div>
      ) : !hasData ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
          Нет данных за выбранный период
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/10">
                  <TrendingUp className="h-5 w-5 text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Выручка</p>
                  <p className="mt-0.5 text-xl font-bold">₸{formatMoney(totals!.total)}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-500/10">
                  <ShoppingCart className="h-5 w-5 text-sky-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Продаж</p>
                  <p className="mt-0.5 text-xl font-bold">{totals!.count.toLocaleString('ru-RU')}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-500/10">
                  <Tag className="h-5 w-5 text-violet-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Средний чек</p>
                  <p className="mt-0.5 text-xl font-bold">₸{formatMoney(totals!.avg_check)}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-500/10">
                  <Percent className="h-5 w-5 text-rose-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">Скидки</p>
                  <p className="mt-0.5 text-xl font-bold">₸{formatMoney(totals!.discount)}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Payment methods breakdown */}
          <Card className="mb-6">
            <CardContent className="p-4">
              <p className="text-sm font-medium mb-4">Способы оплаты</p>
              <div className="space-y-3">
                {paymentMethods.map(pm => (
                  <div key={pm.label} className="flex items-center gap-3">
                    <span className="w-20 text-xs text-muted-foreground shrink-0">{pm.label}</span>
                    <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${pm.color}`}
                        style={{ width: `${Math.round((pm.value / maxPayment) * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium w-28 text-right">₸{formatMoney(pm.value)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Daily table */}
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10">
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Дата</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">День</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">Продаж</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">Выручка</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">Нал</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">Kaspi</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">Карта</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">Онлайн</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">Скидки</th>
                    </tr>
                  </thead>
                  <tbody>
                    {daily.map(row => (
                      <tr key={row.date} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="px-4 py-2.5 font-medium">{row.date}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{dayName(row.date)}</td>
                        <td className="px-4 py-2.5 text-right">{row.count}</td>
                        <td className="px-4 py-2.5 text-right font-semibold">₸{formatMoney(row.total)}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">{row.cash > 0 ? `₸${formatMoney(row.cash)}` : '—'}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">{row.kaspi > 0 ? `₸${formatMoney(row.kaspi)}` : '—'}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">{row.card > 0 ? `₸${formatMoney(row.card)}` : '—'}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">{row.online > 0 ? `₸${formatMoney(row.online)}` : '—'}</td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">{row.discount > 0 ? `₸${formatMoney(row.discount)}` : '—'}</td>
                      </tr>
                    ))}
                    {/* Totals row */}
                    <tr className="border-t border-white/20 bg-white/[0.03]">
                      <td className="px-4 py-3 font-bold" colSpan={2}>ИТОГО</td>
                      <td className="px-4 py-3 text-right font-bold">{totals!.count}</td>
                      <td className="px-4 py-3 text-right font-bold text-emerald-400">₸{formatMoney(totals!.total)}</td>
                      <td className="px-4 py-3 text-right font-semibold">{totals!.cash > 0 ? `₸${formatMoney(totals!.cash)}` : '—'}</td>
                      <td className="px-4 py-3 text-right font-semibold">{totals!.kaspi > 0 ? `₸${formatMoney(totals!.kaspi)}` : '—'}</td>
                      <td className="px-4 py-3 text-right font-semibold">{totals!.card > 0 ? `₸${formatMoney(totals!.card)}` : '—'}</td>
                      <td className="px-4 py-3 text-right font-semibold">{totals!.online > 0 ? `₸${formatMoney(totals!.online)}` : '—'}</td>
                      <td className="px-4 py-3 text-right font-semibold">{totals!.discount > 0 ? `₸${formatMoney(totals!.discount)}` : '—'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
