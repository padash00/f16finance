'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { supabase } from '@/lib/supabaseClient'
import { ChevronLeft, Printer, RefreshCw, Loader2, BarChart3, ChevronDown, ChevronUp } from 'lucide-react'

type Location = {
  id: string
  name: string
  company_id: string
}

type Totals = {
  amount: number
  cash: number
  kaspi: number
  card: number
  online: number
  count: number
  avg_check: number
}

type TopItem = {
  item_id: string
  name: string
  qty: number
  revenue: number
}

type HourEntry = {
  hour: number
  amount: number
}

type SaleEntry = {
  id: string
  sold_at: string
  shift: string
  total_amount: number
  payment_method: string
  items_count: number
}

type ReportData = {
  date: string
  shift: string
  totals: Totals
  top_items: TopItem[]
  by_hour: HourEntry[]
  sales: SaleEntry[]
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Нал',
  kaspi: 'Kaspi',
  card: 'Карта',
  online: 'Онлайн',
  mixed: 'Смешан.',
}

const PAYMENT_METHOD_COLORS: Record<string, string> = {
  cash: 'bg-green-500/20 text-green-400 border border-green-500/30',
  kaspi: 'bg-orange-500/20 text-orange-400 border border-orange-500/30',
  card: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  online: 'bg-purple-500/20 text-purple-400 border border-purple-500/30',
  mixed: 'bg-zinc-500/20 text-zinc-400 border border-zinc-500/30',
}

function fmt(n: number) {
  return n.toLocaleString('ru-RU')
}

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

export default function ShiftReportPage() {
  const today = new Date().toISOString().split('T')[0]

  const [date, setDate] = useState(today)
  const [shift, setShift] = useState<'' | 'day' | 'night'>('')
  const [locationId, setLocationId] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<ReportData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [salesExpanded, setSalesExpanded] = useState(false)

  // Load locations
  useEffect(() => {
    supabase
      .from('inventory_locations')
      .select('id, name, company_id')
      .eq('location_type', 'point_display')
      .order('name')
      .then(({ data }: { data: Location[] | null }) => {
        if (data) setLocations(data)
      })
  }, [])

  const loadReport = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ date })
      if (shift) params.set('shift', shift)
      if (locationId) params.set('location_id', locationId)
      if (companyId) params.set('company_id', companyId)

      const res = await fetch(`/api/admin/shifts/report?${params}`)
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setError(json.error || 'Ошибка загрузки')
        return
      }
      setReport(json.data)
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setLoading(false)
    }
  }, [date, shift, locationId, companyId])

  // Auto-load on mount
  useEffect(() => {
    loadReport()
  }, [loadReport])

  const totals = report?.totals
  const nonCash = totals ? totals.kaspi + totals.card + totals.online : 0
  const maxHourAmount = report ? Math.max(...report.by_hour.map((h) => h.amount), 1) : 1
  const activeHours = report?.by_hour.filter((h) => h.amount > 0) || []

  function payBar(label: string, amount: number, total: number, color: string) {
    const pct = total > 0 ? Math.round((amount / total) * 100) : 0
    return (
      <div key={label} className="flex items-center gap-3">
        <div className="w-16 shrink-0 text-right text-xs text-muted-foreground">{label}</div>
        <div className="flex-1 rounded-full bg-muted h-3 overflow-hidden">
          <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
        </div>
        <div className="w-24 shrink-0 text-right text-sm font-medium tabular-nums">{fmt(amount)} ₸</div>
        <div className="w-10 shrink-0 text-right text-xs text-muted-foreground">{pct}%</div>
      </div>
    )
  }

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .app-page { max-width: 100% !important; }
          body { background: white; color: black; }
          .print-full { display: block !important; }
        }
      `}</style>

      <div className="app-page max-w-5xl">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-bold text-foreground">
              <BarChart3 className="h-8 w-8 text-purple-500" /> Отчёт по смене
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Итоги продаж за выбранную дату и смену
            </p>
          </div>

          {/* Controls */}
          <div className="no-print flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Дата</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Смена</label>
              <Card className="!flex-row !gap-0 !p-0.5 border-border bg-card self-start">
                {(['', 'day', 'night'] as const).map((s) => (
                  <Button
                    key={s}
                    variant={shift === s ? 'secondary' : 'ghost'}
                    size="sm"
                    className="text-xs px-3"
                    onClick={() => setShift(s)}
                  >
                    {s === '' ? 'Все' : s === 'day' ? 'День' : 'Ночь'}
                  </Button>
                ))}
              </Card>
            </div>

            {locations.length > 0 && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Точка</label>
                <select
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="">Все точки</option>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-end gap-2">
              <Button onClick={loadReport} disabled={loading} size="sm" className="gap-1.5">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Загрузить
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.print()}>
                <Printer className="h-4 w-4" />
                Печать
              </Button>
              <Link href="/shifts">
                <Button variant="ghost" size="sm" className="gap-1.5">
                  <ChevronLeft className="h-4 w-4" />
                  Назад
                </Button>
              </Link>
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !report && (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mr-2" /> Загрузка отчёта...
          </div>
        )}

        {report && (
          <>
            {/* Stats row */}
            <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Card className="border-border bg-card p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Выручка</div>
                <div className="mt-2 text-3xl font-bold text-foreground tabular-nums">{fmt(totals!.amount)}</div>
                <div className="mt-1 text-xs text-muted-foreground">тенге</div>
              </Card>

              <Card className="border-border bg-card p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Продаж</div>
                <div className="mt-2 text-3xl font-bold text-foreground tabular-nums">{totals!.count}</div>
                <div className="mt-1 text-xs text-muted-foreground">ср. чек {fmt(totals!.avg_check)} ₸</div>
              </Card>

              <Card className="border-border bg-card p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Наличные</div>
                <div className="mt-2 text-3xl font-bold text-green-400 tabular-nums">{fmt(totals!.cash)}</div>
                <div className="mt-1 text-xs text-muted-foreground">тенге</div>
              </Card>

              <Card className="border-border bg-card p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Безнал</div>
                <div className="mt-2 text-3xl font-bold text-blue-400 tabular-nums">{fmt(nonCash)}</div>
                <div className="mt-1 text-xs text-muted-foreground">Kaspi + Карта + Онлайн</div>
              </Card>
            </div>

            {/* Payment breakdown */}
            <Card className="mb-6 border-border bg-card p-5">
              <div className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                Разбивка по оплате
              </div>
              <div className="flex flex-col gap-3">
                {payBar('Нал', totals!.cash, totals!.amount, 'bg-green-500')}
                {payBar('Kaspi', totals!.kaspi, totals!.amount, 'bg-orange-500')}
                {payBar('Карта', totals!.card, totals!.amount, 'bg-blue-500')}
                {payBar('Онлайн', totals!.online, totals!.amount, 'bg-purple-500')}
              </div>
            </Card>

            <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Top items */}
              {report.top_items.length > 0 && (
                <Card className="border-border bg-card p-5">
                  <div className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                    Топ товары
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="pb-2 text-left font-normal w-6">#</th>
                        <th className="pb-2 text-left font-normal">Название</th>
                        <th className="pb-2 text-right font-normal">Кол-во</th>
                        <th className="pb-2 text-right font-normal">Выручка</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.top_items.map((item, idx) => (
                        <tr key={item.item_id} className="border-b border-border/50 last:border-0">
                          <td className="py-2 text-muted-foreground">{idx + 1}</td>
                          <td className="py-2 font-medium">{item.name || item.item_id}</td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">{item.qty}</td>
                          <td className="py-2 text-right tabular-nums font-medium">{fmt(item.revenue)} ₸</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}

              {/* Hourly chart */}
              {activeHours.length > 0 && (
                <Card className="border-border bg-card p-5">
                  <div className="mb-4 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                    Продажи по часам
                  </div>
                  <div className="flex items-end gap-1 h-32">
                    {activeHours.map((h) => {
                      const heightPct = maxHourAmount > 0 ? (h.amount / maxHourAmount) * 100 : 0
                      const isPeak = h.amount === maxHourAmount
                      return (
                        <div key={h.hour} className="flex flex-col items-center gap-1 flex-1 min-w-0">
                          <div className="w-full flex flex-col justify-end" style={{ height: '100px' }}>
                            <div
                              title={`${pad2(h.hour)}:00 — ${fmt(h.amount)} ₸`}
                              className={`w-full rounded-t transition-all ${isPeak ? 'bg-accent' : 'bg-accent/40'}`}
                              style={{ height: `${Math.max(heightPct, 4)}%` }}
                            />
                          </div>
                          <div className="text-[10px] text-muted-foreground">{pad2(h.hour)}</div>
                        </div>
                      )
                    })}
                  </div>
                </Card>
              )}
            </div>

            {/* Full sales list (collapsible) */}
            {report.sales.length > 0 && (
              <Card className="border-border bg-card">
                <button
                  className="no-print w-full flex items-center justify-between p-5 text-left"
                  onClick={() => setSalesExpanded((v) => !v)}
                >
                  <span className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                    Все продажи ({report.sales.length})
                  </span>
                  {salesExpanded ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>

                {/* Print: always show; interactive: toggle */}
                <div className={`print-full ${salesExpanded ? 'block' : 'hidden'}`}>
                  <div className="border-t border-border">
                    {report.sales.map((sale) => {
                      const time = new Date(sale.sold_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                      const methodLabel = PAYMENT_METHOD_LABELS[sale.payment_method] || sale.payment_method
                      const methodColor = PAYMENT_METHOD_COLORS[sale.payment_method] || PAYMENT_METHOD_COLORS.mixed
                      return (
                        <div
                          key={sale.id}
                          className="flex items-center gap-3 border-b border-border/50 px-5 py-2.5 last:border-0 text-sm"
                        >
                          <div className="w-12 shrink-0 tabular-nums text-muted-foreground">{time}</div>
                          <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${methodColor}`}>
                            {methodLabel}
                          </span>
                          <div className="flex-1 text-xs text-muted-foreground">
                            {sale.items_count > 0 ? `${sale.items_count} позиц.` : ''}
                          </div>
                          <div className="tabular-nums font-semibold">{fmt(Number(sale.total_amount))} ₸</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </Card>
            )}

            {report.sales.length === 0 && (
              <div className="rounded-md border border-border bg-card py-16 text-center text-sm text-muted-foreground">
                Продаж за выбранный период не найдено
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
