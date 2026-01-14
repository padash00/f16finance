'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import { CalendarDays, ArrowLeft, Users2, Search, X } from 'lucide-react'

type Company = {
  id: string
  name: string
  code: string | null
}

type IncomeRow = {
  id: string
  date: string
  company_id: string
  shift: 'day' | 'night' | null
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
  operator_id: string | null
  is_virtual: boolean | null
}

type AdjustmentKind = 'debt' | 'fine' | 'bonus' | 'advance'

type AdjustmentRow = {
  id: number
  operator_id: string
  date: string
  amount: number
  kind: AdjustmentKind
  comment: string | null
}

type DebtRow = {
  id: string
  operator_id: string | null
  amount: number | null
  week_start: string | null
  status: string | null
}

type Operator = {
  id: string
  name: string
  short_name: string | null
  is_active: boolean
}

type OperatorAnalyticsRow = {
  operatorId: string
  operatorName: string

  shifts: number // уникальные смены
  days: number

  totalTurnover: number
  avgPerShift: number
  share: number

  autoDebts: number
  manualMinus: number
  manualPlus: number
  advances: number
  netEffect: number
}

type SortKey = 'turnover' | 'avg' | 'penalties' | 'net'

const toISODateLocal = (d: Date) => {
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

const fromISO = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

const getMonday = (d: Date) => {
  const date = new Date(d)
  const day = date.getDay() || 7
  if (day !== 1) date.setDate(date.getDate() - (day - 1))
  date.setHours(0, 0, 0, 0)
  return date
}

const mondayISOOf = (iso: string) => toISODateLocal(getMonday(fromISO(iso)))

const formatMoney = (v: number, fmt: Intl.NumberFormat) => `${fmt.format(Math.round(v || 0))} ₸`

export default function OperatorAnalyticsPage() {
  const moneyFmt = useMemo(() => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }), [])

  // период по умолчанию: текущая неделя
  const [dateFrom, setDateFrom] = useState(() => toISODateLocal(getMonday(new Date())))
  const [dateTo, setDateTo] = useState(() => {
    const mon = getMonday(new Date())
    const sun = new Date(mon)
    sun.setDate(mon.getDate() + 6)
    return toISODateLocal(sun)
  })

  // static data
  const [companies, setCompanies] = useState<Company[]>([])
  const [operators, setOperators] = useState<Operator[]>([])

  // range data
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([])
  const [debts, setDebts] = useState<DebtRow[]>([])

  const [loading, setLoading] = useState(true)
  const [staticLoading, setStaticLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // фильтры компаний
  const [includeArena, setIncludeArena] = useState(true)
  const [includeRamen, setIncludeRamen] = useState(true)
  const [includeExtra, setIncludeExtra] = useState(true)

  // сортировка + поиск
  const [sortKey, setSortKey] = useState<SortKey>('turnover')
  const [search, setSearch] = useState('')

  // защита от “гонок” запросов
  const reqIdRef = useRef(0)

  // защита от dateFrom > dateTo (swap)
  useEffect(() => {
    if (dateFrom <= dateTo) return
    setDateFrom(dateTo)
    setDateTo(dateFrom)
  }, [dateFrom, dateTo])

  const setThisWeek = () => {
    const now = new Date()
    const mon = getMonday(now)
    const sun = new Date(mon)
    sun.setDate(mon.getDate() + 6)
    setDateFrom(toISODateLocal(mon))
    setDateTo(toISODateLocal(sun))
  }

  const setLastWeek = () => {
    const now = new Date()
    const mon = getMonday(now)
    mon.setDate(mon.getDate() - 7)
    const sun = new Date(mon)
    sun.setDate(mon.getDate() + 6)
    setDateFrom(toISODateLocal(mon))
    setDateTo(toISODateLocal(sun))
  }

  const allowedCodes = useMemo(() => {
    const set = new Set<string>()
    if (includeArena) set.add('arena')
    if (includeRamen) set.add('ramen')
    if (includeExtra) set.add('extra')
    return set
  }, [includeArena, includeRamen, includeExtra])

  const companyById = useMemo(() => {
    const m = new Map<string, Company>()
    for (const c of companies) m.set(c.id, c)
    return m
  }, [companies])

  const operatorById = useMemo(() => {
    const m = new Map<string, Operator>()
    for (const o of operators) m.set(o.id, o)
    return m
  }, [operators])

  const selectedCompanyIds = useMemo(() => {
    if (!companies.length) return []
    return companies
      .filter((c) => allowedCodes.has((c.code || '').toLowerCase()))
      .map((c) => c.id)
  }, [companies, allowedCodes])

  // 1) грузим компании + операторов один раз
  useEffect(() => {
    const loadStatic = async () => {
      setStaticLoading(true)
      setError(null)

      const [compRes, opsRes] = await Promise.all([
        supabase.from('companies').select('id,name,code'),
        supabase.from('operators').select('id,name,short_name,is_active').eq('is_active', true).order('name'),
      ])

      if (compRes.error || opsRes.error) {
        console.error('OperatorAnalytics static load error', {
          compErr: compRes.error,
          opsErr: opsRes.error,
        })
        setError('Ошибка загрузки справочников (companies/operators)')
        setCompanies((compRes.data || []) as Company[])
        setOperators((opsRes.data || []) as Operator[])
        setStaticLoading(false)
        return
      }

      setCompanies((compRes.data || []) as Company[])
      setOperators((opsRes.data || []) as Operator[])
      setStaticLoading(false)
    }

    loadStatic()
  }, [])

  // 2) грузим данные периода (incomes/adjustments/debts) при смене дат/фильтров компаний
  useEffect(() => {
    const loadRange = async () => {
      // если справочники ещё не готовы — не дергаем диапазонные запросы
      if (staticLoading) return

      const myId = ++reqIdRef.current
      setLoading(true)
      setError(null)

      // debts берём по week_start (понедельники), иначе кастомные даты ломают выборку
      const wsFrom = mondayISOOf(dateFrom)
      const wsTo = mondayISOOf(dateTo)

      // если вообще ничего не выбрано по компаниям — выручку просто делаем пустой
      const shouldFetchIncomes = selectedCompanyIds.length > 0

      const incomesQ = shouldFetchIncomes
        ? supabase
            .from('incomes')
            .select('id,date,company_id,shift,cash_amount,kaspi_amount,card_amount,operator_id,is_virtual')
            .gte('date', dateFrom)
            .lte('date', dateTo)
            .in('company_id', selectedCompanyIds)
        : null

      // корректировки — только по активным операторам (чтоб “мертвые души” не всплывали)
      const operatorIds = operators.map((o) => o.id)
      const adjQ =
        operatorIds.length > 0
          ? supabase
              .from('operator_salary_adjustments')
              .select('id,operator_id,date,amount,kind,comment')
              .gte('date', dateFrom)
              .lte('date', dateTo)
              .in('operator_id', operatorIds)
          : supabase
              .from('operator_salary_adjustments')
              .select('id,operator_id,date,amount,kind,comment')
              .gte('date', dateFrom)
              .lte('date', dateTo)

      const debtsQ =
        operatorIds.length > 0
          ? supabase
              .from('debts')
              .select('id,operator_id,amount,week_start,status')
              .gte('week_start', wsFrom)
              .lte('week_start', wsTo)
              .eq('status', 'active')
              .in('operator_id', operatorIds)
          : supabase
              .from('debts')
              .select('id,operator_id,amount,week_start,status')
              .gte('week_start', wsFrom)
              .lte('week_start', wsTo)
              .eq('status', 'active')

      const [incRes, adjRes, debtsRes] = await Promise.all([
        incomesQ ? incomesQ : Promise.resolve({ data: [], error: null } as any),
        adjQ,
        debtsQ,
      ])

      if (myId !== reqIdRef.current) return // устаревший ответ

      if (incRes.error || adjRes.error || debtsRes.error) {
        console.error('OperatorAnalytics range load error', {
          incErr: incRes.error,
          adjErr: adjRes.error,
          debtsErr: debtsRes.error,
        })
        setError('Ошибка загрузки данных периода (incomes/adjustments/debts)')
      }

      setIncomes((incRes.data || []) as IncomeRow[])
      setAdjustments((adjRes.data || []) as AdjustmentRow[])
      setDebts((debtsRes.data || []) as DebtRow[])

      setLoading(false)
    }

    loadRange()
  }, [dateFrom, dateTo, selectedCompanyIds.join('|'), operators, staticLoading])

  const analytics = useMemo(() => {
    // быстрые структуры
    const byOperator = new Map<string, OperatorAnalyticsRow>()
    const daysByOperator = new Map<string, Set<string>>()
    const shiftsByOperator = new Map<string, Set<string>>() // уникальные смены

    let totalTurnover = 0
    let totalAutoDebts = 0
    let totalMinus = 0
    let totalPlus = 0
    let totalAdvances = 0

    const ensureOp = (id: string | null): OperatorAnalyticsRow | null => {
      if (!id) return null
      const meta = operatorById.get(id)
      if (!meta) return null // показываем только активных операторов
      let op = byOperator.get(id)
      if (!op) {
        const name = meta.short_name || meta.name || 'Без имени'
        op = {
          operatorId: id,
          operatorName: name,
          shifts: 0,
          days: 0,
          totalTurnover: 0,
          avgPerShift: 0,
          share: 0,
          autoDebts: 0,
          manualMinus: 0,
          manualPlus: 0,
          advances: 0,
          netEffect: 0,
        }
        byOperator.set(id, op)
        daysByOperator.set(id, new Set())
        shiftsByOperator.set(id, new Set())
      }
      return op
    }

    // 1) Выручка + уникальные смены
    for (const row of incomes) {
      if (!row.operator_id) continue

      const company = companyById.get(row.company_id)
      const code = (company?.code || '').toLowerCase()
      if (!code) continue
      // (здесь уже сервером отфильтровано по company_id, но пусть будет страховка)
      if (!allowedCodes.has(code)) continue

      const op = ensureOp(row.operator_id)
      if (!op) continue

      const total =
        Number(row.cash_amount || 0) +
        Number(row.kaspi_amount || 0) +
        Number(row.card_amount || 0)

      if (!Number.isFinite(total) || total <= 0) continue

      op.totalTurnover += total
      totalTurnover += total

      // дни
      daysByOperator.get(row.operator_id)!.add(row.date)

      // смены (уникальный ключ)
      const shiftKey = `${row.date}|${row.shift || 'na'}|${row.company_id}|${row.operator_id}`
      shiftsByOperator.get(row.operator_id)!.add(shiftKey)
    }

    // 2) Долги из debts (active)
    for (const d of debts) {
      const op = ensureOp(d.operator_id)
      if (!op) continue
      const amount = Number(d.amount || 0)
      if (!Number.isFinite(amount) || amount <= 0) continue
      op.autoDebts += amount
      totalAutoDebts += amount
    }

    // 3) Ручные корректировки
    for (const adj of adjustments) {
      const op = ensureOp(adj.operator_id)
      if (!op) continue

      const amount = Number(adj.amount || 0)
      if (!Number.isFinite(amount) || amount <= 0) continue

      if (adj.kind === 'bonus') {
        op.manualPlus += amount
        totalPlus += amount
      } else if (adj.kind === 'advance') {
        op.advances += amount
        totalAdvances += amount
      } else {
        op.manualMinus += amount
        totalMinus += amount
      }
    }

    // 4) финализация
    const arr: OperatorAnalyticsRow[] = []
    for (const op of byOperator.values()) {
      op.days = daysByOperator.get(op.operatorId)?.size || 0
      op.shifts = shiftsByOperator.get(op.operatorId)?.size || 0
      op.avgPerShift = op.shifts > 0 ? op.totalTurnover / op.shifts : 0
      op.share = totalTurnover > 0 ? op.totalTurnover / totalTurnover : 0
      op.netEffect = op.manualPlus - op.manualMinus - op.autoDebts
      arr.push(op)
    }

    // поиск
    const term = search.trim().toLowerCase()
    const searched = term ? arr.filter((r) => r.operatorName.toLowerCase().includes(term)) : arr

    // сортировка
    const sorted = [...searched].sort((a, b) => {
      if (sortKey === 'turnover') return b.totalTurnover - a.totalTurnover
      if (sortKey === 'avg') return b.avgPerShift - a.avgPerShift
      if (sortKey === 'penalties') {
        const pa = a.autoDebts + a.manualMinus
        const pb = b.autoDebts + b.manualMinus
        return pb - pa
      }
      return b.netEffect - a.netEffect
    })

    // итоги по отфильтрованной таблице
    const totalsFiltered = sorted.reduce(
      (acc, r) => {
        acc.turnover += r.totalTurnover
        acc.shifts += r.shifts
        acc.days += r.days
        acc.autoDebts += r.autoDebts
        acc.manualMinus += r.manualMinus
        acc.manualPlus += r.manualPlus
        acc.advances += r.advances
        acc.netEffect += r.netEffect
        return acc
      },
      {
        turnover: 0,
        shifts: 0,
        days: 0,
        autoDebts: 0,
        manualMinus: 0,
        manualPlus: 0,
        advances: 0,
        netEffect: 0,
      },
    )

    return {
      rows: sorted,
      totalTurnover,
      totalAutoDebts,
      totalMinus,
      totalPlus,
      totalAdvances,
      totalsFiltered,
    }
  }, [
    companyById,
    operatorById,
    incomes,
    debts,
    adjustments,
    allowedCodes,
    search,
    sortKey,
  ])

  const totalPenalties = analytics.totalAutoDebts + analytics.totalMinus

  const bestOperator = useMemo(() => (analytics.rows.length ? analytics.rows[0] : null), [analytics.rows])

  const mostNegative = useMemo(() => {
    if (!analytics.rows.length) return null
    return analytics.rows.reduce((max, cur) => {
      const curMinus = cur.autoDebts + cur.manualMinus
      const maxMinus = max.autoDebts + max.manualMinus
      return curMinus > maxMinus ? cur : max
    }, analytics.rows[0])
  }, [analytics.rows])

  const avgPerShiftClub = useMemo(() => {
    const shifts = analytics.totalsFiltered.shifts
    const turnover = analytics.totalsFiltered.turnover
    return shifts > 0 ? Math.round(turnover / shifts) : 0
  }, [analytics.totalsFiltered])

  const noCompaniesSelected = useMemo(() => selectedCompanyIds.length === 0, [selectedCompanyIds])

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
          {/* Хедер */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link href="/dashboard">
                <Button variant="ghost" size="icon" className="rounded-full">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                  <Users2 className="w-6 h-6 text-emerald-400" />
                  Аналитика операторов
                </h1>
                <p className="text-xs text-muted-foreground">
                  Выручка, смены, долги, штрафы, премии за период. Смены считаются умно.
                </p>
              </div>
            </div>

            {/* Даты */}
            <div className="flex flex-col items-end gap-2">
              <div className="flex gap-2">
                <Button size="xs" variant="outline" onClick={setLastWeek} className="h-7 text-[11px]">
                  Прошлая неделя
                </Button>
                <Button size="xs" variant="outline" onClick={setThisWeek} className="h-7 text-[11px]">
                  Эта неделя
                </Button>
              </div>

              <div className="flex items-center gap-2 bg-card/40 border border-border/60 rounded-lg px-2 py-1">
                <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="bg-transparent text-xs px-1 py-0.5 rounded outline-none"
                />
                <span className="text-[10px] text-muted-foreground">—</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="bg-transparent text-xs px-1 py-0.5 rounded outline-none"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded border border-red-500/30 bg-red-500/10 text-red-300 text-sm">
              ⚠️ {error}
            </div>
          )}

          {noCompaniesSelected && (
            <div className="p-3 rounded border border-yellow-500/30 bg-yellow-500/10 text-yellow-200 text-sm">
              ⚠️ Компании отключены — выручка будет 0. (Долги/штрафы/премии всё равно считаются.)
            </div>
          )}

          {/* Фильтры */}
          <Card className="p-4 bg-card/70 border-border flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
                Компании:
              </span>

              <button
                onClick={() => setIncludeArena((v) => !v)}
                className={`text-[11px] px-2 py-1 rounded border ${
                  includeArena
                    ? 'border-emerald-500/50 text-emerald-300 bg-emerald-500/10'
                    : 'border-border text-muted-foreground'
                }`}
              >
                Arena
              </button>

              <button
                onClick={() => setIncludeRamen((v) => !v)}
                className={`text-[11px] px-2 py-1 rounded border ${
                  includeRamen
                    ? 'border-amber-500/50 text-amber-300 bg-amber-500/10'
                    : 'border-border text-muted-foreground'
                }`}
              >
                Ramen
              </button>

              <button
                onClick={() => setIncludeExtra((v) => !v)}
                className={`text-[11px] px-2 py-1 rounded border ${
                  includeExtra
                    ? 'border-violet-500/50 text-violet-300 bg-violet-500/10'
                    : 'border-border text-muted-foreground'
                }`}
              >
                Extra
              </button>
            </div>

            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-[11px] text-muted-foreground uppercase tracking-wider">
                Сортировка:
              </span>

              {(
                [
                  ['turnover', 'Выручка'],
                  ['net', 'Чистый эффект'],
                  ['penalties', 'Минусы'],
                  ['avg', 'Ср. смена'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setSortKey(k)}
                  className={`text-[11px] px-2 py-1 rounded border ${
                    sortKey === k
                      ? 'border-accent text-accent bg-accent/10'
                      : 'border-border text-muted-foreground'
                  }`}
                >
                  {label}
                </button>
              ))}

              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск оператора..."
                  className="h-8 pl-7 pr-7 bg-input border border-border rounded text-xs outline-none focus:border-accent"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-white"
                    type="button"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </Card>

          {/* Карточки сверху */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <Card className="p-4 bg-card/70 border-border">
              <p className="text-xs text-muted-foreground mb-1">Общая выручка (по таблице)</p>
              <p className="text-2xl font-bold">
                {formatMoney(analytics.totalsFiltered.turnover, moneyFmt)}
              </p>
            </Card>

            <Card className="p-4 bg-card/70 border-border">
              <p className="text-xs text-muted-foreground mb-1">Средняя выручка за смену</p>
              <p className="text-2xl font-bold text-emerald-400">{formatMoney(avgPerShiftClub, moneyFmt)}</p>
            </Card>

            <Card className="p-4 bg-card/70 border-border">
              <p className="text-xs text-muted-foreground mb-1">Премии (плюс)</p>
              <p className="text-2xl font-bold text-emerald-300">{formatMoney(analytics.totalPlus, moneyFmt)}</p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Авансы (инфо): {formatMoney(analytics.totalAdvances, moneyFmt)}
              </p>
            </Card>

            <Card className="p-4 bg-card/70 border-border">
              <p className="text-xs text-muted-foreground mb-1">Долги и штрафы (минус)</p>
              <p className="text-2xl font-bold text-red-400">{formatMoney(totalPenalties, moneyFmt)}</p>
              {mostNegative && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Больше всего минусов: <span className="text-red-300">{mostNegative.operatorName}</span>
                </p>
              )}
            </Card>

            <Card className="p-4 bg-card/70 border-border">
              <p className="text-xs text-muted-foreground mb-1">Лучший по выручке</p>
              {bestOperator ? (
                <>
                  <p className="text-lg font-semibold">{bestOperator.operatorName}</p>
                  <p className="text-sm text-emerald-400">{formatMoney(bestOperator.totalTurnover, moneyFmt)}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {bestOperator.shifts} смен • {formatMoney(bestOperator.avgPerShift, moneyFmt)} / смена
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Нет данных</p>
              )}
            </Card>
          </div>

          {/* Таблица операторов */}
          <Card className="p-4 bg-card/80 border-border overflow-x-auto">
            <table className="w-full text-xs md:text-sm border-collapse">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase text-muted-foreground">
                  <th className="py-2 px-2 text-left">Оператор</th>
                  <th className="py-2 px-2 text-center">Смен</th>
                  <th className="py-2 px-2 text-center">Дней</th>
                  <th className="py-2 px-2 text-right">Выручка</th>
                  <th className="py-2 px-2 text-right">Ср. смена</th>
                  <th className="py-2 px-2 text-right">Доля</th>
                  <th className="py-2 px-2 text-right text-red-300">Долги</th>
                  <th className="py-2 px-2 text-right text-red-300">Штраф/минус</th>
                  <th className="py-2 px-2 text-right text-emerald-300">Премии</th>
                  <th className="py-2 px-2 text-right text-muted-foreground">Авансы</th>
                  <th className="py-2 px-2 text-right">Чистый эффект</th>
                </tr>
              </thead>

              <tbody>
                {(staticLoading || loading) && (
                  <tr>
                    <td colSpan={11} className="py-8 text-center text-muted-foreground text-xs">
                      Загрузка...
                    </td>
                  </tr>
                )}

                {!staticLoading && !loading && !analytics.rows.length && (
                  <tr>
                    <td colSpan={11} className="py-8 text-center text-muted-foreground text-xs">
                      Нет данных за выбранный период / фильтры.
                    </td>
                  </tr>
                )}

                {!staticLoading &&
                  !loading &&
                  analytics.rows.map((op) => {
                    const penalties = op.autoDebts + op.manualMinus
                    const netColor =
                      op.netEffect > 0
                        ? 'text-emerald-300'
                        : op.netEffect < 0
                        ? 'text-red-300'
                        : 'text-muted-foreground'

                    return (
                      <tr key={op.operatorId} className="border-t border-border/40 hover:bg-white/5">
                        <td className="py-1.5 px-2 font-medium">{op.operatorName}</td>
                        <td className="py-1.5 px-2 text-center">{op.shifts}</td>
                        <td className="py-1.5 px-2 text-center">{op.days}</td>
                        <td className="py-1.5 px-2 text-right">{formatMoney(op.totalTurnover, moneyFmt)}</td>
                        <td className="py-1.5 px-2 text-right">{formatMoney(op.avgPerShift, moneyFmt)}</td>
                        <td className="py-1.5 px-2 text-right">{(op.share * 100).toFixed(1)}%</td>

                        <td className="py-1.5 px-2 text-right text-red-300">{formatMoney(op.autoDebts, moneyFmt)}</td>
                        <td className="py-1.5 px-2 text-right text-red-300">{formatMoney(op.manualMinus, moneyFmt)}</td>
                        <td className="py-1.5 px-2 text-right text-emerald-300">{formatMoney(op.manualPlus, moneyFmt)}</td>
                        <td className="py-1.5 px-2 text-right text-muted-foreground">{formatMoney(op.advances, moneyFmt)}</td>

                        <td className={`py-1.5 px-2 text-right font-semibold ${netColor}`}>
                          {formatMoney(op.netEffect, moneyFmt)}
                          {penalties > 0 && (
                            <span className="ml-2 text-[10px] text-muted-foreground">
                              (минус: {formatMoney(penalties, moneyFmt)})
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>

              {!staticLoading && !loading && analytics.rows.length > 0 && (
                <tfoot>
                  <tr className="border-t border-border bg-white/5">
                    <td className="py-2 px-2 font-semibold">Итого</td>
                    <td className="py-2 px-2 text-center font-semibold">{analytics.totalsFiltered.shifts}</td>
                    <td className="py-2 px-2 text-center font-semibold">{analytics.totalsFiltered.days}</td>
                    <td className="py-2 px-2 text-right font-semibold">
                      {formatMoney(analytics.totalsFiltered.turnover, moneyFmt)}
                    </td>
                    <td className="py-2 px-2 text-right text-muted-foreground">—</td>
                    <td className="py-2 px-2 text-right text-muted-foreground">—</td>
                    <td className="py-2 px-2 text-right font-semibold text-red-300">
                      {formatMoney(analytics.totalsFiltered.autoDebts, moneyFmt)}
                    </td>
                    <td className="py-2 px-2 text-right font-semibold text-red-300">
                      {formatMoney(analytics.totalsFiltered.manualMinus, moneyFmt)}
                    </td>
                    <td className="py-2 px-2 text-right font-semibold text-emerald-300">
                      {formatMoney(analytics.totalsFiltered.manualPlus, moneyFmt)}
                    </td>
                    <td className="py-2 px-2 text-right font-semibold text-muted-foreground">
                      {formatMoney(analytics.totalsFiltered.advances, moneyFmt)}
                    </td>
                    <td className="py-2 px-2 text-right font-semibold">
                      {formatMoney(analytics.totalsFiltered.netEffect, moneyFmt)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </Card>
        </div>
      </main>
    </div>
  )
}
