import { useState, useEffect, useMemo } from 'react'
import { formatMoney, formatDate, todayISO } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RefreshCw, Download } from 'lucide-react'
import * as api from '@/lib/api'
import type { AppConfig, AdminSession, BootstrapData } from '@/types'

interface Props {
  config: AppConfig
  session?: AdminSession
  bootstrap?: BootstrapData
}

interface DebtItem {
  id: string
  debtor_name: string
  item_name: string
  barcode: string | null
  quantity: number
  total_amount: number
  status: 'active' | 'deleted' | string
  created_at: string
  deleted_at: string | null
}

export default function DebtHistoryPage({ config, session }: Props) {
  const [allRows, setAllRows] = useState<DebtItem[]>([])
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10)
  })
  const [to, setTo] = useState(todayISO)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const data = await api.getReports(config, session?.token)
      const debts = (data.data.debt_history as any[] || []).map(r => ({
        id: r.id || String(Math.random()),
        debtor_name: r.debtor_name || '—',
        item_name: r.item_name || '—',
        barcode: r.barcode || null,
        quantity: Number(r.quantity || 0),
        total_amount: Number(r.total_amount || 0),
        status: r.status || 'active',
        created_at: r.created_at || '',
        deleted_at: r.deleted_at || null,
      }))
      setAllRows(debts)
    } catch {
      setAllRows([])
    } finally {
      setLoading(false)
    }
  }

  const rows = useMemo(() => {
    return allRows.filter(r => {
      const date = r.created_at.slice(0, 10)
      const inRange = date >= from && date <= to
      const statusOk = showAll || r.status === 'active'
      return inRange && statusOk
    })
  }, [allRows, from, to, showAll])

  const totalActive = rows.filter(r => r.status === 'active').reduce((s, r) => s + r.total_amount, 0)

  // Group by debtor
  const byDebtor = useMemo(() => {
    const map = new Map<string, { items: DebtItem[]; total: number }>()
    for (const r of rows) {
      const prev = map.get(r.debtor_name) ?? { items: [], total: 0 }
      prev.items.push(r)
      if (r.status === 'active') prev.total += r.total_amount
      map.set(r.debtor_name, prev)
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total)
  }, [rows])

  async function handleExport() {
    const XLSX = await import('xlsx')
    const data = rows.map(r => ({
      'Дата': r.created_at ? formatDate(r.created_at.slice(0, 10)) : '—',
      'Должник': r.debtor_name,
      'Товар': r.item_name,
      'Штрихкод': r.barcode || '—',
      'Кол-во': r.quantity,
      'Сумма': r.total_amount,
      'Статус': r.status === 'active' ? 'Активен' : 'Закрыт',
    }))
    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Долги')
    XLSX.writeFile(wb, `debts_${from}_${to}.xlsx`)
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-end gap-4 flex-wrap">
        <div className="space-y-1.5">
          <Label className="text-xs">С</Label>
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">По</Label>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-40" />
        </div>

        <label className="flex items-center gap-2 text-sm cursor-pointer select-none ml-2">
          <input
            type="checkbox"
            checked={showAll}
            onChange={e => setShowAll(e.target.checked)}
            className="rounded"
          />
          Показать закрытые
        </label>

        <div className="flex gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={handleExport} disabled={rows.length === 0} className="gap-1.5">
            <Download className="h-4 w-4" /> Excel
          </Button>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <div className="w-full flex gap-6 py-2 border-t text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Активных долгов</p>
            <p className="text-lg font-bold tabular-nums text-destructive-foreground">{formatMoney(totalActive)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Должников</p>
            <p className="text-lg font-bold">{byDebtor.length}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Позиций</p>
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
          Долгов нет за выбранный период
        </div>
      ) : (
        <div className="space-y-3">
          {byDebtor.map(([debtor, { items, total }]) => (
            <div key={debtor} className="rounded-lg border overflow-hidden">
              <div className="bg-muted/40 px-4 py-2 flex items-center justify-between">
                <span className="text-sm font-semibold">{debtor}</span>
                {total > 0 && (
                  <span className="text-sm font-bold tabular-nums text-destructive-foreground">
                    {formatMoney(total)}
                  </span>
                )}
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y">
                  {items.map(item => (
                    <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 text-muted-foreground text-xs tabular-nums">
                        {item.created_at ? formatDate(item.created_at.slice(0, 10)) : '—'}
                      </td>
                      <td className="px-4 py-2.5 font-medium">{item.item_name}</td>
                      <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs">
                        {item.barcode || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">×{item.quantity}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                        {formatMoney(item.total_amount)}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Badge variant={item.status === 'active' ? 'destructive' : 'secondary'} className="text-xs">
                          {item.status === 'active' ? 'Активен' : 'Закрыт'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
