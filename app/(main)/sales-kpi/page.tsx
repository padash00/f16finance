'use client'

/**
 * Эффективность продавцов магазина.
 *
 * Страница отвечает на один вопрос и старается не отвечать на другие: касса
 * просела из-за спроса или из-за продавца. Поэтому рядом с каждой сменой
 * всегда стоят обе величины — сколько людей купило и что продавец сделал с
 * каждым из них, — а вывод сопровождается уверенностью и списком того, чего
 * в данных не хватило.
 */

import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CalendarDays,
  Check,
  ChevronDown,
  CloudSun,
  Download,
  FileSpreadsheet,
  FileText,
  Gauge,
  GraduationCap,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  ShoppingBag,
  Store,
  Trash2,
  TrendingDown,
  Wallet,
  TrendingUp,
  Users,
} from 'lucide-react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { AppModal } from '@/components/ui/app-modal'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { DatePicker } from '@/components/ui/date-picker'
import { Input } from '@/components/ui/input'
import { ScrollToEdge } from '@/components/ui/scroll-to-edge'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { formatMoney } from '@/lib/core/format'
import { mutateApi, useApi } from '@/lib/hooks/use-api'

import { AccuracyTab } from './accuracy-tab'
import { CashiersTab } from './cashiers-tab'
import { SectionIntro } from './section-intro'
import { MoneyMapTab } from './money-map-tab'
import { PayoutTab } from './payout-tab'
import { PlansTab } from './plans-tab'
import { QualityTab } from './quality-tab'
import {
  ShiftDetail,
  type ShiftContext,
  type ShiftExplanation,
  type ShiftProbabilityView,
} from './shift-detail'

// ─── Типы ответа API ────────────────────────────────────────────────────────

type MetricRow = {
  metric: string
  actual: number | null
  expected: number | null
  raw_ratio: number | null
  ratio: number | null
  level: string | null
  sample: number
}

type ShiftRow = {
  date: string
  shift: 'day' | 'night'
  shift_id: string | null
  duration_minutes: number | null
  season: 'academic' | 'summer'
  cashier_id: string | null
  cashier_name: string | null
  revenue: number
  expected_revenue: number | null
  expected_receipts: number | null
  expected_avg_ticket: number | null
  items: number
  receipts: number
  score: number | null
  confidence: number
  verdict: string
  evidence: string[]
  missing: string[]
  metrics: MetricRow[]
  explanation: ShiftExplanation | null
  context: ShiftContext | null
}

type CashierRow = {
  cashier_id: string
  name: string
  shifts: number
  revenue: number
  receipts: number
  score: number | null
  status: string
  confidence: number
  metric_ratios: Record<string, number>
  strengths: string[]
  weaknesses: string[]
  training_flag?: boolean
  training_reason?: string | null
}

type ApiData = {
  no_store?: boolean
  needs_company?: boolean
  stores?: { id: string; name: string }[]
  period?: { from: string; to: string }
  company?: { id: string; name: string }
  settings?: {
    min_sample_size: number
    min_qualifying_shifts: number
    min_receipts_for_full_score: number
    configured: boolean
  }
  coverage?: {
    baseline_shifts: number
    baseline_from: string | null
    baseline_to: string | null
    items_coverage: number
    attach_coverage: number
    cashier_coverage: number
  }
  totals?: {
    revenue: number
    receipts: number
    shifts: number
    low_demand: number
    cashier_issue: number
    high_demand: number
    strong: number
    insufficient: number
  }
  shifts?: ShiftRow[]
  cashiers?: CashierRow[]
  model_version?: string
  /**
   * Вероятностный прогноз. Считается рядом с рабочим разбором и ни на балл,
   * ни на план, ни на выплату не влияет: пока это измерение, а не решение.
   */
  probabilistic_forecast?: {
    model_version: string
    shifts: Array<{ date: string; shift: string } & ShiftProbabilityView>
  } | null
}

// ─── Словарь ────────────────────────────────────────────────────────────────

const METRIC_LABELS: Record<string, string> = {
  avg_ticket: 'Средний чек',
  items_per_receipt: 'Товаров на чек',
  attach_rate: 'Допродажи',
  revenue_efficiency: 'Отдача с покупателя',
  plan_attainment: 'Выполнение плана',
  product_knowledge: 'Знание товара',
}

const VERDICTS: Record<string, { label: string; hint: string; className: string }> = {
  LOW_DEMAND: {
    label: 'Мало покупателей',
    hint: 'Людей пришло меньше обычного, а с каждым пришедшим продавец отработал не хуже своей нормы.',
    className: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-400/20',
  },
  POSSIBLE_CASHIER_ISSUE: {
    label: 'Вопрос к продавцу',
    hint: 'Покупатели были, но управляемые продавцом метрики просели.',
    className:
      'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20',
  },
  HIGH_DEMAND: {
    label: 'Вытянул поток',
    hint: 'Касса выросла в основном за счёт числа покупателей, а не качества продаж.',
    className:
      'bg-indigo-50 text-indigo-700 ring-indigo-600/20 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-400/20',
  },
  STRONG_CASHIER: {
    label: 'Сильная смена',
    hint: 'Из того же числа покупателей выжали заметно больше обычного.',
    className:
      'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20',
  },
  NORMAL: {
    label: 'Норма',
    hint: 'Отклонения в пределах обычного разброса.',
    className:
      'bg-surface-hover text-body ring-border',
  },
  INSUFFICIENT_DATA: {
    label: 'Мало данных',
    hint: 'Истории или показателей не хватило, чтобы делать выводы.',
    className:
      'bg-surface-hover text-muted-foreground ring-border',
  },
}

const STATUSES: Record<string, { label: string; className: string }> = {
  TOP: {
    label: 'Топ',
    className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  },
  STRONG: {
    label: 'Сильный',
    className: 'bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300',
  },
  NORMAL: { label: 'Норма', className: 'bg-surface-hover text-body' },
  NEEDS_TRAINING: {
    label: 'Нужно обучение',
    className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  },
  INSUFFICIENT_DATA: {
    label: 'Мало смен',
    className: 'bg-surface-hover text-muted-foreground',
  },
}

// ─── Форматирование ─────────────────────────────────────────────────────────

/**
 * Месяц как период.
 *
 * Владелец мыслит месяцами: «июль» и «август», а не «с 17.07 по 16.08».
 * Скользящее окно в тридцать дней резало месяц пополам, из-за чего поправка на
 * месяц относилась к одному месяцу, а смены в таблице — к двум.
 */
function monthBounds(month: string): { from: string; to: string } {
  const [year, m] = month.split('-').map(Number)
  const last = new Date(year || 1970, m || 1, 0).getDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

function currentMonthKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/** Список месяцев назад от текущего — для выпадающего списка. */
function recentMonths(count: number): { key: string; label: string }[] {
  const names = [
    'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
  ]
  const now = new Date()
  const out: { key: string; label: string }[] = []
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    out.push({ key, label: `${names[d.getMonth()]} ${d.getFullYear()}` })
  }
  return out
}

function deltaPct(ratio: number | null): string {
  if (ratio == null) return '—'
  const delta = Math.round((ratio - 1) * 100)
  return delta >= 0 ? `+${delta}%` : `${delta}%`
}

function ratioOf(actual: number | null, expected: number | null): number | null {
  if (actual == null || expected == null || expected <= 0) return null
  return actual / expected
}

/**
 * Балл словами.
 *
 * 1.13 читается как «лучше обычного на 13%» и больше ни в чём не нуждается.
 * Само число остаётся в подсказке — для тех, кто захочет сверить.
 */
function scoreText(score: number | null): string {
  if (score == null) return '—'
  const delta = Math.round((score - 1) * 100)
  if (Math.abs(delta) < 3) return 'как обычно'
  return delta > 0 ? `лучше на ${delta}%` : `слабее на ${Math.abs(delta)}%`
}

function toneFor(ratio: number | null): string {
  if (ratio == null) return 'text-muted-foreground'
  if (ratio >= 1.05) return 'text-emerald-600 dark:text-emerald-400'
  if (ratio <= 0.95) return 'text-amber-600 dark:text-amber-400'
  return 'text-body'
}

// ─── Мелкие блоки ───────────────────────────────────────────────────────────

function StatCard(props: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {props.label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${props.tone || 'text-foreground'}`}>
        {props.value}
      </div>
      {props.hint ? (
        <div className="mt-1 text-xs text-muted-foreground">{props.hint}</div>
      ) : null}
    </Card>
  )
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const v = VERDICTS[verdict] || VERDICTS.NORMAL
  return (
    <span
      title={v.hint}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${v.className}`}
    >
      {v.label}
    </span>
  )
}

/**
 * Насколько можно верить оценке — словами.
 *
 * Раньше здесь стоял процент. Процент не помогает принять решение: «67%» не
 * говорит, идти разговаривать с человеком или подождать ещё смену. Слова
 * говорят.
 */
function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const v =
    pct >= 75
      ? {
          label: 'можно доверять',
          tone: 'bg-emerald-500',
          text: 'text-emerald-700 dark:text-emerald-400',
          hint: 'Смен достаточно, сравнивать есть с чем, помех не было. По такой оценке можно разговаривать с человеком.',
        }
      : pct >= 45
        ? {
            label: 'есть сомнения',
            tone: 'bg-amber-500',
            text: 'text-amber-700 dark:text-amber-400',
            hint: 'Что-то мешало: короткая смена, погода, событие в городе или мало похожих смен для сравнения. Вывод скорее верный, но опираться на него одного не стоит.',
          }
        : {
            label: 'рано судить',
            tone: 'bg-muted-foreground',
            text: 'text-muted-foreground',
            hint: 'Данных слишком мало. Это не про человека — это про то, что модулю пока не с чем сравнивать.',
          }

  return (
    <div className="flex items-center gap-2 whitespace-nowrap" title={v.hint}>
      <div className="h-1.5 w-10 shrink-0 overflow-hidden rounded-full bg-surface-hover">
        <div className={`h-full ${v.tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs ${v.text}`}>{v.label}</span>
    </div>
  )
}

/**
 * Обстановка смены одной строкой в таблице.
 *
 * Развёрнутое объяснение живёт внутри разбора, но увидеть «в этот день был
 * снег и каникулы» нужно сразу, не раскрывая каждую смену: иначе таблица
 * показывает провал по кассе и молчит о его причине.
 */
function ContextChips({ context }: { context: ShiftContext | null }) {
  if (!context) return <span className="text-xs text-muted-foreground">—</span>

  const chips: { key: string; icon: React.ReactNode; text: string; title: string; tone: string }[] = []

  if (context.weather && context.weather.bucket !== 'normal') {
    chips.push({
      key: 'weather',
      icon: <CloudSun className="h-3 w-3" />,
      text: context.weather.label.toLowerCase(),
      title: context.weather.summary,
      tone: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
    })
  }
  for (const d of context.days) {
    chips.push({
      key: `day-${d.name}`,
      icon: <CalendarDays className="h-3 w-3" />,
      text: d.name.length > 22 ? `${d.name.slice(0, 21)}…` : d.name,
      title: `${d.type_label}: ${d.name}`,
      tone: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
    })
  }
  for (const p of context.periods) {
    chips.push({
      key: `period-${p.name}`,
      icon: <GraduationCap className="h-3 w-3" />,
      text: p.type_label.toLowerCase(),
      title: `${p.name}${p.audience_label ? ` · ${p.audience_label}` : ''}${p.confirmed ? '' : ' · не подтверждён'}`,
      tone: 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300',
    })
  }

  if (chips.length === 0) {
    // Обычный день — это тоже ответ, и он важен: значит, кассу нечем оправдать
    // и нечем объяснить, кроме работы.
    return (
      <span className="text-xs text-muted-foreground" title="Ни погоды, ни праздников, ни учебных периодов">
        обычный день
      </span>
    )
  }

  return (
    <div className="flex flex-wrap gap-1">
      {chips.slice(0, 3).map((c) => (
        <span
          key={c.key}
          title={c.title}
          className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium ${c.tone}`}
        >
          {c.icon}
          {c.text}
        </span>
      ))}
      {chips.length > 3 ? (
        <span className="text-[11px] text-muted-foreground">+{chips.length - 3}</span>
      ) : null}
    </div>
  )
}

/**
 * Сортировка таблицы по колонке.
 *
 * Нужна для простых вопросов, на которые иначе приходится листать глазами:
 * «где худшие смены», «кто больше всех отработал». Первый клик по колонке
 * ставит порядок, который человек и хочет увидеть: у чисел — от большего,
 * у дат и имён — от меньшего.
 *
 * Пустые значения всегда уезжают в конец, в обе стороны. Смена без оценки —
 * это не «самая слабая», а «неизвестно», и наверху списка ей не место.
 */
type SortState<K extends string> = { key: K; dir: 'asc' | 'desc' }

function sortRows<T, K extends string>(
  rows: T[],
  sort: SortState<K> | null,
  pick: (row: T, key: K) => string | number | null | undefined,
): T[] {
  if (!sort) return rows
  const factor = sort.dir === 'asc' ? 1 : -1

  return [...rows].sort((a, b) => {
    const left = pick(a, sort.key)
    const right = pick(b, sort.key)
    const leftEmpty = left == null || left === ''
    const rightEmpty = right == null || right === ''
    if (leftEmpty && rightEmpty) return 0
    if (leftEmpty) return 1
    if (rightEmpty) return -1
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * factor
    return String(left).localeCompare(String(right), 'ru') * factor
  })
}

/** Заголовок-кнопка со стрелкой. Стрелка показывает текущий порядок. */
function SortHeader<K extends string>(props: {
  label: string
  sortKey: K
  sort: SortState<K> | null
  onSort: (next: SortState<K>) => void
  align?: 'left' | 'right'
  /** Порядок при первом клике. Для чисел естественнее «сначала большие». */
  initial?: 'asc' | 'desc'
}) {
  const active = props.sort?.key === props.sortKey
  const dir = active ? props.sort!.dir : null
  const align = props.align === 'right' ? 'justify-end text-right' : 'text-left'

  return (
    <th className={`whitespace-nowrap px-4 py-2 font-medium ${props.align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() =>
          props.onSort({
            key: props.sortKey,
            dir: active ? (dir === 'asc' ? 'desc' : 'asc') : props.initial || 'asc',
          })
        }
        className={`inline-flex w-full items-center gap-1 uppercase tracking-wide transition-colors hover:text-foreground ${align} ${
          active ? 'text-foreground' : ''
        }`}
        title="Отсортировать"
      >
        {props.label}
        {dir === 'asc' ? (
          <ArrowUp className="h-3 w-3 shrink-0" />
        ) : dir === 'desc' ? (
          <ArrowDown className="h-3 w-3 shrink-0" />
        ) : (
          <ArrowUpDown className="h-3 w-3 shrink-0 opacity-30" />
        )}
      </button>
    </th>
  )
}

type ShiftSortKey = 'date' | 'cashier' | 'revenue' | 'receipts' | 'score' | 'verdict' | 'confidence'
type CashierSortKey = 'name' | 'shifts' | 'revenue' | 'score' | 'status' | 'confidence'

/**
 * Порядок вердиктов и статусов при сортировке.
 *
 * Не алфавит и не случайность: первым идёт то, с чем нужно разбираться. Клик
 * по колонке «Вывод» должен поднимать наверх смены, требующие внимания, а не
 * начинать с буквы «В».
 */
const STATUS_ORDER: Record<string, number> = {
  POSSIBLE_CASHIER_ISSUE: 0,
  NEEDS_TRAINING: 0,
  LOW_DEMAND: 1,
  NORMAL: 2,
  HIGH_DEMAND: 3,
  STRONG_CASHIER: 4,
  STRONG: 4,
  TOP: 5,
  INSUFFICIENT_DATA: 9,
}

// ─── Настройки ──────────────────────────────────────────────────────────────

type SettingsData = {
  configured: boolean
  settings: {
    latitude: number | null
    longitude: number | null
    weather_adjusts_bonus_threshold: boolean
    require_product_test_for_top_bonus: boolean
    monthly_bonus_strong: number
    monthly_bonus_top: number
  }
  companies: { id: string; name: string; store_enabled: boolean }[]
  categories: { id: string; name: string }[]
  items: { id: string; name: string }[]
  rules: {
    id: string
    source_kind: 'category' | 'item'
    source_ref: string
    target_kind: 'category' | 'item'
    target_ref: string
    weight: number
    active: boolean
  }[]
}

function SettingsModal(props: {
  companyId: string
  companyName: string
  onClose: () => void
  onSaved: () => void
}) {
  const key = `/api/admin/sales-kpi/settings?company_id=${props.companyId}`
  const { data, loading, refresh } = useApi<{ data: SettingsData }>(key)
  const payload = data?.data

  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  const [testGate, setTestGate] = useState(false)
  const [bonusStrong, setBonusStrong] = useState('')
  const [bonusTop, setBonusTop] = useState('')
  // Каждая сторона правила — «категория:id» или «товар:id». Один select
  // вместо двух: администратору не нужно сначала выбирать вид, а потом
  // позицию, он просто ищет нужное в списке.
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  // Догрузка погоды за прошлое: без неё влияние погоды набиралось бы месяцами.
  const [backfill, setBackfill] = useState<{ loading: boolean; result: string | null }>({
    loading: false,
    result: null,
  })

  useEffect(() => {
    if (!payload) return
    setLat(payload.settings.latitude == null ? '' : String(payload.settings.latitude))
    setLon(payload.settings.longitude == null ? '' : String(payload.settings.longitude))
    setTestGate(Boolean(payload.settings.require_product_test_for_top_bonus))
    setBonusStrong(String(payload.settings.monthly_bonus_strong ?? ''))
    setBonusTop(String(payload.settings.monthly_bonus_top ?? ''))
  }, [payload])

  async function post(body: Record<string, unknown>) {
    setBusy(true)
    setProblem(null)
    try {
      const res = await fetch('/api/admin/sales-kpi/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: props.companyId, ...body }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      await refresh()
      props.onSaved()
      return true
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Не удалось сохранить')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function saveSettings() {
    if (coordsBroken) {
      setProblem('Координаты записаны неверно. Нужны числа, например 49.96103 и 82.593714.')
      return
    }
    const ok = await post({
      action: 'save_settings',
      latitude: latValue,
      longitude: lonValue,
      require_product_test_for_top_bonus: testGate,
      monthly_bonus_strong: bonusStrong,
      monthly_bonus_top: bonusTop,
    })
    if (ok) {
      // Подтверждение вместо молчания, а затем закрытие: раньше окно просто
      // оставалось открытым, и было непонятно, сохранилось ли вообще.
      setSaved(true)
      setTimeout(() => props.onClose(), 900)
    }
  }

  /**
   * Догружает факт погоды за всю историю продаж точки.
   *
   * Крон смотрит назад на неделю, поэтому без этой кнопки коэффициенты погоды
   * стали бы рабочими только через несколько месяцев наблюдений. Архив
   * закрывает историю сразу.
   */
  async function backfillWeather() {
    setBackfill({ loading: true, result: null })
    setProblem(null)
    try {
      const res = await fetch('/api/admin/sales-kpi/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: props.companyId, action: 'backfill_weather' }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const reason =
          json?.error === 'coordinates-required'
            ? 'Сначала сохраните координаты.'
            : json?.error === 'no-sales'
              ? 'У точки ещё нет продаж — грузить погоду не к чему.'
              : json?.error || `HTTP ${res.status}`
        throw new Error(reason)
      }
      setBackfill({
        loading: false,
        result: `Загружено дней: ${json.loaded}, с ${json.from} по ${json.to}.`,
      })
    } catch (e) {
      setBackfill({ loading: false, result: null })
      setProblem(e instanceof Error ? e.message : 'Не удалось загрузить погоду')
    }
  }

  async function removeRule(id: string) {
    setBusy(true)
    setProblem(null)
    try {
      const res = await fetch(`/api/admin/sales-kpi/settings?rule_id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await refresh()
      props.onSaved()
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Не удалось удалить')
    } finally {
      setBusy(false)
    }
  }

  const refName = (kind: 'category' | 'item', id: string) => {
    const list = kind === 'category' ? payload?.categories : payload?.items
    const found = list?.find((x) => x.id === id)
    if (!found) return '—'
    return kind === 'item' ? `товар «${found.name}»` : found.name
  }

  const parseRef = (value: string): { kind: 'category' | 'item'; ref: string } | null => {
    const [kind, ref] = value.split(':')
    if (!ref) return null
    return { kind: kind === 'item' ? 'item' : 'category', ref }
  }

  // В русской раскладке дробные вводят через запятую, а Number('49,96') даёт
  // NaN — координаты молча не сохранялись, хотя экран писал «погода
  // собирается». Приводим к точке и проверяем перед отправкой.
  const parseCoord = (raw: string): number | null => {
    const value = raw.trim().replace(',', '.')
    if (value === '') return null
    const n = Number(value)
    return Number.isFinite(n) ? n : NaN
  }

  const latValue = parseCoord(lat)
  const lonValue = parseCoord(lon)
  const coordsBroken = Number.isNaN(latValue) || Number.isNaN(lonValue)
  const hasCoords = latValue != null && lonValue != null && !coordsBroken
  const rules = payload?.rules || []

  // Окно рисует общий AppModal: Esc, клик по фону, замок прокрутки, ловушка
  // фокуса и высота — всё это уже решено там один раз на весь проект.
  return (
    <AppModal
      open
      onClose={props.onClose}
      maxWidth="max-w-3xl"
      title={
        <div className="flex flex-wrap items-center gap-2">
          <span>Настройки</span>
          <span className="rounded-lg bg-surface-hover px-2 py-0.5 text-xs font-medium text-body">
            {props.companyName}
          </span>
          <span className="text-sm font-normal text-muted-foreground">
            настройки относятся к этой точке
          </span>
        </div>
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          {saved ? (
            <span className="mr-auto flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
              <Check className="h-4 w-4" /> Сохранено
            </span>
          ) : null}
          <Button variant="outline" size="sm" onClick={props.onClose}>
            Закрыть
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void saveSettings()}>
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Сохранить
          </Button>
        </div>
      }
    >
      <>
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Загружаем настройки…
          </div>
        ) : (
          <div className="space-y-4">
            {/* Погода */}
            <section className="rounded-xl border border-border p-4">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
                  <CloudSun className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-foreground">
                    Где находится магазин
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Координаты нужны только для погоды: по ним берётся прогноз вашего города. Погода
                    объясняет, почему покупателей было больше или меньше, но на бонусы не влияет —
                    продавец за дождь не отвечает.
                  </p>

                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-body">Широта</span>
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={lat}
                        onChange={(e) => setLat(e.target.value)}
                        placeholder="43.238949"
                        className="w-40"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-body">Долгота</span>
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={lon}
                        onChange={(e) => setLon(e.target.value)}
                        placeholder="76.889709"
                        className="w-40"
                      />
                    </label>
                    <span
                      className={`mb-2 text-xs ${
                        coordsBroken
                          ? 'text-rose-600 dark:text-rose-400'
                          : hasCoords
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {coordsBroken
                        ? 'это не похоже на координаты'
                        : hasCoords
                          ? 'погода собирается'
                          : 'без координат погода не собирается'}
                    </span>
                  </div>

                  <p className="mt-2 text-xs text-muted-foreground">
                    Как узнать: откройте Google Карты, нажмите правой кнопкой на здание магазина — первая
                    строка меню и есть эти два числа.
                  </p>

                  {hasCoords ? (
                    <div className="mt-3 rounded-lg bg-surface-muted p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-medium text-body">
                          Погода за прошлое
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={backfill.loading || busy}
                          onClick={() => void backfillWeather()}
                        >
                          {backfill.loading ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="mr-1 h-3.5 w-3.5" />
                          )}
                          Догрузить
                        </Button>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        Каждую ночь погода собирается на неделю назад, поэтому влияние снега и жары
                        набиралось бы месяцами. Кнопка забирает архив за всю историю продаж сразу — один
                        раз, дальше справляется крон.
                      </p>
                      {backfill.result ? (
                        <p className="mt-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          {backfill.result}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            {/* Суммы доплаты */}
            <section className="rounded-xl border border-border p-4">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
                  <Wallet className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-foreground">Сколько доплачивать</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Это правило, а не разовое решение: продавец должен заранее знать, к чему идёт. Сумму
                    конкретного начисления можно поправить при выплате — там нужно указать причину.
                  </p>

                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-body">Сильный, ₸</span>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={bonusStrong}
                        onChange={(e) => setBonusStrong(e.target.value)}
                        placeholder="10000"
                        className="w-36"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-body">Топ, ₸</span>
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={bonusTop}
                        onChange={(e) => setBonusTop(e.target.value)}
                        placeholder="20000"
                        className="w-36"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </section>

            {/* Ворота */}
            <section className="rounded-xl border border-border p-4">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
                  <GraduationCap className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-foreground">Знание товара</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Верхние уровни (B3 и рекорд) можно закрыть для тех, кто не сдал тест. Включайте,
                    только если тесты действительно проводятся: иначе уровень срежется всем за
                    отсутствие данных, а не за незнание.
                  </p>

                  <label className="mt-3 flex cursor-pointer items-center gap-2.5 rounded-lg bg-surface-muted px-3 py-2.5 transition hover:bg-surface-hover">
                    <input
                      type="checkbox"
                      checked={testGate}
                      onChange={(e) => setTestGate(e.target.checked)}
                      className="h-4 w-4 rounded border-border text-sky-600"
                    />
                    <span className="text-sm text-body">
                      Требовать сданный тест для B3 и рекорда
                    </span>
                  </label>
                </div>
              </div>
            </section>

            {/* Допродажи */}
            <section className="rounded-xl border border-border p-4">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
                  <ShoppingBag className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h3 className="text-sm font-semibold text-foreground">Допродажи</h3>
                    <span className="text-xs text-muted-foreground">
                      {rules.length > 0 ? `${rules.length} прав.` : 'сохраняются сразу'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    «Взяли одно — предложи другое». Считается <b>внутри одного чека</b>: рамен и напиток в
                    одном чеке — допродажа засчитана, а рамен одним чеком и напиток следующим — нет, это
                    две отдельные покупки. Можно указать и категорию, и конкретный товар.
                  </p>

                  <div className="mt-3 space-y-1.5">
                    {rules.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border px-3 py-5 text-center">
                        <p className="text-sm text-muted-foreground">Правил пока нет</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Пока их нет, допродажи не считаются и в оценке не участвуют
                        </p>
                      </div>
                    ) : (
                      rules.map((r) => (
                        <div
                          key={r.id}
                          className="flex items-center gap-2 rounded-lg bg-surface-muted px-3 py-2 text-sm"
                        >
                          <span className="text-body">
                            {refName(r.source_kind, r.source_ref)}
                          </span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-body">
                            {refName(r.target_kind, r.target_ref)}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => void removeRule(r.id)}
                            disabled={busy}
                            className="ml-auto h-7 w-7 text-muted-foreground hover:text-rose-600"
                            aria-label="Удалить правило"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>

                  {(payload?.categories || []).length === 0 && (payload?.items || []).length === 0 ? (
                    <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
                      В каталоге точки нет ни категорий, ни товаров — сначала заполните каталог магазина.
                    </p>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {([
                        ['Что купили', source, setSource],
                        ['Что предложить', target, setTarget],
                      ] as const).map(([placeholder, value, setValue], i) => (
                        <Fragment key={placeholder}>
                          {i === 1 ? <span className="text-muted-foreground">→</span> : null}
                          {/* Общий Select портала: родной <select> рисует
                              список силами системы — на тёмной теме нечитаем. */}
                          <Select value={value} onValueChange={setValue}>
                            <SelectTrigger className="max-w-[200px] flex-1">
                              <SelectValue placeholder={placeholder} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                <SelectLabel>Категории</SelectLabel>
                                {(payload?.categories || []).map((c) => (
                                  <SelectItem key={`c-${c.id}`} value={`category:${c.id}`}>
                                    {c.name}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                              <SelectGroup>
                                <SelectLabel>Товары</SelectLabel>
                                {(payload?.items || []).map((it) => (
                                  <SelectItem key={`i-${it.id}`} value={`item:${it.id}`}>
                                    {it.name}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                        </Fragment>
                      ))}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || !source || !target || source === target}
                        onClick={() => {
                          const a = parseRef(source)
                          const b = parseRef(target)
                          if (!a || !b) return
                          void post({
                            action: 'add_rule',
                            source_kind: a.kind,
                            source_ref: a.ref,
                            target_kind: b.kind,
                            target_ref: b.ref,
                          }).then(() => {
                            setSource('')
                            setTarget('')
                          })
                        }}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" /> Добавить
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {problem ? (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
                {problem}
              </p>
            ) : null}
          </div>
        )}
      </>
    </AppModal>
  )
}

// ─── Страница ───────────────────────────────────────────────────────────────

export default function SalesKpiPage() {
  // Период задаётся месяцем. Произвольные даты остаются доступны, но по
  // умолчанию страница показывает целый месяц: так поправка на месяц и смены в
  // таблице говорят об одном и том же отрезке.
  const [month, setMonth] = useState(currentMonthKey())
  const [customRange, setCustomRange] = useState(false)
  const [from, setFrom] = useState(monthBounds(currentMonthKey()).from)
  const [to, setTo] = useState(monthBounds(currentMonthKey()).to)
  const [companyId, setCompanyId] = useState<string>('')
  const [openShift, setOpenShift] = useState<string | null>(null)
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  // По умолчанию смены идут по дате: так их и читают, день за днём.
  const [shiftSort, setShiftSort] = useState<SortState<ShiftSortKey> | null>({
    key: 'date',
    dir: 'asc',
  })
  const [cashierSort, setCashierSort] = useState<SortState<CashierSortKey> | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  // «Кому доплатить» первой и по умолчанию: это единственная вкладка, ради
  // которой на страницу заходят регулярно.
  const [tab, setTab] = useState<
    'payout' | 'review' | 'people' | 'plans' | 'accuracy' | 'quality' | 'money'
  >(
    'payout',
  )
  const { can } = useCapabilities()

  const query = new URLSearchParams({ from, to })
  if (companyId) query.set('company_id', companyId)

  const apiKey = `/api/admin/sales-kpi?${query.toString()}`
  const { data, error, loading, refreshing, refresh } = useApi<{ data: ApiData }>(apiKey)

  const payload = data?.data
  // Через useMemo, потому что `payload?.shifts || []` создаёт новый массив на
  // каждый рендер и пересортировка запускалась бы без всякой причины.
  const allShifts = useMemo(() => payload?.shifts || [], [payload])
  const allCashiers = useMemo(() => payload?.cashiers || [], [payload])

  const shifts = useMemo(
    () =>
      sortRows(allShifts, shiftSort, (row, key) => {
        switch (key) {
          case 'date':
            // Дата и смена вместе: иначе ночь могла встать выше дня того же дня.
            return `${row.date}|${row.shift === 'night' ? 1 : 0}`
          case 'cashier':
            return row.cashier_name
          case 'revenue':
            return row.revenue
          case 'receipts':
            return row.receipts
          case 'score':
            return row.score
          case 'verdict':
            return STATUS_ORDER[row.verdict] ?? 99
          case 'confidence':
            return row.confidence
          default:
            return null
        }
      }),
    [allShifts, shiftSort],
  )

  const cashiers = useMemo(
    () =>
      sortRows(allCashiers, cashierSort, (row, key) => {
        switch (key) {
          case 'name':
            return row.name
          case 'shifts':
            return row.shifts
          case 'revenue':
            return row.revenue
          case 'score':
            return row.score
          case 'status':
            return STATUS_ORDER[row.status] ?? 99
          case 'confidence':
            return row.confidence
          default:
            return null
        }
      }),
    [allCashiers, cashierSort],
  )
  const coverage = payload?.coverage
  const totals = payload?.totals

  const warnings = useMemo(() => {
    const list: string[] = []
    if (!coverage) return list
    if (coverage.baseline_shifts < 20) {
      list.push(
        `История короткая: ${coverage.baseline_shifts} смен до начала периода. Ожидания будут грубыми, а часть выводов — «мало данных».`,
      )
    }
    if (coverage.attach_coverage < 0.3) {
      list.push(
        'Правила допродаж срабатывают меньше чем в трети смен — метрика допродаж почти не участвует в оценке. Проверьте, заведены ли правила и проставлены ли категории у товаров.',
      )
    }
    if (coverage.items_coverage < 0.5) {
      list.push(
        'Больше половины смен без построчных чеков: средний чек, товары на чек и допродажи по ним не считаются.',
      )
    }
    if (coverage.cashier_coverage < 0.9) {
      list.push('Часть чеков без кассира — такие смены в оценку людей не попадают.')
    }
    return list
  }, [coverage])

  /**
   * Выгрузка разбора.
   *
   * Считает сервер и по тому же коду, что рисует страницу: отчёт, который
   * расходится с экраном, хуже отсутствия отчёта.
   */
  async function exportReport(format: 'pdf' | 'xlsx') {
    if (!payload?.company) return
    setExporting(format)
    setExportError(null)
    try {
      const res = await fetch('/api/admin/sales-kpi/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: payload.company.id, from, to, format }),
      })
      if (!res.ok) {
        const problem = await res.json().catch(() => ({}))
        throw new Error(problem?.detail || problem?.error || `HTTP ${res.status}`)
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Разбор смен ${from} — ${to}.${format}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      // Ссылку освобождаем не сразу: Safari успевает отменить скачивание.
      setTimeout(() => URL.revokeObjectURL(url), 4000)
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Не удалось собрать отчёт')
    } finally {
      setExporting(null)
    }
  }

  const toolbar = (
    <div className="flex flex-wrap items-end gap-2">
      {customRange ? (
        <>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            С
            <DatePicker value={from} onChange={setFrom} className="w-40" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            По
            <DatePicker value={to} onChange={setTo} className="w-40" />
          </label>
        </>
      ) : (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Месяц
          <Select
            value={month}
            onValueChange={(next) => {
              const bounds = monthBounds(next)
              setMonth(next)
              setFrom(bounds.from)
              setTo(bounds.to)
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {recentMonths(18).map((m) => (
                <SelectItem key={m.key} value={m.key}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}
      {(payload?.stores?.length || 0) > 1 ? (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Точка
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Выберите точку" />
            </SelectTrigger>
            <SelectContent>
              {(payload?.stores || []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      ) : null}
      <div className="flex gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (customRange) {
              // Возврат к месяцам: показываем тот, в котором начинался
              // выбранный отрезок, иначе экран прыгнул бы на текущий месяц.
              const next = from.slice(0, 7)
              const bounds = monthBounds(next)
              setMonth(next)
              setFrom(bounds.from)
              setTo(bounds.to)
            }
            setCustomRange(!customRange)
          }}
        >
          {customRange ? 'По месяцам' : 'Свои даты'}
        </Button>
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )

  return (
    // app-page-wide — общий контейнер портала: без него страница растягивается
    // на всю ширину экрана и теряет поля, в отличие от остальных разделов.
    <div className="app-page-wide space-y-5">
      {/* Таблица смен за месяц — это сотни строк, возвращаться к фильтрам
          колесом мыши слишком долго. */}
      <ScrollToEdge />

      <AdminPageHeader
        title="Эффективность продавцов"
        description="Спрос или продавец: сколько людей купило и что продавец сделал с каждым из них"
        icon={<Gauge className="h-5 w-5" />}
        accent="blue"
        toolbar={toolbar}
        actions={
          payload?.company ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={exporting !== null}
                onClick={() => void exportReport('pdf')}
                title="Разбор каждой смены словами, книжная вёрстка"
              >
                {exporting === 'pdf' ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="mr-1 h-4 w-4" />
                )}
                PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={exporting !== null}
                onClick={() => void exportReport('xlsx')}
                title="Таблицы с фильтрами, диаграммы и графики"
              >
                {exporting === 'xlsx' ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="mr-1 h-4 w-4" />
                )}
                Excel
              </Button>
              {can('sales-kpi.manage') ? (
                <Button variant="outline" size="sm" onClick={() => setShowSettings(true)}>
                  <Settings className="mr-1 h-4 w-4" /> Настройки
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />

      {exportError ? (
        <Card className="p-3 text-sm text-rose-600 dark:text-rose-400">
          Отчёт собрать не удалось: {exportError}
        </Card>
      ) : null}

      {showSettings && payload?.company ? (
        <SettingsModal
          companyId={payload.company.id}
          companyName={payload.company.name}
          onClose={() => setShowSettings(false)}
          onSaved={() => mutateApi(apiKey)}
        />
      ) : null}

      {loading ? (
        <Card className="flex items-center justify-center gap-2 p-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Считаем ожидания по истории…
        </Card>
      ) : error ? (
        <Card className="p-6 text-sm text-rose-600 dark:text-rose-400">
          Не удалось загрузить данные: {error}
        </Card>
      ) : payload?.no_store ? (
        <Card className="p-6 text-sm text-body">
          <Store className="mb-2 h-5 w-5 text-muted-foreground" />
          Ни на одной точке не включён магазин. Модуль считает продажи магазина — включите магазин на точке
          в настройках, и страница оживёт.
        </Card>
      ) : payload?.needs_company ? (
        <Card className="p-6 text-sm text-body">
          Выберите точку в фильтре выше. Смешивать точки в один рейтинг нельзя: у них разный ассортимент,
          поток и ожидания, и общий балл не значил бы ничего.
        </Card>
      ) : (
        <>
          <div
            className="inline-flex flex-wrap gap-1 rounded-2xl border border-border bg-surface-muted p-1"
            role="tablist"
            aria-label="Разделы эффективности продавцов"
          >
            {([
              ['payout', 'Кому доплатить'],
              ['review', 'Почему такая касса'],
              ['people', 'По продавцам'],
              ['plans', 'Цели на смену'],
              ['quality', 'Качество данных'],
              ['accuracy', 'Проверка модели'],
              ['money', 'Где что настроено'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                  tab === id
                    ? 'bg-card text-foreground shadow-sm ring-1 ring-border'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'people' && payload?.company ? (
            <CashiersTab
              companyId={payload.company.id}
              from={from}
              to={to}
              cashiers={cashiers as any}
              shifts={shifts as any}
              minQualifyingShifts={payload?.settings?.min_qualifying_shifts ?? 6}
            />
          ) : tab === 'payout' && payload?.company ? (
            <PayoutTab
              companyId={payload.company.id}
              month={month}
              canManage={can('sales-kpi.manage')}
            />
          ) : tab === 'plans' && payload?.company ? (
            <PlansTab companyId={payload.company.id} canManage={can('sales-kpi.manage')} />
          ) : tab === 'accuracy' && payload?.company ? (
            <AccuracyTab companyId={payload.company.id} />
          ) : tab === 'money' && payload?.company ? (
            <MoneyMapTab companyId={payload.company.id} />
          ) : tab === 'quality' && payload?.company ? (
            <QualityTab
              companyId={payload.company.id}
              canManage={can('sales-kpi.manage')}
              cashierNames={new Map(cashiers.map((c) => [c.cashier_id, c.name]))}
            />
          ) : (
        <>

          {warnings.length > 0 ? (
            <Card className="flex gap-3 p-4 text-sm text-body">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <ul className="space-y-1">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          <SectionIntro
            icon={<Gauge className="h-5 w-5" />}
            tone="emerald"
            title="Почему такая касса"
            what="Разбор каждой смены: касса получилась такой из-за того, что мало людей зашло, или из-за того, как продавец с ними работал. Это два разных ответа, и путать их нельзя — за пустой вечер человек не отвечает."
            todo={[
              'Посмотреть, где виноват спрос, а где есть вопрос к продавцу',
              'Нажать на смену — раскроется полный разбор словами',
              'В разборе есть ссылка на чеки и позиции этой смены',
              'Кнопка «Объяснить словами» добавит связный текст от ИИ',
            ]}
            how="Каждая смена сравнивается не со средним по году, а с похожими сменами: тот же сезон, тот же день недели, дневная или ночная. Число чеков считается мерой спроса — привести людей в магазин продавец не может, а вот средний чек и допродажи зависят от него."
          />

          {/* Сводка */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard
              label="Смен разобрано"
              value={String(totals?.shifts ?? 0)}
              hint={coverage ? `история: ${coverage.baseline_shifts} смен` : undefined}
            />
            <StatCard label="Выручка периода" value={formatMoney(totals?.revenue ?? 0)} />
            <StatCard
              label="Мало покупателей"
              value={String(totals?.low_demand ?? 0)}
              hint="продавец отработал нормально"
              tone="text-sky-600 dark:text-sky-400"
            />
            <StatCard
              label="Вопрос к продавцу"
              value={String(totals?.cashier_issue ?? 0)}
              hint="люди были, метрики просели"
              tone="text-amber-600 dark:text-amber-400"
            />
            <StatCard
              label="Мало данных"
              value={String(totals?.insufficient ?? 0)}
              hint="вывод не делается"
            />
          </div>

          {/* Продавцы */}
          <Card className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">Продавцы</h2>
              <span className="text-xs text-muted-foreground">
                статус присваивается от {payload?.settings?.min_qualifying_shifts ?? 6} смен
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <SortHeader label="Продавец" sortKey="name" sort={cashierSort} onSort={setCashierSort} />
                    <SortHeader
                      label="Смен"
                      sortKey="shifts"
                      sort={cashierSort}
                      onSort={setCashierSort}
                      align="right"
                      initial="desc"
                    />
                    <SortHeader
                      label="Выручка"
                      sortKey="revenue"
                      sort={cashierSort}
                      onSort={setCashierSort}
                      align="right"
                      initial="desc"
                    />
                    <SortHeader
                      label="Как отработал"
                      sortKey="score"
                      sort={cashierSort}
                      onSort={setCashierSort}
                      align="right"
                      initial="desc"
                    />
                    <SortHeader label="Статус" sortKey="status" sort={cashierSort} onSort={setCashierSort} />
                    <SortHeader
                      label="Можно ли доверять"
                      sortKey="confidence"
                      sort={cashierSort}
                      onSort={setCashierSort}
                      initial="desc"
                    />
                    <th className="px-4 py-2 text-left font-medium">Сильное / слабое</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {cashiers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                        За период нет смен с указанным продавцом.
                      </td>
                    </tr>
                  ) : (
                    cashiers.map((c) => {
                      const status = STATUSES[c.status] || STATUSES.NORMAL
                      return (
                        <tr key={c.cashier_id} className="hover:bg-surface-hover">
                          <td className="px-4 py-2 font-medium text-foreground">{c.name}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{c.shifts}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{formatMoney(c.revenue)}</td>
                          <td
                            className={`px-4 py-2 text-right font-medium ${toneFor(c.score)}`}
                            title={c.score == null ? '' : `Балл ${c.score.toFixed(2)} — отношение к обычному для таких смен`}
                          >
                            {scoreText(c.score)}
                          </td>
                          <td className="px-4 py-2">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>
                              {status.label}
                            </span>
                            {c.training_flag ? (
                              <div
                                className="mt-0.5 text-xs text-amber-600 dark:text-amber-400"
                                title={c.training_reason || ''}
                              >
                                рекомендуется обучение
                              </div>
                            ) : null}
                          </td>
                          <td className="px-4 py-2">
                            <Confidence value={c.confidence} />
                          </td>
                          <td className="px-4 py-2 text-xs">
                            <div className="flex flex-wrap gap-1">
                              {c.strengths.slice(0, 2).map((m) => (
                                <span
                                  key={`s-${m}`}
                                  className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                                >
                                  <TrendingUp className="h-3 w-3" />
                                  {METRIC_LABELS[m] || m}
                                </span>
                              ))}
                              {c.weaknesses.slice(0, 2).map((m) => (
                                <span
                                  key={`w-${m}`}
                                  className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                                >
                                  <TrendingDown className="h-3 w-3" />
                                  {METRIC_LABELS[m] || m}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Смены */}
          <Card className="overflow-hidden">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">Смены</h2>
              <p className="text-xs text-muted-foreground">
                Нажмите на смену, чтобы увидеть, из чего сложился вывод
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1240px] text-sm">
                <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <SortHeader label="Дата" sortKey="date" sort={shiftSort} onSort={setShiftSort} />
                    <th className="whitespace-nowrap px-4 py-2 text-left font-medium">Смена</th>
                    <SortHeader label="Продавец" sortKey="cashier" sort={shiftSort} onSort={setShiftSort} />
                    <SortHeader
                      label="Касса"
                      sortKey="revenue"
                      sort={shiftSort}
                      onSort={setShiftSort}
                      align="right"
                      initial="desc"
                    />
                    <SortHeader
                      label="Покупателей"
                      sortKey="receipts"
                      sort={shiftSort}
                      onSort={setShiftSort}
                      align="right"
                      initial="desc"
                    />
                    <SortHeader
                      label="Как отработал"
                      sortKey="score"
                      sort={shiftSort}
                      onSort={setShiftSort}
                      align="right"
                      initial="desc"
                    />
                    <SortHeader label="Вывод" sortKey="verdict" sort={shiftSort} onSort={setShiftSort} />
                    <th className="whitespace-nowrap px-4 py-2 text-left font-medium">Обстановка</th>
                    <SortHeader
                      label="Можно ли доверять"
                      sortKey="confidence"
                      sort={shiftSort}
                      onSort={setShiftSort}
                      initial="desc"
                    />
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shifts.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-4 py-6 text-center text-muted-foreground">
                        За выбранный период смен магазина нет.
                      </td>
                    </tr>
                  ) : (
                    shifts.map((s) => {
                      const key = `${s.date}|${s.shift}|${s.cashier_id ?? 'none'}`
                      const revenueRatio = ratioOf(s.revenue, s.expected_revenue)
                      const demandRatio = ratioOf(s.receipts, s.expected_receipts)
                      // Диапазон обычного спроса. Без него «−18% к ожиданию»
                      // читается как провал, хотя такой разброс для этой
                      // смены — рядовое дело: поток гуляет сам по себе.
                      const demandRange = payload?.probabilistic_forecast?.shifts.find(
                        (p) => p.date === s.date && p.shift === s.shift,
                      )?.demand?.interval80
                      const isOpen = openShift === key
                      return (
                        <Fragment key={key}>
                          <tr
                            onClick={() => setOpenShift(isOpen ? null : key)}
                            className="cursor-pointer hover:bg-surface-hover"
                          >
                            <td className="whitespace-nowrap px-4 py-2 tabular-nums">
                              {s.date}
                              {s.duration_minutes ? (
                                <div className="text-xs text-muted-foreground">
                                  {Math.round((s.duration_minutes / 60) * 10) / 10} ч
                                </div>
                              ) : null}
                            </td>
                            <td className="whitespace-nowrap px-4 py-2">
                              {s.shift === 'night' ? 'Ночь' : 'День'}
                              {s.shift_id ? (
                                <a
                                  href={`/store/shifts?shift=${s.shift_id}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="mt-0.5 block text-xs text-sky-600 hover:underline dark:text-sky-400"
                                >
                                  чеки
                                </a>
                              ) : null}
                            </td>
                            <td className="px-4 py-2">{s.cashier_name || '—'}</td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              <div>{formatMoney(s.revenue)}</div>
                              <div className={`whitespace-nowrap text-xs ${toneFor(revenueRatio)}`}>
                                {s.expected_revenue == null ? 'нет ожидания' : `${deltaPct(revenueRatio)} к ожиданию`}
                              </div>
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              <div>{s.receipts}</div>
                              {demandRange ? (
                                <div
                                  className={`whitespace-nowrap text-xs ${
                                    s.receipts >= demandRange.low && s.receipts <= demandRange.high
                                      ? 'text-muted-foreground'
                                      : toneFor(demandRatio)
                                  }`}
                                  title="Границы, в которые поток укладывается в 8 сменах из 10"
                                >
                                  обычно {Math.round(demandRange.low)}–{Math.round(demandRange.high)}
                                </div>
                              ) : (
                                <div className={`whitespace-nowrap text-xs ${toneFor(demandRatio)}`}>
                                  {demandRatio == null
                                    ? 'нет ожидания'
                                    : `${deltaPct(demandRatio)} к ожиданию`}
                                </div>
                              )}
                            </td>
                            <td
                              className={`whitespace-nowrap px-4 py-2 text-right font-medium ${toneFor(s.score)}`}
                              title={s.score == null ? '' : `Балл ${s.score.toFixed(2)} — отношение к обычному для таких смен`}
                            >
                              {scoreText(s.score)}
                            </td>
                            <td className="px-4 py-2">
                              <VerdictBadge verdict={s.verdict} />
                            </td>
                            <td className="px-4 py-2">
                              <ContextChips context={s.context} />
                            </td>
                            <td className="px-4 py-2">
                              <Confidence value={s.confidence} />
                            </td>
                            <td className="px-2 py-2 text-muted-foreground">
                              <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                            </td>
                          </tr>
                          {isOpen ? (
                            <tr className="bg-surface-muted">
                              <td colSpan={10} className="px-4 py-4">
                                <ShiftDetail
                                  companyId={payload?.company?.id || ''}
                                  date={s.date}
                                  shift={s.shift}
                                  explanation={s.explanation}
                                  context={s.context}
                                  probability={
                                    payload?.probabilistic_forecast?.shifts.find(
                                      (p) => p.date === s.date && p.shift === s.shift,
                                    ) ?? null
                                  }
                                  canAskAi
                                />
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <p className="px-1 text-xs text-muted-foreground">
            Модель {payload?.model_version || '—'}. «Лучше на 13%» значит: продавец сработал на 13% выше
            того, что обычно бывает в таких же сменах — тот же сезон, тот же день недели, та же смена. Это
            не доля от плана. Спрос меряется числом чеков: счётчика посетителей у магазина нет, но чек
            оставляет каждый купивший, а привести людей в помещение продавец не может. «Обычно» считается
            по истории до начала периода и без собственных смен продавца — иначе человек сравнивался бы
            сам с собой.
          </p>
        </>
          )}
        </>
      )}
    </div>
  )
}
