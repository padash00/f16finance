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
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { DatePicker } from '@/components/ui/date-picker'
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

/**
 * Реверс: net (на руки) → gross (брутто).
 * Уравнение для льготного режима (G ≤ 25 МРП = 108 125 ₸):
 *   Net = 0.8712 * G + 605.5
 * Для нельготного:
 *   Net = 0.792 * G + 6055
 */
function netToGross(net: number): number {
  // Сначала пробуем льготный режим
  const gLgota = (net - 605.5) / 0.8712
  if (gLgota <= 25 * MRP_2026) return Math.round(gLgota)
  // Иначе нельготный
  return Math.round((net - 6055) / 0.792)
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
  const [iknRate, setIknRate] = useState(() => {
    if (typeof window === 'undefined') return 2
    const saved = localStorage.getItem('tax_ikn_rate')
    return saved ? Number(saved) : 2
  })

  // Учитывать сотрудников в итоговом расчёте
  const [includeEmployees, setIncludeEmployees] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('tax_include_employees') === '1'
  })

  // Учитывать соцплатежи "за себя" в итоге
  const [includeSelfSocial, setIncludeSelfSocial] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('tax_include_self_social') === '1'
  })

  // Включать F16 Extra (компании с code='extra') в налогооблагаемый оборот.
  // По дефолту OFF — те же правила что в /weekly-report, /reports.
  const [includeExtra, setIncludeExtra] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('tax_include_extra') === '1'
  })
  const [dateFrom, setDateFrom] = useState(startOfYearISO())
  const [dateTo, setDateTo] = useState(todayISO())
  // Raw incomes для гибкого расчёта по company × payment_type
  const [incomeRows, setIncomeRows] = useState<Array<{ date: string; company_id: string | null; cash_amount: number; kaspi_amount: number; online_amount: number; card_amount: number }>>([])
  const [companies, setCompanies] = useState<Array<{ id: string; name: string; show_in_structure?: boolean; code?: string | null }>>([])

  // Фильтр: какие источники учитывать в налогооблагаемом обороте
  // Структура: { [companyId]: { cash: bool, kaspi: bool, online: bool, card: bool } }
  // По умолчанию — всё учитывается
  const [taxableFilter, setTaxableFilter] = useState<Record<string, { cash: boolean; kaspi: boolean; online: boolean; card: boolean }>>(() => {
    if (typeof window === 'undefined') return {}
    try { return JSON.parse(localStorage.getItem('tax_filter') || '{}') } catch { return {} }
  })

  // Настройки бизнеса (ИИН/БИН, ОКЭД, флаг плательщика НДС)
  const [bizSettings, setBizSettings] = useState<{ bin: string; oked: string; ipnRate: number; vatPayer: boolean; companyFullName: string }>(() => {
    if (typeof window === 'undefined') return { bin: '', oked: '93290', ipnRate: 2, vatPayer: false, companyFullName: '' }
    try { return { bin: '', oked: '93290', ipnRate: 2, vatPayer: false, companyFullName: '', ...JSON.parse(localStorage.getItem('tax_business_settings') || '{}') } }
    catch { return { bin: '', oked: '93290', ipnRate: 2, vatPayer: false, companyFullName: '' } }
  })
  function updateBizSettings(patch: Partial<typeof bizSettings>) {
    const next = { ...bizSettings, ...patch }
    setBizSettings(next)
    localStorage.setItem('tax_business_settings', JSON.stringify(next))
  }

  // Активная вкладка
  const [activeTab, setActiveTab] = useState<'calc' | 'employees' | 'sources' | 'calendar' | 'thresholds' | 'help'>(() => {
    if (typeof window === 'undefined') return 'calc'
    return (sessionStorage.getItem('tax_tab') as any) || 'calc'
  })
  function changeTab(t: typeof activeTab) {
    setActiveTab(t)
    sessionStorage.setItem('tax_tab', t)
  }

  // Режим ввода окладов — "брутто" (как в договоре) или "net" (на руки)
  const [salaryMode, setSalaryMode] = useState<'gross' | 'net'>(() => {
    if (typeof window === 'undefined') return 'gross'
    return (localStorage.getItem('tax_salary_mode') as 'gross' | 'net') || 'gross'
  })

  function changeSalaryMode(m: 'gross' | 'net') {
    setSalaryMode(m)
    localStorage.setItem('tax_salary_mode', m)
  }

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
      // Период: тянем raw incomes — для гибкого фильтра по company × payment_type
      // Передаём include_extra=1 чтобы получить ВСЕ доходы (включая F16 Extra).
      // Логику включения Extra в налогооблагаемый оборот контролируем сами через toggle.
      const r = await fetch(`/api/admin/reports/bundle?from=${dateFrom}&to=${dateTo}&include_extra=1`)
      if (r.ok) {
        const json = await r.json()
        const data = json.data || json  // совместимость
        const incomes = (data.incomes || []) as any[]
        setIncomeRows(incomes.map((row) => ({
          date: row.date,
          company_id: row.company_id || null,
          cash_amount: Number(row.cash_amount || 0),
          kaspi_amount: Number(row.kaspi_amount || 0),
          online_amount: Number(row.online_amount || 0),
          card_amount: Number(row.card_amount || 0),
        })))
      }

      // Список компаний — используем тот же endpoint что и /settings,
      // чтобы данные совпадали (там пользователь видит все 3 компании)
      const rc = await fetch('/api/admin/settings', { cache: 'no-store' })
      if (rc.ok) {
        const cs = await rc.json()
        const list = (cs.companies || cs.data || []) as any[]
        setCompanies(list.map((c) => ({
          id: c.id,
          name: c.name,
          code: c.code || null,
          show_in_structure: c.show_in_structure !== false,
        })))
      }

      // Годовой оборот для проверки порогов — из тех же raw данных
      const ry = await fetch(`/api/admin/reports/bundle?from=${startOfYearISO()}&to=${todayISO()}&include_extra=1`)
      if (ry.ok) {
        const json = await ry.json()
        const data = json.data || json
        const yearIncomes = (data.incomes || []) as any[]
        const yearTotal = yearIncomes.reduce((s, r) => s + Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.online_amount || 0) + Number(r.card_amount || 0), 0)
        setYearRevenue(yearTotal)
      }
    } catch (e) {
      console.error('[tax] load error:', e)
    } finally {
      setLoading(false)
    }
  }

  // Detect F16 Extra компании (по code='extra' или name='F16 Extra')
  const extraCompanyId = useMemo(() => {
    const c = companies.find(
      (x) => (x.code || '').toLowerCase() === 'extra' || x.name === 'F16 Extra',
    )
    return c?.id ?? null
  }, [companies])

  // Helper: учитывается ли тип оплаты для компании в налогооблагаемом обороте
  function isTaxable(companyId: string | null, paymentType: 'cash' | 'kaspi' | 'online' | 'card') {
    // Глобальный exclude F16 Extra (как в weekly-report / reports)
    if (companyId && companyId === extraCompanyId && !includeExtra) return false
    if (!companyId) return true // если company_id null — учитываем по умолчанию
    const cfg = taxableFilter[companyId]
    if (!cfg) return true // дефолт: учитываем всё
    return cfg[paymentType] !== false
  }

  // Налогооблагаемая выручка с учётом фильтра
  const revenue = useMemo(() => {
    return incomeRows.reduce((sum, r) => {
      let taxable = 0
      if (isTaxable(r.company_id, 'cash')) taxable += r.cash_amount
      if (isTaxable(r.company_id, 'kaspi')) taxable += r.kaspi_amount
      if (isTaxable(r.company_id, 'online')) taxable += r.online_amount
      if (isTaxable(r.company_id, 'card')) taxable += r.card_amount
      return sum + taxable
    }, 0)
  }, [incomeRows, taxableFilter, includeExtra, extraCompanyId])

  // Полный оборот (без фильтра) — для информации
  const fullRevenue = useMemo(() => {
    return incomeRows.reduce((s, r) => s + r.cash_amount + r.kaspi_amount + r.online_amount + r.card_amount, 0)
  }, [incomeRows])

  // Помесячные данные с применением фильтра
  useEffect(() => {
    const byMonth = new Map<string, number>()
    for (const r of incomeRows) {
      let taxable = 0
      if (isTaxable(r.company_id, 'cash')) taxable += r.cash_amount
      if (isTaxable(r.company_id, 'kaspi')) taxable += r.kaspi_amount
      if (isTaxable(r.company_id, 'online')) taxable += r.online_amount
      if (isTaxable(r.company_id, 'card')) taxable += r.card_amount
      const m = r.date.slice(0, 7)
      byMonth.set(m, (byMonth.get(m) || 0) + taxable)
    }
    const monthly = Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, income]) => ({ month, income }))
    setMonthlyIncomes(monthly)
  }, [incomeRows, taxableFilter, includeExtra, extraCompanyId])

  // Per-company breakdown для UI фильтра
  // Включаем ВСЕ компании из БД (даже с 0 доходом за период) + Without company если есть строки без company_id
  const companyBreakdown = useMemo(() => {
    const m = new Map<string | null, { cash: number; kaspi: number; online: number; card: number; total: number }>()
    // Сначала проинициализируем все компании из БД с нулями
    for (const c of companies) {
      m.set(c.id, { cash: 0, kaspi: 0, online: 0, card: 0, total: 0 })
    }
    // Затем суммируем фактические incomes
    for (const r of incomeRows) {
      const cur = m.get(r.company_id) || { cash: 0, kaspi: 0, online: 0, card: 0, total: 0 }
      cur.cash += r.cash_amount
      cur.kaspi += r.kaspi_amount
      cur.online += r.online_amount
      cur.card += r.card_amount
      cur.total = cur.cash + cur.kaspi + cur.online + cur.card
      m.set(r.company_id, cur)
    }
    return Array.from(m.entries())
      .map(([cid, sums]) => ({
        id: cid,
        name: companies.find((c) => c.id === cid)?.name || (cid ? 'Без названия' : 'Без компании'),
        ...sums,
      }))
      // Сортировка: с доходами впереди, потом по убыванию суммы, "без компании" в конце
      .sort((a, b) => {
        if (!a.id && b.id) return 1
        if (a.id && !b.id) return -1
        return b.total - a.total
      })
  }, [incomeRows, companies])

  function toggleFilter(companyId: string, type: 'cash' | 'kaspi' | 'online' | 'card') {
    const next = { ...taxableFilter }
    const cfg = next[companyId] || { cash: true, kaspi: true, online: true, card: true }
    cfg[type] = !cfg[type]
    next[companyId] = cfg
    setTaxableFilter(next)
    localStorage.setItem('tax_filter', JSON.stringify(next))
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
  // В режиме 'net' введённое значение — это сумма на руки, нужно реверсировать в брутто
  const employeeCalc = useMemo(() => {
    const breakdowns = employees.map((e) => {
      const grossSalary = salaryMode === 'net' ? netToGross(e.salary) : e.salary
      return { ...e, displayInput: e.salary, grossSalary, calc: calcEmployeeTax(grossSalary) }
    })
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
  }, [employees, salaryMode])

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
    <div className="app-page-wide space-y-6">
      {/* Header */}
      <AdminPageHeader
        title="Налоги ИП (упрощёнка)"
        description="Расчёт налогов на упрощёнке · форма 910.00"
        icon={<Landmark className="h-5 w-5" />}
        accent="emerald"
        backHref="/"
        actions={
          <Card className="p-1 flex items-center gap-2 bg-card/50">
            <div className="flex items-center px-2">
              <CalendarDays className="w-4 h-4 text-muted-foreground mr-2" />
              <DatePicker value={dateFrom} onChange={setDateFrom} />
            </div>
            <span className="text-muted-foreground">—</span>
            <div className="flex items-center px-2">
              <DatePicker value={dateTo} onChange={setDateTo} />
            </div>
          </Card>
        }
        toolbar={
          <p className="text-muted-foreground text-sm">
            {bizSettings.companyFullName ? <><b className="text-foreground">{bizSettings.companyFullName}</b>, </> : null}
            ОКЭД {bizSettings.oked || '—'}{bizSettings.bin ? <>, БИН/ИИН {bizSettings.bin}</> : null} · форма 910.00
            {!bizSettings.vatPayer ? <span className="ml-2 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-blue-300">не плательщик НДС</span> : <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300">плательщик НДС 16%</span>}
          </p>
        }
      />

      {/* Хлебная цифра — сразу под header, на calc */}
      {activeTab === 'calc' && (() => {
        const grandTotal = calc.ipn
          + (includeSelfSocial ? calc.social : 0)
          + (includeEmployees ? employeeCalc.monthlyTaxFromEmployees * calc.monthsInPeriod : 0)
        return (
        <div className="rounded-3xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent p-6 sm:p-8">
          <div className="text-xs uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-300/80 mb-2">ИПН с дохода ({iknRate}%)</div>
          <div className="text-5xl sm:text-6xl font-bold bg-gradient-to-r from-emerald-300 to-teal-300 bg-clip-text text-transparent leading-none">
            {fmtCompact(grandTotal)}
          </div>
          <div className="mt-3 text-sm text-slate-700 dark:text-slate-300">
            ИПН ({iknRate}% × {fmtCompact(revenue)}) = <b className="text-foreground">{fmt(calc.ipn)}</b>
            {includeSelfSocial ? <> + соц «за себя» {fmt(calc.social)}</> : null}
            {includeEmployees && employees.length > 0 ? <> + за работников {fmt(employeeCalc.monthlyTaxFromEmployees * calc.monthsInPeriod)}</> : null}
          </div>
          <div className="mt-1 text-xs text-emerald-700 dark:text-emerald-200/60">
            Эффективная нагрузка: {revenue > 0 ? ((grandTotal / revenue) * 100).toFixed(2) : '0'}% от оборота
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
            <label className="flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white">
              <input
                type="checkbox"
                checked={includeSelfSocial}
                onChange={(e) => { setIncludeSelfSocial(e.target.checked); localStorage.setItem('tax_include_self_social', e.target.checked ? '1' : '0') }}
                className="h-4 w-4 accent-emerald-500"
              />
              Учитывать соцплатежи «за себя» ({fmt(SOCIAL_FIXED_MONTHLY)}/мес)
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white">
              <input
                type="checkbox"
                checked={includeEmployees}
                onChange={(e) => { setIncludeEmployees(e.target.checked); localStorage.setItem('tax_include_employees', e.target.checked ? '1' : '0') }}
                className="h-4 w-4 accent-emerald-500"
              />
              Учитывать налоги за работников
            </label>
            {extraCompanyId ? (
              <label className="flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white">
                <input
                  type="checkbox"
                  checked={includeExtra}
                  onChange={(e) => { setIncludeExtra(e.target.checked); localStorage.setItem('tax_include_extra', e.target.checked ? '1' : '0') }}
                  className="h-4 w-4 accent-emerald-500"
                />
                Включать F16 Extra в налог
              </label>
            ) : null}
          </div>
        </div>
        )
      })()}

      {/* Tabs */}
      <div className="sticky top-2 z-30 flex flex-wrap gap-1 rounded-2xl bg-slate-100 dark:bg-gray-900/85 backdrop-blur-xl border border-border p-1.5 shadow-2xl shadow-black/40">
        {([
          ['calc', '💰 Расчёт'],
          ['employees', '👥 Сотрудники'],
          ['sources', '🔎 Фильтр доходов'],
          ['calendar', '📅 Календарь и реквизиты'],
          ['thresholds', '⚠️ Пороги и НДС'],
          ['help', '📚 Справка'],
        ] as const).map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => changeTab(k)}
            className={`px-3 py-2 text-sm rounded-xl transition ${
              activeTab === k
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'text-muted-foreground hover:bg-slate-200 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Параметры расчёта (видны на всех вкладках кроме help/calendar) */}
      {activeTab !== 'help' && activeTab !== 'calendar' && (
      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Ставка ИПН (упрощёнка)</label>
            <div className="flex gap-1 rounded-xl border border-border bg-white dark:bg-slate-900/40 p-1">
              {[2, 3, 4, 5, 6].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => { setIknRate(r); localStorage.setItem('tax_ikn_rate', String(r)) }}
                  className={`px-3 py-1.5 text-sm rounded-lg transition ${
                    iknRate === r
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'text-muted-foreground hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {r}%{r === 4 ? ' (баз.)' : ''}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-slate-500">Маслихат вашего региона может назначить 2-6%</p>
          </div>

          <div>
            <div className="text-xs text-muted-foreground mb-1">Оборот за период</div>
            <div className="text-2xl font-bold text-emerald-300">
              {loading ? '…' : fmtCompact(revenue)}
            </div>
            <div className="text-[11px] text-slate-500">{calc.monthsInPeriod} мес</div>
          </div>
        </div>
      </Card>
      )}

      {/* KPI карточки — только на calc */}
      {activeTab === 'calc' && (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">ИПН ({iknRate}%)</div>
          <div className="text-2xl font-bold text-foreground">{fmtCompact(calc.ipn)}</div>
          <p className="mt-2 text-xs text-slate-500">Подоходный налог = оборот × {iknRate}%</p>
        </Card>

        <Card className="p-5">
          <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Соцплатежи (за себя)</div>
          <div className="text-2xl font-bold text-foreground">{fmtCompact(calc.social)}</div>
          <p className="mt-2 text-xs text-slate-500">{fmt(SOCIAL_FIXED_MONTHLY)}/мес × {calc.monthsInPeriod} мес</p>
        </Card>

        <Card className="p-5 border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-transparent">
          <div className="text-xs uppercase tracking-wider text-emerald-400 mb-2">{includeSelfSocial ? 'Итого к уплате' : 'Только ИПН'}</div>
          <div className="text-2xl font-bold text-emerald-300">{fmtCompact(includeSelfSocial ? calc.total : calc.ipn)}</div>
          <p className="mt-2 text-xs text-emerald-400/80">
            {includeSelfSocial ? `Эффективная ставка: ${calc.effectiveRate.toFixed(2)}%` : `Соц «за себя» считаешь сам: ${fmt(calc.social)}`}
          </p>
        </Card>
      </div>
      )}

      {/* === ФИЛЬТР: что включать в налогооблагаемый оборот === */}
      {activeTab === 'sources' && companyBreakdown.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-400" />
            Что включать в налогооблагаемый оборот
          </h3>
          <p className="text-[11px] text-slate-500 mb-3">
            Сними галочку чтобы исключить тип оплаты из расчёта (например, наличные на одной точке не учитывать).
            <br />Полный оборот: <b className="text-foreground">{fmt(fullRevenue)}</b> · в налог пойдёт: <b className="text-emerald-300">{fmt(revenue)}</b>
            <br />Из БД подтянуто компаний: <b className="text-foreground">{companies.length}</b>
            {companies.length < 3 ? (
              <span className="ml-1 text-amber-400">⚠️ Если у тебя больше — проверь /settings или RLS-политику на companies.</span>
            ) : null}
            {companyBreakdown.some((c) => !c.id) ? (
              <span className="block mt-1 text-amber-400">⚠️ Есть доходы без company_id (legacy) — раздел "Без компании" внизу.</span>
            ) : null}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="px-2 py-2">Компания</th>
                  <th className="px-2 py-2 text-center">Нал</th>
                  <th className="px-2 py-2 text-center">Безнал</th>
                  <th className="px-2 py-2 text-center">Online</th>
                  <th className="px-2 py-2 text-center">Карта</th>
                  <th className="px-2 py-2 text-right">Итого</th>
                </tr>
              </thead>
              <tbody>
                {companyBreakdown.map((c) => {
                  const cid = c.id || ''
                  const cfg = taxableFilter[cid] || { cash: true, kaspi: true, online: true, card: true }
                  const types: Array<{ k: 'cash' | 'kaspi' | 'online' | 'card'; v: number }> = [
                    { k: 'cash', v: c.cash },
                    { k: 'kaspi', v: c.kaspi },
                    { k: 'online', v: c.online },
                    { k: 'card', v: c.card },
                  ]
                  return (
                    <tr key={cid || 'no-co'} className="border-t border-slate-200 dark:border-white/5">
                      <td className="px-2 py-2 text-foreground">
                        {c.name}
                        {(() => {
                          const co = companies.find((x) => x.id === c.id)
                          if (co && co.show_in_structure === false) {
                            return <span className="ml-1.5 rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] text-amber-300" title="Скрыта в структуре /settings, но учитывается в налогах">скрыта</span>
                          }
                          return null
                        })()}
                      </td>
                      {types.map(({ k, v }) => (
                        <td key={k} className="px-2 py-2 text-center">
                          <label className="inline-flex flex-col items-center gap-0.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={cfg[k] !== false}
                              disabled={!cid}
                              onChange={() => cid && toggleFilter(cid, k)}
                              className="h-4 w-4 accent-emerald-500"
                            />
                            <span className="text-[9px] text-slate-500">{fmtCompact(v)}</span>
                          </label>
                        </td>
                      ))}
                      <td className="px-2 py-2 text-right text-slate-700 dark:text-slate-300">{fmt(c.total)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* === СОТРУДНИКИ === */}
      {activeTab === 'employees' && (
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Calculator className="w-4 h-4 text-amber-400" />
              Сотрудники (налоги за работников)
            </h3>
            <p className="text-[11px] text-slate-500 mt-1">
              Автоматически из <Link href="/staff" className="text-emerald-400 hover:underline">/staff</Link> · <Link href="/salary" className="text-emerald-400 hover:underline">/salary</Link>
              {staffFromDB.length > 0 ? <> · подтянуто {staffFromDB.length}</> : null}
              {excludedIds.size > 0 ? <> · скрыто {excludedIds.size}</> : null}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">Оклады заданы как:</span>
              <div className="flex rounded-lg border border-border bg-white dark:bg-slate-900/40 p-0.5 text-[11px]">
                <button
                  type="button"
                  onClick={() => changeSalaryMode('gross')}
                  className={`px-2 py-0.5 rounded ${salaryMode === 'gross' ? 'bg-emerald-500/20 text-emerald-300' : 'text-muted-foreground hover:text-slate-900 dark:hover:text-white'}`}
                >
                  Брутто (договор)
                </button>
                <button
                  type="button"
                  onClick={() => changeSalaryMode('net')}
                  className={`px-2 py-0.5 rounded ${salaryMode === 'net' ? 'bg-emerald-500/20 text-emerald-300' : 'text-muted-foreground hover:text-slate-900 dark:hover:text-white'}`}
                >
                  На руки (нетто)
                </button>
              </div>
              <span className="text-[10px] text-slate-500">{salaryMode === 'net' ? 'пересчитываем в брутто автоматически' : 'удержим налоги изнутри'}</span>
            </div>
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
              <div key={b.id} className="rounded-xl border border-border bg-white dark:bg-slate-900/40 p-3">
                <div className="flex flex-wrap items-end gap-3 mb-3">
                  <div className="flex-1 min-w-[180px]">
                    <label className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-2">
                      ФИО / должность
                      {b.id.startsWith('db:') ? <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[9px] text-blue-300">из БД</span>
                       : b.id.startsWith('override:') ? <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] text-amber-300">переопределено</span>
                       : <span className="rounded bg-slate-500/20 px-1.5 py-0.5 text-[9px] text-slate-700 dark:text-slate-300">вручную</span>}
                    </label>
                    <input
                      value={b.name}
                      onChange={(e) => updateEmployee(b.id, { name: e.target.value })}
                      placeholder="Например: Айгерим (повар)"
                      className="w-full rounded-lg border border-border bg-white dark:bg-slate-900/60 px-3 py-2 text-sm text-foreground outline-none focus:border-emerald-400/50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-slate-500">
                      Оклад / мес ({salaryMode === 'net' ? 'на руки' : 'брутто'})
                    </label>
                    <input
                      type="number"
                      value={b.displayInput}
                      onChange={(e) => updateEmployee(b.id, { salary: Math.max(0, Number(e.target.value) || 0) })}
                      className="w-36 rounded-lg border border-border bg-white dark:bg-slate-900/60 px-3 py-2 text-sm text-foreground outline-none focus:border-emerald-400/50"
                    />
                    {salaryMode === 'net' ? (
                      <span className="block mt-1 text-[10px] text-blue-300">
                        ↑ брутто: {fmt(b.grossSalary)}
                      </span>
                    ) : null}
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
                  <div className="rounded bg-slate-50 dark:bg-slate-900/40 p-2"><span className="text-slate-500 block">Удержано (с зп)</span><span className="text-foreground">{fmt(b.calc.withheld)}</span></div>
                  <div className="rounded bg-slate-50 dark:bg-slate-900/40 p-2"><span className="text-slate-500 block">На руки</span><span className="text-emerald-300">{fmt(b.calc.netSalary)}</span></div>
                  <div className="rounded bg-slate-50 dark:bg-slate-900/40 p-2"><span className="text-slate-500 block">Сверху работодатель</span><span className="text-amber-300">{fmt(b.calc.employerTop)}</span></div>
                  <div className="rounded bg-slate-50 dark:bg-slate-900/40 p-2"><span className="text-slate-500 block">Расход бизнеса</span><span className="text-foreground font-semibold">{fmt(b.calc.totalCost)}</span></div>
                </div>
                <details className="mt-2">
                  <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300">Детальная разбивка</summary>
                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10px]">
                    <div>ИПН (10%): <span className="text-foreground">{fmt(b.calc.ipn)}</span></div>
                    <div>ОПВ (10%): <span className="text-foreground">{fmt(b.calc.opv)}</span></div>
                    <div>ВОСМС работника (2%): <span className="text-foreground">{fmt(b.calc.vosmsEmp)}</span></div>
                    <div>ОПВР работодателя (3.5%): <span className="text-foreground">{fmt(b.calc.opvr)}</span></div>
                    <div>СО (3.5%): <span className="text-foreground">{fmt(b.calc.so)}</span></div>
                    <div>ОСМС (3%): <span className="text-foreground">{fmt(b.calc.osms)}</span></div>
                  </div>
                </details>
              </div>
            ))}

            {/* Сумма по всем работникам */}
            <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
              <div className="text-xs uppercase tracking-wider text-amber-300 mb-2">Итого по работникам в месяц</div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <div className="text-[10px] text-amber-700 dark:text-amber-100/70">ФОТ (брутто)</div>
                  <div className="font-semibold text-foreground">{fmt(employeeCalc.totalGross)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-amber-700 dark:text-amber-100/70">На руки сотрудникам</div>
                  <div className="font-semibold text-emerald-300">{fmt(employeeCalc.totalNet)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-amber-700 dark:text-amber-100/70">Налоги за работников</div>
                  <div className="font-semibold text-amber-300">{fmt(employeeCalc.monthlyTaxFromEmployees)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-amber-700 dark:text-amber-100/70">Расход на ФОТ</div>
                  <div className="font-bold text-foreground">{fmt(employeeCalc.totalCost)}</div>
                </div>
              </div>
              <p className="mt-3 text-[10px] text-amber-700 dark:text-amber-100/60">
                За {calc.monthsInPeriod} мес периода: <b>{fmt(employeeCalc.monthlyTaxFromEmployees * calc.monthsInPeriod)}</b> налогов за работников
              </p>
            </div>
          </div>
        )}
      </Card>
      )}

      {/* === ИТОГО ВСЕ НАЛОГИ === — sticky-bottom видно везде */}
      <Card className="sticky bottom-2 z-30 p-5 border-emerald-500/40 bg-gradient-to-br from-emerald-500/20 via-emerald-500/10 to-white dark:to-slate-950/95 backdrop-blur-xl shadow-2xl shadow-emerald-500/20">
        <h3 className="text-sm font-semibold text-emerald-300 mb-4 flex items-center gap-2">
          <Landmark className="w-4 h-4" />
          ИТОГО ВСЕ НАЛОГИ за {calc.monthsInPeriod} мес
        </h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-slate-700 dark:text-slate-300">ИПН ({iknRate}% от оборота)</span><span className="font-semibold text-foreground">{fmt(calc.ipn)}</span></div>
          {includeSelfSocial ? (
            <div className="flex justify-between"><span className="text-slate-700 dark:text-slate-300">Соцплатежи ИП "за себя"</span><span className="font-semibold text-foreground">{fmt(calc.social)}</span></div>
          ) : null}
          {includeEmployees && employees.length > 0 ? (
            <div className="flex justify-between"><span className="text-slate-700 dark:text-slate-300">Налоги за работников ({employees.length} чел)</span><span className="font-semibold text-foreground">{fmt(employeeCalc.monthlyTaxFromEmployees * calc.monthsInPeriod)}</span></div>
          ) : null}
          <div className="border-t border-emerald-500/20 pt-2 mt-2">
            <div className="flex justify-between text-base">
              <span className="text-emerald-700 dark:text-emerald-200 font-semibold">К уплате суммарно</span>
              <span className="font-bold text-emerald-300 text-xl">
                {fmt(calc.ipn + (includeSelfSocial ? calc.social : 0) + (includeEmployees ? employeeCalc.monthlyTaxFromEmployees * calc.monthsInPeriod : 0))}
              </span>
            </div>
            <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-200/70">
              Эффективная нагрузка: {revenue > 0 ? (((calc.ipn + (includeSelfSocial ? calc.social : 0) + (includeEmployees ? employeeCalc.monthlyTaxFromEmployees * calc.monthsInPeriod : 0)) / revenue) * 100).toFixed(2) : '0'}% от оборота
              {!includeSelfSocial ? ' · соц «за себя» не учтены' : ''}
              {!includeEmployees ? ' · работники не учтены' : ''}
            </p>
            <button
              type="button"
              onClick={async () => {
                const r = await fetch('/api/admin/tax/910-form', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    period: { from: dateFrom, to: dateTo },
                    bin: bizSettings.bin,
                    oked: bizSettings.oked,
                    companyFullName: bizSettings.companyFullName,
                    iknRate,
                    revenue,
                    ipnAmount: calc.ipn,
                    socialAmount: calc.social,
                    totalAmount: calc.ipn + calc.social,
                  }),
                })
                if (r.ok) {
                  const blob = await r.blob()
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `FNO_910_${dateFrom}_${dateTo}.xlsx`
                  a.click()
                  URL.revokeObjectURL(url)
                }
              }}
              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-200 hover:bg-emerald-500/25"
            >
              📄 Скачать форму 910.00 (Excel)
            </button>
          </div>
        </div>
      </Card>

      {/* Помесячный график — на calc */}
      {activeTab === 'calc' && chartData.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Calculator className="w-4 h-4 text-emerald-400" />
            Налог по месяцам
          </h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.4} />
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

      {/* Расшифровка соцплатежей — на employees */}
      {activeTab === 'employees' && (
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Info className="w-4 h-4 text-blue-400" />
          Соцплатежи за месяц (от 1 МЗП = {fmt(MZP_2026)})
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div className="rounded-lg bg-white dark:bg-slate-900/40 p-3 border border-slate-200 dark:border-white/5">
            <div className="text-xs text-muted-foreground">ОПВ (10%)</div>
            <div className="font-semibold text-foreground">{fmt(MZP_2026 * SOCIAL_RATES.OPV)}</div>
          </div>
          <div className="rounded-lg bg-white dark:bg-slate-900/40 p-3 border border-slate-200 dark:border-white/5">
            <div className="text-xs text-muted-foreground">ОПВР (3.5%)</div>
            <div className="font-semibold text-foreground">{fmt(MZP_2026 * SOCIAL_RATES.OPVR)}</div>
          </div>
          <div className="rounded-lg bg-white dark:bg-slate-900/40 p-3 border border-slate-200 dark:border-white/5">
            <div className="text-xs text-muted-foreground">СО (5%)</div>
            <div className="font-semibold text-foreground">{fmt(MZP_2026 * SOCIAL_RATES.SO)}</div>
          </div>
          <div className="rounded-lg bg-white dark:bg-slate-900/40 p-3 border border-slate-200 dark:border-white/5">
            <div className="text-xs text-muted-foreground">ВОСМС (7%)</div>
            <div className="font-semibold text-foreground">{fmt(MZP_2026 * SOCIAL_RATES.VOSMS)}</div>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Итого: {fmt(SOCIAL_FIXED_MONTHLY)}/мес = {fmt(SOCIAL_FIXED_MONTHLY * 6)}/полугодие
        </p>
      </Card>
      )}

      {/* Контроль порогов — на thresholds */}
      {activeTab === 'thresholds' && (
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          Контроль порогов на 2026 год
        </h3>

        {!bizSettings.vatPayer ? (
          <div className="mb-4 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-700 dark:text-blue-200">
            Ты <b>не плательщик НДС</b> (упрощёнка). НДС-порог скрыт. Отслеживается только лимит упрощёнки (600 000 МРП).
          </div>
        ) : null}

        <div className="space-y-4">
          {bizSettings.vatPayer ? (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-slate-700 dark:text-slate-300">Порог регистрации по НДС (10 000 МРП = {fmtCompact(NDS_THRESHOLD)})</span>
              <span className={`text-xs font-medium ${yearForecast.ndsRisk ? 'text-rose-400' : 'text-emerald-400'}`}>
                {fmtCompact(yearForecast.currentYearRevenue)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
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
          ) : null}

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-slate-700 dark:text-slate-300">Порог упрощёнки (600 000 МРП = {fmtCompact(SIMPLIFIED_THRESHOLD)})</span>
              <span className="text-xs font-medium text-emerald-400">
                {fmtCompact(yearForecast.currentYearRevenue)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-emerald-500"
                style={{ width: `${Math.min(100, (yearForecast.currentYearRevenue / SIMPLIFIED_THRESHOLD) * 100)}%` }}
              />
            </div>
          </div>

          {!loading && yearForecast.currentYearRevenue > 0 ? (
            <div className="rounded-lg bg-white dark:bg-slate-900/40 p-3 text-xs text-muted-foreground border border-slate-200 dark:border-transparent">
              Прогноз годового оборота при текущем темпе:{' '}
              <span className="text-foreground font-medium">{fmtCompact(yearForecast.projectedYear)}</span>
            </div>
          ) : null}
        </div>
      </Card>
      )}

      {/* Календарь и реквизиты — на calendar */}
      {activeTab === 'calendar' && (
        <CalendarSection iknRate={iknRate} calc={calc} employeeCalc={employeeCalc} hasEmployees={employees.length > 0} />
      )}

      {/* Настройки бизнеса — на help */}
      {activeTab === 'help' && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Info className="w-4 h-4 text-emerald-400" />
            Настройки моего бизнеса
          </h3>
          <p className="text-[11px] text-slate-500 mb-4">Используется в шапке страницы и (в будущем) для автозаполнения формы 910.00. Сохраняется локально.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">ФИО ИП / название</span>
              <input
                type="text"
                value={bizSettings.companyFullName}
                onChange={(e) => updateBizSettings({ companyFullName: e.target.value })}
                placeholder="ИП Кенескан А.К."
                className="w-full rounded-lg border border-border bg-white dark:bg-slate-900/60 px-3 py-2 text-sm text-foreground outline-none focus:border-emerald-400/50"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">ИИН / БИН</span>
              <input
                type="text"
                value={bizSettings.bin}
                onChange={(e) => updateBizSettings({ bin: e.target.value.replace(/\D/g, '').slice(0, 12) })}
                placeholder="123456789012"
                maxLength={12}
                className="w-full rounded-lg border border-border bg-white dark:bg-slate-900/60 px-3 py-2 text-sm text-foreground outline-none focus:border-emerald-400/50 font-mono"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">ОКЭД</span>
              <input
                type="text"
                value={bizSettings.oked}
                onChange={(e) => updateBizSettings({ oked: e.target.value.replace(/\D/g, '').slice(0, 5) })}
                placeholder="93290"
                maxLength={5}
                className="w-full rounded-lg border border-border bg-white dark:bg-slate-900/60 px-3 py-2 text-sm text-foreground outline-none focus:border-emerald-400/50 font-mono"
              />
              <p className="text-[10px] text-slate-500">93290 = «Прочая деятельность по организации отдыха и развлечений»</p>
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Плательщик НДС</span>
              <div className="flex rounded-lg border border-border bg-white dark:bg-slate-900/40 p-0.5">
                <button
                  type="button"
                  onClick={() => updateBizSettings({ vatPayer: false })}
                  className={`flex-1 px-3 py-1.5 rounded text-sm ${!bizSettings.vatPayer ? 'bg-blue-500/20 text-blue-300' : 'text-muted-foreground'}`}
                >
                  Нет (упрощёнка)
                </button>
                <button
                  type="button"
                  onClick={() => updateBizSettings({ vatPayer: true })}
                  className={`flex-1 px-3 py-1.5 rounded text-sm ${bizSettings.vatPayer ? 'bg-amber-500/20 text-amber-300' : 'text-muted-foreground'}`}
                >
                  Да (16%)
                </button>
              </div>
              <p className="text-[10px] text-slate-500">На упрощёнке НДС не платится — НДС не указывается в чеках и ценах.</p>
            </label>
          </div>
        </Card>
      )}

      {/* Справка — на help */}
      {activeTab === 'help' && (
      <Card className="p-5 bg-blue-500/5 border-blue-500/20">
        <h3 className="text-sm font-semibold text-blue-600 dark:text-blue-300 mb-2 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          Что нового в 2026 году
        </h3>
        <ul className="space-y-1.5 text-xs text-blue-700 dark:text-blue-100/80 list-disc pl-5">
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
      )}

      <p className="text-[10px] text-slate-600 text-center">
        Расчёт ориентировочный. Точные ставки и обязательства уточняйте у бухгалтера или на kgd.gov.kz
      </p>
    </div>
  )
}

// =================================================================
// Календарь платежей + реквизиты КБК/КНП (Казахстан 2026)
// =================================================================

function CalendarSection({
  iknRate, calc, employeeCalc, hasEmployees,
}: {
  iknRate: number
  calc: { ipn: number; social: number; total: number; monthsInPeriod: number }
  employeeCalc: { monthlyTaxFromEmployees: number; totalIpn: number; totalOpv: number; totalVosmsEmp: number; totalOpvr: number; totalSo: number; totalOsms: number }
  hasEmployees: boolean
}) {
  // Реквизиты — официальные КБК и КНП (Казахстан 2026)
  const REQUISITES = [
    { name: 'ИПН с упрощёнки (форма 910.00)', kbk: '101202', knp: '911', deadline: 'до 25 числа 2-го месяца после полугодия (25 авг / 25 фев)' },
    { name: 'ИПН с зарплаты работников', kbk: '101201', knp: '911', deadline: 'до 25 числа след. месяца' },
    { name: 'ОПВ работодателя за себя', kbk: '904101', knp: '010', deadline: 'до 25 числа след. месяца' },
    { name: 'ОПВ за работника', kbk: '904101', knp: '010', deadline: 'до 25 числа след. месяца' },
    { name: 'ОПВР работодателя', kbk: '904102', knp: '010', deadline: 'до 25 числа след. месяца' },
    { name: 'ВОСМС работника (2%)', kbk: '904201', knp: '121', deadline: 'до 25 числа след. месяца' },
    { name: 'ОСМС работодателя (3%)', kbk: '904201', knp: '122', deadline: 'до 25 числа след. месяца' },
    { name: 'СО (соц. отчисления, 3.5%)', kbk: '904103', knp: '015', deadline: 'до 25 числа след. месяца' },
  ]

  function copy(text: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text)
    }
  }

  // Ближайшие даты платежей
  const today = new Date()
  const nextMonthly = new Date(today.getFullYear(), today.getMonth(), 25)
  if (today > nextMonthly) nextMonthly.setMonth(nextMonthly.getMonth() + 1)
  const halfYearDue = today.getMonth() < 7
    ? new Date(today.getFullYear(), 7, 25)  // 25 августа за 1-е полугодие
    : new Date(today.getFullYear() + 1, 1, 25)  // 25 февраля за 2-е полугодие

  const daysToMonthly = Math.ceil((nextMonthly.getTime() - today.getTime()) / 86400000)
  const daysToHalfYear = Math.ceil((halfYearDue.getTime() - today.getTime()) / 86400000)

  return (
    <>
      {/* Дедлайны */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-5 border-amber-500/30 bg-amber-500/5">
          <div className="text-xs uppercase tracking-wider text-amber-300 mb-2">Ближайший ежемесячный платёж</div>
          <div className="text-2xl font-bold text-foreground">25 {nextMonthly.toLocaleString('ru-RU', { month: 'long' })}</div>
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-200/80">через {daysToMonthly} {daysToMonthly === 1 ? 'день' : daysToMonthly < 5 ? 'дня' : 'дней'}</p>
          <p className="mt-3 text-xs text-muted-foreground">Соцплатежи: ОПВ + ОПВР + ВОСМС + ОСМС + СО за прошлый месяц + ИПН с зарплаты</p>
          <p className="mt-2 text-sm text-amber-300 font-semibold">
            ≈ {fmt((SOCIAL_FIXED_MONTHLY + (hasEmployees ? employeeCalc.monthlyTaxFromEmployees : 0)))}
          </p>
        </Card>

        <Card className="p-5 border-emerald-500/30 bg-emerald-500/5">
          <div className="text-xs uppercase tracking-wider text-emerald-300 mb-2">Полугодовой ИПН (форма 910.00)</div>
          <div className="text-2xl font-bold text-foreground">{halfYearDue.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
          <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-200/80">через {daysToHalfYear} {daysToHalfYear === 1 ? 'день' : 'дней'}</p>
          <p className="mt-3 text-xs text-muted-foreground">ИПН с упрощёнки {iknRate}% от полугодового оборота</p>
          <p className="mt-2 text-sm text-emerald-300 font-semibold">≈ {fmt(calc.ipn)}</p>
        </Card>
      </div>

      {/* Сколько откладывать */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
          <Calculator className="w-4 h-4 text-blue-400" />
          Сколько откладывать ежемесячно
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Чтобы налог не «съел» оборотные деньги, переводи на отдельный счёт ежемесячно:
        </p>
        <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4">
          <div className="text-3xl font-bold text-blue-600 dark:text-blue-300">
            {fmt(Math.round((calc.total + (hasEmployees ? employeeCalc.monthlyTaxFromEmployees * calc.monthsInPeriod : 0)) / Math.max(1, calc.monthsInPeriod)))}
          </div>
          <p className="mt-1 text-xs text-blue-700 dark:text-blue-200/80">в месяц на «налоговую кубышку»</p>
        </div>
      </Card>

      {/* Реквизиты */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
          <Landmark className="w-4 h-4 text-emerald-400" />
          Реквизиты для оплаты (КБК и КНП)
        </h3>
        <p className="text-[11px] text-slate-500 mb-3">Скопируй в Halyk Business / Kaspi Business → Платежи в бюджет</p>
        <div className="space-y-2">
          {REQUISITES.map((r) => (
            <div key={r.name + r.kbk + r.knp} className="rounded-lg border border-border bg-white dark:bg-slate-900/40 p-3 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="text-sm text-foreground">{r.name}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{r.deadline}</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => copy(r.kbk)} className="rounded-lg bg-slate-100 dark:bg-slate-900/80 border border-border px-2 py-1 text-xs text-slate-700 dark:text-slate-200 hover:bg-emerald-500/20 hover:border-emerald-500/30">
                  КБК <span className="font-mono text-emerald-300">{r.kbk}</span>
                </button>
                <button onClick={() => copy(r.knp)} className="rounded-lg bg-slate-100 dark:bg-slate-900/80 border border-border px-2 py-1 text-xs text-slate-700 dark:text-slate-200 hover:bg-emerald-500/20 hover:border-emerald-500/30">
                  КНП <span className="font-mono text-emerald-300">{r.knp}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[10px] text-slate-500">Получатель: УГД по месту регистрации ИП. Уточняйте БИК/ИИК своего РНУ — они меняются в зависимости от региона.</p>
      </Card>

      {/* Что вообще делать */}
      <Card className="p-5 bg-blue-500/5 border-blue-500/20">
        <h3 className="text-sm font-semibold text-blue-600 dark:text-blue-300 mb-2 flex items-center gap-2">
          <Info className="w-4 h-4" />
          Что вообще делать (пошагово)
        </h3>
        <ol className="space-y-1.5 text-xs text-blue-700 dark:text-blue-100/80 list-decimal pl-5">
          <li><b>До 25-го каждого месяца</b> — оплачивай соцплатежи за прошлый месяц (ОПВ, ОПВР, СО, ВОСМС за себя; за работников — ИПН + ОПВ + ВОСМС + СО + ОСМС + ОПВР).</li>
          <li><b>До 25 августа</b> — заплати ИПН с упрощёнки за 1-е полугодие.</li>
          <li><b>До 15 августа</b> — сдай форму 910.00 в ЭФНО (cabinet.salyk.kz).</li>
          <li><b>До 25 февраля</b> следующего года — то же самое за 2-е полугодие, форма 910.00 до 15 февраля.</li>
          <li>Платежи делаешь в Kaspi Business / Halyk Business → раздел «Платежи в бюджет», вводишь КБК + КНП из таблицы выше.</li>
          <li>Все платежи и формы храни в облаке (Google Drive) в отдельной папке «Налоги {new Date().getFullYear()}».</li>
        </ol>
      </Card>
    </>
  )
}

