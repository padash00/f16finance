'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart2,
  Brain,
  Calendar,
  CheckCircle2,
  ChevronDown,
  DollarSign,
  Globe,
  LineChart,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'

import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Area,
  ComposedChart,
  Line,
  PieChart as RePieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from 'recharts'

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' })
  const json = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(json?.error || `Ошибка запроса (${response.status})`)
  }
  return json as T
}

// ==================== TYPES ====================

type Company = { id: string; name: string; code?: string | null }

type IncomeRow = {
  id: string
  date: string // YYYY-MM-DD
  company_id: string
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
  online_amount: number | null
  comment: string | null
}

type ExpenseRow = {
  id: string
  date: string
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  comment: string | null
}

type RangeType = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom'

type FinancialTotals = {
  incomeCash: number
  incomeKaspi: number
  incomeCard: number
  incomeOnline: number
  incomeTotal: number
  expenseCash: number
  expenseKaspi: number
  expenseTotal: number
  profit: number
  netCash: number
  netKaspi: number
  netTotal: number
  incomeTx: number
  expenseTx: number
  avgCheck: number
}

type AIInsight = {
  score: number
  status: 'critical' | 'warning' | 'good' | 'excellent'
  summary: string
  recommendation: string
  margin: number
  efficiency: number
  trends: {
    income: 'up' | 'down' | 'stable'
    expense: 'up' | 'down' | 'stable'
    profit: 'up' | 'down' | 'stable'
  }
  anomalies: Array<{
    type: 'spike' | 'drop'
    date: string
    description: string
    severity: 'low' | 'medium' | 'high'
  }>
  predictions: {
    nextMonthProfit: number
    confidence: number
    recommendation: string
  }
  benchmarks: {
    vsPrevPeriod: number
    vsAvgDaily: number
  }
}

type ChartPoint = {
  date: string
  income: number
  expense: number
  profit: number
  movingAvg: number
  label: string
}

type CategoryData = {
  name: string
  value: number
  percentage: number
  color: string
}

type FeedItem = {
  id: string
  date: string
  company_id: string
  kind: 'income' | 'expense'
  title: string
  amount: number
  isAnomaly?: boolean
}

// ==================== UTILS ====================

const DateUtils = {
  toISODateLocal(d: Date) {
    const t = d.getTime() - d.getTimezoneOffset() * 60_000
    return new Date(t).toISOString().slice(0, 10)
  },
  fromISO(iso: string) {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, (m || 1) - 1, d || 1)
  },
  todayISO() {
    return DateUtils.toISODateLocal(new Date())
  },
  addDaysISO(iso: string, diff: number) {
    const d = DateUtils.fromISO(iso)
    d.setDate(d.getDate() + diff)
    return DateUtils.toISODateLocal(d)
  },
  formatShort(iso: string) {
    const d = DateUtils.fromISO(iso)
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  },
  formatFull(iso: string) {
    const d = DateUtils.fromISO(iso)
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  },
  getQuarterBounds() {
    const now = new Date()
    const y = now.getFullYear()
    const q = Math.floor(now.getMonth() / 3)
    return {
      start: DateUtils.toISODateLocal(new Date(y, q * 3, 1)),
      end: DateUtils.toISODateLocal(new Date(y, q * 3 + 3, 0)),
    }
  },
  getYearBounds() {
    const now = new Date()
    const y = now.getFullYear()
    return {
      start: DateUtils.toISODateLocal(new Date(y, 0, 1)),
      end: DateUtils.toISODateLocal(new Date(y, 11, 31)),
    }
  },
  calcPrevPeriod(dateFrom: string, dateTo: string) {
    const dFrom = DateUtils.fromISO(dateFrom)
    const dTo = DateUtils.fromISO(dateTo)
    const days = Math.floor((dTo.getTime() - dFrom.getTime()) / 86_400_000) + 1
    return {
      prevFrom: DateUtils.addDaysISO(dateFrom, -days),
      prevTo: DateUtils.addDaysISO(dateFrom, -1),
      days,
    }
  },
  rangeDates(from: string, to: string) {
    const out: string[] = []
    let cur = DateUtils.fromISO(from)
    const end = DateUtils.fromISO(to)
    while (cur <= end) {
      out.push(DateUtils.toISODateLocal(cur))
      cur.setDate(cur.getDate() + 1)
    }
    return out
  },
}

const Formatters = {
  moneyDetailed(v: number) {
    return (Number.isFinite(v) ? v : 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'
  },
  percentChange(current: number, previous: number) {
    if (!previous) return { text: '—', positive: true }
    const p = ((current - previous) / Math.abs(previous)) * 100
    return { text: `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`, positive: p >= 0 }
  },
}

const COLORS = {
  income: '#10b981',
  expense: '#ef4444',
  profit: '#8b5cf6',
  chart: ['#8b5cf6', '#10b981', '#ef4444', '#f59e0b', '#3b82f6', '#ec4899'],
}

// ==================== “AI” ANALYTICS (простая, но честная) ====================

function detectTrend(values: number[]): 'up' | 'down' | 'stable' {
  if (values.length < 3) return 'stable'
  const first = values[0]
  const last = values[values.length - 1]
  const change = ((last - first) / (Math.abs(first) || 1)) * 100
  if (change > 5) return 'up'
  if (change < -5) return 'down'
  return 'stable'
}

function detectAnomalies(points: ChartPoint[], threshold = 2.5): AIInsight['anomalies'] {
  const vals = points.map(p => p.income).filter(v => v > 0)
  if (vals.length < 6) return []
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  const variance = vals.reduce((a, v) => a + Math.pow(v - mean, 2), 0) / vals.length
  const std = Math.sqrt(variance) || 1

  const out: AIInsight['anomalies'] = []
  for (const p of points) {
    if (p.income <= 0) continue
    const z = Math.abs((p.income - mean) / std)
    if (z > threshold) {
      const type = p.income > mean ? 'spike' : 'drop'
      const severity = z > 4 ? 'high' : z > 3 ? 'medium' : 'low'
      out.push({
        type,
        date: p.date,
        severity,
        description: `${type === 'spike' ? 'Всплеск' : 'Падение'} дохода: ${Formatters.moneyDetailed(p.income)}`,
      })
    }
  }
  return out.slice(0, 3)
}

function predictNextMonthProfit(points: ChartPoint[]): { value: number; confidence: number } {
  // линейная регрессия по дневной прибыли (без магии, просто тренд)
  const y = points.map(p => p.profit)
  if (y.length < 10) return { value: 0, confidence: 0 }
  const x = Array.from({ length: y.length }, (_, i) => i)

  const n = x.length
  const sumX = x.reduce((a, b) => a + b, 0)
  const sumY = y.reduce((a, b) => a + b, 0)
  const sumXX = x.reduce((a, v) => a + v * v, 0)
  const sumXY = x.reduce((a, _, i) => a + x[i] * y[i], 0)

  const denom = n * sumXX - sumX * sumX
  const slope = denom ? (n * sumXY - sumX * sumY) / denom : 0
  const intercept = (sumY - slope * sumX) / n

  const futureDays = 30
  const startIndex = n
  let futureProfit = 0
  for (let i = 0; i < futureDays; i++) {
    const yi = slope * (startIndex + i) + intercept
    futureProfit += yi
  }

  // confidence через R^2
  const yMean = sumY / n
  const ssRes = y.reduce((acc, yi, i) => acc + Math.pow(yi - (slope * x[i] + intercept), 2), 0)
  const ssTot = y.reduce((acc, yi) => acc + Math.pow(yi - yMean, 2), 0)
  const r2 = 1 - ssRes / (ssTot || 1)
  const confidence = Math.max(0, Math.min(100, r2 * 100))

  return { value: Math.round(futureProfit), confidence: Math.round(confidence * 100) / 100 }
}

function scoreStatus(score: number): AIInsight['status'] {
  if (score >= 80) return 'excellent'
  if (score >= 60) return 'good'
  if (score >= 40) return 'warning'
  return 'critical'
}

function buildSummary(status: AIInsight['status'], profitTrend: 'up' | 'down' | 'stable') {
  const emoji = profitTrend === 'up' ? '📈' : profitTrend === 'down' ? '📉' : '📊'
  if (status === 'excellent') return `${emoji} Отлично: прибыль и динамика в зелёной зоне`
  if (status === 'good') return `${emoji} Нормально: держим курс, есть точки роста`
  if (status === 'warning') return `${emoji} Внимание: что-то начинает “плыть”`
  return `⚠️ Критично: надо резать лишнее и чинить маржу`
}

function ProductLanding() {
  const audienceCards = [
    {
      title: 'Владелец',
      text: 'Смотрит общую картину по деньгам, рискам, структуре команды и статусу смен.',
      icon: Globe,
    },
    {
      title: 'Руководитель',
      text: 'Управляет задачами, публикует неделю, разбирает проблемы по точкам и держит ритм команды.',
      icon: Calendar,
    },
    {
      title: 'Старший по точке',
      text: 'Видит только свою точку, свою команду, спорные смены и задачи, которые горят сегодня.',
      icon: Target,
    },
    {
      title: 'Оператор',
      text: 'Получает смены и задачи, подтверждает график через Telegram и работает в мобильном кабинете.',
      icon: Activity,
    },
  ]

  const productCards = [
    {
      title: 'Финансовый контур',
      text: 'Доходы, расходы, правила зарплаты, налоговый контроль и аудит правок в одном месте.',
      icon: Wallet,
    },
    {
      title: 'Метрики и отчёты',
      text: 'Оборот, прибыль, маржа, просадки, аномалии и недельный ритм по точкам без ручной сводки.',
      icon: TrendingUp,
    },
    {
      title: 'График смен',
      text: 'Неделя собирается один раз, публикуется по точке и дальше живёт через подтверждение, споры и замены.',
      icon: Calendar,
    },
    {
      title: 'Задачи',
      text: 'Работа идёт по ролям: кто поставил, кто принял, где зависло и что уже ушло на проверку.',
      icon: CheckCircle2,
    },
  ]

  const flow = [
    'Распределили роли, назначили точки и собрали структуру команды',
    'Опубликовали неделю, сотрудники подтвердили смены или отправили спорные даты',
    'Поставили задачи по точкам, получили ответы в кабинете и в Telegram',
    'Руководство увидело деньги, проблемные места и фактический статус работы в одном окне',
  ]

  const highlights = [
    'Главный фокус системы — финансовая дисциплина: деньги, прибыль, правила зарплаты и контроль правок.',
    'Смены, задачи, структура и зарплата не разбросаны по разным таблицам, а завязаны на один рабочий контур.',
    'Telegram не заменяет систему, а усиливает её: подтверждения и ответы сразу попадают в рабочий контур.',
    'Каждое критичное действие по финансам и персоналу можно отследить в аудит-логе.',
    'Роли разделены так, чтобы владелец, руководитель, старший и оператор видели только своё.',
  ]

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.18),_transparent_30%),radial-gradient(circle_at_80%_20%,_rgba(14,165,233,0.12),_transparent_22%),linear-gradient(180deg,#070b12_0%,#0a0f18_45%,#070b12_100%)] text-white">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/60 p-6 backdrop-blur-xl lg:p-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_rgba(251,191,36,0.16),_transparent_28%),radial-gradient(circle_at_bottom_left,_rgba(59,130,246,0.10),_transparent_24%)]" />
          <div className="relative grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-amber-300">
                <Sparkles className="h-3.5 w-3.5" />
                Orda Control
              </div>

              <h1 className="mt-5 text-4xl font-semibold leading-[0.96] tracking-[-0.06em] text-white sm:text-5xl lg:text-7xl">
                Сначала деньги
                <br />
                и метрики,
                <br />
                потом команда и
                <br />
                операционный ритм.
              </h1>

              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:text-lg">
                Orda Control строится вокруг финансового контура: доходы, расходы, прибыль, правила зарплаты,
                недельные отчёты и критичные изменения. Поверх этого система связывает смены, задачи,
                структуру команды и ежедневный контроль точек.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/login">
                  <Button className="rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 px-6 text-slate-950 hover:from-amber-400 hover:to-orange-400">
                    Войти в систему
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
                <a href="#capabilities">
                  <Button
                    variant="outline"
                    className="rounded-2xl border-white/10 bg-white/[0.03] px-6 text-white hover:bg-white/[0.06]"
                  >
                    Посмотреть возможности
                  </Button>
                </a>
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                <div className="rounded-[1.5rem] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Роли</p>
                  <p className="mt-2 text-2xl font-semibold text-white">4+</p>
                  <p className="mt-1 text-sm text-slate-400">Владелец, руководитель, старший, оператор.</p>
                </div>
                <div className="rounded-[1.5rem] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Фокус</p>
                  <p className="mt-2 text-2xl font-semibold text-white">Finance</p>
                  <p className="mt-1 text-sm text-slate-400">Доходы, расходы, прибыль, зарплата и контроль правок.</p>
                </div>
                <div className="rounded-[1.5rem] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Контуры</p>
                  <p className="mt-2 text-2xl font-semibold text-white">6</p>
                  <p className="mt-1 text-sm text-slate-400">Деньги, отчёты, смены, задачи, структура и аудит.</p>
                </div>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-[1.8rem] border border-white/10 bg-black/20 p-4 shadow-2xl shadow-black/20">
                <div className="rounded-[1.4rem] border border-white/8 bg-gradient-to-br from-slate-900 to-slate-800 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Control Center</p>
                      <p className="mt-1 text-lg font-semibold text-white">Единый обзор</p>
                    </div>
                    <div className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                      live
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl bg-white/[0.04] p-3">
                      <div className="flex items-center gap-2 text-amber-300">
                        <DollarSign className="h-4 w-4" />
                        <p className="text-sm font-medium text-white">Деньги</p>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-400">
                        Доходы, расходы, прибыль, налоги и изменения по важным суммам.
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white/[0.04] p-3">
                      <div className="flex items-center gap-2 text-emerald-300">
                        <TrendingUp className="h-4 w-4" />
                        <p className="text-sm font-medium text-white">Метрики</p>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-400">
                        Недельный ритм, маржа, просадки, аномалии и управленческие сигналы.
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white/[0.04] p-3">
                      <div className="flex items-center gap-2 text-sky-300">
                        <Calendar className="h-4 w-4" />
                        <p className="text-sm font-medium text-white">Смены</p>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-400">
                        Кто подтвердил неделю, где споры и кого уже заменили.
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white/[0.04] p-3">
                      <div className="flex items-center gap-2 text-purple-300">
                        <CheckCircle2 className="h-4 w-4" />
                        <p className="text-sm font-medium text-white">Задачи</p>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-400">
                        Кто принял задачу, где зависло исполнение и что уже ушло на проверку.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-[1.6rem] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Финансовый срез</p>
                  <div className="mt-3 space-y-2">
                    <div className="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-200">Прибыль недели: +418 000 ₸</div>
                    <div className="rounded-xl bg-white/[0.04] p-3 text-sm text-slate-300">Расходы под контролем: 9 категорий</div>
                    <div className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200">2 правки по деньгам ждут подтверждения</div>
                  </div>
                </div>
                <div className="rounded-[1.6rem] border border-white/8 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Операционный слой</p>
                  <div className="mt-3 space-y-2">
                    <div className="rounded-xl bg-white/[0.04] p-3 text-sm text-slate-300">Смена на 19 марта подтверждена</div>
                    <div className="rounded-xl bg-white/[0.04] p-3 text-sm text-slate-300">Задача “Проверить точку” принята</div>
                    <div className="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-200">Ответ из Telegram уже в системе</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {audienceCards.map((card) => {
            const Icon = card.icon
            return (
              <Card key={card.title} className="border-white/10 bg-slate-950/55 p-6 text-white backdrop-blur-xl">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-300">
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="mt-4 text-xl font-semibold">{card.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">{card.text}</p>
              </Card>
            )
          })}
        </section>

        <section id="capabilities" className="mt-8 rounded-[2rem] border border-white/10 bg-slate-950/55 p-6 backdrop-blur-xl lg:p-8">
          <div className="max-w-3xl">
            <p className="text-xs uppercase tracking-[0.2em] text-amber-300">Что умеет Orda Control</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white lg:text-4xl">
              Система начинается с финансов и управленческих метрик, а затем связывает всё остальное.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
              В основе — прозрачный денежный контур и отчётность. На него уже надстраиваются смены, задачи,
              структура команды и ежедневная дисциплина по точкам.
            </p>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            {productCards.map((card) => {
              const Icon = card.icon
              return (
                <div key={card.title} className="rounded-[1.5rem] border border-white/8 bg-white/[0.03] p-5">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.06] text-amber-300">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-white">{card.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-400">{card.text}</p>
                </div>
              )
            })}
          </div>
        </section>

        <section className="mt-8 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <Card className="border-white/10 bg-slate-950/55 p-6 text-white backdrop-blur-xl lg:p-8">
            <p className="text-xs uppercase tracking-[0.2em] text-amber-300">Как это работает</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] lg:text-4xl">Один рабочий цикл от роли до результата</h2>
            <div className="mt-6 space-y-4">
              {flow.map((step, index) => (
                <div key={step} className="flex gap-4 rounded-[1.4rem] border border-white/8 bg-white/[0.03] p-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/10 text-sm font-semibold text-amber-300">
                    {index + 1}
                  </div>
                  <p className="text-sm leading-6 text-slate-300">{step}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card className="border-white/10 bg-gradient-to-br from-amber-500/10 via-slate-950/60 to-slate-950/60 p-6 text-white backdrop-blur-xl lg:p-8">
            <p className="text-xs uppercase tracking-[0.2em] text-amber-300">Почему это выгодно</p>
            <div className="mt-5 space-y-3">
              {highlights.map((item) => (
                <div key={item} className="flex items-start gap-3 rounded-2xl bg-black/20 p-3">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" />
                  <p className="text-sm leading-6 text-slate-300">{item}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-[1.5rem] border border-white/8 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Внутри дня</p>
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
                  <span className="text-sm text-slate-300">Смена опубликована</span>
                  <span className="text-xs text-emerald-300">09:00</span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
                  <span className="text-sm text-slate-300">Задача принята</span>
                  <span className="text-xs text-sky-300">10:18</span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-amber-500/10 px-3 py-2">
                  <span className="text-sm text-amber-200">Есть проблема по смене</span>
                  <span className="text-xs text-amber-300">12:42</span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2">
                  <span className="text-sm text-slate-300">Решение зафиксировано</span>
                  <span className="text-xs text-purple-300">13:05</span>
                </div>
              </div>
            </div>
          </Card>
        </section>

        <section className="mt-8 grid gap-4 lg:grid-cols-2">
          <Card className="border-white/10 bg-slate-950/55 p-6 text-white backdrop-blur-xl lg:p-8">
            <p className="text-xs uppercase tracking-[0.2em] text-amber-300">Что видит владелец и руководитель</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">Сначала финансовая картина, потом действия по точкам</h2>
            <div className="mt-6 space-y-4 rounded-[1.6rem] border border-white/8 bg-black/20 p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-emerald-500/10 p-3">
                  <p className="text-xs text-emerald-300">Оборот</p>
                  <p className="mt-2 text-2xl font-semibold text-white">2.84M</p>
                </div>
                <div className="rounded-xl bg-amber-500/10 p-3">
                  <p className="text-xs text-amber-300">Маржа</p>
                  <p className="mt-2 text-2xl font-semibold text-white">28%</p>
                </div>
                <div className="rounded-xl bg-sky-500/10 p-3">
                  <p className="text-xs text-sky-300">Риск</p>
                  <p className="mt-2 text-2xl font-semibold text-white">3</p>
                </div>
              </div>
              <div className="rounded-2xl bg-white/[0.04] p-4">
                <p className="text-sm font-medium text-white">Сигналы, которые требуют решения</p>
                <div className="mt-3 space-y-2 text-sm text-slate-300">
                  <div className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2">
                    <span>Расходы по Extra вышли выше среднего</span>
                    <span className="text-amber-300">нужна проверка</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2">
                    <span>Arena · 21 марта · ночная смена</span>
                    <span className="text-emerald-300">замена предложена</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2">
                    <span>2 задачи по точкам просрочены</span>
                    <span className="text-sky-300">контроль</span>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          <Card className="border-white/10 bg-slate-950/55 p-6 text-white backdrop-blur-xl lg:p-8">
            <p className="text-xs uppercase tracking-[0.2em] text-amber-300">Что видит оператор</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">Понятный кабинет без лишнего шума</h2>
            <div className="mt-6 space-y-4 rounded-[1.6rem] border border-white/8 bg-black/20 p-4">
              <div className="rounded-2xl bg-white/[0.04] p-4">
                <p className="text-sm font-medium text-white">Моя неделя</p>
                <div className="mt-3 grid gap-2">
                  <div className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2 text-sm">
                    <span>19 марта · день</span>
                    <span className="text-emerald-300">подтверждено</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2 text-sm">
                    <span>20 марта · день</span>
                    <span className="text-white">в работе</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-black/20 px-3 py-2 text-sm">
                    <span>21 марта · день</span>
                    <span className="text-amber-300">отправлена проблема</span>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl bg-white/[0.04] p-4">
                <p className="text-sm font-medium text-white">Мои задачи</p>
                <div className="mt-3 space-y-2">
                  <div className="rounded-xl bg-black/20 px-3 py-2 text-sm text-slate-300">Проверить точку перед сменой</div>
                  <div className="rounded-xl bg-black/20 px-3 py-2 text-sm text-slate-300">Отправить фотоотчёт после закрытия</div>
                </div>
              </div>
            </div>
          </Card>
        </section>

        <section className="mt-8 rounded-[2rem] border border-white/10 bg-slate-950/55 p-6 text-white backdrop-blur-xl lg:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs uppercase tracking-[0.2em] text-amber-300">Вход в систему</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] lg:text-4xl">Открыть рабочий кабинет Orda Control</h2>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                Если доступ уже выдан, можно войти по email или по операторскому логину. Если доступ ещё не настроен,
                администратор отправит приглашение и ссылку на создание пароля.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/login">
                <Button className="rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 px-6 text-slate-950 hover:from-amber-400 hover:to-orange-400">
                  Перейти ко входу
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <a href="#capabilities">
                <Button
                  variant="outline"
                  className="rounded-2xl border-white/10 bg-white/[0.03] px-6 text-white hover:bg-white/[0.06]"
                >
                  Что внутри системы
                </Button>
              </a>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

// ==================== PAGE ====================

export default function SmartDashboardPage() {
  const [authResolved, setAuthResolved] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [dateFrom, setDateFrom] = useState(() => DateUtils.addDaysISO(DateUtils.todayISO(), -29))
  const [dateTo, setDateTo] = useState(() => DateUtils.todayISO())
  const [rangeType, setRangeType] = useState<RangeType>('month')

  const [activeTab, setActiveTab] = useState<'overview' | 'details' | 'forecast'>('overview')
  const [selectedMetric, setSelectedMetric] = useState<'income' | 'expense' | 'profit'>('profit')

  const [includeExtra, setIncludeExtra] = useState(false)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [showMovingAvg, setShowMovingAvg] = useState(true)

  const [companies, setCompanies] = useState<Company[]>([])
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [expenses, setExpenses] = useState<ExpenseRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [todayStats, setTodayStats] = useState<{ income: number; expense: number; txCount: number } | null>(null)
  const [overdueCount, setOverdueCount] = useState<number | null>(null)
  const [overdueDismissed, setOverdueDismissed] = useState(false)
  const [realtimeKey, setRealtimeKey] = useState(0)

  useEffect(() => {
    let mounted = true

    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!mounted) return
      setIsAuthenticated(!!user)
      setAuthResolved(true)
    })()

    return () => {
      mounted = false
    }
  }, [])

  // ---------- data load ----------
  useEffect(() => {
    if (!authResolved) return
    if (!isAuthenticated) {
      setLoading(false)
      return
    }

    let mounted = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const { prevFrom } = DateUtils.calcPrevPeriod(dateFrom, dateTo)

        const [companiesBody, incomesBody, expensesBody] = await Promise.all([
          fetchJson<{ data: Company[] }>('/api/admin/companies'),
          fetchJson<{ data: IncomeRow[] }>(`/api/admin/incomes?from=${prevFrom}&to=${dateTo}`),
          // API по умолчанию отдаёт 200 строк; окно prevFrom…dateTo — два периода, иначе расходы за выбранный период обрезаются
          fetchJson<{ data: ExpenseRow[] }>(
            `/api/admin/expenses?from=${prevFrom}&to=${dateTo}&page_size=2000&page=0`,
          ),
        ])

        if (!mounted) return

        setCompanies(companiesBody.data || [])
        setIncomes(incomesBody.data || [])
        setExpenses(expensesBody.data || [])
      } catch (e: any) {
        setError(e?.message || 'Ошибка загрузки')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [authResolved, isAuthenticated, dateFrom, dateTo, realtimeKey])

  // Realtime subscription — refresh on new income/expense records
  useEffect(() => {
    if (!isAuthenticated) return
    const channel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'incomes' }, () => setRealtimeKey(k => k + 1))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () => setRealtimeKey(k => k + 1))
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [isAuthenticated])

  // Today stats fetch
  useEffect(() => {
    if (!isAuthenticated) return
    let mounted = true
    ;(async () => {
      const today = DateUtils.todayISO()
      const [incomesBody, expensesBody] = await Promise.all([
        fetchJson<{ data: Array<{ cash_amount: number | null; kaspi_amount: number | null; card_amount: number | null; online_amount: number | null }> }>(
          `/api/admin/incomes?from=${today}&to=${today}`,
        ),
        fetchJson<{ data: Array<{ cash_amount: number | null; kaspi_amount: number | null }> }>(
          `/api/admin/expenses?from=${today}&to=${today}&page_size=2000&page=0`,
        ),
      ])
      if (!mounted) return
      const income = (incomesBody.data || []).reduce(
        (s: number, r: { cash_amount: number | null; kaspi_amount: number | null; card_amount: number | null; online_amount: number | null }) =>
          s + Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0) + Number(r.online_amount || 0),
        0,
      )
      const expense = (expensesBody.data || []).reduce(
        (s: number, r: { cash_amount: number | null; kaspi_amount: number | null }) =>
          s + Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0),
        0,
      )
      const txCount = (incomesBody.data?.length || 0) + (expensesBody.data?.length || 0)
      setTodayStats({ income, expense, txCount })
    })().catch(() => {
      if (mounted) setTodayStats({ income: 0, expense: 0, txCount: 0 })
    })
    return () => { mounted = false }
  }, [isAuthenticated])

  // Overdue tasks count
  useEffect(() => {
    if (!isAuthenticated) return
    let mounted = true
    ;(async () => {
      const today = DateUtils.todayISO()
      const { count } = await supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .lt('due_date', today)
        .not('status', 'in', '("done","archived")')
      if (mounted && count != null && count > 0) setOverdueCount(count)
    })()
    return () => { mounted = false }
  }, [isAuthenticated])

  const companyById = useMemo(() => {
    const map: Record<string, Company> = {}
    for (const c of companies) map[c.id] = c
    return map
  }, [companies])

  const hasExtraCompany = useMemo(
    () => companies.some(c => (c.code || '').toLowerCase() === 'extra'),
    [companies]
  )

  const isExtraCompany = useCallback(
    (companyId: string) => (companyById[companyId]?.code || '').toLowerCase() === 'extra',
    [companyById]
  )

  const companyName = useCallback(
    (companyId: string) => companyById[companyId]?.name ?? '—',
    [companyById]
  )

  // ---------- quick ranges ----------
  const setQuickRange = useCallback((type: RangeType) => {
    const today = DateUtils.todayISO()
    if (type === 'today') {
      setDateFrom(today)
      setDateTo(today)
    } else if (type === 'week') {
      setDateFrom(DateUtils.addDaysISO(today, -6))
      setDateTo(today)
    } else if (type === 'month') {
      setDateFrom(DateUtils.addDaysISO(today, -29))
      setDateTo(today)
    } else if (type === 'quarter') {
      const { start, end } = DateUtils.getQuarterBounds()
      setDateFrom(start)
      setDateTo(end)
    } else if (type === 'year') {
      const { start, end } = DateUtils.getYearBounds()
      setDateFrom(start)
      setDateTo(end)
    }
    setRangeType(type)
  }, [])

  const onDateFromChange = useCallback((v: string) => {
    setDateFrom(v)
    setRangeType('custom')
  }, [])
  const onDateToChange = useCallback((v: string) => {
    setDateTo(v)
    setRangeType('custom')
  }, [])

  // ---------- analytics ----------
  const analytics = useMemo(() => {
    const { prevFrom, prevTo, days } = DateUtils.calcPrevPeriod(dateFrom, dateTo)
    const dates = DateUtils.rangeDates(dateFrom, dateTo)

    const chartMap = new Map<string, ChartPoint>()
    for (const d of dates) {
      chartMap.set(d, { date: d, income: 0, expense: 0, profit: 0, movingAvg: 0, label: DateUtils.formatShort(d) })
    }

    const current: FinancialTotals = {
      incomeCash: 0, incomeKaspi: 0, incomeCard: 0, incomeOnline: 0, incomeTotal: 0,
      expenseCash: 0, expenseKaspi: 0, expenseTotal: 0,
      profit: 0, netCash: 0, netKaspi: 0, netTotal: 0,
      incomeTx: 0, expenseTx: 0, avgCheck: 0,
    }

    const previous: FinancialTotals = {
      incomeCash: 0, incomeKaspi: 0, incomeCard: 0, incomeOnline: 0, incomeTotal: 0,
      expenseCash: 0, expenseKaspi: 0, expenseTotal: 0,
      profit: 0, netCash: 0, netKaspi: 0, netTotal: 0,
      incomeTx: 0, expenseTx: 0, avgCheck: 0,
    }

    const incomeCats: Record<string, number> = {}
    const expenseCats: Record<string, number> = {}

    const inCurrent = (d: string) => d >= dateFrom && d <= dateTo
    const inPrev = (d: string) => d >= prevFrom && d <= prevTo

    for (const r of incomes) {
      if (!includeExtra && isExtraCompany(r.company_id)) continue

      const cash = Number(r.cash_amount || 0)
      const kaspi = Number(r.kaspi_amount || 0)
      const card = Number(r.card_amount || 0)
      const online = Number(r.online_amount || 0)
      const total = cash + kaspi + card + online
      if (total <= 0) continue

      const cat = (r.comment || 'Продажи').trim()
      incomeCats[cat] = (incomeCats[cat] || 0) + total

      if (inCurrent(r.date)) {
        current.incomeTotal += total
        current.incomeCash += cash
        current.incomeKaspi += kaspi
        current.incomeCard += card
        current.incomeOnline += online
        current.incomeTx += 1

        const p = chartMap.get(r.date)
        if (p) p.income += total
      } else if (inPrev(r.date)) {
        previous.incomeTotal += total
        previous.incomeCash += cash
        previous.incomeKaspi += kaspi
        previous.incomeCard += card
        previous.incomeOnline += online
        previous.incomeTx += 1
      }
    }

    for (const r of expenses) {
      if (!includeExtra && isExtraCompany(r.company_id)) continue

      const cash = Number(r.cash_amount || 0)
      const kaspi = Number(r.kaspi_amount || 0)
      const total = cash + kaspi
      if (total <= 0) continue

      const cat = (r.category || r.comment || 'Прочее').trim()
      expenseCats[cat] = (expenseCats[cat] || 0) + total

      if (inCurrent(r.date)) {
        current.expenseTotal += total
        current.expenseCash += cash
        current.expenseKaspi += kaspi
        current.expenseTx += 1

        const p = chartMap.get(r.date)
        if (p) p.expense += total
      } else if (inPrev(r.date)) {
        previous.expenseTotal += total
        previous.expenseCash += cash
        previous.expenseKaspi += kaspi
        previous.expenseTx += 1
      }
    }

    const finalize = (t: FinancialTotals) => {
      t.profit = t.incomeTotal - t.expenseTotal
      t.netCash = t.incomeCash - t.expenseCash
      t.netKaspi = (t.incomeKaspi + t.incomeCard + t.incomeOnline) - t.expenseKaspi
      t.netTotal = t.profit
      t.avgCheck = t.incomeTx ? t.incomeTotal / t.incomeTx : 0
    }
    finalize(current)
    finalize(previous)

    chartMap.forEach(p => {
      p.profit = p.income - p.expense
    })

    const chartData = Array.from(chartMap.values()).sort((a, b) => a.date.localeCompare(b.date))

    // moving avg (7)
    const w = 7
    for (let i = 0; i < chartData.length; i++) {
      const start = Math.max(0, i - w + 1)
      const window = chartData.slice(start, i + 1)
      chartData[i].movingAvg = window.reduce((s, x) => s + x.profit, 0) / window.length
    }

    const margin = current.incomeTotal ? (current.profit / current.incomeTotal) * 100 : 0
    const efficiency = current.expenseTotal ? current.incomeTotal / current.expenseTotal : (current.incomeTotal ? 10 : 0)

    const trends = {
      income: detectTrend(chartData.map(x => x.income)),
      expense: detectTrend(chartData.map(x => x.expense)),
      profit: detectTrend(chartData.map(x => x.profit)),
    }

    const anomalies = detectAnomalies(chartData)
    const pred = predictNextMonthProfit(chartData)

    // score (простая шкала)
    let score = 50
    if (margin > 30) score += 20
    else if (margin > 20) score += 15
    else if (margin > 10) score += 10
    else if (margin > 5) score += 5
    else if (margin < 0) score -= 20

    const growthProfit = previous.profit ? ((current.profit - previous.profit) / Math.abs(previous.profit)) * 100 : 0
    if (growthProfit > 20) score += 20
    else if (growthProfit > 10) score += 15
    else if (growthProfit > 0) score += 10
    else if (growthProfit < -10) score -= 15

    if (efficiency > 2) score += 15
    else if (efficiency > 1.5) score += 10
    else if (efficiency > 1.2) score += 5
    else if (efficiency < 0.8) score -= 10

    score = Math.max(0, Math.min(100, score))
    const status = scoreStatus(score)

    const recommendation =
      status === 'excellent'
        ? 'Можно смело реинвестировать: маркетинг/оборудование/новые направления.'
        : status === 'good'
        ? 'Подкрути средний чек и контролируй топ-расходы — будет ещё лучше.'
        : status === 'warning'
        ? 'Расходы/маржа требуют внимания: проверь категории и цены.'
        : 'Режим “пожарный”: режь лишнее, ищи утечки и пересматривай прайс.'

    const avgDaily = chartData.length ? chartData.reduce((s, x) => s + x.profit, 0) / chartData.length : 0

    const insight: AIInsight = {
      score,
      status,
      summary: buildSummary(status, trends.profit),
      recommendation,
      margin,
      efficiency,
      trends,
      anomalies,
      predictions: {
        nextMonthProfit: Math.max(0, pred.value),
        confidence: pred.confidence,
        recommendation: pred.confidence >= 70 ? 'Прогноз ок по качеству' : 'Прогноз слабый: мало данных/шум',
      },
      benchmarks: {
        vsPrevPeriod: current.profit - previous.profit,
        vsAvgDaily: current.profit - avgDaily * days,
      },
    }

    const topIncomeCategories: CategoryData[] = Object.entries(incomeCats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, value], idx) => ({
        name,
        value,
        percentage: current.incomeTotal ? (value / current.incomeTotal) * 100 : 0,
        color: COLORS.chart[idx % COLORS.chart.length],
      }))

    const topExpenseCategories: CategoryData[] = Object.entries(expenseCats)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([name, value], idx) => ({
        name,
        value,
        percentage: current.expenseTotal ? (value / current.expenseTotal) * 100 : 0,
        color: COLORS.chart[idx % COLORS.chart.length],
      }))

    return { current, previous, chartData, insight, topIncomeCategories, topExpenseCategories }
  }, [companies, companyById, incomes, expenses, dateFrom, dateTo, includeExtra, isExtraCompany])

  const feedItems = useMemo(() => {
    const items: FeedItem[] = []
    const anomalyDates = new Set(analytics.insight.anomalies.map(a => a.date))

    for (const r of incomes) {
      if (!includeExtra && isExtraCompany(r.company_id)) continue
      if (r.date < dateFrom || r.date > dateTo) continue
      const total =
        Number(r.cash_amount || 0) +
        Number(r.kaspi_amount || 0) +
        Number(r.card_amount || 0) +
        Number(r.online_amount || 0)
      if (total <= 0) continue
      items.push({
        id: `inc-${r.id}`,
        date: r.date,
        company_id: r.company_id,
        kind: 'income',
        title: (r.comment || 'Доход').trim(),
        amount: total,
        isAnomaly: anomalyDates.has(r.date),
      })
    }

    for (const r of expenses) {
      if (!includeExtra && isExtraCompany(r.company_id)) continue
      if (r.date < dateFrom || r.date > dateTo) continue
      const total = Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0)
      if (total <= 0) continue
      items.push({
        id: `exp-${r.id}`,
        date: r.date,
        company_id: r.company_id,
        kind: 'expense',
        title: (r.category || r.comment || 'Расход').trim(),
        amount: total,
        isAnomaly: anomalyDates.has(r.date),
      })
    }

    return items
      .sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount)
      .slice(0, 12)
  }, [incomes, expenses, dateFrom, dateTo, includeExtra, isExtraCompany, analytics.insight.anomalies])

  // ---------- UI states ----------
  if (!authResolved) {
    return (
      <>
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/55 px-5 py-4 backdrop-blur-xl">
          <Sparkles className="h-5 w-5 text-amber-300" />
          <span className="text-sm text-slate-300">Загрузка Orda Control...</span>
        </div>
      </>
    )
  }

  if (!isAuthenticated) {
    return <ProductLanding />
  }

  if (loading) {
    return (
      <>
          <div className="text-center">
            <div className="relative">
              <div className="animate-spin rounded-full h-16 w-16 border-4 border-purple-500/30 border-t-purple-500 mx-auto mb-6" />
              <Brain className="w-8 h-8 text-purple-400 absolute top-4 left-1/2 -translate-x-1/2" />
            </div>
            <p className="text-gray-400">Грузы считаю. Не мешай калькулятору думать 😄</p>
          </div>
      </>
    )
  }

  if (error) {
    return (
      <>
          <Card className="p-8 max-w-md text-center border-red-500/30 bg-red-950/10 backdrop-blur-sm">
            <AlertTriangle className="w-16 h-16 text-red-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Ошибка загрузки</h2>
            <p className="text-gray-400 mb-6">{error}</p>
            <Button
              onClick={() => window.location.reload()}
              className="bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30"
            >
              Перезагрузить
            </Button>
          </Card>
      </>
    )
  }

  const { current, previous, chartData, insight, topIncomeCategories, topExpenseCategories } = analytics

  return (
    <>
        <div className="app-page max-w-7xl space-y-6">
          <HeaderBlock
            dateFrom={dateFrom}
            dateTo={dateTo}
            rangeType={rangeType}
            includeExtra={includeExtra}
            hasExtraCompany={hasExtraCompany}
            insight={insight}
            calendarOpen={calendarOpen}
            onToggleCalendar={() => setCalendarOpen(v => !v)}
            onQuickRange={setQuickRange}
            onDateFromChange={onDateFromChange}
            onDateToChange={onDateToChange}
            onToggleExtra={() => setIncludeExtra(v => !v)}
          />

          {/* Overdue tasks banner */}
          {overdueCount !== null && !overdueDismissed && (
            <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
              <p className="text-sm text-amber-200 flex-1">
                <span className="font-semibold">{overdueCount} просроченных задач</span> — дедлайн прошёл, но статус не закрыт.
              </p>
              <Link href="/tasks" className="text-xs font-semibold text-amber-300 hover:text-amber-200 underline underline-offset-2 shrink-0">
                Открыть задачи →
              </Link>
              <button
                onClick={() => setOverdueDismissed(true)}
                className="text-amber-500 hover:text-amber-300 transition-colors shrink-0 ml-1"
                aria-label="Скрыть"
              >
                ✕
              </button>
            </div>
          )}

          {/* Пульс бизнеса сегодня */}
          {todayStats !== null && (
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 p-5">
              <div className="absolute top-0 right-0 w-48 h-48 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />
              <div className="relative z-10">
                <div className="flex items-center gap-2 mb-4">
                  <Activity className="w-5 h-5 text-purple-400" />
                  <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Пульс бизнеса сегодня</h2>
                  {todayStats.txCount === 0 ? (
                    <span className="ml-auto text-xs text-gray-500">📊 Данных за сегодня нет</span>
                  ) : (todayStats.income - todayStats.expense) > 0 ? (
                    <span className="ml-auto text-xs text-emerald-400">✅ Прибыльный день</span>
                  ) : (
                    <span className="ml-auto text-xs text-red-400">⚠️ Убыточный день</span>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3">
                    <p className="text-[11px] text-emerald-400 uppercase tracking-wider">Выручка</p>
                    <p className="text-lg font-bold text-white mt-1">{Formatters.moneyDetailed(todayStats.income)}</p>
                  </div>
                  <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3">
                    <p className="text-[11px] text-red-400 uppercase tracking-wider">Расходы</p>
                    <p className="text-lg font-bold text-white mt-1">{Formatters.moneyDetailed(todayStats.expense)}</p>
                  </div>
                  <div className={`rounded-xl p-3 border ${(todayStats.income - todayStats.expense) >= 0 ? 'bg-purple-500/10 border-purple-500/20' : 'bg-rose-500/10 border-rose-500/20'}`}>
                    <p className="text-[11px] text-purple-400 uppercase tracking-wider">Прибыль</p>
                    <p className={`text-lg font-bold mt-1 ${(todayStats.income - todayStats.expense) >= 0 ? 'text-white' : 'text-red-400'}`}>
                      {Formatters.moneyDetailed(todayStats.income - todayStats.expense)}
                    </p>
                  </div>
                  <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-3">
                    <p className="text-[11px] text-blue-400 uppercase tracking-wider">Транзакций</p>
                    <p className="text-lg font-bold text-white mt-1">{todayStats.txCount}</p>
                  </div>
                </div>
                {analytics.insight.anomalies.length > 0 && (
                  <div className="mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
                    <p className="text-xs text-amber-400">
                      ⚡ Аномалия: {analytics.insight.anomalies[0].description}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          <Tabs
            active={activeTab}
            onChange={setActiveTab}
          />

          {activeTab === 'overview' && (
            <Overview
              insight={insight}
              current={current}
              previous={previous}
              selectedMetric={selectedMetric}
              onMetricChange={setSelectedMetric}
              chartData={chartData}
              showMovingAvg={showMovingAvg}
              onToggleMovingAvg={() => setShowMovingAvg(v => !v)}
              topIncomeCategories={topIncomeCategories}
              topExpenseCategories={topExpenseCategories}
              feed={feedItems}
              companyName={companyName}
              dateFrom={dateFrom}
              dateTo={dateTo}
            />
          )}

          {activeTab === 'details' && (
            <Details
              current={current}
              previous={previous}
              topIncomeCategories={topIncomeCategories}
              topExpenseCategories={topExpenseCategories}
            />
          )}

          {activeTab === 'forecast' && (
            <Forecast
              insight={insight}
            />
          )}
        </div>
    </>
  )
}

// ==================== UI COMPONENTS ====================

function Tabs({ active, onChange }: { active: 'overview' | 'details' | 'forecast'; onChange: (v: any) => void }) {
  return (
    <div className="flex w-full gap-2 overflow-x-auto rounded-xl border border-gray-700 bg-gray-800/50 p-1 sm:w-fit">
      <TabButton active={active === 'overview'} onClick={() => onChange('overview')} icon={<Activity className="w-4 h-4" />} label="Обзор" />
      <TabButton active={active === 'details'} onClick={() => onChange('details')} icon={<BarChart2 className="w-4 h-4" />} label="Детали" />
      <TabButton active={active === 'forecast'} onClick={() => onChange('forecast')} icon={<Sparkles className="w-4 h-4" />} label="Прогноз" />
    </div>
  )
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
        active ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/25' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function HeaderBlock(props: {
  dateFrom: string
  dateTo: string
  rangeType: RangeType
  includeExtra: boolean
  hasExtraCompany: boolean
  insight: AIInsight
  calendarOpen: boolean
  onToggleCalendar: () => void
  onQuickRange: (t: RangeType) => void
  onDateFromChange: (v: string) => void
  onDateToChange: (v: string) => void
  onToggleExtra: () => void
}) {
  const statusStyle: Record<AIInsight['status'], string> = {
    excellent: 'bg-green-500/15 border-green-500/30 text-green-300',
    good: 'bg-purple-500/15 border-purple-500/30 text-purple-300',
    warning: 'bg-yellow-500/15 border-yellow-500/30 text-yellow-300',
    critical: 'bg-red-500/15 border-red-500/30 text-red-300',
  }

  return (
    <div className="relative overflow-visible rounded-2xl bg-gradient-to-br from-purple-900/30 via-gray-900 to-blue-900/30 p-6 border border-purple-500/20">
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-purple-500/20 rounded-xl">
              <Brain className="w-6 h-6 text-purple-300" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Финансовый дашборд</h1>
              <p className="text-xs text-gray-400">Без “мертвых” кнопок. Только рабочая логика.</p>
            </div>

            <span className={`ml-auto px-3 py-1 rounded-full text-xs font-medium border ${statusStyle[props.insight.status]}`}>
              {props.insight.status === 'excellent' ? '🚀 Отлично' :
               props.insight.status === 'good' ? '✅ Хорошо' :
               props.insight.status === 'warning' ? '⚠️ Внимание' : '🔴 Критично'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <QuickRangeBtn active={props.rangeType === 'today'} onClick={() => props.onQuickRange('today')} label="Сегодня" />
            <QuickRangeBtn active={props.rangeType === 'week'} onClick={() => props.onQuickRange('week')} label="Неделя" />
            <QuickRangeBtn active={props.rangeType === 'month'} onClick={() => props.onQuickRange('month')} label="30 дней" />
            <QuickRangeBtn active={props.rangeType === 'quarter'} onClick={() => props.onQuickRange('quarter')} label="Квартал" />
            <QuickRangeBtn active={props.rangeType === 'year'} onClick={() => props.onQuickRange('year')} label="Год" />

            <button
              onClick={props.onToggleCalendar}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-800/50 rounded-lg border border-gray-700 hover:border-purple-500/50 transition-colors"
            >
              <Calendar className="w-4 h-4 text-purple-300" />
              <span className="text-gray-200">
                {DateUtils.formatFull(props.dateFrom)} — {DateUtils.formatFull(props.dateTo)}
              </span>
              <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${props.calendarOpen ? 'rotate-180' : ''}`} />
            </button>

            {props.hasExtraCompany && (
              <button
                onClick={props.onToggleExtra}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors ${
                  props.includeExtra
                    ? 'bg-red-500/10 border-red-500/30 text-red-300'
                    : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:bg-gray-700/50'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${props.includeExtra ? 'bg-red-400' : 'bg-gray-500'}`} />
                {props.includeExtra ? 'Extra включён' : 'Extra исключён'}
              </button>
            )}

            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800/50 rounded-lg border border-gray-700">
              <Sparkles className="w-4 h-4 text-yellow-400" />
              <span className="text-gray-300">Прогноз:</span>
              <span className="font-medium text-purple-300">{props.insight.predictions.confidence}%</span>
            </div>
          </div>
        </div>
      </div>

      {props.calendarOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 z-[100]">
          <Card className="p-4 bg-gray-900/95 backdrop-blur-xl border border-purple-500/20 rounded-2xl shadow-2xl">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs text-gray-500 uppercase tracking-wider">Начало</label>
                <input
                  type="date"
                  value={props.dateFrom}
                  onChange={e => props.onDateFromChange(e.target.value)}
                  className="w-full bg-gray-800 text-white px-4 py-3 rounded-xl border border-gray-700 focus:border-purple-500 outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-gray-500 uppercase tracking-wider">Конец</label>
                <input
                  type="date"
                  value={props.dateTo}
                  min={props.dateFrom}
                  onChange={e => props.onDateToChange(e.target.value)}
                  className="w-full bg-gray-800 text-white px-4 py-3 rounded-xl border border-gray-700 focus:border-purple-500 outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <Button onClick={props.onToggleCalendar} className="bg-purple-500 hover:bg-purple-600 text-white">
                Применить
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

function QuickRangeBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-xl transition-all ${
        active ? 'bg-purple-500 text-white shadow-lg shadow-purple-500/25' : 'bg-gray-800 text-gray-300 hover:bg-gray-700 border border-gray-700'
      }`}
    >
      {label}
    </button>
  )
}

// ==================== OVERVIEW ====================

function Overview(props: {
  insight: AIInsight
  current: FinancialTotals
  previous: FinancialTotals
  selectedMetric: 'income' | 'expense' | 'profit'
  onMetricChange: (m: any) => void
  chartData: ChartPoint[]
  showMovingAvg: boolean
  onToggleMovingAvg: () => void
  topIncomeCategories: CategoryData[]
  topExpenseCategories: CategoryData[]
  feed: FeedItem[]
  companyName: (id: string) => string
  dateFrom: string
  dateTo: string
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <AICard insight={props.insight} />

        <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-6">
          <MetricCard
            label="Доход"
            value={props.current.incomeTotal}
            previousValue={props.previous.incomeTotal}
            icon={<TrendingUp className="w-5 h-5" />}
            color="from-green-500 to-emerald-500"
            selected={props.selectedMetric === 'income'}
            onClick={() => props.onMetricChange('income')}
          />
          <MetricCard
            label="Расход"
            value={props.current.expenseTotal}
            previousValue={props.previous.expenseTotal}
            icon={<TrendingDown className="w-5 h-5" />}
            color="from-red-500 to-rose-500"
            selected={props.selectedMetric === 'expense'}
            onClick={() => props.onMetricChange('expense')}
          />
          <MetricCard
            label="Прибыль"
            value={props.current.profit}
            previousValue={props.previous.profit}
            icon={<Target className="w-5 h-5" />}
            color="from-purple-500 to-indigo-500"
            selected={props.selectedMetric === 'profit'}
            onClick={() => props.onMetricChange('profit')}
          />
        </div>
      </div>

      <ChartCard
        data={props.chartData}
        metric={props.selectedMetric}
        showMovingAvg={props.showMovingAvg}
        onToggleMovingAvg={props.onToggleMovingAvg}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <CategoryPie title="Структура доходов" data={props.topIncomeCategories} total={props.current.incomeTotal} icon={<TrendingUp className="w-4 h-4" />} />
        <CategoryPie title="Структура расходов" data={props.topExpenseCategories} total={props.current.expenseTotal} icon={<TrendingDown className="w-4 h-4" />} />
        <AnomaliesCard anomalies={props.insight.anomalies} />
        <FeedCard feed={props.feed} companyName={props.companyName} dateFrom={props.dateFrom} dateTo={props.dateTo} />
      </div>

      <PredictionWide insight={props.insight} currentProfit={props.current.profit} />
    </div>
  )
}

function AICard({ insight }: { insight: AIInsight }) {
  return (
    <Card className="p-6 border-0 bg-gradient-to-br from-purple-900/30 via-gray-900 to-indigo-900/30 backdrop-blur-sm">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-purple-500/20 rounded-xl">
          <Brain className="w-5 h-5 text-purple-300" />
        </div>
        <span className="text-sm font-medium text-gray-200">AI анализ</span>
      </div>

      <div className="mb-3">
        <div className="text-4xl font-bold text-white">{insight.score}</div>
        <div className="text-xs text-gray-500">из 100</div>
      </div>

      <div className="space-y-3">
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-400">Маржа</span>
            <span className="text-purple-300 font-medium">{insight.margin.toFixed(1)}%</span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-purple-400 rounded-full" style={{ width: `${Math.min(100, insight.margin * 2)}%` }} />
          </div>
        </div>

        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-400">Эффективность</span>
            <span className="text-green-300 font-medium">{insight.efficiency.toFixed(2)}x</span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full bg-green-400 rounded-full" style={{ width: `${Math.min(100, insight.efficiency * 30)}%` }} />
          </div>
        </div>

        <div className="pt-3 border-t border-gray-800">
          <p className="text-xs text-gray-400 mb-2">{insight.summary}</p>
          <p className="text-sm text-gray-200">{insight.recommendation}</p>
        </div>
      </div>
    </Card>
  )
}

function MetricCard(props: {
  label: string
  value: number
  previousValue: number
  icon: ReactNode
  color: string
  selected: boolean
  onClick: () => void
}) {
  const ch = Formatters.percentChange(props.value, props.previousValue)
  return (
    <Card
      onClick={props.onClick}
      className={`p-6 cursor-pointer transition-all border-0 bg-gray-800/50 hover:bg-gray-800/80 ${props.selected ? 'ring-2 ring-purple-500' : ''}`}
    >
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-gray-400">{props.label}</span>
        <div className={`p-2 rounded-xl bg-gradient-to-br ${props.color} bg-opacity-20`}>{props.icon}</div>
      </div>
      <div className="text-2xl font-bold text-white mb-2 break-all">{Formatters.moneyDetailed(props.value)}</div>
      <div className="flex items-center gap-2 text-xs">
        <span className={ch.positive ? 'text-green-300' : 'text-red-300'}>{ch.text}</span>
        <span className="text-gray-500">к прошлому периоду</span>
      </div>
      {props.selected && (
        <div className="mt-4 text-xs text-purple-300 flex items-center gap-1">
          <Activity className="w-3 h-3" /> на графике
        </div>
      )}
    </Card>
  )
}

function ChartCard(props: {
  data: ChartPoint[]
  metric: 'income' | 'expense' | 'profit'
  showMovingAvg: boolean
  onToggleMovingAvg: () => void
}) {
  const metricName = props.metric === 'income' ? 'Доход' : props.metric === 'expense' ? 'Расход' : 'Прибыль'
  const metricColor = props.metric === 'income' ? COLORS.income : props.metric === 'expense' ? COLORS.expense : COLORS.profit

  return (
    <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-500/20 rounded-xl">
            <LineChart className="w-5 h-5 text-purple-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Динамика: {metricName}</h3>
            <p className="text-xs text-gray-500">
              {props.data.length ? `с ${DateUtils.formatShort(props.data[0].date)} по ${DateUtils.formatShort(props.data[props.data.length - 1].date)}` : 'Нет данных'}
            </p>
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={props.onToggleMovingAvg}
          className="text-xs h-8 bg-gray-700/50 hover:bg-gray-700 text-gray-200"
        >
          {props.showMovingAvg ? 'Скрыть среднее' : 'Показать среднее'}
        </Button>
      </div>

      {!props.data.length ? (
        <div className="h-80 flex items-center justify-center text-gray-500">Нет данных</div>
      ) : (
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={props.data}>
              <defs>
                <linearGradient id="metricFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={metricColor} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={metricColor} stopOpacity={0} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" opacity={0.12} stroke="#374151" vertical={false} />
              <XAxis dataKey="label" stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis
                stroke="#6b7280"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => Formatters.moneyDetailed(v)}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#111827', border: '1px solid rgba(139,92,246,.25)', borderRadius: 12 }}
                itemStyle={{ color: '#fff' }}
                labelStyle={{ color: '#9ca3af', fontSize: 12 }}
                formatter={(val: any) => [Formatters.moneyDetailed(Number(val)), '']}
              />
              <Legend />

              <Area
                type="monotone"
                dataKey={props.metric}
                name={metricName}
                stroke={metricColor}
                strokeWidth={2}
                fill="url(#metricFill)"
              />

              {props.showMovingAvg && (
                <Line
                  type="monotone"
                  dataKey="movingAvg"
                  name="Среднее (7д)"
                  stroke="#fbbf24"
                  strokeWidth={2}
                  dot={false}
                  strokeDasharray="5 5"
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}

function CategoryPie(props: { title: string; data: CategoryData[]; total: number; icon: ReactNode }) {
  return (
    <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-gray-700/40 rounded-xl">{props.icon}</div>
        <h3 className="text-sm font-semibold text-white">{props.title}</h3>
      </div>

      {!props.data.length ? (
        <div className="h-48 flex items-center justify-center text-gray-500">Нет данных</div>
      ) : (
        <div className="space-y-4">
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <RePieChart>
                <Pie data={props.data} dataKey="value" cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={2}>
                  {props.data.map((e, i) => (
                    <Cell key={i} fill={e.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: any) => [Formatters.moneyDetailed(Number(v)), '']} />
              </RePieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-2 max-h-32 overflow-auto">
            {props.data.map((x, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: x.color }} />
                  <span className="text-gray-300 truncate max-w-[120px]">{x.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-white font-medium">{Formatters.moneyDetailed(x.value)}</span>
                  <span className="text-gray-500">({x.percentage.toFixed(1)}%)</span>
                </div>
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-gray-700">
            <div className="flex justify-between text-xs">
              <span className="text-gray-400">Всего</span>
              <span className="text-white font-medium">{Formatters.moneyDetailed(props.total)}</span>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

function AnomaliesCard({ anomalies }: { anomalies: AIInsight['anomalies'] }) {
  const severityStyle: Record<'low' | 'medium' | 'high', string> = {
    low: 'bg-yellow-500/10 border-yellow-500/25 text-yellow-200',
    medium: 'bg-orange-500/10 border-orange-500/25 text-orange-200',
    high: 'bg-red-500/10 border-red-500/25 text-red-200',
  }

  return (
    <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-yellow-500/20 rounded-xl">
          <AlertTriangle className="w-5 h-5 text-yellow-300" />
        </div>
        <h3 className="text-sm font-semibold text-white">Аномалии</h3>
        {!!anomalies.length && <span className="px-2 py-0.5 bg-red-500/20 text-red-200 text-xs rounded-full">{anomalies.length}</span>}
      </div>

      {!anomalies.length ? (
        <div className="text-center py-8">
          <CheckCircle2 className="w-12 h-12 text-green-500/50 mx-auto mb-2" />
          <p className="text-sm text-gray-300">Аномалий не обнаружено</p>
          <p className="text-xs text-gray-500">Пока всё ровно</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-64 overflow-auto">
          {anomalies.map((a, i) => (
            <div key={i} className={`p-3 rounded-xl border ${severityStyle[a.severity]}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium">
                  {a.type === 'spike' ? '📈 Всплеск' : '📉 Падение'} • {a.severity}
                </span>
                <span className="text-[10px] opacity-80">{DateUtils.formatShort(a.date)}</span>
              </div>
              <p className="text-xs">{a.description}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function FeedCard(props: {
  feed: FeedItem[]
  companyName: (id: string) => string
  dateFrom: string
  dateTo: string
}) {
  return (
    <Card className="p-0 border-0 bg-gray-800/50 backdrop-blur-sm overflow-hidden flex flex-col">
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/20 rounded-xl">
            <Activity className="w-5 h-5 text-blue-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Лента</h3>
            <p className="text-xs text-gray-500">Последние операции</p>
          </div>
          {!!props.feed.length && (
            <span className="ml-auto px-2 py-0.5 bg-blue-500/20 text-blue-200 text-xs rounded-full">
              {props.feed.length}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto max-h-[300px] p-2 space-y-1">
        {!props.feed.length ? (
          <div className="text-center py-8 text-gray-500">Нет операций</div>
        ) : (
          props.feed.map(it => (
            <div
              key={it.id}
              className={`flex items-center justify-between p-3 rounded-xl transition-all ${
                it.isAnomaly ? 'bg-yellow-500/10 border border-yellow-500/20' : 'hover:bg-gray-700/50'
              }`}
            >
              <div className="min-w-0">
                <div className="text-xs font-medium text-white truncate">{it.title}</div>
                <div className="text-[10px] text-gray-500 truncate">
                  {props.companyName(it.company_id)} • {DateUtils.formatShort(it.date)}
                </div>
              </div>
              <div className={`text-xs font-bold font-mono whitespace-nowrap ml-2 ${it.kind === 'income' ? 'text-green-300' : 'text-red-300'}`}>
                {it.kind === 'income' ? '+' : '-'}
                {Formatters.moneyDetailed(it.amount)}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-3 border-t border-gray-700 bg-gray-900/40">
        <Link href={`/income?from=${props.dateFrom}&to=${props.dateTo}`}>
          <Button variant="ghost" size="sm" className="w-full text-xs h-8 text-gray-300 hover:text-white hover:bg-gray-700">
            Все операции
          </Button>
        </Link>
      </div>
    </Card>
  )
}

function PredictionWide({ insight, currentProfit }: { insight: AIInsight; currentProfit: number }) {
  const diff = insight.predictions.nextMonthProfit - currentProfit
  const pct = currentProfit ? (diff / Math.abs(currentProfit)) * 100 : 0

  return (
    <Card className="p-6 border-0 bg-gradient-to-br from-blue-900/30 via-gray-900 to-purple-900/30 backdrop-blur-sm">
      <div className="flex flex-col lg:flex-row gap-6 items-start lg:items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="w-5 h-5 text-blue-300" />
            <h3 className="text-sm font-semibold text-white">Прогноз на 30 дней (прибыль)</h3>
          </div>
          <div className="text-3xl font-bold text-white">{Formatters.moneyDetailed(insight.predictions.nextMonthProfit)}</div>
          <div className="text-xs text-gray-400 mt-1">
            Достоверность: <span className="text-purple-300 font-medium">{insight.predictions.confidence}%</span> • {insight.predictions.recommendation}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className={`px-3 py-1 rounded-lg text-sm font-medium ${diff >= 0 ? 'bg-green-500/20 text-green-200' : 'bg-red-500/20 text-red-200'}`}>
            {diff >= 0 ? '↗' : '↘'} {Math.abs(pct).toFixed(1)}%
          </div>
          <div className="text-xs text-gray-400">
            {diff >= 0 ? 'лучше' : 'хуже'} текущего периода
          </div>
        </div>
      </div>
    </Card>
  )
}

// ==================== DETAILS ====================

function Details(props: {
  current: FinancialTotals
  previous: FinancialTotals
  topIncomeCategories: CategoryData[]
  topExpenseCategories: CategoryData[]
}) {
  const paymentStats = [
    { name: 'Наличные', value: props.current.incomeCash, color: '#f59e0b' },
    { name: 'Kaspi', value: props.current.incomeKaspi, color: '#2563eb' },
    { name: 'Карта', value: props.current.incomeCard, color: '#7c3aed' },
    { name: 'Онлайн', value: props.current.incomeOnline, color: '#ec4899' },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MiniStat label="Транзакции (доход)" value={props.current.incomeTx} prev={props.previous.incomeTx} icon={<Activity className="w-4 h-4" />} />
        <MiniStat label="Транзакции (расход)" value={props.current.expenseTx} prev={props.previous.expenseTx} icon={<Activity className="w-4 h-4" />} />
        <MiniStat label="Средний чек" value={props.current.avgCheck} prev={props.previous.avgCheck} icon={<DollarSign className="w-4 h-4" />} money />
        <MiniStat label="Онлайн" value={props.current.incomeOnline} prev={props.previous.incomeOnline} icon={<Globe className="w-4 h-4" />} money />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-white mb-4">Способы оплаты</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={paymentStats}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.12} stroke="#374151" />
                <XAxis dataKey="name" stroke="#6b7280" fontSize={10} />
                <YAxis stroke="#6b7280" fontSize={10} tickFormatter={(v) => Formatters.moneyDetailed(v)} />
                <Tooltip formatter={(v: any) => Formatters.moneyDetailed(Number(v))} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                  {paymentStats.map((e, i) => (
                    <Cell key={i} fill={e.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
          <h3 className="text-sm font-semibold text-white mb-4">Баланс</h3>
          <div className="space-y-4">
            <BalanceRow icon={<Wallet className="w-4 h-4" />} label="Net Cash" value={props.current.netCash} />
            <BalanceRow icon={<Globe className="w-4 h-4" />} label="Net Безнал" value={props.current.netKaspi} />
            <BalanceRow icon={<Target className="w-4 h-4" />} label="Net Total" value={props.current.netTotal} />
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CategoryPie title="Топ доходов" data={props.topIncomeCategories} total={props.current.incomeTotal} icon={<TrendingUp className="w-4 h-4" />} />
        <CategoryPie title="Топ расходов" data={props.topExpenseCategories} total={props.current.expenseTotal} icon={<TrendingDown className="w-4 h-4" />} />
      </div>
    </div>
  )
}

function MiniStat(props: { label: string; value: number; prev: number; icon: ReactNode; money?: boolean }) {
  const ch = Formatters.percentChange(props.value, props.prev)
  return (
    <Card className="p-4 border-0 bg-gray-800/50 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded-lg bg-gray-700/40">{props.icon}</div>
        <span className="text-xs text-gray-400">{props.label}</span>
      </div>
      <div className="text-xl font-bold text-white">
        {props.money ? Formatters.moneyDetailed(props.value) : props.value.toLocaleString('ru-RU')}
      </div>
      <div className="flex items-center gap-2 text-xs mt-1">
        <span className={ch.positive ? 'text-green-300' : 'text-red-300'}>{ch.text}</span>
        <span className="text-gray-500">к прошлому</span>
      </div>
    </Card>
  )
}

function BalanceRow({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center justify-between p-3 bg-gray-700/20 rounded-xl border border-gray-700">
      <div className="flex items-center gap-2 text-sm text-gray-300">
        {icon}
        {label}
      </div>
      <div className="text-sm font-bold text-white">{Formatters.moneyDetailed(value)}</div>
    </div>
  )
}

// ==================== FORECAST ====================

function Forecast({ insight }: { insight: AIInsight }) {
  return (
    <div className="space-y-6">
      <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-5 h-5 text-purple-300" />
          <h3 className="text-sm font-semibold text-white">Что делать дальше</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <Advice
            title="Маржинальность"
            text={insight.margin < 20 ? `Маржа ${insight.margin.toFixed(1)}% — подними цены/режь себестоимость.` : `Маржа ${insight.margin.toFixed(1)}% — держи, не сливай.`}
            icon={<Target className="w-4 h-4" />}
          />
          <Advice
            title="Эффективность"
            text={insight.efficiency < 1.5 ? `Эффективность ${insight.efficiency.toFixed(2)}x — расходы кушают доход.` : `Эффективность ${insight.efficiency.toFixed(2)}x — хорошо.`}
            icon={<Activity className="w-4 h-4" />}
          />
          <Advice
            title="Тренд прибыли"
            text={
              insight.trends.profit === 'up'
                ? 'Прибыль растёт — закрепи: повтори удачные дни/акции.'
                : insight.trends.profit === 'down'
                ? 'Прибыль падает — проверь топ-расходы и просадки дохода.'
                : 'Прибыль стабильна — делай A/B по акциям и среднему чеку.'
            }
            icon={<LineChart className="w-4 h-4" />}
          />
          <Advice
            title="Прогноз"
            text={`Ожидаемая прибыль: ${Formatters.moneyDetailed(insight.predictions.nextMonthProfit)}. Достоверность: ${insight.predictions.confidence}%.`}
            icon={<Sparkles className="w-4 h-4" />}
          />
        </div>
      </Card>
    </div>
  )
}

function Advice({ title, text, icon }: { title: string; text: string; icon: ReactNode }) {
  return (
    <div className="p-4 bg-gray-700/20 rounded-xl border border-gray-700 hover:border-purple-500/30 transition-colors">
      <div className="flex items-center gap-2 mb-2">
        <div className="p-1.5 bg-purple-500/15 rounded-lg">{icon}</div>
        <div className="text-sm font-medium text-white">{title}</div>
      </div>
      <div className="text-xs text-gray-300">{text}</div>
    </div>
  )
}
