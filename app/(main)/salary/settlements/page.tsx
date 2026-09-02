'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, Clock3, RefreshCw, WalletCards } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatMoney } from '@/lib/core/format'

type Settlement = {
  id: string
  staff_id: string
  staff_name: string
  staff_full_name: string | null
  period_month: string
  slot: 'first' | 'second'
  scheduled_date: string
  opened_date: string
  net_due: number
  paid_amount: number
  balance_adjustment: number
  remaining_amount: number
  status: string
  created_at: string
  closed_at: string | null
}

type SettlementEvent = {
  id: string
  settlement_id: string
  event_type: string
  amount: number
  balance_delta: number
  before_remaining: number
  after_remaining: number
  business_date: string
  created_at: string
}

type Payload = {
  rows: Settlement[]
  events: SettlementEvent[]
  totals: {
    due: number
    paid: number
    remaining: number
    adjustments: number
    openCount: number
  }
  error?: string
}

const money = (value: number) => `${formatMoney(Math.round(Number(value || 0)))} ₸`

function slotLabel(slot: Settlement['slot']) {
  return slot === 'first' ? '1-е число' : '15-е число'
}

function statusLabel(status: string, remaining: number) {
  if (remaining <= 0 || status === 'paid') return 'Закрыт'
  if (status === 'partial') return 'Частично'
  return 'Не выплачен'
}

function eventLabel(type: string) {
  const labels: Record<string, string> = {
    payment_allocated: 'Выплата',
    payment_reversed: 'Отмена выплаты',
    adjustment_applied: 'Корректировка',
    adjustment_reversed: 'Отмена корректировки',
    snapshot_underpayment_fixed: 'Зафиксирован остаток',
    snapshot_overpayment_fixed: 'Зафиксирована переплата',
    legacy_underpayment_voided: 'Старый остаток аннулирован',
    remainder_voided: 'Остаток списан вручную',
  }
  return labels[type] || type.replaceAll('_', ' ')
}

function ruDate(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
}

export default function SalarySettlementsPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openOnly, setOpenOnly] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/admin/staff-salary/settlements', { cache: 'no-store' })
      const payload = (await response.json()) as Payload
      if (!response.ok) throw new Error(payload.error || 'Не удалось загрузить реестр.')
      setData(payload)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить реестр.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo(() => {
    const source = data?.rows || []
    return openOnly ? source.filter((row) => Number(row.remaining_amount || 0) > 0) : source
  }, [data, openOnly])

  const staffBySettlement = useMemo(
    () => new Map((data?.rows || []).map((row) => [row.id, row.staff_name])),
    [data],
  )

  const totalRemaining = data?.totals.remaining || 0

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-2">
            <Button asChild variant="ghost" size="sm" className="-ml-3">
              <Link href="/salary"><ArrowLeft className="mr-2 h-4 w-4" />Назад к зарплате</Link>
            </Button>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Расчёты административных сотрудников</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Зафиксированные выплаты 1-го и 15-го, живые остатки и FIFO-движения.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Обновить
        </Button>
      </div>

      {error ? (
        <Card className="border-destructive/40 p-4 text-sm text-destructive">{error}</Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Всего начислено</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">{money(data?.totals.due || 0)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Выплачено</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">{money(data?.totals.paid || 0)}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><WalletCards className="h-4 w-4" />Должна компания</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">{money(totalRemaining)}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="h-4 w-4" />Открытых расчётов</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">{data?.totals.openCount || 0}</div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-medium">Расчёты 1-го и 15-го</div>
            <div className="text-xs text-muted-foreground">Каждая строка — отдельный зафиксированный расчёт.</div>
          </div>
          <Button variant={openOnly ? 'default' : 'outline'} size="sm" onClick={() => setOpenOnly((value) => !value)}>
            {openOnly ? 'Показать все' : 'Только остатки'}
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Сотрудник</th>
                <th className="px-4 py-3 font-medium">Расчёт</th>
                <th className="px-4 py-3 text-right font-medium">Начислено</th>
                <th className="px-4 py-3 text-right font-medium">Выплачено</th>
                <th className="px-4 py-3 text-right font-medium">Корректировки</th>
                <th className="px-4 py-3 text-right font-medium">Остаток</th>
                <th className="px-4 py-3 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading && !data ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">Загрузка…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">Расчётов пока нет.</td></tr>
              ) : rows.map((row) => {
                const remaining = Number(row.remaining_amount || 0)
                const closed = remaining <= 0 || row.status === 'paid'
                return (
                  <tr key={row.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <div className="font-medium">{row.staff_name}</div>
                      {row.staff_full_name && row.staff_full_name !== row.staff_name ? <div className="text-xs text-muted-foreground">{row.staff_full_name}</div> : null}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{slotLabel(row.slot)}</div>
                      <div className="text-xs text-muted-foreground">{ruDate(row.scheduled_date)}</div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(row.net_due)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{money(row.paid_amount)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.balance_adjustment === 0 ? '—' : `${row.balance_adjustment > 0 ? '+' : ''}${money(row.balance_adjustment)}`}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{money(remaining)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${closed ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>
                        {closed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
                        {statusLabel(row.status, remaining)}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b p-4">
          <div className="font-medium">Последние движения</div>
          <div className="text-xs text-muted-foreground">FIFO-выплаты, долги, корректировки и ручные списания.</div>
        </div>
        <div className="divide-y">
          {(data?.events || []).slice(0, 60).map((event) => (
            <div key={event.id} className="grid gap-2 p-4 text-sm md:grid-cols-[160px_1fr_140px_140px] md:items-center">
              <div>
                <div className="font-medium">{staffBySettlement.get(event.settlement_id) || 'Сотрудник'}</div>
                <div className="text-xs text-muted-foreground">{ruDate(event.business_date)}</div>
              </div>
              <div>{eventLabel(event.event_type)}</div>
              <div className="text-right tabular-nums">{event.balance_delta === 0 ? '—' : `${event.balance_delta > 0 ? '+' : ''}${money(event.balance_delta)}`}</div>
              <div className="text-right text-xs text-muted-foreground tabular-nums">{money(event.before_remaining)} → {money(event.after_remaining)}</div>
            </div>
          ))}
          {!loading && (data?.events || []).length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Движений пока нет.</div>
          ) : null}
        </div>
      </Card>
    </div>
  )
}
