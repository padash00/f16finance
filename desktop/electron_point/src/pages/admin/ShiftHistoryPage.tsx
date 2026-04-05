import { useState, useEffect, useMemo } from 'react'
import { formatMoney, formatDate, todayISO } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RefreshCw, Download, ChevronDown, ChevronRight } from 'lucide-react'
import * as api from '@/lib/api'
import type { AppConfig, AdminSession, BootstrapData } from '@/types'

interface Props {
  config: AppConfig
  session?: AdminSession
  bootstrap?: BootstrapData
}

interface ShiftRow {
  id: string
  date: string
  shift: string
  operator_name: string | null
  company_id: string | null
  company_name: string | null
  cash: number
  kaspi: number
  kaspi_online: number
  total: number
}

export default function ShiftHistoryPage({ config, session, bootstrap }: Props) {
  const [allRows, setAllRows] = useState<ShiftRow[]>([])
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10)
  })
  const [to, setTo] = useState(todayISO)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const data = await api.getReports(config, session?.token)
      const operatorById = new Map(
        (bootstrap?.operators || []).map(op => [op.id, op.full_name || op.name])
      )

      const shifts = (data.data.shifts as any[] || []).map(r => {
        const cash = Number(r.cash_amount || r.cash || 0)
        const kaspi = Number(r.kaspi_amount || r.kaspi_pos || 0)
        const kaspi_online = Number(r.online_amount || r.kaspi_online || 0)
        const total = cash + kaspi + kaspi_online
        const operatorName = r.operator_name
          || (r.operator_id ? operatorById.get(r.operator_id) : null)
          || null
        return {
          id: r.id,
          date: r.date,
          shift: r.shift,
          operator_name: operatorName,
          company_id: r.company_id || null,
          company_name: r.company_name || null,
          cash,
          kaspi,
          kaspi_online,
          total,
        }
      })
      setAllRows(shifts)
    } catch {
      setAllRows([])
    } finally {
      setLoading(false)
    }
  }

  const rows = useMemo(
    () => allRows.filter(r => r.date >= from && r.date <= to),
    [allRows, from, to],
  )

  const totalRevenue = rows.reduce((s, r) => s + r.total, 0)
  const totalCash = rows.reduce((s, r) => s + r.cash, 0)
  const totalKaspi = rows.reduce((s, r) => s + r.kaspi, 0)
  const totalOnline = rows.reduce((s, r) => s + r.kaspi_online, 0)

  // Итоги по операторам
  const byOperator = useMemo(() => {
    const map = new Map<string, { total: number; count: number }>()
    for (const r of rows) {
      const key = r.operator_name || '—'
      const prev = map.get(key) ?? { total: 0, count: 0 }
      map.set(key, { total: prev.total + r.total, count: prev.count + 1 })
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total)
  }, [rows])

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleExport() {
    const XLSX = await import('xlsx')
    const data = rows.map(r => ({
      'Дата': r.date,
      'Смена': r.shift === 'day' ? 'День' : 'Ночь',
      'Оператор': r.operator_name || '—',
      'Наличные': r.cash,
      'Kaspi POS': r.kaspi,
      'Kaspi Online': r.kaspi_online,
      'Выручка': r.total,
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Смены')
    XLSX.writeFile(wb, `shifts_${from}_${to}.xlsx`)
  }

  const isAdmin = !!session

  return (
    <div className="p-5 space-y-4">
      {/* Toolbar */}
      <div className="flex items-end gap-4 flex-wrap">
        <div className="space-y-1.5">
          <Label className="text-xs">С</Label>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">По</Label>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-40" />
        </div>

        <div className="flex gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={handleExport} disabled={rows.length === 0} className="gap-1.5">
            <Download className="h-4 w-4" /> Excel
          </Button>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Итоги */}
        <div className="w-full flex gap-6 py-2 border-t text-sm flex-wrap">
          <div>
            <p className="text-xs text-muted-foreground">Выручка за период</p>
            <p className="text-lg font-bold tabular-nums">{formatMoney(totalRevenue)}</p>
          </div>
          {totalCash > 0 && (
            <div>
              <p className="text-xs text-muted-foreground">Наличные</p>
              <p className="text-base font-semibold tabular-nums">{formatMoney(totalCash)}</p>
            </div>
          )}
          {totalKaspi > 0 && (
            <div>
              <p className="text-xs text-muted-foreground">Kaspi POS</p>
              <p className="text-base font-semibold tabular-nums">{formatMoney(totalKaspi)}</p>
            </div>
          )}
          {totalOnline > 0 && (
            <div>
              <p className="text-xs text-muted-foreground">Kaspi Online</p>
              <p className="text-base font-semibold tabular-nums">{formatMoney(totalOnline)}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground">Смен</p>
            <p className="text-lg font-bold">{rows.length}</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <span className="animate-spin h-6 w-6 border-2 border-border border-t-foreground rounded-full" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground text-sm">
          Нет данных за выбранный период
        </div>
      ) : (
        <div className="space-y-4">
          {/* Итоги по операторам */}
          {byOperator.length > 1 && (
            <div className="rounded-lg border overflow-hidden">
              <div className="bg-muted/40 px-4 py-2 text-xs font-semibold text-muted-foreground">По операторам</div>
              <div className="divide-y">
                {byOperator.map(([name, totals]) => (
                  <div key={name} className="flex items-center px-4 py-2 text-sm gap-4">
                    <span className="flex-1 font-medium">{name}</span>
                    <span className="text-xs text-muted-foreground">{totals.count} смен</span>
                    <span className="tabular-nums w-32 text-right font-semibold">{formatMoney(totals.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Таблица смен */}
          <div className="rounded-lg border overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="w-6 px-2 py-2.5" />
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Дата</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Смена</th>
                  {isAdmin && <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Точка</th>}
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Оператор</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Выручка</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map(row => {
                  const isOpen = expanded.has(row.id)
                  const hasBreakdown = row.kaspi > 0 || row.kaspi_online > 0
                  return (
                    <>
                      <tr
                        key={row.id}
                        className={`hover:bg-muted/20 transition-colors ${hasBreakdown ? 'cursor-pointer' : ''}`}
                        onClick={() => hasBreakdown && toggleExpand(row.id)}
                      >
                        <td className="px-2 py-2.5 text-muted-foreground">
                          {hasBreakdown && (
                            isOpen
                              ? <ChevronDown className="h-3.5 w-3.5" />
                              : <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums">{formatDate(row.date)}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant={row.shift === 'day' ? 'secondary' : 'outline'} className="text-xs">
                            {row.shift === 'day' ? '☀️ День' : '🌙 Ночь'}
                          </Badge>
                        </td>
                        {isAdmin && <td className="px-4 py-2.5 text-xs text-muted-foreground">{row.company_name || '—'}</td>}
                        <td className="px-4 py-2.5 text-muted-foreground">{row.operator_name || '—'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{formatMoney(row.total)}</td>
                      </tr>
                      {isOpen && (
                        <tr key={`${row.id}-detail`} className="bg-muted/10">
                          <td />
                          <td colSpan={4} className="px-4 py-2">
                            <div className="flex gap-6 text-xs text-muted-foreground">
                              {row.cash > 0 && (
                                <span>Нал: <strong className="text-foreground tabular-nums">{formatMoney(row.cash)}</strong></span>
                              )}
                              {row.kaspi > 0 && (
                                <span>Kaspi POS: <strong className="text-foreground tabular-nums">{formatMoney(row.kaspi)}</strong></span>
                              )}
                              {row.kaspi_online > 0 && (
                                <span>Online: <strong className="text-foreground tabular-nums">{formatMoney(row.kaspi_online)}</strong></span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
