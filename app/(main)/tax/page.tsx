'use client'

/**
 * Налоговый калькулятор для ИП (Казахстан 2026, упрощёнка форма 910.00).
 *
 * Источники: НК РК с 01.01.2026.
 * — Розничный налог упразднён
 * — Упрощёнка: 4% базовая (маслихат может 2-6%)
 * — Соцплатежи "за себя" фикс ~21 675 ₸/мес от 1 МЗП
 * — НДС 16% при обороте > 10 000 МРП в год
 * — Лимит упрощёнки: 600 000 МРП в год
 */

import { useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import {
  Calculator,
  CalendarDays,
  Landmark,
  AlertTriangle,
  CheckCircle2,
  Info,
} from 'lucide-react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'

const MRP_2026 = 4_325
const MZP_2026 = 85_000

// Соцплатежи "за себя" — ежемесячно от 1 МЗП
const SOCIAL_RATES = { OPV: 0.10, OPVR: 0.035, SO: 0.05, VOSMS: 0.07 }
const SOCIAL_FIXED_MONTHLY =
  Math.round(MZP_2026 * SOCIAL_RATES.OPV) +
  Math.round(MZP_2026 * SOCIAL_RATES.OPVR) +
  Math.round(MZP_2026 * SOCIAL_RATES.SO) +
  Math.round(MZP_2026 * SOCIAL_RATES.VOSMS)

const NDS_THRESHOLD = 10_000 * MRP_2026
const SIMPLIFIED_THRESHOLD = 600_000 * MRP_2026

// === НАЛОГИ ЗА РАБОТНИКА (стандартный режим, 2026) ===
// Удерживается с работника:
//   ИПН 10% (с льготой 90% если оклад ≤ 25 МРП)
//   ОПВ 10% (макс с 50 МЗП)
//   ВОСМС работника 2%
// За счёт работодателя:
//   ОПВР 3.5%
//   СО 3.5% (макс с 7 МЗП)
//   ОСМС 3%
const EMPL_RATES = {
  IPN: 0.10,
  OPV_EMP: 0.10,
  VOSMS_EMP: 0.02,
  OPVR_ER: 0.035,
  SO_ER: 0.035,
  OSMS_ER: 0.03,
}

const STD_DEDUCTION_MRP = 14 // стандартный налоговый вычет 14 МРП в месяц

function calcEmployeeTax(grossSalary: number) {
  const opvLimit = 50 * MZP_2026
  const soLimit = 7 * MZP_2026

  const opv = Math.round(Math.min(grossSalary, opvLimit) * EMPL_RATES.OPV_EMP)
  const vosmsEmp = Math.round(grossSalary * EMPL_RATES.VOSMS_EMP)

  // ИПН: база = (зп - 14 МРП - ОПВ - ВОСМС работника)
  const ipnBase = Math.max(0, grossSalary - STD_DEDUCTION_MRP * MRP_2026 - opv - vosmsEmp)
  let ipn = Math.round(ipnBase * EMPL_RATES.IPN)
  // Льгота 90% если оклад ≤ 25 МРП = 108 125 ₸
  if (grossSalary <= 25 * MRP_2026) ipn = Math.round(ipn * 0.10)

  // Работодатель сверху
  const opvr = Math.round(grossSalary * EMPL_RATES.OPVR_ER)
  const so = Math.round(Math.min(grossSalary, soLimit) * EMPL_RATES.SO_ER)
  const osms = Math.round(grossSalary * EMPL_RATES.OSMS_ER)

  const withheld = ipn + opv + vosmsEmp        // удержания (за счёт работника)
  const employerTop = opvr + so + osms         // за счёт работодателя
  const netSalary = grossSalary - withheld     // на руки
  const totalCost = grossSalary + employerTop  // что уходит из бюджета

  return { ipn, opv, vosmsEmp, opvr, so, osms, withheld, employerTop, netSalary, totalCost, grossSalary }
}

interface Employee {
  id: string
  name: string
  salary: number
}

interface MonthlyTaxData {
  month: string
  monthName: string
  income: number
  ipn: number
  social: number
  total: number
}

function fmt(v: number) {
  return Math.round(v).toLocaleString('ru-RU') + ' ₸'
}
function fmtCompact(v: number) {
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + ' млн ₸'
  if (Math.abs(v) >= 1_000) return Math.round(v / 1_000) + 'к ₸'
  return Math.round(v).toLocaleString('ru-RU') + ' ₸'
}

function todayISO() { return new Date().toISOString().slice(0, 10) }
function startOfYearISO() { return `${new Date().getFullYear()}-01-01` }

export default function TaxPage() {
  const [iknRate, setIknRate] = useState(4)
  const [dateFrom, setDateFrom] = useState(startOfYearISO())
  const [dateTo, setDateTo] = useState(todayISO())
  const [revenue, setRevenue] = useState(0)
  // Сотрудники: берём из /api/admin/staff-salary (страницы /staff и /salary), но юзер
  // может добавить вручную; добавленные хранятся в localStorage
  const [staffFromDB, setStaffFromDB] = useState<Employee[]>([])
  const [extraEmployees, setExtraEmployees] = useState<Employee[]>(() => {
    if (typeof window === 'undefined') return []
    try { return JSON.parse(localStorage.getItem('tax_employees') || '[]') } catch { return [] }
  })
  const [excludedIds, setExcludedIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try { return new Set(JSON.parse(localStorage.getItem('tax_excluded_ids') || '[]')) } catch { return new Set() }
  })

  // Авто-загрузка штата из БД
  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch('/api/admin/staff-salary')
        if (!r.ok) return
        const data = await r.json()
        const staff = (data.staff || [])
          .filter((s: any) => s.is_active !== false && Number(s.monthly_salary || 0) > 0)
          .map((s: any) => ({
            id: 'db:' + s.id,
            name: s.short_name || s.full_name || 'Сотрудник',
            salary: Number(s.monthly_salary || 0),
          }))
        setStaffFromDB(staff)
      } catch (e) {
        console.error('[tax] staff load:', e)
      }
    })()
  }, [])

  // Объединённый список — БД (с возможностью exclude) + extra пользовательские
  const employees = useMemo<Employee[]>(() => {
    const fromDB = staffFromDB.filter((e) => !excludedIds.has(e.id))
    return [...fromDB, ...extraEmployees]
  }, [staffFromDB, excludedIds, extraEmployees])
  const [yearRevenue, setYearRevenue] = useState(0)
  const [monthlyIncomes, setMonthlyIncomes] = useState<{ month: string; income: number }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void load()
  }, [dateFrom, dateTo])

  async function load() {
    setLoading(true)
    try {
      // Период оборота
      const r = await fetch(`/api/admin/reports/bundle?from=${dateFrom}&to=${dateTo}`)
      if (r.ok) {
        const data = await r.json()
        setRevenue(data.totalsCur?.totalIncome || 0)

        // Помесячная разбивка по dailyIncome (если приходит)
        if (data.dailyIncome) {
          const byMonth = new Map<string, number>()
          for (const [date, val] of Object.entries(data.dailyIncome as Record<string, number>)) {
            const m = date.slice(0, 7)
            byMonth.set(m, (byMonth.get(m) || 0) + Number(val || 0))
          }
          const monthly = Array.from(byMonth.entries())
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, income]) => ({ month, income }))
          setMonthlyIncomes(monthly)
        } else {
          setMonthlyIncomes([])
        }
      }

      // Годовой оборот для проверки порогов
      const ry = await fetch(`/api/admin/reports/bundle?from=${startOfYearISO()}&to=${todayISO()}`)
      if (ry.ok) {
        const data = await ry.json()
        setYearRevenue(data.totalsCur?.totalIncome || 0)
      }
    } catch (e) {
      console.error('[tax] load error:', e)
    } finally {
      setLoading(false)
    }
  }

  // Помесячный chart с расчётом налога
  const chartData = useMemo<MonthlyTaxData[]>(() => {
    return monthlyIncomes.map(({ month, income }) => {
      const ipn = Math.round(income * (iknRate / 100))
      const social = SOCIAL_FIXED_MONTHLY
      const monthName = new Date(month + '-01').toLocaleString('ru-RU', { month: 'short', year: '2-digit' })
      return { month, monthName, income, ipn, social, total: ipn + social }
    })
  }, [monthlyIncomes, iknRate])

  // Расчёт налога за весь период
  const calc = useMemo(() => {
    const ipn = Math.round(revenue * (iknRate / 100))
    const monthsInPeriod = monthlyIncomes.length || 1
    const social = SOCIAL_FIXED_MONTHLY * monthsInPeriod
    const total = ipn + social
    const effectiveRate = revenue > 0 ? (total / revenue) * 100 : 0
    return { ipn, social, total, effectiveRate, monthsInPeriod }
  }, [revenue, iknRate, monthlyIncomes.length])

  // Налоги за сотрудников — рассчитываем для каждого
  const employeeCalc = useMemo(() => {
    const breakdowns = employees.map((e) => ({ ...e, calc: calcEmployeeTax(e.salary) }))
    const totalIpn = breakdowns.reduce((s, b) => s + b.calc.ipn, 0)
    const totalOpv = breakdowns.reduce((s, b) => s + b.calc.opv, 0)
    const totalVosmsEmp = breakdowns.reduce((s, b) => s + b.calc.vosmsEmp, 0)
    const totalOpvr = breakdowns.reduce((s, b) => s + b.calc.opvr, 0)
    const totalSo = breakdowns.reduce((s, b) => s + b.calc.so, 0)
    const totalOsms = breakdowns.reduce((s, b) => s + b.calc.osms, 0)
    const totalWithheld = breakdowns.reduce((s, b) => s + b.calc.withheld, 0)
    const totalEmployerTop = breakdowns.reduce((s, b) => s + b.calc.employerTop, 0)
    const totalGross = breakdowns.reduce((s, b) => s + b.salary, 0)
    const totalNet = breakdowns.reduce((s, b) => s + b.calc.netSalary, 0)
    const totalCost = breakdowns.reduce((s, b) => s + b.calc.totalCost, 0)
    // Все налоги за работников (что переводит ИП в бюджет ежемесячно)
    const monthlyTaxFromEmployees = totalIpn + totalOpv + totalVosmsEmp + totalOpvr + totalSo + totalOsms
    return {
      breakdowns, totalIpn, totalOpv, totalVosmsEmp, totalOpvr, totalSo, totalOsms,
      totalWithheld, totalEmployerTop, totalGross, totalNet, totalCost, monthlyTaxFromEmployees,
    }
  }, [employees])

  function addEmployee() {
    const e: Employee = { id: 'manual:' + Math.random().toString(36).slice(2, 10), name: '', salary: MZP_2026 }
    const next = [...extraEmployees, e]
    setExtraEmployees(next)
    localStorage.setItem('tax_employees', JSON.stringify(next))
  }
  function updateEmployee(id: string, patch: Partial<Employee>) {
    if (id.startsWith('db:')) {
      // Для БД-сотрудников сохраняем override в extras со старым id заменён
      const dbEmp = staffFromDB.find((e) => e.id === id)
      if (!dbEmp) return
      // Override: добавляем в excluded и создаём manual копию
      const newExc = new Set([...excludedIds, id])
      setExcludedIds(newExc)
      localStorage.setItem('tax_excluded_ids', JSON.stringify([...newExc]))
      const e: Employee = { id: 'override:' + id.slice(3), name: dbEmp.name, salary: dbEmp.salary, ...patch }
      const next = [...extraEmployees, e]
      setExtraEmployees(next)
      localStorage.setItem('tax_employees', JSON.stringify(next))
      return
    }
    const next = extraEmployees.map((e) => (e.id === id ? { ...e, ...patch } : e))
    setExtraEmployees(next)
    localStorage.setItem('tax_employees', JSON.stringify(next))
  }
  function removeEmployee(id: string) {
    if (id.startsWith('db:')) {
      // Для БД-сотрудников помечаем как excluded
      const newExc = new Set([...excludedIds, id])
      setExcludedIds(newExc)
      localStorage.setItem('tax_excluded_ids', JSON.stringify([...newExc]))
      return
    }
    const next = extraEmployees.filter((e) => e.id !== id)
    setExtraEmployees(next)
    localStorage.setItem('tax_employees', JSON.stringify(next))
  }
  function restoreFromDB() {
    setExcludedIds(new Set())
    localStorage.setItem('tax_excluded_ids', '[]')
  }

  // Прогноз на конец года + контроль порогов
  const yearForecast = useMemo(() => {
    const today = new Date()
    const dayOfYear = Math.floor((today.getTime() - new Date(today.getFullYear(), 0, 1).getTime()) / 86400000) + 1
    const projectedYear = yearRevenue * (365 / dayOfYear)
    return {
      currentYearRevenue: yearRevenue,
      projectedYear,
      ndsRisk: projectedYear > NDS_THRESHOLD,
      ndsRemaining: Math.max(0, NDS_THRESHOLD - yearRevenue),
      simplifiedRisk: projectedYear > SIMPLIFIED_THRESHOLD,
    }
  }, [yearRevenue])

  return (
    <div className="app-page-wide space-y-6 px-3 sm:px-4 py-4">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <Landmark className="w-8 h-8 text-emerald-500" />
            Налоги ИП (упрощёнка)
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Расчёт по НК РК 2026 — форма 910.00, ИПН + соцплатежи
          </p>
        </div>

        <Card className="p-1 flex items-center gap-2 bg-card/50">
          <div className="flex items-center px-2">
            <CalendarDays className="w-4 h-4 text-muted-foreground mr-2" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="bg-transparent text-sm text-foreground outline-none"
            />
          </div>
          <span className="text-muted-foreground">—</span>
          <div className="flex items-center px-2">
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="bg-transparent text-sm text-foreground outline-none"
            />
          </div>
        </Card>
      </div>

      {/* Параметры расчёта */}
      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Ставка ИПН (упрощёнка)</label>
            <div className="flex gap-1 rounded-xl border border-white/10 bg-slate-900/40 p-1">
              {[2, 3, 4, 5, 6].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setIknRate(r)}
                  className={`px-3 py-1.5 text-sm rounded-lg transition ${
                    iknRate === r
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {r}%{r === 4 ? ' (баз.)' : ''}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-slate-500">Маслихат вашего региона может назначить 2-6%</p>
          </div>

          <div>
            <div className="text-xs text-slate-400 mb-1">Оборот за период</div>
            <div className="text-2xl font-bold text-emerald-300">
              {loading ? '…' : fmtCompact(revenue)}
            </div>
            <div className="text-[11px] text-slate-500">{calc.monthsInPeriod} мес</div>
          </div>
        </div>
      </Card>

      {/* KPI карточки */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">ИПН ({iknRate}%)</div>
          <div className="text-2xl font-bold text-white">{fmtCompact(calc.ipn)}</div>
          <p className="mt-2 text-xs text-slate-500">Подоходный налог = оборот × {iknRate}%</p>
        </Card>

        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-slate-400 mb-2">Соцплатежи (за себя)</div>
          <div className="text-2xl font-bold text-white">{fmtCompact(calc.social)}</div>
          <p className="mt-2 text-xs text-slate-500">{fmt(SOCIAL_FIXED_MONTHLY)}/мес × {calc.monthsInPeriod} мес</p>
        </Card>

        <Card className="p-5 border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-transparent">
          <div className="text-xs uppercase tracking-wider text-emerald-400 mb-2">Итого к уплате</div>
          <div className="text-2xl font-bold text-emerald-300">{fmtCompact(calc.total)}</div>
          <p className="mt-2 text-xs text-emerald-400/80">Эффективная ставка: {calc.effectiveRate.toFixed(2)}%</p>
        </Card>
      </div>

      {/* === СОТРУДНИКИ === */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Calculator className="w-4 h-4 text-amber-400" />
              Сотрудники (налоги за работников)
            </h3>
            <p className="text-[11px] text-slate-500 mt-1">
              Автоматически из <a href="/staff" className="text-emerald-400 hover:underline">/staff</a> · <a href="/salary" className="text-emerald-400 hover:underline">/salary</a>
              {staffFromDB.length > 0 ? <> · подтянуто {staffFromDB.length}</> : null}
              {excludedIds.size > 0 ? <> · скрыто {excludedIds.size}</> : null}
            </p>
          </div>
          <div className="flex gap-2">
            {excludedIds.size > 0 ? (
              <button
                type="button"
                onClick={restoreFromDB}
                className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-500/20"
              >
                ↻ Восстановить из БД
              </button>
            ) : null}
            <button
              type="button"
              onClick={addEmployee}
              className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
            >
              + Добавить вручную
            </button>
          </div>
        </div>

        {employees.length === 0 ? (
          <p className="text-sm text-slate-500 italic">
            Нет активных сотрудников с окладом в БД. Заведи их на странице <a href="/staff" className="text-emerald-400 hover:underline">/staff</a> или нажми «Добавить вручную».
          </p>
        ) : (
          <div className="space-y-2">
            {employeeCalc.breakdowns.map((b) => (
              <div key={b.id} className="rounded-xl border border-white/10 bg-slate-900/40 p-3">
                <div className="flex flex-wrap items-end gap-3 mb-3">
                  <div className="flex-1 min-w-[180px]">
                    <label className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-2">
                      ФИО / должность
                      {b.id.startsWith('db:') ? <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[9px] text-blue-300">из БД</span>
                       : b.id.startsWith('override:') ? <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] text-amber-300">переопределено</span>
                       : <span className="rounded bg-slate-500/20 px-1.5 py-0.5 text-[9px] text-slate-300">вручную</span>}
                    </label>
                    <input
                      value={b.name}
                      onChange={(e) => updateEmployee(b.id, { name: e.target.value })}
                      placeholder="Например: Айгерим (повар)"
                      className="w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-slate-500">Оклад / мес (брутто)</label>
                    <input
                      type="number"
                      value={b.salary}
                      onChange={(e) => updateEmployee(b.id, { salary: Math.max(0, Number(e.target.value) || 0) })}
                      className="w-36 rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/50"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeEmployee(b.id)}
                    className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/20"
                  >
                    Удалить
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="rounded bg-slate-900/40 p-2"><span className="text-slate-500 block">Удержано (с зп)</span><span className="text-white">{fmt(b.calc.withheld)}</span></div>
                  <div className="rounded bg-slate-900/40 p-2"><span className="text-slate-500 block">На руки</span><span className="text-emerald-300">{fmt(b.calc.netSalary)}</span></div>
                  <div className="rounded bg-slate-900/40 p-2"><span className="text-slate-500 block">Сверху работодатель</span><span className="text-amber-300">{fmt(b.calc.employerTop)}</span></div>
                  <div className="rounded bg-slate-900/40 p-2"><span className="text-slate-500 block">Расход бизнеса</span><span className="text-white font-semibold">{fmt(b.calc.totalCost)}</span></div>
                </div>
                <details className="mt-2">
                  <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-300">Детальная разбивка</summary>
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px]">
                    <div>ИПН (10%): <span className="text-white">{fmt(b.calc.ipn)}</span></div>
                    <div>ОПВ (10%): <span className="text-white">{fmt(b.calc.opv)}</span></div>
                    <div>ВОСМС работника (2%): <span className="text-white">{fmt(b.calc.vosmsEmp)}</span></div>
                    <div>ОПВР работодателя (3.5%): <span className="text-white">{fmt(b.calc.opvr)}</span></div>
                    <div>СО (3.5%): <span className="text-white">{fmt(b.calc.so)}</span></div>
                    <div>ОСМС (3%): <span className="text-white">{fmt(b.calc.osms)}</span></div>
                  </div>
                </details>
              </div>
            ))}

            {/* Сумма по всем работникам */}
            <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="text-xs uppercase tracking-wider text-amber-300 mb-2">Итого по работникам в месяц</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <div className="text-[10px] text-amber-100/70">ФОТ (брутто)</div>
                  <div className="font-semibold text-white">{fmt(employeeCalc.totalGross)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-amber-100/70">На руки сотрудникам</div>
                  <div className="font-semibold text-emerald-300">{fmt(employeeCalc.totalNet)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-amber-100/70">Налоги за работников</div>
                  <div className="font-semibold text-amber-300">{fmt(employeeCalc.monthlyTaxFromEmployees)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-amber-100/70">Расход на ФОТ</div>
                  <div className="font-bold text-white">{fmt(employeeCalc.totalCost)}</div>
                </div>
              </div>
              <p className="mt-3 text-[10px] text-amber-100/60">
                За {calc.monthsInPeriod} мес периода: <b>{fmt(employeeCalc.monthlyTaxFromEmployees * calc.monthsInPeriod)}</b> налогов за работников
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* === ИТОГО ВСЕ НАЛОГИ === */}
      <Card className="p-5 border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent">
        <h3 className="text-sm font-semibold text-emerald-300 mb-4 flex items-center gap-2">
          <Landmark className="w-4 h-4" />
          ИТОГО ВСЕ НАЛОГИ за {calc.monthsInPeriod} мес
        </h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-300">ИПН ({iknRate}% от оборота)</span><span className="font-semibold text-white">{fmt(calc.ipn)}</span></div>
          <div className="flex justify-between"><span className="text-slate-300">Соцплатежи ИП "за себя"</span><span className="font-semibold text-white">{fmt(calc.social)}</span></div>
          {employees.length > 0 ? (
            <div className="flex justify-between"><span className="text-slate-300">Налоги за работников ({employees.length} чел)</span><span className="font-semibold text-white">{fmt(employeeCalc.monthlyTaxFromEmployees * calc.monthsInPeriod)}</span></div>
          ) : null}
          <div className="border-t border-emerald-500/20 pt-2 mt-2">
            <div className="flex justify-between text-base">
              <span className="text-emerald-200 font-semibold">К уплате суммарно</span>
              <span className="font-bold text-emerald-300 text-xl">
                {fmt(calc.ipn + calc.social + employeeCalc.monthlyTaxFromEmployees * calc.monthsInPeriod)}
              </span>
            </div>
            <p className="mt-2 text-xs text-emerald-200/70">
              Эффективная нагрузка: {revenue > 0 ? (((calc.ipn + calc.social + employeeCalc.monthlyTaxFromEmployees * calc.monthsInPeriod) / revenue) * 100).toFixed(2) : '0'}% от оборота
            </p>
          </div>
        </div>
      </Card>

      {/* Помесячный график */}
      {chartData.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Calculator className="w-4 h-4 text-emerald-400" />
            Налог по месяцам
          </h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.2} />
                <XAxis dataKey="monthName" stroke="#9ca3af" fontSize={11} />
                <YAxis stroke="#9ca3af" fontSize={11} tickFormatter={(v) => fmtCompact(v)} />
                <Tooltip
                  contentStyle={{ background: 'rgba(17,24,39,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                  formatter={(v: number, name: string) => {
                    const labels: Record<string, string> = { income: 'Оборот', ipn: 'ИПН', social: 'Соцплатежи', total: 'Итого' }
                    return [fmt(v), labels[name] || name]
                  }}
                />
                <Bar dataKey="income" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="total" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Расшифровка соцплатежей */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
          <Info className="w-4 h-4 text-blue-400" />
          Соцплатежи за месяц (от 1 МЗП = {fmt(MZP_2026)})
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div className="rounded-lg bg-slate-900/40 p-3 border border-white/5">
            <div className="text-xs text-slate-400">ОПВ (10%)</div>
            <div className="font-semibold text-white">{fmt(MZP_2026 * SOCIAL_RATES.OPV)}</div>
          </div>
          <div className="rounded-lg bg-slate-900/40 p-3 border border-white/5">
            <div className="text-xs text-slate-400">ОПВР (3.5%)</div>
            <div className="font-semibold text-white">{fmt(MZP_2026 * SOCIAL_RATES.OPVR)}</div>
          </div>
          <div className="rounded-lg bg-slate-900/40 p-3 border border-white/5">
            <div className="text-xs text-slate-400">СО (5%)</div>
            <div className="font-semibold text-white">{fmt(MZP_2026 * SOCIAL_RATES.SO)}</div>
          </div>
          <div className="rounded-lg bg-slate-900/40 p-3 border border-white/5">
            <div className="text-xs text-slate-400">ВОСМС (7%)</div>
            <div className="font-semibold text-white">{fmt(MZP_2026 * SOCIAL_RATES.VOSMS)}</div>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Итого: {fmt(SOCIAL_FIXED_MONTHLY)}/мес = {fmt(SOCIAL_FIXED_MONTHLY * 6)}/полугодие
        </p>
      </Card>

      {/* Контроль порогов */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          Контроль порогов на 2026 год
        </h3>

        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-slate-300">Порог регистрации по НДС (10 000 МРП = {fmtCompact(NDS_THRESHOLD)})</span>
              <span className={`text-xs font-medium ${yearForecast.ndsRisk ? 'text-rose-400' : 'text-emerald-400'}`}>
                {fmtCompact(yearForecast.currentYearRevenue)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className={`h-full ${
                  yearForecast.currentYearRevenue / NDS_THRESHOLD > 0.8
                    ? 'bg-rose-500'
                    : yearForecast.currentYearRevenue / NDS_THRESHOLD > 0.5
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.min(100, (yearForecast.currentYearRevenue / NDS_THRESHOLD) * 100)}%` }}
              />
            </div>
            {yearForecast.ndsRisk ? (
              <p className="mt-1 text-xs text-rose-400">
                ⚠️ Прогноз на год превысит порог НДС. Регистрация по НДС обязательна (16%).
              </p>
            ) : yearForecast.ndsRemaining > 0 ? (
              <p className="mt-1 text-xs text-slate-500">До НДС осталось: {fmtCompact(yearForecast.ndsRemaining)}</p>
            ) : null}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-slate-300">Порог упрощёнки (600 000 МРП = {fmtCompact(SIMPLIFIED_THRESHOLD)})</span>
              <span className="text-xs font-medium text-emerald-400">
                {fmtCompact(yearForecast.currentYearRevenue)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-emerald-500"
                style={{ width: `${Math.min(100, (yearForecast.currentYearRevenue / SIMPLIFIED_THRESHOLD) * 100)}%` }}
              />
            </div>
          </div>

          {!loading && yearForecast.currentYearRevenue > 0 ? (
            <div className="rounded-lg bg-slate-900/40 p-3 text-xs text-slate-400">
              Прогноз годового оборота при текущем темпе:{' '}
              <span className="text-white font-medium">{fmtCompact(yearForecast.projectedYear)}</span>
            </div>
          ) : null}
        </div>
      </Card>

      {/* Справка */}
      <Card className="p-5 bg-blue-500/5 border-blue-500/20">
        <h3 className="text-sm font-semibold text-blue-300 mb-2 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          Что нового в 2026 году
        </h3>
        <ul className="space-y-1.5 text-xs text-blue-100/80 list-disc pl-5">
          <li>
            <b>Отменены:</b> патент, розничный налог, режим фиксированного вычета
          </li>
          <li>
            <b>Упрощёнка (форма 910.00):</b> ставка <b>4% базовая</b>, маслихат может 2-6%
          </li>
          <li>
            <b>НДС:</b> повышен с 12% до <b>16%</b>, порог регистрации снижен с 20 000 МРП до 10 000 МРП
          </li>
          <li>
            <b>МРП 2026:</b> {fmt(MRP_2026)} | <b>МЗП 2026:</b> {fmt(MZP_2026)}
          </li>
          <li>
            <b>Период:</b> декларация подаётся раз в полугодие
          </li>
          <li>
            <b>Соцналог</b> на упрощёнке НЕ платится (ст. 722 НК РК)
          </li>
        </ul>
      </Card>

      <p className="text-[10px] text-slate-600 text-center">
        Расчёт ориентировочный. Точные ставки и обязательства уточняйте у бухгалтера или на kgd.gov.kz
      </p>
    </div>
  )
}
