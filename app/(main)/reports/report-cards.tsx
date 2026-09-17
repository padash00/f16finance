'use client'

/** Карточки страницы /reports: показатели, сигналы, аномалии, тепловая карта, расходы по статьям. */

import { memo } from 'react'
import type { ExpenseArticle } from '@/lib/reports/expense-groups'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AlertTriangle, ChevronRight, Lightbulb, PieChart as PieChartIcon } from 'lucide-react'
import { INSIGHT_STYLES, SEVERITY_STYLES, SEVERITY_LABELS, fromISO, addDaysISO, formatMoneyFull, formatMoneyCompact } from './report-shared'
import type { AIInsight, Anomaly } from './report-shared'

// =====================
// UI COMPONENTS
// =====================

export const ChartShell = memo(({ children, className = '', height = 'h-80' }: { 
  children: React.ReactNode; 
  className?: string; 
  height?: string 
}) => (
  <div className={`min-w-0 ${height} min-h-[320px] ${className}`}>
    {children}
  </div>
))
ChartShell.displayName = 'ChartShell'

export const StatCard = memo(({ title, value, subValue, icon: Icon, trend, trendGood = 'up', trendHint, color = 'blue', onClick }: {
  title: string
  value: string
  subValue?: string
  icon: React.ElementType
  trend?: number
  /**
   * В какую сторону изменение — хорошо. Для расходов 'down': рост расходов
   * красный. Раньше знак сам решал цвет, и «+49% расходов» горело зелёным.
   */
  trendGood?: 'up' | 'down'
  /** Словами под значком: «расходы выросли» — чтобы процент не приходилось толковать */
  trendHint?: string
  color?: 'blue' | 'green' | 'red' | 'amber'
  onClick?: () => void
}) => {
  const trendIsGood = trend === undefined || trend === 0 ? null : (trend > 0) === (trendGood === 'up')
  const iconTone: Record<string, string> = {
    blue: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    green: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    red: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  }

  return (
    <Card
      onClick={onClick}
      className={`group gap-0 p-4 sm:p-5 ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-center justify-between mb-4">
        <div className={`grid place-items-center h-9 w-9 rounded-xl ${iconTone[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        {trend !== undefined && (
          <div className="flex flex-col items-end gap-0.5">
            <span className={`inline-flex items-center gap-0.5 text-xs font-semibold px-2 py-0.5 rounded-full ${trendIsGood === true ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : trendIsGood === false ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' : 'bg-slate-500/10 text-muted-foreground'}`}>
              {trend > 0 ? '▲' : trend < 0 ? '▼' : ''} {Math.abs(trend)}%
            </span>
            {trendHint ? (
              <span className={`text-[10px] ${trendIsGood === true ? 'text-emerald-600 dark:text-emerald-400' : trendIsGood === false ? 'text-rose-600 dark:text-rose-400' : 'text-muted-foreground'}`}>{trendHint}</span>
            ) : null}
          </div>
        )}
      </div>
      <p className="text-muted-foreground text-xs font-medium">{title}</p>
      <p className="mt-1 text-lg sm:text-2xl font-bold tabular-nums text-foreground">{value}</p>
      {subValue && <p className="mt-1.5 text-xs text-muted-foreground">{subValue}</p>}
    </Card>
  )
})
StatCard.displayName = 'StatCard'

export const InsightCard = memo(({ insight }: { insight: AIInsight }) => {
  const styles = INSIGHT_STYLES[insight.type]
  const Icon = styles.icon
  
  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${styles.bg} ${styles.border}`}
    >
      <div className="flex items-start gap-3">
        <div className={`grid place-items-center h-8 w-8 shrink-0 rounded-lg ${styles.bg.replace('/5', '/20')} ${styles.text}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">{insight.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2 leading-relaxed">{insight.description}</p>
          {insight.metric && (
            <p className={`text-sm font-bold tabular-nums mt-1 ${styles.text}`}>{insight.metric}</p>
          )}
        </div>
      </div>
    </div>
  )
})
InsightCard.displayName = 'InsightCard'

export const AnomalyCard = memo(({ anomaly }: { anomaly: Anomaly }) => {
  const styles = SEVERITY_STYLES[anomaly.severity]
  
  return (
    <div
      className={`flex items-center gap-4 p-4 rounded-xl border ${styles.bg} ${styles.border}`}
    >
      <div className={`grid place-items-center h-9 w-9 shrink-0 rounded-lg ${styles.bg.replace('/5', '/20').replace('/10', '/20')} ${styles.text}`}>
        {anomaly.severity === 'critical' || anomaly.severity === 'high' ? 
          <AlertTriangle className="w-5 h-5" /> : 
          <Lightbulb className="w-5 h-5" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground font-medium">{anomaly.description}</p>
        <p className="text-xs text-slate-500 mt-1">{anomaly.date}</p>
      </div>
      <span className={`shrink-0 text-[11px] px-2.5 py-1 rounded-full font-semibold ${styles.bg.replace('/5', '/20').replace('/10', '/20')} ${styles.text}`}>
        {SEVERITY_LABELS[anomaly.severity]}
      </span>
    </div>
  )
})
AnomalyCard.displayName = 'AnomalyCard'

// =====================
// PROFIT HEATMAP
// =====================

export const HEATMAP_DAILY_MAX_DAYS = 93
export const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export type HeatCell = { key: string; label: string; title: string; from: string; to: string; income: number; expense: number }

/**
 * Прибыль по дням (период до 3 месяцев) или по месяцам (дольше) — на весь период.
 * Цвет задан inline: Tailwind не генерирует классы, собранные из строки
 * (`bg-emerald-500/${n}`), поэтому раньше все клетки были серыми, а карта
 * всегда показывала только 35 дней от начала периода.
 */
export function ProfitHeatmap({ dateFrom, dateTo, dailyIncome, dailyExpense, onCellClick }: {
  dateFrom: string
  dateTo: string
  dailyIncome: Map<string, number>
  dailyExpense: Map<string, number>
  /** Клик по дню или месяцу — доходы и расходы этого отрезка */
  onCellClick?: (from: string, to: string) => void
}) {
  const totalDays = Math.max(0, Math.round((fromISO(dateTo).getTime() - fromISO(dateFrom).getTime()) / 86400000) + 1)
  const byMonth = totalDays > HEATMAP_DAILY_MAX_DAYS

  const cells: HeatCell[] = []
  const monthIndex = new Map<string, HeatCell>()
  for (let i = 0; i < totalDays; i++) {
    const date = addDaysISO(dateFrom, i)
    const income = dailyIncome.get(date) || 0
    const expense = dailyExpense.get(date) || 0
    if (!byMonth) {
      const title = fromISO(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
      cells.push({ key: date, label: String(Number(date.slice(8))), title, from: date, to: date, income, expense })
      continue
    }
    const key = date.slice(0, 7)
    let cell = monthIndex.get(key)
    if (!cell) {
      const name = fromISO(`${key}-01`).toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' })
      cell = { key, label: name, title: name, from: date, to: date, income: 0, expense: 0 }
      monthIndex.set(key, cell)
      cells.push(cell)
    }
    cell.income += income
    cell.expense += expense
    cell.to = date
  }

  const maxAbs = cells.reduce((m, c) => Math.max(m, Math.abs(c.income - c.expense)), 0)
  const leadingBlanks = byMonth ? 0 : (fromISO(dateFrom).getDay() + 6) % 7

  const cellStyle = (profit: number): React.CSSProperties | undefined => {
    if (profit === 0 || maxAbs === 0) return undefined
    const alpha = 0.12 + 0.55 * (Math.abs(profit) / maxAbs)
    return { backgroundColor: profit > 0 ? `rgba(16, 185, 129, ${alpha})` : `rgba(244, 63, 94, ${alpha})` }
  }

  return (
    <div>
      {/* Компактная сетка по центру: на всю ширину карточки клетки выходили огромными */}
      <div className={byMonth ? 'mx-auto grid max-w-2xl grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6' : 'mx-auto grid max-w-5xl grid-cols-7 gap-1.5 sm:gap-2'}>
        {!byMonth && WEEKDAY_LABELS.map((d) => (
          <div key={d} className="text-center text-[10px] font-medium text-muted-foreground">{d}</div>
        ))}
        {Array.from({ length: leadingBlanks }, (_, i) => <div key={`blank-${i}`} />)}
        {cells.map((cell) => {
          const profit = cell.income - cell.expense
          return (
            <button
              type="button"
              key={cell.key}
              style={cellStyle(profit)}
              disabled={!onCellClick || (cell.income === 0 && cell.expense === 0)}
              onClick={() => onCellClick?.(cell.from, cell.to)}
              className={`${byMonth ? 'py-3' : 'h-14 sm:h-20'} flex flex-col items-center justify-center gap-0.5 rounded-lg text-xs transition-shadow enabled:cursor-pointer enabled:hover:ring-2 enabled:hover:ring-amber-500/60 disabled:cursor-default ${profit === 0 ? 'bg-slate-100 dark:bg-slate-800/50' : ''}`}
              title={`${cell.title}: доход ${formatMoneyFull(cell.income)}, расход ${formatMoneyFull(cell.expense)}, прибыль ${formatMoneyFull(profit)}`}
            >
              <span className={`tabular-nums ${byMonth ? 'text-xs text-muted-foreground' : 'text-xs sm:text-sm font-semibold text-foreground'}`}>{cell.label}</span>
              {/* Сумма дня — со среднего экрана; на телефоне клетка узкая, сумму покажет клик */}
              {profit !== 0 && (
                <span className={`tabular-nums font-medium text-foreground ${byMonth ? 'text-sm' : 'hidden sm:block text-xs'}`}>
                  {formatMoneyCompact(profit)}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-4 mt-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(244, 63, 94, 0.5)' }} /> Убыток</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-200 dark:bg-slate-800" /> Ноль</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded" style={{ backgroundColor: 'rgba(16, 185, 129, 0.5)' }} /> Прибыль</span>
        {byMonth && <span>период длиннее 3 месяцев — по месяцам</span>}
        {onCellClick && <span>нажмите на {byMonth ? 'месяц' : 'день'} — доходы и расходы</span>}
      </div>
    </div>
  )
}


// =====================
// EXPENSE ARTICLES
// =====================

/**
 * Расходы периода по статьям ОПиУ (себестоимость, операционные, эквайринг, ФОТ…)
 * по тем же правилам, что /profitability. EBITDA и чистую прибыль не показываем:
 * их считает ОПиУ с ручными помесячными поправками — сюда ведёт ссылка.
 */
export function ExpenseArticlesCard({ articles, totalIncome, onOpen }: {
  articles: ExpenseArticle[]
  totalIncome: number
  /** Клик по статье — операции её категорий */
  onOpen?: (article: ExpenseArticle) => void
}) {
  const chain = articles.filter((a) => !a.offChain && a.amount > 0)
  const offChain = articles.filter((a) => a.offChain && a.amount > 0)
  const max = Math.max(1, ...articles.map((a) => a.amount))

  const line = (a: ExpenseArticle) => {
    const change = a.prevAmount > 0 ? ((a.amount - a.prevAmount) / a.prevAmount) * 100 : null
    const share = totalIncome > 0 ? (a.amount / totalIncome) * 100 : null
    return (
      <div
        key={a.group}
        role="button"
        tabIndex={0}
        onClick={() => onOpen?.(a)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen?.(a)
          }
        }}
        className="-mx-2 cursor-pointer space-y-1.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-muted"
      >
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-medium text-foreground">{a.label}</span>
          <span className="tabular-nums font-semibold text-foreground">{formatMoneyFull(a.amount)}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/[0.06]">
          <div className="h-full rounded-full bg-rose-500/70" style={{ width: `${(a.amount / max) * 100}%` }} />
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">
            {a.categories.slice(0, 3).map((c) => `${c.name} ${formatMoneyCompact(c.amount)}`).join(' · ')}
          </span>
          <span className="shrink-0 tabular-nums">
            {share !== null && `${share.toFixed(1)}% выручки`}
            {change !== null && (
              <span className={`ml-2 ${change > 0 ? 'text-rose-600 dark:text-rose-400' : change < 0 ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
                {change > 0 ? '+' : ''}{change.toFixed(0)}%
              </span>
            )}
          </span>
        </div>
      </div>
    )
  }

  return (
    <Card className="gap-0 p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <PieChartIcon className="h-5 w-5 text-rose-500 dark:text-rose-400" />
          Расходы по статьям
        </h3>
        <Button asChild variant="ghost" size="xs" className="rounded-xl text-muted-foreground">
          <Link href="/profitability">
            Полный ОПиУ
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      {chain.length === 0 && offChain.length === 0 ? (
        <p className="text-sm text-muted-foreground">Расходов за период нет.</p>
      ) : (
        <div className="max-h-[28rem] space-y-4 overflow-y-auto pr-1">
          {chain.map(line)}
          {offChain.length > 0 && (
            <div className="space-y-4 border-t border-border pt-4">
              <p className="text-xs text-muted-foreground">
                Вне ОПиУ: из прибыли на /profitability не вычитаются, но в «Расходах» этой страницы учтены.
              </p>
              {offChain.map(line)}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
