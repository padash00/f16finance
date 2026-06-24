'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  Award,
  Calendar,
  ChevronDown,
  Clock,
  Crown,
  Download,
  Gift,
  Info,
  Medal,
  Minus,
  RefreshCw,
  Search,
  TrendingDown,
  TrendingUp,
  Trophy,
  Users,
  X,
  Zap,
} from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { useModalEscape } from '@/lib/client/use-modal-escape'

type ShiftDetail = {
  date: string
  shift: string
  company_id: string
  actual: number
  expected: number
  pi: number
  source: string
}

type RankingItem = {
  operator_id: string
  operator_name: string
  operator_short_name: string | null
  shifts: number
  total_revenue: number
  avg_revenue_per_shift: number
  pi: number
  qualifying: boolean
  shift_details: ShiftDetail[]
}

type ApiResponse = {
  data: {
    ranking: RankingItem[]
    baseline: { from: string; to: string; shifts_count: number; slots_count: number; global_median: number }
    period: { from: string; to: string }
    config: {
      baseline_days_actual: number
      baseline_earliest_income_date: string | null
      min_qualifying_shifts: number
      pi_clip: [number, number]
    }
  }
}

type Company = { id: string; name: string; code: string | null }
type ShiftFilter = 'all' | 'day' | 'night'

type PeriodPreset = 'thisMonth' | 'lastMonth' | 'thisWeek' | 'lastWeek' | 'thisYear'

const PERIOD_PRESETS: Record<PeriodPreset, { label: string; getRange: () => { from: string; to: string } }> = {
  thisWeek: {
    label: 'Эта неделя',
    getRange: () => {
      const now = new Date()
      const day = now.getDay() === 0 ? 7 : now.getDay()
      const monday = new Date(now)
      monday.setDate(now.getDate() - (day - 1))
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      return { from: toISO(monday), to: toISO(sunday) }
    },
  },
  lastWeek: {
    label: 'Прошлая неделя',
    getRange: () => {
      const now = new Date()
      const day = now.getDay() === 0 ? 7 : now.getDay()
      const lastMonday = new Date(now)
      lastMonday.setDate(now.getDate() - (day - 1) - 7)
      const lastSunday = new Date(lastMonday)
      lastSunday.setDate(lastMonday.getDate() + 6)
      return { from: toISO(lastMonday), to: toISO(lastSunday) }
    },
  },
  thisMonth: {
    label: 'Текущий месяц',
    getRange: () => {
      const now = new Date()
      return {
        from: toISO(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: toISO(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      }
    },
  },
  lastMonth: {
    label: 'Прошлый месяц',
    getRange: () => {
      const now = new Date()
      return {
        from: toISO(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: toISO(new Date(now.getFullYear(), now.getMonth(), 0)),
      }
    },
  },
  thisYear: {
    label: 'Текущий год',
    getRange: () => {
      const now = new Date()
      return {
        from: toISO(new Date(now.getFullYear(), 0, 1)),
        to: toISO(new Date(now.getFullYear(), 11, 31)),
      }
    },
  },
}

function toISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Предыдущий период той же длины, вплотную перед текущим (для тренда PI).
function prevRange(from: string, to: string): { from: string; to: string } {
  const f = new Date(from)
  const t = new Date(to)
  const lenDays = Math.round((t.getTime() - f.getTime()) / 86_400_000) + 1
  const prevTo = new Date(f)
  prevTo.setDate(f.getDate() - 1)
  const prevFrom = new Date(prevTo)
  prevFrom.setDate(prevTo.getDate() - (lenDays - 1))
  return { from: toISO(prevFrom), to: toISO(prevTo) }
}

function moneyFmt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU') + ' ₸'
}

function moneyShort(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' млн ₸'
  if (Math.abs(n) >= 1_000) return Math.round(n / 1_000) + ' тыс ₸'
  return Math.round(n).toLocaleString('ru-RU') + ' ₸'
}

function piColor(pi: number): { text: string; bg: string; border: string; label: string } {
  if (pi >= 1.15) return { text: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', label: 'Превосходно' }
  if (pi >= 1.05) return { text: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', label: 'Хорошо' }
  if (pi >= 0.95) return { text: 'text-slate-700 dark:text-slate-300', bg: 'bg-slate-500/10', border: 'border-slate-500/20', label: 'Норма' }
  if (pi >= 0.85) return { text: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-500/10', border: 'border-amber-500/20', label: 'Ниже нормы' }
  return { text: 'text-rose-700 dark:text-rose-300', bg: 'bg-rose-500/10', border: 'border-rose-500/20', label: 'Слабо' }
}

function rankBadge(rank: number) {
  if (rank === 1) return <Crown className="w-5 h-5 text-amber-600 dark:text-amber-300" />
  if (rank === 2) return <Trophy className="w-5 h-5 text-slate-700 dark:text-slate-300" />
  if (rank === 3) return <Medal className="w-5 h-5 text-orange-600 dark:text-orange-300" />
  return <span className="text-xs font-mono text-slate-500 dark:text-slate-400">#{rank}</span>
}

const WEEKDAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

// Σ ожидание по сменам оператора (норма за период в тенге).
function expectedTotal(item: RankingItem): number {
  return item.shift_details.reduce((s, sh) => s + sh.expected, 0)
}
// Сколько он принёс СВЕРХ нормы (или ниже) — для обоснования бонуса.
function aboveNorm(item: RankingItem): number {
  return item.total_revenue - expectedTotal(item)
}
// Номер недели (для личного тренда внутри периода).
function weekKey(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1)
  const day = dt.getDay() === 0 ? 7 : dt.getDay()
  dt.setDate(dt.getDate() - day + 1) // понедельник недели
  return toISO(dt)
}

// Дельта PI к прошлому периоду: ↑/↓/— с цветом. undefined prev → «новый».
function DeltaBadge({ pi, prev }: { pi: number; prev: number | undefined }) {
  if (prev === undefined) {
    return <span className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap">новый</span>
  }
  const d = pi - prev
  if (Math.abs(d) < 0.005) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-slate-500 dark:text-slate-400 tabular-nums">
        <Minus className="w-3 h-3" />0.00
      </span>
    )
  }
  const up = d > 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums ${up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`} title={`Прошлый период: PI ${prev.toFixed(2)}`}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {up ? '+' : ''}{d.toFixed(2)}
    </span>
  )
}

// Горизонтальная PI-шкала 0.5..2.0 с маркером — положение видно одним взглядом.
function PiBar({ pi }: { pi: number }) {
  const lo = 0.5, hi = 2.0
  const pos = Math.max(0, Math.min(100, ((Math.max(lo, Math.min(hi, pi)) - lo) / (hi - lo)) * 100))
  const normPos = ((1 - lo) / (hi - lo)) * 100
  const col = pi >= 1.05 ? 'bg-emerald-500' : pi >= 0.95 ? 'bg-slate-400' : pi >= 0.85 ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <div className="relative h-1.5 w-full rounded-full bg-slate-200 dark:bg-white/10 overflow-visible">
      <div className="absolute top-0 bottom-0 w-px bg-slate-400 dark:bg-white/30" style={{ left: `${normPos}%` }} title="Норма (1.0)" />
      <div className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-2.5 w-2.5 rounded-full ${col} ring-2 ring-white dark:ring-slate-900`} style={{ left: `${pos}%` }} />
    </div>
  )
}

// Мини-спарклайн PI по сменам (для модалки): линия 0.5..2.0, без осей.
function PiSparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const w = 140, h = 32, pad = 3
  const lo = 0.5, hi = 2.0
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2)
    const cl = Math.max(lo, Math.min(hi, v))
    const y = h - pad - ((cl - lo) / (hi - lo)) * (h - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const baselineY = h - pad - ((1 - lo) / (hi - lo)) * (h - pad * 2)
  return (
    <svg width={w} height={h} className="shrink-0">
      <line x1={pad} y1={baselineY} x2={w - pad} y2={baselineY} stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" className="text-slate-300 dark:text-white/15" />
      <polyline points={pts.join(' ')} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" className="text-violet-500 dark:text-violet-400" />
    </svg>
  )
}

// Проблемные слоты: агрегируем все смены всех операторов по (точка·день·смена),
// ищем где факт систематически ниже нормы за период.
type SlotStat = { key: string; company: string; weekday: number; shift: string; actual: number; expected: number; count: number; ratio: number }
function computeProblemSlots(ranking: RankingItem[]): SlotStat[] {
  const map = new Map<string, SlotStat>()
  for (const op of ranking) {
    for (const sh of op.shift_details) {
      const wd = weekday(sh.date)
      const key = `${sh.company_id}|${wd}|${sh.shift}`
      const cur = map.get(key) || { key, company: sh.company_id, weekday: wd, shift: sh.shift, actual: 0, expected: 0, count: 0, ratio: 1 }
      cur.actual += sh.actual
      cur.expected += sh.expected
      cur.count += 1
      map.set(key, cur)
    }
  }
  const arr = [...map.values()].filter((s) => s.count >= 2 && s.expected > 0)
  for (const s of arr) s.ratio = s.actual / s.expected
  return arr.filter((s) => s.ratio < 0.92).sort((a, b) => a.ratio - b.ratio).slice(0, 6)
}
function weekday(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1).getDay()
}

// CSV-экспорт рейтинга (открывается в Excel).
function exportCsv(rows: RankingItem[], bonusPct: number) {
  const head = ['Оператор', 'Смен', 'Выручка', 'Норма', 'Сверх нормы', 'PI', bonusPct > 0 ? 'Бонус' : '']
    .filter(Boolean)
  const lines = rows.map((r) => {
    const exp = Math.round(expectedTotal(r))
    const above = Math.round(aboveNorm(r))
    const cells = [
      `"${(r.operator_short_name || r.operator_name).replace(/"/g, '""')}"`,
      r.shifts,
      Math.round(r.total_revenue),
      exp,
      above,
      r.pi.toFixed(2),
    ]
    if (bonusPct > 0) cells.push(Math.round(Math.max(0, above) * bonusPct / 100))
    return cells.join(',')
  })
  const csv = '﻿' + [head.join(','), ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'performance.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export default function PerformancePage() {
  const [isClient, setIsClient] = useState(false)
  useEffect(() => setIsClient(true), [])

  const [period, setPeriod] = useState<PeriodPreset>('thisMonth')
  const [companyId, setCompanyId] = useState<string>('')   // '' = все точки
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>('all')
  const [companies, setCompanies] = useState<Company[]>([])
  const [data, setData] = useState<ApiResponse['data'] | null>(null)
  const [prevPi, setPrevPi] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<RankingItem | null>(null)
  const [methodOpen, setMethodOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'pi' | 'aboveNorm' | 'revenue' | 'shifts'>('pi')
  const [bonusPct, setBonusPct] = useState(0)        // % от суммы сверх нормы; 0 = выкл
  const [candidateThreshold] = useState(1.10)        // PI ≥ → кандидат на бонус
  const reqId = useRef(0)

  const range = useMemo(() => PERIOD_PRESETS[period].getRange(), [period])

  // Загружаем список точек один раз
  useEffect(() => {
    fetch('/api/admin/companies', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => setCompanies(j.data || []))
      .catch(() => {})
  }, [])

  const load = async (silent = false) => {
    const myReq = ++reqId.current   // защита от гонки: учитываем только последний запрос
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const mk = (from: string, to: string) => {
        const p = new URLSearchParams({ from, to })
        if (companyId) p.set('company_id', companyId)
        return `/api/admin/performance/ranking?${p}`
      }
      const prev = prevRange(range.from, range.to)
      // Текущий период + предыдущий (для тренда) — параллельно. Предыдущий не критичен.
      const [res, prevRes] = await Promise.all([
        fetch(mk(range.from, range.to), { cache: 'no-store' }),
        fetch(mk(prev.from, prev.to), { cache: 'no-store' }).catch(() => null),
      ])
      const body = (await res.json()) as ApiResponse | { error: string }
      if (myReq !== reqId.current) return   // пришёл устаревший ответ — игнорируем
      if (!res.ok) throw new Error(('error' in body && body.error) || 'Не удалось загрузить рейтинг')
      setData((body as ApiResponse).data)

      const map: Record<string, number> = {}
      if (prevRes && prevRes.ok) {
        const pj = (await prevRes.json()) as ApiResponse
        for (const op of pj.data?.ranking || []) map[op.operator_id] = op.pi
      }
      if (myReq === reqId.current) setPrevPi(map)
    } catch (e: any) {
      if (myReq === reqId.current) setError(e?.message || 'Ошибка загрузки')
    } finally {
      if (myReq === reqId.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, companyId])

  // Локальная фильтрация по shift (api грузит все смены, фильтруем на клиенте чтобы не дёргать api)
  const filteredRanking = useMemo(() => {
    if (!data) return []
    if (shiftFilter === 'all') return data.ranking
    // Фильтруем shift_details и пересчитываем PI/shifts/totalRevenue только для нужных смен
    return data.ranking
      .map((op) => {
        const matched = op.shift_details.filter((s) => s.shift === shiftFilter)
        if (matched.length === 0) return null
        const totalRev = matched.reduce((sum, s) => sum + s.actual, 0)
        // Та же формула, что в API: денежный PI = Σ(клип.факт) / Σ(ожидание). Без накруток.
        const sumExp = matched.reduce((sum, s) => sum + s.expected, 0)
        const sumPiExp = matched.reduce((sum, s) => sum + s.pi * s.expected, 0)
        const piMoney = sumExp > 0 ? sumPiExp / sumExp : 1.0
        return {
          ...op,
          shifts: matched.length,
          total_revenue: totalRev,
          avg_revenue_per_shift: matched.length > 0 ? totalRev / matched.length : 0,
          pi: Number(piMoney.toFixed(3)),
          qualifying: matched.length >= (data.config.min_qualifying_shifts || 3),
          shift_details: matched,
        } as RankingItem
      })
      .filter((x): x is RankingItem => x !== null)
      .sort((a, b) => {
        if (a.qualifying !== b.qualifying) return a.qualifying ? -1 : 1
        if (a.qualifying) return b.pi - a.pi
        return b.total_revenue - a.total_revenue
      })
  }, [data, shiftFilter])

  if (!isClient) return null

  const qualifying = filteredRanking.filter((r) => r.qualifying)
  const coldStart = filteredRanking.filter((r) => !r.qualifying)
  const selectedCompany = companies.find((c) => c.id === companyId)
  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? '—'

  // Поиск + сортировка для отображаемого списка (сводка/лидер — по полному набору qualifying)
  const q = search.trim().toLowerCase()
  const viewQualifying = [...qualifying]
    .filter((r) => !q || (r.operator_short_name || r.operator_name).toLowerCase().includes(q))
    .sort((a, b) => {
      if (sortBy === 'revenue') return b.total_revenue - a.total_revenue
      if (sortBy === 'shifts') return b.shifts - a.shifts
      if (sortBy === 'aboveNorm') return aboveNorm(b) - aboveNorm(a)
      return b.pi - a.pi
    })

  // Сводка по квалифицированным операторам (обычный расчёт — дешёво, после early-return хук нельзя)
  const summary = qualifying.length === 0 ? null : {
    avgPi: qualifying.reduce((s, r) => s + r.pi, 0) / qualifying.length,
    above: qualifying.filter((r) => r.pi >= 1.05).length,
    below: qualifying.filter((r) => r.pi < 0.95).length,
    norm: qualifying.filter((r) => r.pi >= 0.95 && r.pi < 1.05).length,
    leader: qualifying[0],
  }

  const problemSlots = computeProblemSlots(filteredRanking)

  return (
    <div className="app-page-wide space-y-6">
      {/* Header */}
      <AdminPageHeader
        title="Эффективность операторов"
        description="Performance Index = факт / ожидание. Рейтинг с поправкой на слот: точка, день недели, день/ночь."
        icon={<TrendingUp className="h-5 w-5" />}
        accent="violet"
        backHref="/"
        actions={
          <>
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-zinc-900/50 p-1 rounded-xl border border-slate-200 dark:border-white/10">
              {(Object.keys(PERIOD_PRESETS) as PeriodPreset[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                    period === p ? 'bg-slate-200 dark:bg-white/10 text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {PERIOD_PRESETS[p].label}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => load(true)}
              disabled={loading || refreshing}
              className="rounded-xl border border-slate-200 dark:border-white/10"
              title="Обновить"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
          </>
        }
        toolbar={
          <>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className="bg-slate-100 dark:bg-zinc-900/50 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-1.5 text-xs font-medium text-slate-900 dark:text-white outline-none hover:bg-slate-200 dark:hover:bg-zinc-900/70 cursor-pointer"
              >
                <option value="" className="bg-white dark:bg-zinc-900">📍 Все точки</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id} className="bg-white dark:bg-zinc-900">
                    📍 {c.name}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-zinc-900/50 p-1 rounded-xl border border-slate-200 dark:border-white/10">
                {(['all', 'day', 'night'] as ShiftFilter[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setShiftFilter(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                      shiftFilter === s ? 'bg-slate-200 dark:bg-white/10 text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {s === 'all' ? 'Все смены' : s === 'day' ? '☀️ День' : '🌙 Ночь'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 px-2.5 py-0.5 text-[11px] font-medium text-slate-700 dark:text-slate-300">
                {PERIOD_PRESETS[period].label}
              </span>
              {selectedCompany && (
                <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                  📍 {selectedCompany.name}
                </span>
              )}
              {shiftFilter !== 'all' && (
                <span className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2.5 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">
                  {shiftFilter === 'day' ? '☀️ Только дневные смены' : '🌙 Только ночные смены'}
                </span>
              )}
            </div>

            {/* Поиск · сортировка · бонус · экспорт */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск оператора…"
                  className="w-44 bg-slate-100 dark:bg-zinc-900/50 border border-slate-200 dark:border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:border-violet-400"
                />
              </div>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="bg-slate-100 dark:bg-zinc-900/50 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-1.5 text-xs font-medium text-slate-900 dark:text-white outline-none cursor-pointer"
              >
                <option value="pi" className="bg-white dark:bg-zinc-900">Сортировка: PI</option>
                <option value="aboveNorm" className="bg-white dark:bg-zinc-900">Сверх нормы ₸</option>
                <option value="revenue" className="bg-white dark:bg-zinc-900">Выручка</option>
                <option value="shifts" className="bg-white dark:bg-zinc-900">Смены</option>
              </select>
              <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-zinc-900/50 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-1.5">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Бонус</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={bonusPct || ''}
                  onChange={(e) => setBonusPct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                  placeholder="0"
                  className="w-12 bg-transparent text-xs font-semibold text-slate-900 dark:text-white outline-none text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400">% сверх нормы</span>
              </div>
              <button
                type="button"
                onClick={() => exportCsv(viewQualifying, bonusPct)}
                disabled={viewQualifying.length === 0}
                className="inline-flex items-center gap-1.5 bg-slate-100 dark:bg-zinc-900/50 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-zinc-900/70 disabled:opacity-40"
                title="Скачать CSV (Excel)"
              >
                <Download className="w-3.5 h-3.5" />Экспорт
              </button>
            </div>
          </>
        }
      />

      {error && (
        <Card className="p-4 border-rose-500/30 bg-rose-500/10 text-sm text-rose-700 dark:text-rose-300">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>{error}</div>
          </div>
        </Card>
      )}

      {/* Сводка */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <SummaryCard
            icon={<Users className="w-4 h-4" />}
            label="Средний PI команды"
            value={summary.avgPi.toFixed(2)}
            tone={summary.avgPi >= 1.05 ? 'emerald' : summary.avgPi >= 0.95 ? 'slate' : 'rose'}
            hint={`${qualifying.length} операторов в рейтинге`}
          />
          <SummaryCard
            icon={<TrendingUp className="w-4 h-4" />}
            label="Выше нормы"
            value={String(summary.above)}
            tone="emerald"
            hint="PI ≥ 1.05"
          />
          <SummaryCard
            icon={<TrendingDown className="w-4 h-4" />}
            label="Ниже нормы"
            value={String(summary.below)}
            tone={summary.below > 0 ? 'rose' : 'slate'}
            hint="PI < 0.95"
          />
          <SummaryCard
            icon={<Crown className="w-4 h-4" />}
            label="Лидер периода"
            value={summary.leader.operator_short_name || summary.leader.operator_name}
            tone="amber"
            hint={`PI ${summary.leader.pi.toFixed(2)}`}
            small
          />
        </div>
      )}

      {/* Объяснение метода — сворачиваемое (справочник, по умолчанию скрыто) */}
      <Card className="bg-white dark:bg-gray-900/40 border-slate-200 dark:border-white/8 overflow-hidden">
        <button
          type="button"
          onClick={() => setMethodOpen((v) => !v)}
          className="w-full border-b border-slate-200 dark:border-white/5 bg-blue-500/[0.04] px-5 py-3 flex items-center gap-2 text-left hover:bg-blue-500/[0.07] transition-colors"
        >
          <Info className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">Как формируется рейтинг</span>
          <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">PI = факт ÷ ожидание по слоту (точка · день недели · день/ночь)</span>
          <ChevronDown className={`ml-auto w-4 h-4 text-slate-400 transition-transform ${methodOpen ? 'rotate-180' : ''}`} />
        </button>
        {methodOpen && (
        <div className="p-5 space-y-5 text-sm">
          {/* Шаг 1 */}
          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-700 dark:text-blue-300 text-xs font-semibold">1</div>
            <div className="flex-1">
              <div className="font-semibold text-slate-900 dark:text-white mb-1">Считаем «ожидание» для каждой смены</div>
              <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
                Берём <strong className="text-slate-700 dark:text-slate-200">всю историю проекта</strong>
                {data?.baseline.from && (
                  <> с <strong className="text-slate-700 dark:text-slate-200">{data.baseline.from}</strong> ({data.config.baseline_days_actual} дн.)</>
                )}
                {' '}и для каждого слота считаем
                <strong className="text-slate-700 dark:text-slate-200"> медианную выручку</strong>. Слот — это уникальная комбинация
                «<strong className="text-emerald-700 dark:text-emerald-300">точка</strong> × <strong className="text-emerald-700 dark:text-emerald-300">день недели</strong> × <strong className="text-emerald-700 dark:text-emerald-300">день/ночь</strong>».
                Окно автоматически расширяется по мере накопления данных — мы не теряем ранние смены и точно знаем,
                сколько в среднем делается в каждый понедельник, пятницу, ночь и т.д.
              </p>
              <p className="text-slate-500 dark:text-slate-400 leading-relaxed mt-2">
                <strong className="text-amber-700 dark:text-amber-300">Важно (leave-one-out):</strong> когда мы считаем ожидание для смены оператора Х — его собственные прошлые смены <strong className="text-amber-700 dark:text-amber-300">не входят в медиану</strong>.
                Это убирает «само-смещение»: если оператор работал почти все пятничные ночи, его прошлые результаты не должны формировать его же норму. Сравниваем его только с тем что делали <strong>другие</strong> в таком же слоте.
              </p>
              <div className="mt-2 rounded-lg border border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-black/20 p-3 text-xs text-slate-500 dark:text-slate-400">
                Пример: «Arena × пятница × ночь» — за период базы было 24 таких смены. Когда считаем ожидание для Айгерим, исключаем её 6 смен → медиана из оставшихся 18 = <span className="text-slate-900 dark:text-white font-semibold">280 000 ₸</span>. Сравниваем её с этим значением.
              </div>
            </div>
          </div>

          {/* Шаг 2 */}
          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-700 dark:text-blue-300 text-xs font-semibold">2</div>
            <div className="flex-1">
              <div className="font-semibold text-slate-900 dark:text-white mb-1">Считаем PI каждой смены оператора</div>
              <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
                Для каждой смены берём фактическую выручку и делим на ожидание этого слота:
              </p>
              <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] p-3 font-mono text-sm text-emerald-700 dark:text-emerald-200">
                PI смены = факт / ожидание
              </div>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] p-3">
                  <div className="text-emerald-700 dark:text-emerald-300 font-semibold">PI = 1.20</div>
                  <div className="text-slate-500 dark:text-slate-400 mt-1">Сделал 336k вместо ожидаемых 280k. Это <strong className="text-emerald-700 dark:text-emerald-300">+20% к норме</strong>.</div>
                </div>
                <div className="rounded-lg border border-rose-500/20 bg-rose-500/[0.05] p-3">
                  <div className="text-rose-700 dark:text-rose-300 font-semibold">PI = 0.85</div>
                  <div className="text-slate-500 dark:text-slate-400 mt-1">Сделал 238k при ожидании 280k. <strong className="text-rose-700 dark:text-rose-300">−15% к норме</strong>.</div>
                </div>
              </div>
            </div>
          </div>

          {/* Шаг 3 */}
          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-700 dark:text-blue-300 text-xs font-semibold">3</div>
            <div className="flex-1">
              <div className="font-semibold text-slate-900 dark:text-white mb-1">Собираем балл — по деньгам, а не по «среднему процентов»</div>
              <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
                Балл = <strong className="text-slate-700 dark:text-slate-200">вся выручка ÷ всё ожидание</strong> по сменам (денежный вес). Большая смена весит больше маленькой — как в жизни. Это честнее простого среднего: удачная «мёртвая» смена с маленькими суммами больше не задирает балл.
              </p>
              <div className="mt-2 rounded-lg border border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-black/20 p-3 text-xs text-slate-500 dark:text-slate-400">
                <span className="text-slate-900 dark:text-white font-semibold">Айгерим:</span> Σфакт = 865к, Σожидание = 880к → балл = 865/880 = <span className="text-emerald-700 dark:text-emerald-300 font-semibold">0.98</span>. Копеечный удачный вторник почти не виден — он мал и в сумме не тянет.
              </div>
            </div>
          </div>

          {/* Цветовые метки */}
          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-700 dark:text-blue-300 text-xs font-semibold">4</div>
            <div className="flex-1">
              <div className="font-semibold text-slate-900 dark:text-white mb-2">Цветовые метки</div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-1.5 text-center">
                  <div className="text-emerald-700 dark:text-emerald-300 font-bold">≥ 1.15</div>
                  <div className="text-emerald-700 dark:text-emerald-200 text-[10px]">Превосходно</div>
                </div>
                <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1.5 text-center">
                  <div className="text-emerald-700 dark:text-emerald-300 font-bold">1.05–1.14</div>
                  <div className="text-emerald-700 dark:text-emerald-200 text-[10px]">Хорошо</div>
                </div>
                <div className="rounded-md border border-slate-500/20 bg-slate-500/10 px-2 py-1.5 text-center">
                  <div className="text-slate-700 dark:text-slate-300 font-bold">0.95–1.04</div>
                  <div className="text-slate-700 dark:text-slate-300 text-[10px]">Норма</div>
                </div>
                <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-center">
                  <div className="text-amber-700 dark:text-amber-300 font-bold">0.85–0.94</div>
                  <div className="text-amber-700 dark:text-amber-200 text-[10px]">Ниже нормы</div>
                </div>
                <div className="rounded-md border border-rose-500/20 bg-rose-500/10 px-2 py-1.5 text-center">
                  <div className="text-rose-700 dark:text-rose-300 font-bold">{'< 0.85'}</div>
                  <div className="text-rose-700 dark:text-rose-200 text-[10px]">Слабо</div>
                </div>
              </div>
            </div>
          </div>

          {/* Защиты */}
          <div className="flex gap-3 pt-2 border-t border-slate-200 dark:border-white/5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 text-xs font-semibold">!</div>
            <div className="flex-1">
              <div className="font-semibold text-slate-900 dark:text-white mb-1">Защита от случайных всплесков</div>
              <ul className="text-slate-500 dark:text-slate-400 leading-relaxed space-y-1 list-disc pl-4">
                <li>
                  <strong className="text-slate-700 dark:text-slate-200">Минимум 3 смены</strong> для попадания в основной рейтинг.
                  Меньше — оператор в секции «Накапливают данные».
                </li>
                <li>
                  <strong className="text-slate-700 dark:text-slate-200">PI ограничен от 0.5 до 2.0</strong> — лотерейный день с одним крупным заказом не возносит и не валит надолго.
                </li>
                <li>
                  Если в слоте {'<'} 3 наблюдений (редкий случай) — берём fallback: медиана по точке-смене, потом по точке, потом глобально.
                </li>
                <li>
                  <strong className="text-slate-700 dark:text-slate-200">Сравнение справедливое</strong> — пятница сравнивается с пятницей, ночь с ночью, Arena с Arena. Не зависит от того сколько смен у оператора.
                </li>
              </ul>
            </div>
          </div>

          {/* Stats */}
          {data?.baseline && (
            <div className="rounded-xl border border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-white/[0.02] p-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
              <span><strong className="text-slate-700 dark:text-slate-300">База расчёта:</strong> {data.baseline.shifts_count} смен в {data.baseline.slots_count} уникальных слотах</span>
              <span><strong className="text-slate-700 dark:text-slate-300">Период базы:</strong> {data.baseline.from} — {data.baseline.to}</span>
              <span><strong className="text-slate-700 dark:text-slate-300">Медиана глобально:</strong> {moneyShort(data.baseline.global_median)}</span>
            </div>
          )}
        </div>
        )}
      </Card>

      {/* Основной рейтинг */}
      <Card className="p-5 bg-white dark:bg-gray-900/40 backdrop-blur-xl border-slate-200 dark:border-white/5">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Award className="w-4 h-4 text-emerald-400" />
            Основной рейтинг ({q ? `${viewQualifying.length} из ${qualifying.length}` : qualifying.length})
          </h3>
          {refreshing && <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-500 dark:text-slate-400" />}
        </div>

        {loading && !data ? (
          <div className="flex items-center justify-center py-16 gap-2 text-slate-500">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span className="text-sm">Считаем рейтинг…</span>
          </div>
        ) : viewQualifying.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-sm">
            {qualifying.length === 0
              ? `Нет операторов с ${data?.config.min_qualifying_shifts || 3}+ сменами за этот период.`
              : 'Никто не найден по поиску.'}
          </div>
        ) : (
          <div className="space-y-2">
            {viewQualifying.map((op, i) => {
              const c = piColor(op.pi)
              const above = aboveNorm(op)
              const isCandidate = op.pi >= candidateThreshold
              const bonus = bonusPct > 0 ? Math.max(0, above) * bonusPct / 100 : 0
              return (
                <button
                  key={op.operator_id}
                  type="button"
                  onClick={() => setSelected(op)}
                  className={`w-full text-left rounded-xl border p-4 transition hover:bg-slate-100 dark:hover:bg-gray-900/80 ${
                    isCandidate
                      ? 'border-emerald-400/50 bg-emerald-500/[0.04] dark:bg-emerald-500/[0.06] ring-1 ring-emerald-400/30'
                      : 'border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-gray-900/60 hover:border-emerald-400/30'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center">
                      {sortBy === 'pi' && !q ? rankBadge(i + 1) : <span className="text-xs font-mono text-slate-500 dark:text-slate-400">#{i + 1}</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900 dark:text-white">{op.operator_short_name || op.operator_name}</span>
                        {isCandidate && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                            <Gift className="w-3 h-3" />кандидат
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-3 flex-wrap">
                        <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{op.shifts} смен</span>
                        <span className="inline-flex items-center gap-1"><TrendingUp className="w-3 h-3" />{moneyShort(op.total_revenue)}</span>
                        <span className="text-slate-400 dark:text-slate-500">норма {moneyShort(expectedTotal(op))}</span>
                        <span className={`font-semibold ${above >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {above >= 0 ? '+' : ''}{moneyShort(above)} к норме
                        </span>
                        {bonus > 0 && (
                          <span className="inline-flex items-center gap-1 font-semibold text-amber-600 dark:text-amber-400">
                            <Gift className="w-3 h-3" />бонус {moneyFmt(bonus)}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 max-w-[260px]"><PiBar pi={op.pi} /></div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className={`text-2xl font-bold ${c.text} tabular-nums`}>{op.pi.toFixed(2)}</div>
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="text-[10px] text-slate-500 uppercase tracking-wide">PI</span>
                          <DeltaBadge pi={op.pi} prev={prevPi[op.operator_id]} />
                        </div>
                      </div>
                      <div className={`rounded-md border ${c.border} ${c.bg} px-2 py-1 text-[11px] font-medium ${c.text} whitespace-nowrap`}>
                        {c.label}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </Card>

      {/* Cold start */}
      {coldStart.length > 0 && (
        <Card className="p-5 bg-white dark:bg-gray-900/40 backdrop-blur-xl border-slate-200 dark:border-white/5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400" />
            Накапливают данные ({coldStart.length})
            <span className="text-xs font-normal text-slate-500">— меньше {data?.config.min_qualifying_shifts || 3} смен</span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {coldStart.map((op) => (
              <button
                key={op.operator_id}
                type="button"
                onClick={() => setSelected(op)}
                className="text-left rounded-xl border border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-gray-900/40 px-3 py-2.5 transition hover:border-slate-300 dark:hover:border-white/15"
              >
                <div className="font-medium text-slate-700 dark:text-slate-200 text-sm truncate">{op.operator_short_name || op.operator_name}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {op.shifts}/{data?.config.min_qualifying_shifts || 3} смен · {moneyShort(op.total_revenue)}
                </div>
                <div className="mt-1.5 h-1 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-amber-400 dark:bg-amber-500"
                    style={{ width: `${Math.min(100, (op.shifts / (data?.config.min_qualifying_shifts || 3)) * 100)}%` }}
                  />
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Проблемные слоты — где факт систематически ниже нормы (сигнал владельцу) */}
      {problemSlots.length > 0 && (
        <Card className="p-5 bg-white dark:bg-gray-900/40 backdrop-blur-xl border-slate-200 dark:border-white/5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-rose-400" />
            Проблемные слоты ({problemSlots.length})
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Где факт ниже нормы за период — смотреть расписание/процесс, а не одного человека.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {problemSlots.map((s) => {
              const pct = Math.round((s.ratio - 1) * 100)
              return (
                <div key={s.key} className="rounded-xl border border-rose-500/20 bg-rose-500/[0.04] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-slate-900 dark:text-white truncate">
                      {companyName(s.company)} · {WEEKDAY_NAMES[s.weekday]} · {s.shift === 'night' ? '🌙 ночь' : '☀️ день'}
                    </div>
                    <span className="text-sm font-bold text-rose-600 dark:text-rose-400 tabular-nums shrink-0">{pct}%</span>
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    факт {moneyShort(s.actual)} / норма {moneyShort(s.expected)} · {s.count} смен
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {selected && (
        <OperatorDetailModal
          item={selected}
          onClose={() => setSelected(null)}
          periodLabel={PERIOD_PRESETS[period].label}
          bonusPct={bonusPct}
        />
      )}
    </div>
  )
}

function OperatorDetailModal({
  item,
  onClose,
  periodLabel,
  bonusPct,
}: {
  item: RankingItem
  onClose: () => void
  periodLabel: string
  bonusPct: number
}) {
  useModalEscape(true, onClose)
  if (typeof document === 'undefined') return null

  const sortedShifts = [...item.shift_details].sort((a, b) => b.date.localeCompare(a.date))
  const c = piColor(item.pi)
  const above = aboveNorm(item)
  const bonus = bonusPct > 0 ? Math.max(0, above) * bonusPct / 100 : 0
  // Недельный тренд PI (денежный вес внутри недели) — личная динамика за период.
  const weekMap = new Map<string, { exp: number; piExp: number }>()
  for (const sh of item.shift_details) {
    const k = weekKey(sh.date)
    const w = weekMap.get(k) || { exp: 0, piExp: 0 }
    w.exp += sh.expected
    w.piExp += sh.pi * sh.expected
    weekMap.set(k, w)
  }
  const weeklyPi = [...weekMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, w]) => (w.exp > 0 ? w.piExp / w.exp : 1))

  return createPortal(
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-900 border border-slate-200 dark:border-white/10 rounded-2xl w-full max-w-3xl my-8 animate-in fade-in zoom-in duration-200"
      >
        {/* Header */}
        <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-slate-200 dark:border-white/5 rounded-t-2xl z-10 p-5">
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold text-slate-900 dark:text-white truncate">
                {item.operator_short_name || item.operator_name}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 mt-1">
                <Calendar className="h-3.5 w-3.5" />
                {periodLabel}
              </div>
            </div>
            <div className="text-right">
              <div className={`text-3xl font-bold ${c.text} tabular-nums`}>{item.pi.toFixed(2)}</div>
              <div className={`text-[10px] uppercase tracking-wide ${c.text}`}>{c.label}</div>
            </div>
            <button
              onClick={onClose}
              type="button"
              className="rounded-lg p-2 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white"
              aria-label="Закрыть"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Выручка" value={moneyShort(item.total_revenue)} />
            <Stat label="Норма за период" value={moneyShort(expectedTotal(item))} />
            <Stat label={above >= 0 ? 'Сверх нормы' : 'Ниже нормы'} value={`${above >= 0 ? '+' : ''}${moneyShort(above)}`} />
            <Stat label={bonus > 0 ? `Бонус (${bonusPct}%)` : 'Смен'} value={bonus > 0 ? moneyFmt(bonus) : String(item.shifts)} />
          </div>
          {weeklyPi.length >= 2 && (
            <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
              <span>PI по неделям</span>
              <PiSparkline values={weeklyPi} />
            </div>
          )}
        </div>

        {/* Shift table */}
        <div className="p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h4 className="text-xs uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400 font-semibold">
              Разбор по сменам
            </h4>
            {item.shift_details.length >= 2 && (
              <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                <span>динамика PI</span>
                <PiSparkline values={[...item.shift_details].sort((a, b) => a.date.localeCompare(b.date)).map((s) => s.pi)} />
              </div>
            )}
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-white/8">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-white/[0.03] text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <th className="px-3 py-2 text-left font-medium">Дата</th>
                  <th className="px-3 py-2 text-left font-medium">Смена</th>
                  <th className="px-3 py-2 text-right font-medium">Ожидалось</th>
                  <th className="px-3 py-2 text-right font-medium">Сделано</th>
                  <th className="px-3 py-2 text-right font-medium">PI</th>
                </tr>
              </thead>
              <tbody>
                {sortedShifts.map((sh, idx) => {
                  const piC = piColor(sh.pi)
                  const diff = sh.actual - sh.expected
                  // Аномалия: PI упёрся в потолок/пол (экстремальное отклонение от нормы) — проверить.
                  const anomaly = sh.pi >= 1.99 || sh.pi <= 0.51
                  return (
                    <tr key={idx} className="border-b border-slate-100 dark:border-white/5 last:border-0 hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {anomaly && <Zap className="inline w-3 h-3 mr-1 text-amber-500" />}{sh.date}
                      </td>
                      <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                        {sh.shift === 'night' ? '🌙 ночь' : '☀️ день'}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-500 dark:text-slate-400 tabular-nums">{moneyShort(sh.expected)}</td>
                      <td className="px-3 py-2 text-right text-slate-900 dark:text-white tabular-nums">
                        {moneyShort(sh.actual)}
                        <span className={`ml-2 text-[10px] ${diff >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {diff >= 0 ? <TrendingUp className="inline w-3 h-3" /> : <TrendingDown className="inline w-3 h-3" />}
                          {diff >= 0 ? '+' : ''}{moneyShort(diff)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className={`inline-block rounded-md ${piC.bg} ${piC.text} px-2 py-0.5 text-xs font-semibold tabular-nums`}>
                          {sh.pi.toFixed(2)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white dark:bg-gray-900 border-t border-slate-200 dark:border-white/5 rounded-b-2xl p-4 flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose} className="border-slate-200 dark:border-white/10">
            Закрыть
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{value}</div>
    </div>
  )
}

const SUMMARY_TONE: Record<'emerald' | 'rose' | 'amber' | 'slate', { icon: string; val: string }> = {
  emerald: { icon: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300', val: 'text-emerald-700 dark:text-emerald-300' },
  rose: { icon: 'bg-rose-500/15 text-rose-600 dark:text-rose-300', val: 'text-rose-700 dark:text-rose-300' },
  amber: { icon: 'bg-amber-500/15 text-amber-600 dark:text-amber-300', val: 'text-amber-700 dark:text-amber-300' },
  slate: { icon: 'bg-slate-500/15 text-slate-600 dark:text-slate-300', val: 'text-slate-900 dark:text-white' },
}

function SummaryCard({
  icon, label, value, hint, tone, small,
}: { icon: React.ReactNode; label: string; value: string; hint: string; tone: 'emerald' | 'rose' | 'amber' | 'slate'; small?: boolean }) {
  const t = SUMMARY_TONE[tone]
  return (
    <Card className="p-4 bg-white dark:bg-gray-900/40 border-slate-200 dark:border-white/8">
      <div className="flex items-center gap-2">
        <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${t.icon}`}>{icon}</div>
        <div className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 leading-tight">{label}</div>
      </div>
      <div className={`mt-2 font-bold tabular-nums ${t.val} ${small ? 'text-base truncate' : 'text-2xl'}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{hint}</div>
    </Card>
  )
}
