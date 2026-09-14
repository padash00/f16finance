'use client'

/**
 * Недельный баланс — вкладками.
 *
 *  Итоги    — выручка, расходы, прибыль, сальдо, неделя против плана месяца и
 *             что изменилось к базе сравнения;
 *  Касса    — наличные и безналичный: доход, расход, сальдо по дням;
 *  Смены    — день и ночь, какие отчёты смен не внесены;
 *  Точки    — точки таблицей, по клику — расходы по статьям;
 *  Расходы  — статьи с изменением и крупные расходы;
 *  Закуп    — план закупа на следующую неделю;
 *  Отчёт    — печатный акт, PDF и ИИ-отчёт.
 *
 * Цифры считает lib/reports/weekly-balance.ts так же, как /reports: безнал
 * ночной смены после полуночи — на следующий день, отклонённые расходы не
 * считаются, F16 Extra в итогах только по галочке. «Безналичный» — терминал и
 * переводы, онлайн и карта вместе (как в печатном акте).
 */

import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Coins,
  CreditCard,
  Download,
  Info,
  Loader2,
  Moon,
  Printer,
  RefreshCw,
  Scale,
  Share2,
  Sparkles,
  Square,
  Sun,
  Target,
} from 'lucide-react'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { WeeklyActPrint } from '@/components/admin/weekly-act-print'
import { WeeklyPurchasePlan, nextWeekMondayISO, planWeekLabel } from '@/components/admin/weekly-purchase-plan'
import { PageSkeleton } from '@/components/skeleton'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { NativeSelect } from '@/components/ui/native-select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from '@/components/ui/use-toast'
import { useCompanies } from '@/hooks/use-companies'
import { useExpenses } from '@/hooks/use-expenses'
import { useIncome } from '@/hooks/use-income'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { downloadReportPdf } from '@/lib/client/download-pdf'
import {
  COMPARE_MODES,
  buildWeeklyBalance,
  deltaPct,
  weekPlanStatus,
  type CompareMode,
  type PeriodSums,
  type PlanRow,
  type WeekPlanStatus,
  type WeeklyBalance,
} from '@/lib/reports/weekly-balance'

// ─── Даты и форматирование ──────────────────────────────────────────────────

const DAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const MONTH_GEN = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
const TABS = ['summary', 'cash', 'shifts', 'points', 'expenses', 'purchase', 'report'] as const
type TabKey = (typeof TABS)[number]
/** Истории нужно 8 недель — для сравнения со средним и привычного графика смен */
const HISTORY_DAYS = 56

const toISODateLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
const fromISO = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}
const addDaysISO = (iso: string, diff: number) => {
  const d = fromISO(iso)
  d.setDate(d.getDate() + diff)
  return toISODateLocal(d)
}
const mondayOf = (iso: string) => {
  const d = fromISO(iso)
  const dow = d.getDay() === 0 ? 7 : d.getDay()
  d.setDate(d.getDate() - (dow - 1))
  return toISODateLocal(d)
}
const rangeTitle = (start: string, end: string) => {
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }
  return `${fromISO(start).toLocaleDateString('ru-RU', opts)} — ${fromISO(end).toLocaleDateString('ru-RU', opts)}`
}
const dm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`
const weekdayOf = (iso: string) => (fromISO(iso).getDay() + 6) % 7

const money = (n: number) => `${Math.round(n || 0).toLocaleString('ru-RU')} ₸`
const signed = (n: number) => `${Math.round(n) > 0 ? '+' : Math.round(n) < 0 ? '−' : ''}${Math.abs(Math.round(n)).toLocaleString('ru-RU')} ₸`
const compact = (n: number) => {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (a >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(Math.round(n))
}
const tone = (n: number) => (Math.round(n) < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400')

const CHART_TOOLTIP = { background: 'var(--popover)', color: 'var(--popover-foreground)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }

// ─── Мелкие компоненты ──────────────────────────────────────────────────────

function Delta({ cur, prev, goodWhenUp = true }: { cur: number; prev: number; goodWhenUp?: boolean }) {
  const pct = deltaPct(cur, prev)
  if (pct == null) return <span className="text-xs text-muted-foreground">не с чем сравнить</span>
  if (Math.abs(pct) < 0.05) return <span className="text-xs text-muted-foreground">без изменений</span>
  const up = pct > 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up === goodWhenUp ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
      <Icon className="h-3 w-3" />
      {Math.abs(pct).toFixed(1)}%
    </span>
  )
}

function Tile({ label, value, hint, children, valueClass = '' }: { label: string; value: string; hint?: ReactNode; children?: ReactNode; valueClass?: string }) {
  return (
    <Card className="gap-1 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${valueClass}`}>{value}</p>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </Card>
  )
}

function SectionCard({ title, subtitle, icon, children, action }: { title: string; subtitle?: ReactNode; icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <Card className="gap-0 p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            {icon}
            {title}
          </h2>
          {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </Card>
  )
}

const th = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground'
const thr = 'px-3 py-2 text-right text-xs font-medium text-muted-foreground'
const td = 'px-3 py-2 text-sm tabular-nums'
const tdr = 'px-3 py-2 text-right text-sm tabular-nums'

/** Короткий Markdown ИИ-отчёта: заголовки, пункты, жирный. Без HTML из текста. */
function MarkdownLite({ text }: { text: string }) {
  const inline = (line: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <span key={i}>{part}</span>,
    )
  const blocks: ReactNode[] = []
  let list: string[] = []
  const flush = () => {
    if (!list.length) return
    const items = list
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="ml-4 list-disc space-y-1">
        {items.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>,
    )
    list = []
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    const heading = /^#{1,4}\s+(.*)$/.exec(line)
    const bullet = /^(?:[-•*]|\d+[.)])\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      blocks.push(
        <h3 key={`h-${blocks.length}`} className="mt-4 text-sm font-semibold text-foreground first:mt-0">
          {inline(heading[1])}
        </h3>,
      )
    } else if (bullet) {
      list.push(bullet[1])
    } else {
      flush()
      blocks.push(
        <p key={`p-${blocks.length}`} className="leading-relaxed">
          {inline(line)}
        </p>,
      )
    }
  }
  flush()
  return <div className="space-y-2 text-sm text-foreground">{blocks}</div>
}

function parseSseEvent(raw: string) {
  const event = raw.split('\n').find((l) => l.startsWith('event:'))?.slice(6).trim() || 'message'
  const data = raw
    .split('\n')
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim())
    .join('\n')
  return { event, data: data ? JSON.parse(data) : null }
}

// ─── Страница ───────────────────────────────────────────────────────────────

function WeeklyReportContent() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { can } = useCapabilities()

  const todayISO = useMemo(() => toISODateLocal(new Date()), [])
  const currentMonday = useMemo(() => mondayOf(todayISO), [todayISO])

  const [weekStart, setWeekStart] = useState(() => {
    const p = searchParams.get('start')
    return p && /^\d{4}-\d{2}-\d{2}$/.test(p) ? mondayOf(p) : currentMonday
  })
  const [includeExtra, setIncludeExtra] = useState(() => searchParams.get('extra') === '1')
  const [compare, setCompare] = useState<CompareMode>(() => {
    const p = searchParams.get('cmp') as CompareMode | null
    return p && p in COMPARE_MODES ? p : 'week'
  })
  const [tab, setTab] = useState<TabKey>(() => {
    const p = searchParams.get('tab') as TabKey | null
    return p && TABS.includes(p) ? p : 'summary'
  })
  const [showActPrint, setShowActPrint] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [plans, setPlans] = useState<PlanRow[]>([])
  const weekEnd = addDaysISO(weekStart, 6)

  // Ссылка всегда ведёт на ту же неделю, вкладку и сравнение
  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams()
      params.set('start', weekStart)
      params.set('end', weekEnd)
      if (includeExtra) params.set('extra', '1')
      if (compare !== 'week') params.set('cmp', compare)
      if (tab !== 'summary') params.set('tab', tab)
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }, 200)
    return () => clearTimeout(t)
  }, [weekStart, weekEnd, includeExtra, compare, tab, pathname, router])

  const { companies, loading: companiesLoading, error: companiesError } = useCompanies()
  // 8 недель истории + день на перенос безнала ночной смены за полночь
  const { rows: incomeRows, loading: incomeLoading, error: incomeError, reload: reloadIncome } = useIncome({
    from: addDaysISO(weekStart, -HISTORY_DAYS - 1),
    to: weekEnd,
    fetchAll: true,
    pageSize: 2000,
  })
  const { rows: expenseRows, loading: expenseLoading, error: expenseError, reload: reloadExpenses } = useExpenses({
    from: addDaysISO(weekStart, -HISTORY_DAYS),
    to: weekEnd,
    fetchAll: true,
    pageSize: 2000,
  })

  // Цели месяца (/goals) — без них блок плана просто не показывается
  const planYear = weekEnd.slice(0, 4)
  useEffect(() => {
    let active = true
    fetch(`/api/admin/kpi-plans?year=${planYear}&plans_only=1`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => active && setPlans(Array.isArray(j?.data?.plans) ? j.data.plans : []))
      .catch(() => active && setPlans([]))
    return () => {
      active = false
    }
  }, [planYear])

  const loading = companiesLoading || incomeLoading || expenseLoading
  const error = companiesError || incomeError || expenseError || null

  const balance = useMemo<WeeklyBalance | null>(() => {
    if (!companies.length) return null
    return buildWeeklyBalance({ incomes: incomeRows as any, expenses: expenseRows as any, companies, weekStart, today: todayISO, includeExtra, compare })
  }, [companies, incomeRows, expenseRows, weekStart, todayISO, includeExtra, compare])

  const planStatus = useMemo<WeekPlanStatus | null>(() => {
    if (!companies.length || !plans.length) return null
    return weekPlanStatus({ plans, incomes: incomeRows as any, companies, weekStart, today: todayISO })
  }, [plans, incomeRows, companies, weekStart, todayISO])

  const isCurrentWeek = weekStart === currentMonday
  const canGoNext = weekStart < currentMonday

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([reloadIncome(), reloadExpenses()])
      toast({ title: 'Данные обновлены' })
    } catch {
      toast({ title: 'Не удалось обновить', variant: 'destructive' })
    } finally {
      setRefreshing(false)
    }
  }, [reloadIncome, reloadExpenses])

  const handleShare = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast({ title: 'Ссылка скопирована' })
    } catch {
      toast({ title: 'Не удалось скопировать ссылку', variant: 'destructive' })
    }
  }, [])

  if (loading && !balance) {
    return (
      <div className="app-page-wide">
        <PageSkeleton stats={4} rows={7} cols={5} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="app-page-wide space-y-4 py-16 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-rose-500" />
        <h2 className="text-lg font-semibold">Ошибка загрузки</h2>
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" onClick={handleRefresh}>
          <RefreshCw className="h-4 w-4" /> Повторить
        </Button>
      </div>
    )
  }

  const hasExtra = Boolean(balance?.extra.names.length)
  const compareNote =
    balance && balance.compareUntil
      ? balance.comparedDays === 7
        ? `сравнение: ${balance.compareLabel.replace('те же дни ', '')}`
        : `сравнение пн–${DAY_LABELS[balance.comparedDays - 1].toLowerCase()}: ${balance.compareLabel}`
      : null

  return (
    <div className="app-page-wide space-y-5">
      <AdminPageHeader
        title="Недельный баланс"
        description="Доходы, расходы и сальдо за неделю"
        accent="violet"
        icon={<CalendarDays className="h-5 w-5" aria-hidden />}
        actions={
          <>
            <Button variant="outline" size="icon" onClick={handleRefresh} disabled={refreshing} aria-label="Обновить">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
            {can('weekly-report.share') ? (
              <Button variant="outline" size="icon" onClick={handleShare} aria-label="Поделиться ссылкой">
                <Share2 className="h-4 w-4" />
              </Button>
            ) : null}
          </>
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1">
              <Button variant="ghost" size="icon-sm" onClick={() => setWeekStart(addDaysISO(weekStart, -7))} aria-label="Предыдущая неделя">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-2 text-sm font-semibold">{rangeTitle(weekStart, weekEnd)}</span>
              <Button variant="ghost" size="icon-sm" onClick={() => setWeekStart(addDaysISO(weekStart, 7))} disabled={!canGoNext} aria-label="Следующая неделя">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            {!isCurrentWeek ? (
              <Button variant="outline" size="sm" onClick={() => setWeekStart(currentMonday)}>
                Текущая неделя
              </Button>
            ) : (
              <span className="text-xs text-muted-foreground">текущая неделя</span>
            )}
            <NativeSelect className="h-8 w-auto" value={compare} onChange={(e) => setCompare(e.target.value as CompareMode)} aria-label="С чем сравнивать">
              {(Object.keys(COMPARE_MODES) as CompareMode[]).map((key) => (
                <option key={key} value={key}>
                  Сравнить: {COMPARE_MODES[key].short.toLowerCase()}
                </option>
              ))}
            </NativeSelect>
            {hasExtra ? (
              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Checkbox checked={includeExtra} onCheckedChange={(v) => setIncludeExtra(v === true)} /> с {balance!.extra.names.join(', ')}
              </label>
            ) : null}
            {compareNote ? <span className="text-xs text-muted-foreground">· {compareNote}</span> : null}
          </div>
        }
      />

      {balance ? (
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="gap-4">
          <div className="-mx-1 overflow-x-auto px-1">
            <TabsList className="h-10">
              <TabsTrigger value="summary" className="px-3">Итоги</TabsTrigger>
              <TabsTrigger value="cash" className="px-3">Касса</TabsTrigger>
              <TabsTrigger value="shifts" className="px-3">
                Смены
                {balance.missingShifts.length ? (
                  <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">{balance.missingShifts.length}</span>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="points" className="px-3">Точки</TabsTrigger>
              <TabsTrigger value="expenses" className="px-3">Расходы</TabsTrigger>
              <TabsTrigger value="purchase" className="px-3">Закуп</TabsTrigger>
              <TabsTrigger value="report" className="px-3">Отчёт</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="summary">
            <SummaryTab balance={balance} plan={planStatus} loading={loading} onOpenShifts={() => setTab('shifts')} />
          </TabsContent>
          <TabsContent value="cash">
            <CashTab balance={balance} />
          </TabsContent>
          <TabsContent value="shifts">
            <ShiftsTab balance={balance} />
          </TabsContent>
          <TabsContent value="points">
            <PointsTab balance={balance} />
          </TabsContent>
          <TabsContent value="expenses">
            <ExpensesTab balance={balance} />
          </TabsContent>
          <TabsContent value="purchase">
            <WeeklyPurchasePlan reportEndDate={weekEnd} />
          </TabsContent>
          <TabsContent value="report">
            <ReportTab
              balance={balance}
              weekStart={weekStart}
              weekEnd={weekEnd}
              companies={companies}
              incomeRows={incomeRows as any[]}
              expenseRows={expenseRows as any[]}
              onPrintAct={() => setShowActPrint(true)}
            />
          </TabsContent>
        </Tabs>
      ) : null}

      {showActPrint ? <WeeklyActPrint from={weekStart} to={weekEnd} onClose={() => setShowActPrint(false)} /> : null}
    </div>
  )
}

// ─── Итоги ──────────────────────────────────────────────────────────────────

function PlanCard({ plan }: { plan: WeekPlanStatus }) {
  const month = MONTH_GEN[Number(plan.month.slice(5, 7)) - 1]
  const donePct = Math.round((plan.fact / plan.target) * 100)
  const weekDiff = plan.weekFact - plan.weekExpectedToDate
  const ahead = plan.pace.gap >= 0
  return (
    <SectionCard
      title={`План на ${month}`}
      subtitle={`${plan.source === 'org' ? 'Общая цель организации' : 'Сумма целей точек'} · выручка без F16 Extra, по ${dm(plan.lastFactDate)}`}
      icon={<Target className="h-4 w-4 text-emerald-500" />}
      action={
        <Button asChild variant="outline" size="sm">
          <Link href="/goals">
            Цели <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      }
    >
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-border p-3">
          <p className="text-xs text-muted-foreground">Выполнено за месяц</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {money(plan.fact)} <span className="text-sm font-normal text-muted-foreground">из {money(plan.target)}</span>
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-muted">
            <div className={`h-full ${donePct >= Math.round(plan.pace.timeShare * 100) ? 'bg-emerald-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(100, donePct)}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {donePct}% плана · по ритму должно быть {Math.round(plan.pace.timeShare * 100)}%
          </p>
        </div>
        <div className="rounded-xl border border-border p-3">
          <p className="text-xs text-muted-foreground">
            Эта неделя ({dm(plan.weekFrom)}–{dm(plan.weekTo)})
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {money(plan.weekFact)} <span className="text-sm font-normal text-muted-foreground">из {money(plan.weekExpectedToDate)}</span>
          </p>
          <p className={`mt-1 text-xs font-medium ${tone(weekDiff)}`}>
            {Math.round(weekDiff) >= 0 ? `опережаем ритм на ${money(weekDiff)}` : `отстаём от ритма на ${money(-weekDiff)}`}
          </p>
          <p className="text-xs text-muted-foreground">за всю неделю по плану — {money(plan.weekExpected)}</p>
        </div>
        <div className={`rounded-xl border p-3 ${ahead ? 'border-emerald-500/30 bg-emerald-500/[0.05]' : 'border-amber-500/30 bg-amber-500/[0.05]'}`}>
          <p className="text-xs text-muted-foreground">До конца месяца</p>
          {plan.pace.daysLeft > 0 ? (
            <>
              <p className="mt-1 text-lg font-semibold tabular-nums">
                {money(plan.pace.requiredPerDay)} <span className="text-sm font-normal text-muted-foreground">в день</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                осталось {plan.pace.daysLeft} дн. · сейчас в среднем {money(plan.pace.currentPerDay)}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm">{plan.fact >= plan.target ? 'План месяца выполнен' : `Месяц закрыт, недобор ${money(plan.target - plan.fact)}`}</p>
          )}
        </div>
      </div>
    </SectionCard>
  )
}

function SummaryTab({ balance, plan, loading, onOpenShifts }: { balance: WeeklyBalance; plan: WeekPlanStatus | null; loading: boolean; onOpenShifts: () => void }) {
  const { current: c, previous: p, compared } = balance
  const maxAbs = Math.max(1, ...balance.changes.map((x) => Math.abs(x.effect)))
  const chartData = balance.days.map((d) => ({
    label: DAY_LABELS[d.weekday],
    'Выручка': d.future ? null : Math.round(d.current.income.total),
    [balance.compareShort]: Math.round(d.previous.income.total),
    'Прибыль': d.future ? null : Math.round(d.current.profit),
  }))

  return (
    <div className={`space-y-5 ${loading ? 'opacity-60' : ''}`}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Выручка" value={money(c.income.total)}>
          <Delta cur={compared.income.total} prev={p.income.total} />
        </Tile>
        <Tile
          label="Расходы"
          value={money(c.expense.total)}
          hint={balance.pending.count ? `из них ждут согласования: ${balance.pending.count} на ${money(balance.pending.total)}` : undefined}
        >
          <Delta cur={compared.expense.total} prev={p.expense.total} goodWhenUp={false} />
        </Tile>
        <Tile label="Прибыль" value={money(c.profit)} valueClass={c.profit < 0 ? 'text-rose-600 dark:text-rose-400' : ''}>
          <Delta cur={compared.profit} prev={p.profit} />
        </Tile>
        <Tile label="Маржа" value={`${c.margin.toFixed(1)}%`} hint={p.income.total ? `база сравнения ${p.margin.toFixed(1)}%` : undefined} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Tile label="Сальдо наличных" value={signed(c.netCash)} valueClass={tone(c.netCash)} hint={`доход ${money(c.income.cash)} · расход ${money(c.expense.cash)}`} />
        <Tile label="Сальдо безналичного" value={signed(c.netCashless)} valueClass={tone(c.netCashless)} hint={`доход ${money(c.income.cashless)} · расход ${money(c.expense.cashless)}`} />
      </div>

      {balance.alerts.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {balance.alerts.map((a, i) => {
            const cls =
              a.tone === 'danger'
                ? 'border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-200'
                : a.tone === 'warning'
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200'
                  : a.tone === 'success'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                    : 'border-border bg-surface-muted text-foreground'
            const Icon = a.tone === 'success' ? CheckCircle2 : a.tone === 'info' ? Info : AlertTriangle
            const isShifts = a.title.startsWith('Не внесены отчёты смен')
            return (
              <div key={i} className={`flex gap-2 rounded-xl border p-3 text-sm ${cls}`}>
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium">{a.title}</p>
                  <p className="text-xs opacity-90">{a.text}</p>
                  {isShifts ? (
                    <button type="button" onClick={onOpenShifts} className="mt-1 text-xs font-medium underline underline-offset-2">
                      Все пропуски
                    </button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {plan ? <PlanCard plan={plan} /> : null}

      <div className="grid gap-5 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <SectionCard title="По дням" subtitle={`Выручка против базы сравнения (${balance.compareShort.toLowerCase()}) и прибыль дня`}>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.3} vertical={false} />
                  <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={compact} width={48} />
                  <Tooltip contentStyle={CHART_TOOLTIP} formatter={(v: any) => (v == null ? '—' : money(Number(v)))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey={balance.compareShort} fill="#94a3b8" fillOpacity={0.35} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Выручка" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="Прибыль" stroke="#8b5cf6" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>
        </div>

        <div className="xl:col-span-2">
          <SectionCard
            title="Что изменилось"
            subtitle={balance.compareUntil ? `Прибыль ${signed(compared.profit - p.profit)} к базе: ${balance.compareLabel}. Что добавило и что отняло:` : 'На этой неделе ещё нет данных.'}
            icon={<Scale className="h-4 w-4 text-violet-500" />}
          >
            {balance.changes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Заметных изменений нет.</p>
            ) : (
              <div className="space-y-2.5">
                {balance.changes.map((ch) => (
                  <div key={ch.key}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate">
                        {ch.label}
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          {money(ch.previous)} → {money(ch.current)}
                        </span>
                      </span>
                      <span className={`shrink-0 font-semibold tabular-nums ${tone(ch.effect)}`}>{signed(ch.effect)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-surface-muted">
                      <div className={`h-1.5 rounded-full ${ch.effect >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} style={{ width: `${Math.max(2, (Math.abs(ch.effect) / maxAbs) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  )
}

// ─── Касса ──────────────────────────────────────────────────────────────────

function CashTab({ balance }: { balance: WeeklyBalance }) {
  const { current: c } = balance
  const shareOf = (v: number) => (c.income.total ? `${((v / c.income.total) * 100).toFixed(1)}%` : '—')
  const chartData = balance.cumulative.map((d) => ({
    label: DAY_LABELS[weekdayOf(d.date)],
    'Наличные': Math.round(d.netCash),
    'Безналичный': Math.round(d.netCashless),
    'Всего': Math.round(d.net),
  }))

  return (
    <div className="space-y-5">
      <SectionCard title="Наличные и безналичный" icon={<Coins className="h-4 w-4 text-emerald-500" />}>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[520px]">
            <thead className="bg-surface-muted">
              <tr>
                <th className={th}>Тип</th>
                <th className={thr}>Доход</th>
                <th className={thr}>Расход</th>
                <th className={thr}>Сальдо</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className={`${td} font-medium`}>
                  <span className="inline-flex items-center gap-2">
                    <Coins className="h-3.5 w-3.5 text-emerald-600" /> Наличные
                  </span>
                </td>
                <td className={tdr}>{money(c.income.cash)}</td>
                <td className={tdr}>{money(c.expense.cash)}</td>
                <td className={`${tdr} font-semibold ${tone(c.netCash)}`}>{signed(c.netCash)}</td>
              </tr>
              <tr>
                <td className={`${td} font-medium`}>
                  <span className="inline-flex items-center gap-2">
                    <CreditCard className="h-3.5 w-3.5 text-blue-600" /> Безналичный
                  </span>
                </td>
                <td className={tdr}>{money(c.income.cashless)}</td>
                <td className={tdr}>{money(c.expense.cashless)}</td>
                <td className={`${tdr} font-semibold ${tone(c.netCashless)}`}>{signed(c.netCashless)}</td>
              </tr>
              <tr className="bg-surface-muted/60">
                <td className={`${td} font-semibold`}>Итого</td>
                <td className={`${tdr} font-semibold`}>{money(c.income.total)}</td>
                <td className={`${tdr} font-semibold`}>{money(c.expense.total)}</td>
                <td className={`${tdr} font-semibold ${tone(c.profit)}`}>{signed(c.profit)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          {(
            [
              ['Наличные', c.income.cash],
              ['Безналичный: терминал и переводы', c.income.terminal],
              ['Безналичный: онлайн', c.income.online],
              ['Безналичный: карта', c.income.card],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-xl border border-border p-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 font-semibold tabular-nums">{money(value)}</p>
              <p className="text-xs text-muted-foreground">{shareOf(value)} выручки</p>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Накопленное сальдо" subtitle="Сколько осталось к концу каждого дня недели: доход минус расход с понедельника">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.3} vertical={false} />
              <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={compact} width={48} />
              <Tooltip contentStyle={CHART_TOOLTIP} formatter={(v: any) => money(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="Наличные" stroke="#10b981" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Безналичный" stroke="#3b82f6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Всего" stroke="#8b5cf6" strokeWidth={3} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      <SectionCard title="По дням">
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[720px]">
            <thead className="bg-surface-muted">
              <tr>
                <th className={th}>День</th>
                <th className={thr}>Доход нал</th>
                <th className={thr}>Доход безнал</th>
                <th className={thr}>Расход нал</th>
                <th className={thr}>Расход безнал</th>
                <th className={thr}>Сальдо нал</th>
                <th className={thr}>Сальдо безнал</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {balance.days.map((d) => (
                <tr key={d.date} className={d.future ? 'text-muted-foreground' : ''}>
                  <td className={td}>
                    {DAY_LABELS[d.weekday]} <span className="text-xs text-muted-foreground">{dm(d.date)}</span>
                  </td>
                  <td className={tdr}>{money(d.current.income.cash)}</td>
                  <td className={tdr}>{money(d.current.income.cashless)}</td>
                  <td className={tdr}>{money(d.current.expense.cash)}</td>
                  <td className={tdr}>{money(d.current.expense.cashless)}</td>
                  <td className={`${tdr} ${d.hasData ? tone(d.current.netCash) : ''}`}>{d.hasData ? signed(d.current.netCash) : '—'}</td>
                  <td className={`${tdr} ${d.hasData ? tone(d.current.netCashless) : ''}`}>{d.hasData ? signed(d.current.netCashless) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Безналичный ночной смены после полуночи учтён на следующий день — как в отчётах.</p>
      </SectionCard>
    </div>
  )
}

// ─── Смены ──────────────────────────────────────────────────────────────────

function ShiftsTab({ balance }: { balance: WeeklyBalance }) {
  const { current: c, compared, previous: p } = balance
  const nightShare = c.income.total ? (c.income.night / c.income.total) * 100 : 0
  const chartData = balance.days.map((d) => ({
    label: DAY_LABELS[d.weekday],
    'День': d.future ? null : Math.round(d.current.income.day),
    'Ночь': d.future ? null : Math.round(d.current.income.night),
    [balance.compareShort]: Math.round(d.previous.income.total),
  }))

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Дневные смены" value={money(c.income.day)}>
          <Delta cur={compared.income.day} prev={p.income.day} />
        </Tile>
        <Tile label="Ночные смены" value={money(c.income.night)}>
          <Delta cur={compared.income.night} prev={p.income.night} />
        </Tile>
        <Tile label="Доля ночи" value={`${nightShare.toFixed(0)}%`} hint={p.income.total ? `база сравнения ${((p.income.night / p.income.total) * 100).toFixed(0)}%` : undefined} />
      </div>

      <SectionCard
        title="Отчёты смен"
        subtitle="Смена считается обязательной, если точка сдавала её в большинстве дней за 4 недели до этой. Проверяем по вчерашний день."
        icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
      >
        {balance.missingShifts.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" /> Все привычные отчёты смен внесены.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[420px]">
              <thead className="bg-surface-muted">
                <tr>
                  <th className={th}>День</th>
                  <th className={th}>Точка</th>
                  <th className={th}>Смена</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {balance.missingShifts.map((m) => (
                  <tr key={`${m.companyId}-${m.date}-${m.shift}`}>
                    <td className={td}>
                      {DAY_LABELS[weekdayOf(m.date)]} {dm(m.date)}
                    </td>
                    <td className={td}>{m.company}</td>
                    <td className={td}>
                      <span className="inline-flex items-center gap-1.5">
                        {m.shift === 'night' ? <Moon className="h-3.5 w-3.5 text-indigo-500" /> : <Sun className="h-3.5 w-3.5 text-amber-500" />}
                        {m.shift === 'night' ? 'Ночь' : 'День'} — отчёта нет
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="День и ночь по дням" subtitle="Ночь — выручка ночных смен; безналичный после полуночи учтён на следующий день.">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.3} vertical={false} />
              <XAxis dataKey="label" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={compact} width={48} />
              <Tooltip contentStyle={CHART_TOOLTIP} formatter={(v: any) => (v == null ? '—' : money(Number(v)))} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="День" stackId="shift" fill="#f59e0b" />
              <Bar dataKey="Ночь" stackId="shift" fill="#6366f1" radius={[4, 4, 0, 0]} />
              <Line type="monotone" dataKey={balance.compareShort} stroke="#94a3b8" strokeDasharray="5 5" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </SectionCard>

      <SectionCard title="По точкам" subtitle={`Изменение — к базе: ${balance.compareLabel}`}>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[640px]">
            <thead className="bg-surface-muted">
              <tr>
                <th className={th}>Точка</th>
                <th className={thr}>День</th>
                <th className={thr}>Изм.</th>
                <th className={thr}>Ночь</th>
                <th className={thr}>Изм.</th>
                <th className={thr}>Доля ночи</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {balance.companies
                .filter((co) => co.current.income.total || co.previous.income.total)
                .map((co) => {
                  const dayDiff = co.currentCompared.income.day - co.previous.income.day
                  const nightDiff = co.currentCompared.income.night - co.previous.income.night
                  return (
                    <tr key={co.id} className={co.inTotals ? '' : 'text-muted-foreground'}>
                      <td className={`${td} font-medium`}>{co.name}</td>
                      <td className={tdr}>{money(co.current.income.day)}</td>
                      <td className={`${tdr} ${balance.compareUntil ? tone(dayDiff) : ''}`}>{balance.compareUntil ? signed(dayDiff) : '—'}</td>
                      <td className={tdr}>{money(co.current.income.night)}</td>
                      <td className={`${tdr} ${balance.compareUntil ? tone(nightDiff) : ''}`}>{balance.compareUntil ? signed(nightDiff) : '—'}</td>
                      <td className={tdr}>{co.current.income.total ? `${((co.current.income.night / co.current.income.total) * 100).toFixed(0)}%` : '—'}</td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  )
}

// ─── Точки ──────────────────────────────────────────────────────────────────

function PointsTab({ balance }: { balance: WeeklyBalance }) {
  const [open, setOpen] = useState<string | null>(null)
  const inTotals = balance.companies.filter((c) => c.inTotals)
  const sum = (key: (s: PeriodSums) => number) => inTotals.reduce((s, c) => s + key(c.current), 0)

  return (
    <SectionCard title="Точки" subtitle={`Нажмите на точку, чтобы увидеть расходы по статьям. Изменение прибыли — к базе: ${balance.compareLabel}.`}>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[860px]">
          <thead className="bg-surface-muted">
            <tr>
              <th className={th}>Точка</th>
              <th className={thr}>Выручка</th>
              <th className={thr}>Расходы</th>
              <th className={thr}>Прибыль</th>
              <th className={thr}>Изм. прибыли</th>
              <th className={thr}>Сальдо нал</th>
              <th className={thr}>Сальдо безнал</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {balance.companies.map((co) => {
              const expanded = open === co.id
              const change = co.currentCompared.profit - co.previous.profit
              return (
                <Fragment key={co.id}>
                  <tr className={`cursor-pointer hover:bg-surface-muted ${co.inTotals ? '' : 'text-muted-foreground'}`} onClick={() => setOpen(expanded ? null : co.id)}>
                    <td className={`${td} font-medium`}>
                      <span className="inline-flex items-center gap-1.5">
                        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                        {co.name}
                        {co.isExtra ? <span className="text-xs font-normal">({co.inTotals ? 'в итогах' : 'не в итогах'})</span> : null}
                      </span>
                    </td>
                    <td className={tdr}>{money(co.current.income.total)}</td>
                    <td className={tdr}>{money(co.current.expense.total)}</td>
                    <td className={`${tdr} font-semibold ${tone(co.current.profit)}`}>{money(co.current.profit)}</td>
                    <td className={`${tdr} ${balance.compareUntil ? tone(change) : ''}`}>
                      {balance.compareUntil && (co.previous.income.total || co.previous.expense.total) ? signed(change) : '—'}
                    </td>
                    <td className={`${tdr} ${tone(co.current.netCash)}`}>{signed(co.current.netCash)}</td>
                    <td className={`${tdr} ${tone(co.current.netCashless)}`}>{signed(co.current.netCashless)}</td>
                  </tr>
                  {expanded ? (
                    <tr>
                      <td colSpan={7} className="bg-surface-muted/50 px-4 py-3">
                        <div className="grid gap-4 md:grid-cols-2">
                          <div className="text-sm">
                            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Доход</p>
                            <p>Наличные: {money(co.current.income.cash)}</p>
                            <p>Безналичный: {money(co.current.income.cashless)}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              день {money(co.current.income.day)} · ночь {money(co.current.income.night)}
                            </p>
                          </div>
                          <div>
                            <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Расходы по статьям</p>
                            {co.categories.length === 0 ? (
                              <p className="text-sm text-muted-foreground">Расходов нет</p>
                            ) : (
                              <div className="space-y-1">
                                {co.categories.map((cat) => (
                                  <div key={cat.name} className="flex justify-between gap-3 text-sm">
                                    <span className="truncate">{cat.name}</span>
                                    <span className="shrink-0 tabular-nums">
                                      {money(cat.total)}
                                      <span className="ml-2 text-xs text-muted-foreground">
                                        нал {compact(cat.cash)} · безнал {compact(cat.cashless)}
                                      </span>
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
            {inTotals.length > 1 ? (
              <tr className="bg-surface-muted/60 font-semibold">
                <td className={td}>Итого{balance.extra.names.length && !balance.companies.some((c) => c.isExtra && c.inTotals) ? ' (без Extra)' : ''}</td>
                <td className={tdr}>{money(sum((s) => s.income.total))}</td>
                <td className={tdr}>{money(sum((s) => s.expense.total))}</td>
                <td className={`${tdr} ${tone(sum((s) => s.profit))}`}>{money(sum((s) => s.profit))}</td>
                <td className={tdr} />
                <td className={`${tdr} ${tone(sum((s) => s.netCash))}`}>{signed(sum((s) => s.netCash))}</td>
                <td className={`${tdr} ${tone(sum((s) => s.netCashless))}`}>{signed(sum((s) => s.netCashless))}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </SectionCard>
  )
}

// ─── Расходы ────────────────────────────────────────────────────────────────

function ExpensesTab({ balance }: { balance: WeeklyBalance }) {
  const maxTotal = Math.max(1, ...balance.categories.map((c) => c.total))
  return (
    <div className="space-y-5">
      <SectionCard
        title="Статьи расходов"
        subtitle={
          <>
            {balance.compareUntil ? `«База» — ${balance.compareLabel}. ` : ''}
            {balance.pending.count ? `Ждут согласования: ${balance.pending.count} на ${money(balance.pending.total)} — уже учтены.` : ''}
          </>
        }
      >
        {balance.categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">Расходов за неделю нет.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[760px]">
              <thead className="bg-surface-muted">
                <tr>
                  <th className={th}>Статья</th>
                  <th className={thr}>Неделя</th>
                  <th className={thr}>База</th>
                  <th className={thr}>Изменение</th>
                  <th className={thr}>Нал</th>
                  <th className={thr}>Безнал</th>
                  <th className={`${th} w-40`}>Доля</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {balance.categories.map((cat) => {
                  const diff = cat.compared - cat.previous
                  return (
                    <tr key={cat.name}>
                      <td className={`${td} font-medium`}>{cat.name}</td>
                      <td className={tdr}>{money(cat.total)}</td>
                      <td className={`${tdr} text-muted-foreground`}>{balance.compareUntil ? money(cat.previous) : '—'}</td>
                      <td className={`${tdr} ${balance.compareUntil ? tone(-diff) : ''}`}>{balance.compareUntil ? signed(diff) : '—'}</td>
                      <td className={tdr}>{money(cat.cash)}</td>
                      <td className={tdr}>{money(cat.cashless)}</td>
                      <td className={td}>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 flex-1 rounded-full bg-surface-muted">
                            <div className="h-1.5 rounded-full bg-rose-500" style={{ width: `${(cat.total / maxTotal) * 100}%` }} />
                          </div>
                          <span className="w-10 text-right text-xs text-muted-foreground">{cat.share.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Крупные расходы недели">
        {balance.largestExpenses.length === 0 ? (
          <p className="text-sm text-muted-foreground">Расходов нет.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[720px]">
              <thead className="bg-surface-muted">
                <tr>
                  <th className={th}>Дата</th>
                  <th className={th}>Точка</th>
                  <th className={th}>Статья</th>
                  <th className={th}>Кому / комментарий</th>
                  <th className={thr}>Сумма</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {balance.largestExpenses.map((e, i) => (
                  <tr key={i}>
                    <td className={td}>{dm(e.date)}</td>
                    <td className={td}>{e.company}</td>
                    <td className={td}>
                      {e.category}
                      {e.pending ? (
                        <span className="ml-1.5 rounded bg-amber-500/15 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:text-amber-300">на согласовании</span>
                      ) : null}
                    </td>
                    <td className={`${td} max-w-[280px] truncate text-muted-foreground`}>{e.payee || '—'}</td>
                    <td className={tdr}>
                      {money(e.total)}
                      <span className="block text-[11px] text-muted-foreground">
                        {e.cash ? `нал ${compact(e.cash)}` : ''}
                        {e.cash && e.cashless ? ' · ' : ''}
                        {e.cashless ? `безнал ${compact(e.cashless)}` : ''}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  )
}

// ─── Отчёт ──────────────────────────────────────────────────────────────────

function ReportTab({
  balance,
  weekStart,
  weekEnd,
  companies,
  incomeRows,
  expenseRows,
  onPrintAct,
}: {
  balance: WeeklyBalance
  weekStart: string
  weekEnd: string
  companies: Array<{ id: string; name: string }>
  incomeRows: any[]
  expenseRows: any[]
  onPrintAct: () => void
}) {
  const { can } = useCapabilities()
  const [pdfLoading, setPdfLoading] = useState(false)
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Отчёт относится к неделе: сменили неделю — старый текст убираем
  useEffect(() => {
    abortRef.current?.abort()
    setAiText('')
    setAiError(null)
  }, [weekStart])

  const downloadPdf = async () => {
    setPdfLoading(true)
    try {
      const nameById = new Map(companies.map((c) => [String(c.id), c.name]))
      const inWeek = (iso: string) => iso >= weekStart && iso <= weekEnd
      const ops: Array<{ date: string; type: string; company: string; cat: string; amount: number; cash: number; cashless: number; note: string }> = []
      for (const r of incomeRows) {
        if (!inWeek(r.date)) continue
        const cash = Number(r.cash_amount || 0)
        const cashless = Number(r.kaspi_amount || 0) + Number(r.online_amount || 0) + Number(r.card_amount || 0)
        if (!cash && !cashless) continue
        ops.push({ date: r.date, type: 'Доход', company: nameById.get(String(r.company_id)) || '—', cat: r.shift === 'day' ? 'День' : r.shift === 'night' ? 'Ночь' : r.zone || '', amount: cash + cashless, cash, cashless, note: r.comment || '' })
      }
      for (const r of expenseRows) {
        if (!inWeek(r.date) || r.status === 'declined') continue
        const cash = Number(r.cash_amount || 0)
        const cashless = Number(r.kaspi_amount || 0)
        if (!cash && !cashless) continue
        ops.push({ date: r.date, type: 'Расход', company: nameById.get(String(r.company_id)) || '—', cat: r.category || '—', amount: cash + cashless, cash, cashless, note: r.one_off_payee || r.comment || '' })
      }
      ops.sort((a, b) => a.date.localeCompare(b.date))

      let purchasingPlan: any[] = []
      let purchasingPlanWeek = ''
      try {
        const planWeekStart = nextWeekMondayISO(weekEnd)
        purchasingPlanWeek = planWeekLabel(planWeekStart)
        const res = await fetch(`/api/admin/purchase-plan?week_start=${planWeekStart}`, { cache: 'no-store' })
        if (res.ok) {
          const j = await res.json().catch(() => null)
          purchasingPlan = (Array.isArray(j?.data) ? j.data : []).map((r: any) => ({
            company: nameById.get(String(r.company_id)) || '—',
            day: Number(r.day_of_week) || 0,
            category: r.category || '',
            title: r.title || '',
            supplier: r.supplier || '',
            qty: r.quantity != null ? r.quantity : '',
            amount: Number(r.amount) || 0,
            bought: r.status === 'bought',
          }))
        }
      } catch {
        /* план закупа в отчёте необязателен */
      }

      const c = balance.current
      const p = balance.previous
      await downloadReportPdf(
        'finreport',
        {
          meta: { title: 'Недельный отчёт', period: `${weekStart} — ${weekEnd}`, company: 'Все точки', generated: new Date().toLocaleString('ru-RU') },
          kpi: {
            revenue: c.income.total,
            revenuePrev: p.income.total,
            expense: c.expense.total,
            expensePrev: p.expense.total,
            profit: c.profit,
            profitPrev: p.profit,
            avgCheck: 0,
            txns: ops.filter((o) => o.type === 'Доход').length,
          },
          summary: [
            { section: 'СТРУКТУРА ДОХОДОВ' },
            { label: 'Наличные', cur: c.income.cash, prev: p.income.cash },
            { label: 'Безналичный доход', cur: c.income.cashless, prev: p.income.cashless },
            { label: 'Дневные смены', cur: c.income.day, prev: p.income.day },
            { label: 'Ночные смены', cur: c.income.night, prev: p.income.night },
            { section: 'САЛЬДО' },
            { label: 'Сальдо наличных', cur: c.netCash, prev: p.netCash },
            { label: 'Сальдо безналичного', cur: c.netCashless, prev: p.netCashless },
          ],
          byCompany: balance.companies
            .filter((co) => co.current.income.total || co.current.expense.total)
            .map((co) => ({
              name: co.name,
              revenue: co.current.income.total,
              cash: co.current.income.cash,
              cashless: co.current.income.cashless,
              online: co.current.income.online,
              card: co.current.income.card,
              txns: 0,
            })),
          expenses: balance.categories.map((cat) => ({ name: cat.name, amount: cat.total })),
          operations: ops,
          purchasingPlan,
          purchasingPlanWeek,
        },
        `Nedelnyy_otchet_${weekStart}_${weekEnd}`,
      )
      toast({ title: 'PDF скачан' })
    } catch (e: any) {
      toast({ title: 'Не удалось собрать PDF', description: e?.message, variant: 'destructive' })
    } finally {
      setPdfLoading(false)
    }
  }

  const generateAi = async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setAiLoading(true)
    setAiError(null)
    setAiText('')
    try {
      const res = await fetch('/api/ai/weekly-report', {
        method: 'POST',
        signal: ac.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateFrom: weekStart, dateTo: weekEnd, stream: true }),
      })
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error || 'Ошибка генерации отчёта')
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''
        for (const raw of events) {
          if (!raw.trim()) continue
          const { event, data } = parseSseEvent(raw)
          if (event === 'delta') setAiText((t) => t + String(data?.text || ''))
          if (event === 'error') throw new Error(String(data?.error || 'Ошибка генерации отчёта'))
        }
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      setAiError(e?.message || 'Не удалось сгенерировать отчёт')
    } finally {
      if (abortRef.current === ac) abortRef.current = null
      setAiLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <SectionCard title="Печатный акт" subtitle="Акт по точкам за неделю: доход, расходы построчно, остаток наличных и безналичного." icon={<Printer className="h-4 w-4 text-violet-500" />}>
          {can('weekly-report.export_pdf') ? (
            <Button variant="outline" onClick={onPrintAct}>
              <Printer className="h-4 w-4" /> Открыть акт
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">Нет права на печать акта.</p>
          )}
        </SectionCard>
        <SectionCard title="PDF-отчёт недели" subtitle="Итоги, точки, статьи расходов, все операции и план закупа на следующую неделю." icon={<Download className="h-4 w-4 text-emerald-500" />}>
          {can('weekly-report.export') ? (
            <Button variant="outline" onClick={() => void downloadPdf()} disabled={pdfLoading}>
              {pdfLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Скачать PDF
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">Нет права на выгрузку.</p>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="ИИ-отчёт недели"
        subtitle={`ИИ разбирает неделю ${rangeTitle(weekStart, weekEnd)}: итоги, что сработало, риски и что сделать на следующей неделе.`}
        icon={<Sparkles className="h-4 w-4 text-violet-500" />}
        action={
          can('weekly-report.ai_generate') ? (
            aiLoading ? (
              <Button variant="outline" size="sm" onClick={() => abortRef.current?.abort()}>
                <Square className="h-3.5 w-3.5" /> Остановить
              </Button>
            ) : (
              <Button size="sm" onClick={() => void generateAi()}>
                <Sparkles className="h-3.5 w-3.5" /> {aiText ? 'Сгенерировать заново' : 'Сгенерировать'}
              </Button>
            )
          ) : null
        }
      >
        {aiError ? <p className="text-sm text-rose-600 dark:text-rose-400">{aiError}</p> : null}
        {aiLoading && !aiText ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Собираем данные недели…
          </p>
        ) : null}
        {aiText ? <MarkdownLite text={aiText} /> : null}
        {!aiText && !aiLoading && !aiError ? (
          <p className="text-sm text-muted-foreground">{can('weekly-report.ai_generate') ? 'Нажмите «Сгенерировать» — отчёт появится здесь.' : 'Нет права на генерацию ИИ-отчёта.'}</p>
        ) : null}
      </SectionCard>
    </div>
  )
}

export default function WeeklyReportPage() {
  return (
    <Suspense
      fallback={
        <div className="app-page-wide">
          <PageSkeleton stats={4} rows={7} cols={5} />
        </div>
      }
    >
      <WeeklyReportContent />
    </Suspense>
  )
}
