/**
 * Общее для страницы /reports: типы, константы, форматирование и даты, CSV,
 * разбор URL-параметров и сборка строк операций для «Деталей» и PDF.
 */

import { Activity, AlertTriangle, Lightbulb, TrendingUp } from 'lucide-react'

// =====================
// TYPES
// =====================
export type Shift = 'day' | 'night'

export interface IncomeRow {
  id: string
  date: string
  company_id: string
  shift: Shift
  zone: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  kaspi_before_midnight?: number | null
  online_amount: number | null
  card_amount: number | null
  comment: string | null
  created_at?: string
}

export interface ExpenseRow {
  id: string
  date: string
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  comment: string | null
  created_at?: string
  operator_id?: string | null
}

export interface Company {
  id: string
  name: string
  code?: string | null
}

export type GroupMode = 'day' | 'week' | 'month' | 'year'
export type DatePreset = 'custom' | 'today' | 'yesterday' | 'last7' | 'prevWeek' | 'last30' | 'currentMonth' | 'prevMonth' | 'last90' | 'currentQuarter' | 'prevQuarter' | 'currentYear' | 'prevYear'

export type SortDirection = 'asc' | 'desc'
export type SortField = 'date' | 'company' | 'amount' | 'category' | 'shift' | 'zone'

export interface TimeAggregation {
  key: string
  label: string
  sortISO: string
  income: number
  expense: number
  profit: number
  incomeCash: number
  incomeKaspi: number
  incomeOnline: number
  incomeCard: number
  incomeNonCash: number
  expenseCash: number
  expenseKaspi: number
  count: number
}

export type InsightType = 'warning' | 'success' | 'info' | 'opportunity' | 'danger'

export interface AIInsight {
  type: InsightType
  title: string
  description: string
  metric?: string
  trend?: 'up' | 'down' | 'neutral'
}

export type Severity = 'low' | 'medium' | 'high' | 'critical'
export type AnomalyType = 'income_spike' | 'expense_spike' | 'low_profit' | 'no_data' | 'high_cash_ratio'

export interface Anomaly {
  type: AnomalyType
  date: string
  description: string
  severity: Severity
  value: number
  companyId?: string
}

export interface DetailedRow {
  id: string
  date: string
  type: 'income' | 'expense'
  companyId: string
  companyName: string
  amount: number
  cashAmount: number
  kaspiAmount: number
  onlineAmount?: number
  cardAmount?: number
  category?: string
  shift?: Shift
  zone?: string | null
  comment?: string | null
}

// =====================
// CONSTANTS
// =====================
export const PIE_COLORS = [
  '#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', 
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1'
] as const

export const SHIFT_LABELS: Record<Shift, string> = {
  day: 'День',
  night: 'Ночь',
}

export const PRESET_LABELS: Record<DatePreset, string> = {
  today: 'Сегодня',
  yesterday: 'Вчера',
  last7: 'Последние 7 дней',
  prevWeek: 'Прошлая неделя',
  last30: 'Последние 30 дней',
  currentMonth: 'Текущий месяц',
  prevMonth: 'Прошлый месяц',
  last90: 'Последние 90 дней',
  currentQuarter: 'Текущий квартал',
  prevQuarter: 'Прошлый квартал',
  currentYear: 'Текущий год',
  prevYear: 'Прошлый год',
  custom: 'Произвольный период',
}

export const INSIGHT_STYLES: Record<InsightType, { bg: string; border: string; text: string; icon: typeof TrendingUp }> = {
  success: { bg: 'bg-emerald-50 dark:bg-emerald-500/5', border: 'border-emerald-200 dark:border-emerald-500/20', text: 'text-emerald-600 dark:text-emerald-400', icon: TrendingUp },
  warning: { bg: 'bg-amber-50 dark:bg-amber-500/5', border: 'border-amber-200 dark:border-amber-500/20', text: 'text-amber-600 dark:text-amber-400', icon: AlertTriangle },
  danger: { bg: 'bg-rose-50 dark:bg-rose-500/5', border: 'border-rose-200 dark:border-rose-500/20', text: 'text-rose-600 dark:text-rose-400', icon: AlertTriangle },
  opportunity: { bg: 'bg-blue-50 dark:bg-blue-500/5', border: 'border-blue-200 dark:border-blue-500/20', text: 'text-blue-600 dark:text-blue-400', icon: Lightbulb },
  info: { bg: 'bg-surface-muted', border: 'border-border', text: 'text-muted-foreground', icon: Activity },
}

export const SEVERITY_STYLES: Record<Severity, { bg: string; border: string; text: string }> = {
  critical: { bg: 'bg-rose-50 dark:bg-rose-500/10', border: 'border-rose-200 dark:border-rose-500/30', text: 'text-rose-600 dark:text-rose-400' },
  high: { bg: 'bg-rose-50 dark:bg-rose-500/5', border: 'border-rose-200 dark:border-rose-500/20', text: 'text-rose-600 dark:text-rose-400' },
  medium: { bg: 'bg-amber-50 dark:bg-amber-500/5', border: 'border-amber-200 dark:border-amber-500/20', text: 'text-amber-600 dark:text-amber-400' },
  low: { bg: 'bg-blue-50 dark:bg-blue-500/5', border: 'border-blue-200 dark:border-blue-500/20', text: 'text-blue-600 dark:text-blue-400' },
}

export const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'Критично',
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
}

// =====================
// UTILITY FUNCTIONS
// =====================
export const toISODateLocal = (d: Date): string => {
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

export const fromISO = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export const todayISO = (): string => toISODateLocal(new Date())

export const addDaysISO = (iso: string, diff: number): string => {
  const d = fromISO(iso)
  d.setDate(d.getDate() + diff)
  return toISODateLocal(d)
}

export const calculatePrevPeriod = (dateFrom: string, dateTo: string) => {
  const dFrom = fromISO(dateFrom)
  const dTo = fromISO(dateTo)
  const durationDays = Math.floor((dTo.getTime() - dFrom.getTime()) / 86400000) + 1
  const prevTo = addDaysISO(dateFrom, -1)
  const prevFrom = addDaysISO(prevTo, -(durationDays - 1))
  return { prevFrom, prevTo, durationDays }
}

export const formatDateRange = (from: string, to: string): string => {
  const d1 = fromISO(from)
  const d2 = fromISO(to)
  const sameMonth = d1.getMonth() === d2.getMonth() && d1.getFullYear() === d2.getFullYear()
  
  if (sameMonth) {
    return `${d1.getDate()}–${d2.getDate()} ${d1.toLocaleDateString('ru-RU', { month: 'long' })} ${d1.getFullYear()}`
  }
  return `${d1.toLocaleDateString('ru-RU')} – ${d2.toLocaleDateString('ru-RU')}`
}

export const formatMoneyFull = (n: number): string => {
  if (!Number.isFinite(n)) return '0 ₸'
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'
}

export const formatMoneyCompact = (n: number): string => {
  const abs = Math.abs(n)
  if (abs >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + ' млрд'
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' млн'
  if (abs >= 1_000) return (n / 1_000).toFixed(1) + ' тыс'
  return String(Math.round(n))
}

export const formatCompact = (n: number): string => {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (abs >= 1_000) return (n / 1_000).toFixed(0) + 'k'
  return String(Math.round(n))
}

export const safeNumber = (v: unknown): number => {
  if (v === null || v === undefined) return 0
  const num = Number(v)
  return Number.isFinite(num) ? num : 0
}

// =====================
// CSV & EXPORT UTILITIES
// =====================
export const csvEscape = (v: string): string => {
  const s = String(v).replaceAll('"', '""')
  if (/[",\n\r;]/.test(s)) return `"${s}"`
  return s
}

export const toCSV = (rows: string[][], sep = ';'): string => 
  rows.map((r) => r.map((c) => csvEscape(c)).join(sep)).join('\n') + '\n'

export const downloadTextFile = (filename: string, content: string, mime = 'text/csv'): void => {
  const blob = new Blob(['\uFEFF' + content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// =====================
// URL PARAMS PARSING
// =====================
export const parseBool = (v: string | null): boolean => v === '1' || v === 'true'
export const parseGroup = (v: string | null): GroupMode | null => 
  (v === 'day' || v === 'week' || v === 'month' || v === 'year') ? v : null
export const parseTab = (v: string | null) => 
  (v === 'overview' || v === 'analytics' || v === 'details' || v === 'companies') ? v : null
export const isISODate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Строки дохода и расхода выбранного периода в один список — для «Деталей» и PDF. */
export function buildDetailedRows(
  incomes: IncomeRow[],
  expenses: ExpenseRow[],
  opts: { dateFrom: string; dateTo: string; min: number; max: number; companyName: (id: string) => string },
): DetailedRow[] {
  const { dateFrom, dateTo, min, max, companyName } = opts
  const rows: DetailedRow[] = []

  for (const r of incomes) {
    if (r.date < dateFrom || r.date > dateTo) continue
    const cash = safeNumber(r.cash_amount)
    const kaspi = safeNumber(r.kaspi_amount)
    const online = safeNumber(r.online_amount)
    const card = safeNumber(r.card_amount)
    const total = cash + kaspi + online + card
    if (total === 0 || total < min || total > max) continue
    rows.push({
      id: r.id,
      date: r.date,
      type: 'income',
      companyId: r.company_id,
      companyName: companyName(r.company_id),
      amount: total,
      cashAmount: cash,
      kaspiAmount: kaspi,
      onlineAmount: online,
      cardAmount: card,
      shift: r.shift,
      zone: r.zone,
    })
  }

  for (const r of expenses) {
    if (r.date < dateFrom || r.date > dateTo) continue
    const cash = safeNumber(r.cash_amount)
    const kaspi = safeNumber(r.kaspi_amount)
    const total = cash + kaspi
    if (total === 0 || total < min || total > max) continue
    rows.push({
      id: r.id,
      date: r.date,
      type: 'expense',
      companyId: r.company_id,
      companyName: companyName(r.company_id),
      amount: total,
      cashAmount: cash,
      kaspiAmount: kaspi,
      category: r.category || 'Без категории',
      comment: r.comment,
    })
  }

  return rows
}
