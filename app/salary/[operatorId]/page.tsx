'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DEFAULT_SHIFT_BASE_PAY } from '@/lib/core/constants'
import { calculateOperatorShiftBreakdown, type SalaryShiftBreakdown } from '@/lib/domain/salary'
import { getOperatorDisplayName } from '@/lib/core/operator-name'
import {
  ArrowLeft,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Circle,
  Loader2,
  Moon,
  Settings2,
  Sun,
  TrendingUp,
  UserCircle2,
} from 'lucide-react'

type Shift = 'day' | 'night'

type IncomeRow = {
  id: string
  date: string
  company_id: string
  operator_id: string | null
  shift: Shift
  zone: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
  comment: string | null
}

type Company = {
  id: string
  name: string
  code: string | null
}

type Operator = {
  id: string
  name: string
  full_name?: string | null
  short_name: string | null
  operator_profiles?: { full_name?: string | null }[] | null
  is_active: boolean
}

type SalaryRule = {
  company_code: string
  shift_type: Shift
  base_per_shift: number | null
  senior_operator_bonus: number | null
  senior_cashier_bonus: number | null
  threshold1_turnover: number | null
  threshold1_bonus: number | null
  threshold2_turnover: number | null
  threshold2_bonus: number | null
}

type AssignmentRow = {
  operator_id: string
  company_id: string
  role_in_company: 'operator' | 'senior_operator' | 'senior_cashier'
  is_active: boolean
}

type PayoutRow = {
  id: number
  operator_id: string
  date: string
  shift: Shift
  is_paid: boolean
  paid_at: string | null
  comment: string | null
}

type SalaryDetailResponse = {
  operator: Operator
  companies: Company[]
  rules: SalaryRule[]
  assignments: AssignmentRow[]
  incomes: IncomeRow[]
  payouts: PayoutRow[]
}

type DateRangePreset = 'month' | 'week' | 'all'

const toISODateLocal = (date: Date) => {
  const localTime = date.getTime() - date.getTimezoneOffset() * 60_000
  return new Date(localTime).toISOString().slice(0, 10)
}

const fromISODateLocal = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}

const todayISO = () => toISODateLocal(new Date())

const addDaysISO = (iso: string, diff: number) => {
  const date = fromISODateLocal(iso || todayISO())
  date.setDate(date.getDate() + diff)
  return toISODateLocal(date)
}

const formatMoney = (value: number | null | undefined) => (value ?? 0).toLocaleString('ru-RU')

const formatDate = (iso: string) => {
  if (!iso) return ''
  return fromISODateLocal(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

const formatDateTime = (iso: string | null) => {
  if (!iso) return null
  return new Date(iso).toLocaleString('ru-RU')
}

export default function OperatorSalaryPage() {
  const params = useParams<{ operatorId?: string | string[] }>()
  const operatorId = useMemo(() => {
    const raw = params?.operatorId
    const value = Array.isArray(raw) ? raw[0] || '' : raw || ''
    if (value === 'undefined' || value === 'null') return ''
    return value
  }, [params])

  const [operator, setOperator] = useState<Operator | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [rules, setRules] = useState<SalaryRule[]>([])
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [payouts, setPayouts] = useState<PayoutRow[]>([])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatingKey, setUpdatingKey] = useState<string | null>(null)

  const [dateFrom, setDateFrom] = useState(() => addDaysISO(todayISO(), -29))
  const [dateTo, setDateTo] = useState(todayISO())
  const [preset, setPreset] = useState<DateRangePreset | null>('month')

  const payoutMap = useMemo(() => {
    const map = new Map<string, PayoutRow>()
    for (const payout of payouts) {
      map.set(`${payout.date}_${payout.shift}`, payout)
    }
    return map
  }, [payouts])

  useEffect(() => {
    let alive = true

    const load = async () => {
      if (!operatorId) {
        setError('Некорректный id оператора')
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      const params = new URLSearchParams({
        view: 'operatorDetail',
        operatorId,
        dateFrom: dateFrom || '1900-01-01',
        dateTo: dateTo || '2999-12-31',
      })
      const response = await fetch(`/api/admin/salary?${params.toString()}`, {
        credentials: 'include',
      })
      const payload = (await response.json().catch(() => null)) as { error?: string; data?: SalaryDetailResponse } | null

      if (!alive) return

      if (!response.ok || !payload?.data) {
        setError(payload?.error || 'Ошибка при загрузке данных')
        setLoading(false)
        return
      }

      setOperator(payload.data.operator)
      setCompanies(payload.data.companies)
      setRules(payload.data.rules)
      setAssignments(payload.data.assignments)
      setIncomes(payload.data.incomes)
      setPayouts(payload.data.payouts)
      setLoading(false)
    }

    load()
    return () => {
      alive = false
    }
  }, [operatorId, dateFrom, dateTo])

  const shifts = useMemo<SalaryShiftBreakdown[]>(() => {
    if (!operatorId) return []
    return calculateOperatorShiftBreakdown({
      operatorId,
      companies,
      rules,
      assignments,
      incomes,
    })
  }, [assignments, companies, incomes, operatorId, rules])

  const assignedCompanyNames = useMemo(() => {
    const companyMap = new Map(companies.map((company) => [company.id, company.name]))
    return assignments
      .map((assignment) => companyMap.get(assignment.company_id))
      .filter(Boolean) as string[]
  }, [assignments, companies])

  const relevantRules = useMemo(() => {
    const assignedCodes = new Set(
      assignments
        .map((assignment) => companies.find((company) => company.id === assignment.company_id)?.code?.toLowerCase() || null)
        .filter(Boolean) as string[],
    )
    return rules.filter((rule) => assignedCodes.has(rule.company_code.toLowerCase()))
  }, [assignments, companies, rules])

  const totals = useMemo(() => {
    const totalShifts = shifts.length
    const totalRevenue = shifts.reduce((sum, shift) => sum + shift.totalIncome, 0)
    const totalSalary = shifts.reduce((sum, shift) => sum + shift.salary, 0)
    const avgRevenuePerShift = totalShifts > 0 ? totalRevenue / totalShifts : 0
    const avgSalaryPerShift = totalShifts > 0 ? totalSalary / totalShifts : 0
    const paidCount = shifts.reduce((acc, shift) => acc + (payoutMap.get(shift.payoutKey)?.is_paid ? 1 : 0), 0)

    return {
      totalShifts,
      totalRevenue,
      totalSalary,
      avgRevenuePerShift,
      avgSalaryPerShift,
      paidCount,
    }
  }, [payoutMap, shifts])

  const handlePreset = (nextPreset: DateRangePreset) => {
    const today = todayISO()
    setPreset(nextPreset)

    if (nextPreset === 'month') {
      setDateFrom(addDaysISO(today, -29))
      setDateTo(today)
      return
    }

    if (nextPreset === 'week') {
      setDateFrom(addDaysISO(today, -6))
      setDateTo(today)
      return
    }

    setDateFrom('')
    setDateTo('')
  }

  const togglePaid = useCallback(
    async (shift: SalaryShiftBreakdown) => {
      if (!operatorId) {
        setError('Некорректный id оператора')
        return
      }

      setError(null)
      setUpdatingKey(shift.id)

      try {
        const current = payoutMap.get(shift.payoutKey)
        const nextPaid = !(current?.is_paid ?? false)
        const response = await fetch('/api/admin/salary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            action: 'toggleShiftPayout',
            payload: {
              operator_id: operatorId,
              date: shift.date,
              shift: shift.shift,
              is_paid: nextPaid,
              paid_at: nextPaid ? new Date().toISOString() : null,
            },
          }),
        })
        const payload = (await response.json().catch(() => null)) as { error?: string; data?: PayoutRow } | null
        if (!response.ok || !payload?.data) {
          throw new Error(payload?.error || 'Не удалось обновить статус оплаты')
        }

        setPayouts((prev) => {
          const next = prev.filter((item) => `${item.date}_${item.shift}` !== shift.payoutKey)
          next.push(payload.data as PayoutRow)
          return next
        })
      } catch (err: any) {
        console.error(err)
        setError(err?.message || 'Не удалось обновить статус оплаты')
      } finally {
        setUpdatingKey(null)
      }
    },
    [operatorId, payoutMap],
  )

  const periodLabel = dateFrom || dateTo ? `${formatDate(dateFrom)} - ${formatDate(dateTo)}` : 'Весь период'

  if (loading) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex flex-1 items-center justify-center px-4 pt-20 text-muted-foreground md:px-8 md:pt-0">
          Загрузка карточки оператора...
        </main>
      </div>
    )
  }

  if (error || !operator) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex flex-1 flex-col items-center justify-center gap-3 px-4 pt-20 text-muted-foreground md:px-8 md:pt-0">
          <p>{error || 'Оператор не найден'}</p>
          <Link href="/salary">
            <Button variant="outline" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Назад к зарплате
            </Button>
          </Link>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-auto pt-20 md:pt-0">
        <div className="mx-auto max-w-7xl space-y-6 px-4 pb-8 pt-4 md:p-8">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div className="flex items-start gap-3">
              <Link href="/salary">
                <Button variant="ghost" size="icon" className="mr-1 hidden md:inline-flex">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <div>
                <div className="flex items-center gap-2">
                  <UserCircle2 className="h-6 w-6 text-purple-500" />
                  <h1 className="text-2xl font-bold md:text-3xl">{getOperatorDisplayName(operator)}</h1>
                  {!operator.is_active && (
                    <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-400">
                      неактивен
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Детальная статистика смен и зарплаты за выбранный период
                </p>
              </div>
            </div>

            <Link href="/salary/rules">
              <Button variant="outline" size="sm" className="gap-2 text-xs">
                <Settings2 className="h-4 w-4" />
                Правила зарплаты
              </Button>
            </Link>
          </div>

          <Card className="space-y-3 border-border bg-card/80 p-4 md:p-5">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Card className="flex flex-col justify-center border-border bg-background/40 p-4">
                <div className="mb-1 flex items-center gap-2 text-muted-foreground">
                  <Banknote className="h-4 w-4" />
                  <span className="text-xs uppercase tracking-wide">Всего зарплата</span>
                </div>
                <div className="text-xl font-bold text-foreground md:text-2xl">{formatMoney(totals.totalSalary)} ₸</div>
              </Card>

              <Card className="flex flex-col justify-center border-border bg-background/40 p-4">
                <div className="mb-1 flex items-center gap-2 text-muted-foreground">
                  <TrendingUp className="h-4 w-4" />
                  <span className="text-xs uppercase tracking-wide">Выручка</span>
                </div>
                <div className="text-xl font-bold text-foreground md:text-2xl">{formatMoney(totals.totalRevenue)} ₸</div>
                <div className="text-[10px] text-muted-foreground">
                  В среднем за смену: <span className="font-semibold">{formatMoney(totals.avgRevenuePerShift)} ₸</span>
                </div>
              </Card>

              <Card className="flex flex-col justify-center border-border bg-background/40 p-4">
                <div className="mb-1 flex items-center gap-2 text-muted-foreground">
                  <CalendarDays className="h-4 w-4" />
                  <span className="text-xs uppercase tracking-wide">Кол-во смен</span>
                </div>
                <div className="text-xl font-bold text-foreground md:text-2xl">{totals.totalShifts}</div>
                <div className="text-[10px] text-muted-foreground">
                  Средняя зарплата за смену: <span className="font-semibold">{formatMoney(totals.avgSalaryPerShift)} ₸</span>
                </div>
              </Card>

              <Card className="flex flex-col justify-center border border-accent/60 bg-accent/10 p-4">
                <div className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">Текущие правила</div>
                <div className="space-y-1 text-xs text-foreground">
                  <div>Активных правил: {relevantRules.length || 0}</div>
                  <div>
                    Точки: {assignedCompanyNames.length ? assignedCompanyNames.join(', ') : 'не назначены'}
                  </div>
                  <div>Роль-бонус учитывается автоматически</div>
                  <div>Ставка по умолчанию: {formatMoney(DEFAULT_SHIFT_BASE_PAY)} ₸</div>
                  <div className="pt-2 text-[11px] text-muted-foreground">
                    Оплачено смен: <span className="font-semibold text-foreground">{totals.paidCount}</span> /{' '}
                    <span className="font-semibold text-foreground">{totals.totalShifts}</span>
                  </div>
                </div>
              </Card>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <div className="flex items-center gap-1">
                <CalendarDays className="h-3 w-3" />
                <span className="uppercase tracking-wide">Период:</span>
                <span className="font-mono">{periodLabel}</span>
              </div>
            </div>
          </Card>

          <Card className="border-border bg-card p-4">
            <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Период</label>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex items-center rounded-md border border-border/50 bg-input/50 px-2 py-1">
                    <CalendarDays className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(event) => {
                        setDateFrom(event.target.value)
                        setPreset(null)
                      }}
                      className="cursor-pointer bg-transparent px-1 py-1 text-xs text-foreground outline-none"
                    />
                    <span className="px-1 text-xs text-muted-foreground">→</span>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(event) => {
                        setDateTo(event.target.value)
                        setPreset(null)
                      }}
                      className="cursor-pointer bg-transparent px-1 py-1 text-xs text-foreground outline-none"
                    />
                  </div>

                  <div className="flex rounded-md border border-border/30 bg-input/30 p-0.5">
                    {(['week', 'month', 'all'] as DateRangePreset[]).map((value) => (
                      <button
                        key={value}
                        onClick={() => handlePreset(value)}
                        className={`rounded px-3 py-1 text-[10px] transition-colors ${
                          preset === value ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-white/10'
                        }`}
                      >
                        {value === 'week' && 'Неделя'}
                        {value === 'month' && '30 дн.'}
                        {value === 'all' && 'Все'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="sticky top-0 z-10 border-b border-border bg-secondary/40 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
                    <th className="px-4 py-3 text-left">Дата</th>
                    <th className="px-4 py-3 text-center">Смена</th>
                    <th className="px-4 py-3 text-left">Точка</th>
                    <th className="px-4 py-3 text-left">Зоны</th>
                    <th className="px-4 py-3 text-right text-green-500">Нал</th>
                    <th className="px-4 py-3 text-right text-blue-500">Kaspi</th>
                    <th className="px-4 py-3 text-right text-purple-500">Карта</th>
                    <th className="px-4 py-3 text-right">Выручка</th>
                    <th className="px-4 py-3 text-right">Зарплата</th>
                    <th className="px-4 py-3 text-left">Комментарии</th>
                    <th className="px-4 py-3 text-center">Оплата</th>
                  </tr>
                </thead>

                <tbody className="text-sm">
                  {shifts.length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-6 py-10 text-center text-muted-foreground">
                        Нет смен за выбранный период.
                      </td>
                    </tr>
                  )}

                  {shifts.map((shift, index) => {
                    const payout = payoutMap.get(shift.payoutKey)
                    const isPaid = payout?.is_paid ?? false
                    const busy = updatingKey === shift.id

                    return (
                      <tr
                        key={shift.id}
                        className={`border-b border-border/40 transition-colors hover:bg-white/5 ${index % 2 === 0 ? 'bg-card/40' : ''}`}
                      >
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                          {formatDate(shift.date)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {shift.shift === 'day' ? (
                            <Sun className="inline h-4 w-4 text-yellow-400" />
                          ) : (
                            <Moon className="inline h-4 w-4 text-blue-400" />
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {shift.companyName || shift.companyCode || '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {shift.zones.length ? shift.zones.join(', ') : '—'}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono ${shift.cash ? 'text-foreground' : 'text-muted-foreground/20'}`}>
                          {shift.cash ? formatMoney(shift.cash) : '—'}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono ${shift.kaspi ? 'text-foreground' : 'text-muted-foreground/20'}`}>
                          {shift.kaspi ? formatMoney(shift.kaspi) : '—'}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono ${shift.card ? 'text-foreground' : 'text-muted-foreground/20'}`}>
                          {shift.card ? formatMoney(shift.card) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">{formatMoney(shift.totalIncome)}</td>
                        <td className="bg-accent/5 px-4 py-3 text-right font-mono font-semibold text-accent">
                          {formatMoney(shift.salary)}
                        </td>
                        <td className="max-w-[260px] px-4 py-3 text-xs text-muted-foreground">
                          {shift.comments.length ? shift.comments.join(' | ') : '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Button
                            size="xs"
                            variant={isPaid ? 'default' : 'outline'}
                            className={`gap-2 ${isPaid ? 'bg-emerald-600 hover:bg-emerald-600/90' : ''}`}
                            disabled={busy}
                            onClick={() => togglePaid(shift)}
                          >
                            {busy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : isPaid ? (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            ) : (
                              <Circle className="h-3.5 w-3.5" />
                            )}
                            <span className="text-[11px]">{isPaid ? 'Оплачено' : 'Не оплачено'}</span>
                          </Button>

                          {isPaid && payout?.paid_at && (
                            <div className="mt-1 text-[10px] text-muted-foreground">{formatDateTime(payout.paid_at)}</div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </main>
    </div>
  )
}
