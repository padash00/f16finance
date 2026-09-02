'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, Clock3, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatMoney } from '@/lib/core/format'

type Settlement = {
  id: string
  staff_name: string
  staff_full_name: string | null
  slot: 'first' | 'second'
  scheduled_date: string
  net_due: number
  paid_amount: number
  balance_adjustment: number
  remaining_amount: number
  status: string
}

type Event = {
  id: string
  settlement_id: string
  event_type: string
  balance_delta: number
  before_remaining: number
  after_remaining: number
  business_date: string
}

type Payload = {
  rows: Settlement[]
  events: Event[]
  totals: { due: number; paid: number; remaining: number; adjustments: number; openCount: number }
  error?: string
}

function ruDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date)
}

function eventLabel(type: string) {
  const labels: Record<string, string> = {
    payment_allocated: 'Выплата по FIFO',
    payment_reversed: 'Отмена выплаты',
    adjustment_applied: 'Корректировка остатка',
    adjustment_reversed: 'Отмена корректировки',
    snapshot_underpayment_fixed: 'Зафиксирован остаток',
    snapshot_overpayment_fixed: 'Зафиксирована переплата',
    legacy_underpayment_voided: 'Исторический остаток аннулирован',
    remainder_voided: 'Остаток списан вручную',
  }
  return labels[type] || type.replaceAll('_', ' ')
}

export default function SalarySettlementsPage() {
  const [payload, setPayload] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openOnly, setOpenOnly] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/admin/staff-salary/settlements', { cache: 'no-store' })
      const body = (await response.json()) as Payload
      if (!response.ok) throw new Error(body.error || 'Не удалось загрузить реестр.')
      setPayload(body)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить реестр.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const rows = useMemo(() => {
    const source = payload?.rows || []
    return openOnly ? source.filter((row) => Number(row.remaining_amount || 0) > 0) : source
  }, [payload, openOnly])

  const staffBySettlement = useMemo(
    () => new Map((payload?.rows || []).map((row) => [row.id, row.staff_name])),
    [payload],
  )

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2">
            <Link href="/salary"><ArrowLeft className="mr-2 h-4 w-4" />К зарплате</Link>
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">Остатки зарплаты</h1>
          <p className="mt-1 text-sm text-muted-foreground">Отдельные расчёты 1-го и 15-го, FIFO-выплаты и живой долг компании.</p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Обновить
        </Button>
      </div>

      {error ? <Card className="border-destructive/40 p-4 text-sm text-destructive">{error}</Card> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Начислено', payload?.totals.due || 0],
          ['Выплачено', payload?.totals.paid || 0],
          ['Должна компания', payload?.totals.remaining || 0],
        ].map(([label, value]) => (
          <Card key={String(label)} className="p-4">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums">{formatMoney(Number(value))}</div>
          </Card>
        ))}
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Открытых расчётов</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">{payload?.totals.openCount || 0}</div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b p-4">
          <div>
            <div className="font-medium">Расчёты</div>
            <div className="text-xs text-muted-foreground">Один расчёт = одна зафиксированная выплата 1-го или 15-го.</div>
          </div>
          <Button size="sm" variant={openOnly ? 'default' : 'outline'} onClick={() => setOpenOnly((v) => !v)}>
            {openOnly ? 'Все' : 'Только остатки'}
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Сотрудник</th>
                <th className="px-4 py-3 text-left font-medium">Дата</th>
                <th className="px-4 py-3 text-right font-medium">Начислено</th>
                <th className="px-4 py-3 text-right font-medium">Выплачено</th>
                <th className="px-4 py-3 text-right font-medium">Корр.</th>
                <th className="px-4 py-3 text-right font-medium">Остаток</th>
                <th className="px-4 py-3 text-left font-medium">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading && !payload ? <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Загрузка…</td></tr> : null}
              {!loading && rows.length === 0 ? <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Нет расчётов.</td></tr> : null}
              {rows.map((row) => {
                const remaining = Number(row.remaining_amount || 0)
                const closed = remaining <= 0 || row.status === 'paid'
                return (
                  <tr key={row.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3"><div className="font-medium">{row.staff_name}</div>{row.staff_full_name && row.staff_full_name !== row.staff_name ? <div className="text-xs text-muted-foreground">{row.staff_full_name}</div> : null}</td>
                    <td className="px-4 py-3"><div>{row.slot === 'first' ? '1-е число' : '15-е число'}</div><div className="text-xs text-muted-foreground">{ruDate(row.scheduled_date)}</div></td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatMoney(row.net_due)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatMoney(row.paid_amount)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.balance_adjustment ? `${row.balance_adjustment > 0 ? '+' : ''}${formatMoney(row.balance_adjustment)}` : '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatMoney(remaining)}</td>
                    <td className="px-4 py-3"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium ${closed ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>{closed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}{closed ? 'Закрыт' : row.status === 'partial' ? 'Частично' : 'Не выплачен'}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="border-b p-4"><div className="font-medium">Последние движения</div><div className="text-xs text-muted-foreground">Выплаты, долги, бонусы, отмены и списания остатка.</div></div>
        <div className="divide-y">
          {(payload?.events || []).slice(0, 60).map((event) => (
            <div key={event.id} className="grid gap-2 p-4 text-sm md:grid-cols-[170px_1fr_150px_180px] md:items-center">
              <div><div className="font-medium">{staffBySettlement.get(event.settlement_id) || 'Сотрудник'}</div><div className="text-xs text-muted-foreground">{ruDate(event.business_date)}</div></div>
              <div>{eventLabel(event.event_type)}</div>
              <div className="text-right tabular-nums">{event.balance_delta ? `${event.balance_delta > 0 ? '+' : ''}${formatMoney(event.balance_delta)}` : '—'}</div>
              <div className="text-right text-xs text-muted-foreground tabular-nums">{formatMoney(event.before_remaining)} → {formatMoney(event.after_remaining)}</div>
            </div>
          ))}
          {!loading && (payload?.events || []).length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">Движений пока нет.</div> : null}
        </div>
      </Card>
    </div>
  )
}
