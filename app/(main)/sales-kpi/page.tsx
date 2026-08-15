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
  Check,
  ChevronDown,
  CloudSun,
  GraduationCap,
  ShoppingBag,
  Gauge,
  Info,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  Store,
  Trash2,
  TrendingDown,
  TrendingUp,
  Users,
} from 'lucide-react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { AppModal } from '@/components/ui/app-modal'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { formatMoney } from '@/lib/core/format'
import { mutateApi, useApi } from '@/lib/hooks/use-api'

import { AccuracyTab } from './accuracy-tab'
import { SectionIntro } from './section-intro'
import { MoneyMapTab } from './money-map-tab'
import { PayoutTab } from './payout-tab'
import { PlansTab } from './plans-tab'
import { QualityTab } from './quality-tab'
import { ShiftDetail, type ShiftExplanation } from './shift-detail'

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
      'bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-white/5 dark:text-slate-300 dark:ring-white/10',
  },
  INSUFFICIENT_DATA: {
    label: 'Мало данных',
    hint: 'Истории или показателей не хватило, чтобы делать выводы.',
    className:
      'bg-slate-100 text-slate-500 ring-slate-500/20 dark:bg-white/5 dark:text-slate-400 dark:ring-white/10',
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
  NORMAL: { label: 'Норма', className: 'bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300' },
  NEEDS_TRAINING: {
    label: 'Нужно обучение',
    className: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  },
  INSUFFICIENT_DATA: {
    label: 'Мало смен',
    className: 'bg-slate-100 text-slate-500 dark:bg-white/5 dark:text-slate-400',
  },
}

// ─── Форматирование ─────────────────────────────────────────────────────────

function isoToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

function toneFor(ratio: number | null): string {
  if (ratio == null) return 'text-slate-400 dark:text-slate-500'
  if (ratio >= 1.05) return 'text-emerald-600 dark:text-emerald-400'
  if (ratio <= 0.95) return 'text-amber-600 dark:text-amber-400'
  return 'text-slate-600 dark:text-slate-300'
}

// ─── Мелкие блоки ───────────────────────────────────────────────────────────

function StatCard(props: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {props.label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${props.tone || 'text-slate-900 dark:text-white'}`}>
        {props.value}
      </div>
      {props.hint ? (
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{props.hint}</div>
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

function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const tone = pct >= 75 ? 'bg-emerald-500' : pct >= 45 ? 'bg-amber-500' : 'bg-slate-400'
  return (
    <div className="flex items-center gap-2" title="Насколько можно доверять выводу">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{pct}%</span>
    </div>
  )
}

// ─── Настройки ──────────────────────────────────────────────────────────────

type SettingsData = {
  configured: boolean
  settings: {
    latitude: number | null
    longitude: number | null
    weather_adjusts_bonus_threshold: boolean
    require_product_test_for_top_bonus: boolean
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
  // Каждая сторона правила — «категория:id» или «товар:id». Один select
  // вместо двух: администратору не нужно сначала выбирать вид, а потом
  // позицию, он просто ищет нужное в списке.
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    if (!payload) return
    setLat(payload.settings.latitude == null ? '' : String(payload.settings.latitude))
    setLon(payload.settings.longitude == null ? '' : String(payload.settings.longitude))
    setTestGate(Boolean(payload.settings.require_product_test_for_top_bonus))
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
    })
    if (ok) {
      // Подтверждение вместо молчания, а затем закрытие: раньше окно просто
      // оставалось открытым, и было непонятно, сохранилось ли вообще.
      setSaved(true)
      setTimeout(() => props.onClose(), 900)
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
          <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-white/10 dark:text-slate-200">
            {props.companyName}
          </span>
          <span className="text-sm font-normal text-slate-500 dark:text-slate-400">
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
          <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" /> Загружаем настройки…
          </div>
        ) : (
          <div className="space-y-4">
            {/* Погода */}
            <section className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
                  <CloudSun className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Где находится магазин
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    Координаты нужны только для погоды: по ним берётся прогноз вашего города. Погода
                    объясняет, почему покупателей было больше или меньше, но на бонусы не влияет —
                    продавец за дождь не отвечает.
                  </p>

                  <div className="mt-3 flex flex-wrap items-end gap-3">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Широта</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={lat}
                        onChange={(e) => setLat(e.target.value)}
                        placeholder="43.238949"
                        className="w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:focus:ring-sky-500/20"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Долгота</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={lon}
                        onChange={(e) => setLon(e.target.value)}
                        placeholder="76.889709"
                        className="w-40 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:focus:ring-sky-500/20"
                      />
                    </label>
                    <span
                      className={`mb-2 text-xs ${
                        coordsBroken
                          ? 'text-rose-600 dark:text-rose-400'
                          : hasCoords
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-400 dark:text-slate-500'
                      }`}
                    >
                      {coordsBroken
                        ? 'это не похоже на координаты'
                        : hasCoords
                          ? 'погода собирается'
                          : 'без координат погода не собирается'}
                    </span>
                  </div>

                  <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                    Как узнать: откройте Google Карты, нажмите правой кнопкой на здание магазина — первая
                    строка меню и есть эти два числа.
                  </p>
                </div>
              </div>
            </section>

            {/* Ворота */}
            <section className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
                  <GraduationCap className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Знание товара</h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    Верхние уровни (B3 и рекорд) можно закрыть для тех, кто не сдал тест. Включайте,
                    только если тесты действительно проводятся: иначе уровень срежется всем за
                    отсутствие данных, а не за незнание.
                  </p>

                  <label className="mt-3 flex cursor-pointer items-center gap-2.5 rounded-lg bg-slate-50 px-3 py-2.5 transition hover:bg-slate-100 dark:bg-white/5 dark:hover:bg-white/10">
                    <input
                      type="checkbox"
                      checked={testGate}
                      onChange={(e) => setTestGate(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-sky-600 dark:border-white/20"
                    />
                    <span className="text-sm text-slate-700 dark:text-slate-200">
                      Требовать сданный тест для B3 и рекорда
                    </span>
                  </label>
                </div>
              </div>
            </section>

            {/* Допродажи */}
            <section className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
                  <ShoppingBag className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Допродажи</h3>
                    <span className="text-xs text-slate-400">
                      {rules.length > 0 ? `${rules.length} прав.` : 'сохраняются сразу'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    «Взяли одно — предложи другое». Модуль считает, как часто продавец добавлял второе к
                    первому. Можно указать и категорию, и конкретный товар.
                  </p>

                  <div className="mt-3 space-y-1.5">
                    {rules.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center dark:border-white/10">
                        <p className="text-sm text-slate-500 dark:text-slate-400">Правил пока нет</p>
                        <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                          Пока их нет, допродажи не считаются и в оценке не участвуют
                        </p>
                      </div>
                    ) : (
                      rules.map((r) => (
                        <div
                          key={r.id}
                          className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-white/5"
                        >
                          <span className="text-slate-700 dark:text-slate-200">
                            {refName(r.source_kind, r.source_ref)}
                          </span>
                          <span className="text-slate-400">→</span>
                          <span className="text-slate-700 dark:text-slate-200">
                            {refName(r.target_kind, r.target_ref)}
                          </span>
                          <button
                            onClick={() => void removeRule(r.id)}
                            disabled={busy}
                            className="ml-auto rounded p-1 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
                            aria-label="Удалить правило"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
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
                          {i === 1 ? <span className="text-slate-400">→</span> : null}
                          <select
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            className="max-w-[200px] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 dark:border-white/10 dark:bg-slate-950 dark:text-white dark:focus:ring-emerald-500/20"
                          >
                            <option value="">{placeholder}</option>
                            <optgroup label="Категории">
                              {(payload?.categories || []).map((c) => (
                                <option key={`c-${c.id}`} value={`category:${c.id}`}>
                                  {c.name}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="Товары">
                              {(payload?.items || []).map((it) => (
                                <option key={`i-${it.id}`} value={`item:${it.id}`}>
                                  {it.name}
                                </option>
                              ))}
                            </optgroup>
                          </select>
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
  const [from, setFrom] = useState(isoDaysAgo(30))
  const [to, setTo] = useState(isoToday())
  const [companyId, setCompanyId] = useState<string>('')
  const [openShift, setOpenShift] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  // «Кому доплатить» первой и по умолчанию: это единственная вкладка, ради
  // которой на страницу заходят регулярно.
  const [tab, setTab] = useState<'payout' | 'review' | 'plans' | 'accuracy' | 'quality' | 'money'>(
    'payout',
  )
  const { can } = useCapabilities()

  const query = new URLSearchParams({ from, to })
  if (companyId) query.set('company_id', companyId)

  const apiKey = `/api/admin/sales-kpi?${query.toString()}`
  const { data, error, loading, refreshing, refresh } = useApi<{ data: ApiData }>(apiKey)

  const payload = data?.data
  const shifts = payload?.shifts || []
  const cashiers = payload?.cashiers || []
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

  const toolbar = (
    <div className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
        С
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-white/10 dark:bg-slate-900 dark:text-white"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
        По
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-white/10 dark:bg-slate-900 dark:text-white"
        />
      </label>
      {(payload?.stores?.length || 0) > 1 ? (
        <label className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
          Точка
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-white/10 dark:bg-slate-900 dark:text-white"
          >
            <option value="">Выберите точку</option>
            {(payload?.stores || []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="flex gap-1">
        <Button variant="outline" size="sm" onClick={() => { setFrom(isoDaysAgo(7)); setTo(isoToday()) }}>
          7 дней
        </Button>
        <Button variant="outline" size="sm" onClick={() => { setFrom(isoDaysAgo(30)); setTo(isoToday()) }}>
          30 дней
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
      <AdminPageHeader
        title="Эффективность продавцов"
        description="Спрос или продавец: сколько людей купило и что продавец сделал с каждым из них"
        icon={<Gauge className="h-5 w-5" />}
        accent="blue"
        toolbar={toolbar}
        actions={
          can('sales-kpi.manage') && payload?.company ? (
            <Button variant="outline" size="sm" onClick={() => setShowSettings(true)}>
              <Settings className="mr-1 h-4 w-4" /> Настройки
            </Button>
          ) : null
        }
      />

      {showSettings && payload?.company ? (
        <SettingsModal
          companyId={payload.company.id}
          companyName={payload.company.name}
          onClose={() => setShowSettings(false)}
          onSaved={() => mutateApi(apiKey)}
        />
      ) : null}

      {loading ? (
        <Card className="flex items-center justify-center gap-2 p-10 text-slate-500 dark:text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          Считаем ожидания по истории…
        </Card>
      ) : error ? (
        <Card className="p-6 text-sm text-rose-600 dark:text-rose-400">
          Не удалось загрузить данные: {error}
        </Card>
      ) : payload?.no_store ? (
        <Card className="p-6 text-sm text-slate-600 dark:text-slate-300">
          <Store className="mb-2 h-5 w-5 text-slate-400" />
          Ни на одной точке не включён магазин. Модуль считает продажи магазина — включите магазин на точке
          в настройках, и страница оживёт.
        </Card>
      ) : payload?.needs_company ? (
        <Card className="p-6 text-sm text-slate-600 dark:text-slate-300">
          Выберите точку в фильтре выше. Смешивать точки в один рейтинг нельзя: у них разный ассортимент,
          поток и ожидания, и общий балл не значил бы ничего.
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1 dark:border-white/10 dark:bg-slate-900/60">
            {([
              ['payout', 'Кому доплатить'],
              ['review', 'Почему такая касса'],
              ['plans', 'Цели на смену'],
              ['quality', 'Качество данных'],
              ['accuracy', 'Проверка модели'],
              ['money', 'Где что настроено'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                  tab === id
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'payout' && payload?.company ? (
            <PayoutTab companyId={payload.company.id} canManage={can('sales-kpi.manage')} />
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
            <Card className="flex gap-3 p-4 text-sm text-slate-600 dark:text-slate-300">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
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
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-white/10">
              <Users className="h-4 w-4 text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Продавцы</h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                статус присваивается от {payload?.settings?.min_qualifying_shifts ?? 6} смен
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Продавец</th>
                    <th className="px-4 py-2 text-right font-medium">Смен</th>
                    <th className="px-4 py-2 text-right font-medium">Выручка</th>
                    <th className="px-4 py-2 text-right font-medium">Балл</th>
                    <th className="px-4 py-2 text-left font-medium">Статус</th>
                    <th className="px-4 py-2 text-left font-medium">Уверенность</th>
                    <th className="px-4 py-2 text-left font-medium">Сильное / слабое</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {cashiers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">
                        За период нет смен с указанным продавцом.
                      </td>
                    </tr>
                  ) : (
                    cashiers.map((c) => {
                      const status = STATUSES[c.status] || STATUSES.NORMAL
                      return (
                        <tr key={c.cashier_id} className="hover:bg-slate-50 dark:hover:bg-white/5">
                          <td className="px-4 py-2 font-medium text-slate-900 dark:text-white">{c.name}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{c.shifts}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{formatMoney(c.revenue)}</td>
                          <td className={`px-4 py-2 text-right tabular-nums font-semibold ${toneFor(c.score)}`}>
                            {c.score == null ? '—' : c.score.toFixed(2)}
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
            <div className="border-b border-slate-200 px-4 py-3 dark:border-white/10">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Смены</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Нажмите на смену, чтобы увидеть, из чего сложился вывод
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Дата</th>
                    <th className="px-4 py-2 text-left font-medium">Смена</th>
                    <th className="px-4 py-2 text-left font-medium">Продавец</th>
                    <th className="px-4 py-2 text-right font-medium">Касса</th>
                    <th className="px-4 py-2 text-right font-medium">Покупателей</th>
                    <th className="px-4 py-2 text-right font-medium">Балл</th>
                    <th className="px-4 py-2 text-left font-medium">Вывод</th>
                    <th className="px-4 py-2 text-left font-medium">Уверенность</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {shifts.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-6 text-center text-slate-500 dark:text-slate-400">
                        За выбранный период смен магазина нет.
                      </td>
                    </tr>
                  ) : (
                    shifts.map((s) => {
                      const key = `${s.date}|${s.shift}|${s.cashier_id ?? 'none'}`
                      const revenueRatio = ratioOf(s.revenue, s.expected_revenue)
                      const demandRatio = ratioOf(s.receipts, s.expected_receipts)
                      const isOpen = openShift === key
                      return (
                        <Fragment key={key}>
                          <tr
                            onClick={() => setOpenShift(isOpen ? null : key)}
                            className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5"
                          >
                            <td className="px-4 py-2 tabular-nums">
                              {s.date}
                              {s.duration_minutes ? (
                                <div className="text-xs text-slate-400">
                                  {Math.round((s.duration_minutes / 60) * 10) / 10} ч
                                </div>
                              ) : null}
                            </td>
                            <td className="px-4 py-2">
                              {s.shift === 'night' ? 'Ночь' : 'День'}
                              {s.shift_id ? (
                                <a
                                  href={`/store/shifts?shift=${s.shift_id}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="mt-0.5 block text-xs text-sky-600 hover:underline dark:text-sky-400"
                                >
                                  чеки и позиции
                                </a>
                              ) : null}
                            </td>
                            <td className="px-4 py-2">{s.cashier_name || '—'}</td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              <div>{formatMoney(s.revenue)}</div>
                              <div className={`text-xs ${toneFor(revenueRatio)}`}>
                                {s.expected_revenue == null ? 'нет ожидания' : `${deltaPct(revenueRatio)} к ожиданию`}
                              </div>
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums">
                              <div>{s.receipts}</div>
                              <div className={`text-xs ${toneFor(demandRatio)}`}>
                                {demandRatio == null
                                  ? 'нет ожидания'
                                  : `${deltaPct(demandRatio)} к ожиданию`}
                              </div>
                            </td>
                            <td className={`px-4 py-2 text-right tabular-nums font-semibold ${toneFor(s.score)}`}>
                              {s.score == null ? '—' : s.score.toFixed(2)}
                            </td>
                            <td className="px-4 py-2">
                              <VerdictBadge verdict={s.verdict} />
                            </td>
                            <td className="px-4 py-2">
                              <Confidence value={s.confidence} />
                            </td>
                            <td className="px-2 py-2 text-slate-400">
                              <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                            </td>
                          </tr>
                          {isOpen ? (
                            <tr className="bg-slate-50/60 dark:bg-white/[0.02]">
                              <td colSpan={9} className="px-4 py-4">
                                <ShiftDetail
                                  companyId={payload?.company?.id || ''}
                                  date={s.date}
                                  shift={s.shift}
                                  explanation={s.explanation}
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

          <p className="px-1 text-xs text-slate-400 dark:text-slate-500">
            Модель {payload?.model_version || '—'}. Балл — это отношение метрик продавца к норме для
            сопоставимых условий (сезон, день недели, смена), а не доля от плана. Спрос меряется числом
            чеков: счётчика посетителей у магазина нет, но чек оставляет каждый купивший, а привести людей
            в помещение продавец не может. Ожидания считаются по истории до начала периода и без учёта
            собственных смен продавца.
          </p>
        </>
          )}
        </>
      )}
    </div>
  )
}
