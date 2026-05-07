'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertCircle,
  Award,
  Calendar,
  Clock,
  Crown,
  Info,
  Medal,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Trophy,
  X,
} from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
    config: { baseline_days: number; min_qualifying_shifts: number; pi_clip: [number, number] }
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

function moneyFmt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU') + ' ₸'
}

function moneyShort(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' млн ₸'
  if (Math.abs(n) >= 1_000) return Math.round(n / 1_000) + ' тыс ₸'
  return Math.round(n).toLocaleString('ru-RU') + ' ₸'
}

function piColor(pi: number): { text: string; bg: string; border: string; label: string } {
  if (pi >= 1.15) return { text: 'text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-500/30', label: 'Превосходно' }
  if (pi >= 1.05) return { text: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', label: 'Хорошо' }
  if (pi >= 0.95) return { text: 'text-slate-300', bg: 'bg-slate-500/10', border: 'border-slate-500/20', label: 'Норма' }
  if (pi >= 0.85) return { text: 'text-amber-300', bg: 'bg-amber-500/10', border: 'border-amber-500/20', label: 'Ниже нормы' }
  return { text: 'text-rose-300', bg: 'bg-rose-500/10', border: 'border-rose-500/20', label: 'Слабо' }
}

function rankBadge(rank: number) {
  if (rank === 1) return <Crown className="w-5 h-5 text-amber-300" />
  if (rank === 2) return <Trophy className="w-5 h-5 text-slate-300" />
  if (rank === 3) return <Medal className="w-5 h-5 text-orange-300" />
  return <span className="text-xs font-mono text-slate-400">#{rank}</span>
}

export default function PerformancePage() {
  const [isClient, setIsClient] = useState(false)
  useEffect(() => setIsClient(true), [])

  const [period, setPeriod] = useState<PeriodPreset>('thisMonth')
  const [companyId, setCompanyId] = useState<string>('')   // '' = все точки
  const [shiftFilter, setShiftFilter] = useState<ShiftFilter>('all')
  const [companies, setCompanies] = useState<Company[]>([])
  const [data, setData] = useState<ApiResponse['data'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<RankingItem | null>(null)

  const range = useMemo(() => PERIOD_PRESETS[period].getRange(), [period])

  // Загружаем список точек один раз
  useEffect(() => {
    fetch('/api/admin/companies', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => setCompanies(j.data || []))
      .catch(() => {})
  }, [])

  const load = async (silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to })
      if (companyId) params.set('company_id', companyId)
      const res = await fetch(`/api/admin/performance/ranking?${params}`, { cache: 'no-store' })
      const body = (await res.json()) as ApiResponse | { error: string }
      if (!res.ok) throw new Error(('error' in body && body.error) || 'Не удалось загрузить рейтинг')
      setData((body as ApiResponse).data)
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
      setRefreshing(false)
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
        const piAvg = matched.reduce((sum, s) => sum + s.pi, 0) / matched.length
        return {
          ...op,
          shifts: matched.length,
          total_revenue: totalRev,
          avg_revenue_per_shift: matched.length > 0 ? totalRev / matched.length : 0,
          pi: Number(piAvg.toFixed(3)),
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

  return (
    <div className="app-page-wide space-y-6">
      {/* Header */}
      <Card className="relative overflow-hidden border-white/10 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.18),transparent_42%),linear-gradient(135deg,rgba(13,22,38,0.85),rgba(13,22,38,0.55))] p-6 lg:p-8 shadow-[0_24px_70px_rgba(0,0,0,0.32)]">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-200">
              Справедливый рейтинг
            </div>
            <h1 className="font-display text-3xl font-bold tracking-[-0.02em] text-white flex items-center gap-3 lg:text-4xl">
              <Trophy className="w-8 h-8 text-emerald-400" />
              Эффективность операторов
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-medium text-slate-300">
                {PERIOD_PRESETS[period].label}
              </span>
              {selectedCompany && (
                <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
                  📍 {selectedCompany.name}
                </span>
              )}
              {shiftFilter !== 'all' && (
                <span className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2.5 py-0.5 text-[11px] font-medium text-violet-300">
                  {shiftFilter === 'day' ? '☀️ Только дневные смены' : '🌙 Только ночные смены'}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-400 max-w-2xl">
              Performance Index = факт / ожидание. Учитывается контекст каждой смены: точка, день недели, день/ночь.
              Сравнение с медианой такого же слота за прошлые 180 дней — <strong className="text-slate-200">без собственных смен оператора</strong> (leave-one-out).
              Минимум {data?.config.min_qualifying_shifts || 3} смен для попадания в основной рейтинг.
            </p>
          </div>

          <div className="flex flex-col items-stretch gap-2 lg:items-end">
            <div className="flex flex-wrap items-center gap-2 justify-end">
              {/* Период */}
              <div className="flex items-center gap-1 bg-zinc-900/50 p-1 rounded-xl border border-white/10">
                {(Object.keys(PERIOD_PRESETS) as PeriodPreset[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPeriod(p)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                      period === p ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'
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
                className="rounded-xl border border-white/10"
                title="Обновить"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
              </Button>
            </div>

            {/* Точка + Тип смены */}
            <div className="flex flex-wrap items-center gap-2 justify-end">
              <select
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                className="bg-zinc-900/50 border border-white/10 rounded-xl px-3 py-1.5 text-xs font-medium text-white outline-none hover:bg-zinc-900/70 cursor-pointer"
              >
                <option value="" className="bg-zinc-900">📍 Все точки</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id} className="bg-zinc-900">
                    📍 {c.name}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1 bg-zinc-900/50 p-1 rounded-xl border border-white/10">
                {(['all', 'day', 'night'] as ShiftFilter[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setShiftFilter(s)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                      shiftFilter === s ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {s === 'all' ? 'Все смены' : s === 'day' ? '☀️ День' : '🌙 Ночь'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {error && (
        <Card className="p-4 border-rose-500/30 bg-rose-500/10 text-sm text-rose-300">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>{error}</div>
          </div>
        </Card>
      )}

      {/* Объяснение метода */}
      <Card className="bg-gray-900/40 border-white/8 overflow-hidden">
        <div className="border-b border-white/5 bg-blue-500/[0.04] px-5 py-3 flex items-center gap-2">
          <Info className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-semibold text-blue-300">Как формируется рейтинг</span>
        </div>
        <div className="p-5 space-y-5 text-sm">
          {/* Шаг 1 */}
          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-300 text-xs font-semibold">1</div>
            <div className="flex-1">
              <div className="font-semibold text-white mb-1">Считаем «ожидание» для каждой смены</div>
              <p className="text-slate-400 leading-relaxed">
                Берём прошлые <strong className="text-slate-200">180 дней</strong> и для каждого слота считаем
                <strong className="text-slate-200"> медианную выручку</strong>. Слот — это уникальная комбинация
                «<strong className="text-emerald-300">точка</strong> × <strong className="text-emerald-300">день недели</strong> × <strong className="text-emerald-300">день/ночь</strong>».
              </p>
              <p className="text-slate-400 leading-relaxed mt-2">
                <strong className="text-amber-300">Важно (leave-one-out):</strong> когда мы считаем ожидание для смены оператора Х — его собственные прошлые смены <strong className="text-amber-300">не входят в медиану</strong>.
                Это убирает «само-смещение»: если оператор работал почти все пятничные ночи, его прошлые результаты не должны формировать его же норму. Сравниваем его только с тем что делали <strong>другие</strong> в таком же слоте.
              </p>
              <div className="mt-2 rounded-lg border border-white/8 bg-black/20 p-3 text-xs text-slate-400">
                Пример: «Arena × пятница × ночь» — за последние 180 дней было 24 таких смены. Когда считаем ожидание для Айгерим, исключаем её 6 смен → медиана из оставшихся 18 = <span className="text-white font-semibold">280 000 ₸</span>. Сравниваем её с этим значением.
              </div>
            </div>
          </div>

          {/* Шаг 2 */}
          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-300 text-xs font-semibold">2</div>
            <div className="flex-1">
              <div className="font-semibold text-white mb-1">Считаем PI каждой смены оператора</div>
              <p className="text-slate-400 leading-relaxed">
                Для каждой смены берём фактическую выручку и делим на ожидание этого слота:
              </p>
              <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] p-3 font-mono text-sm text-emerald-200">
                PI смены = факт / ожидание
              </div>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] p-3">
                  <div className="text-emerald-300 font-semibold">PI = 1.20</div>
                  <div className="text-slate-400 mt-1">Сделал 336k вместо ожидаемых 280k. Это <strong className="text-emerald-300">+20% к норме</strong>.</div>
                </div>
                <div className="rounded-lg border border-rose-500/20 bg-rose-500/[0.05] p-3">
                  <div className="text-rose-300 font-semibold">PI = 0.85</div>
                  <div className="text-slate-400 mt-1">Сделал 238k при ожидании 280k. <strong className="text-rose-300">−15% к норме</strong>.</div>
                </div>
              </div>
            </div>
          </div>

          {/* Шаг 3 */}
          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-300 text-xs font-semibold">3</div>
            <div className="flex-1">
              <div className="font-semibold text-white mb-1">Берём среднее PI по всем сменам — это балл оператора</div>
              <p className="text-slate-400 leading-relaxed">
                У оператора 8 смен за месяц → 8 PI. Их среднее и есть его рейтинговый балл.
              </p>
              <div className="mt-2 rounded-lg border border-white/8 bg-black/20 p-3 text-xs text-slate-400">
                <span className="text-white font-semibold">Айгерим:</span> 8 смен. PI = [1.05, 1.18, 0.92, 1.30, 1.12, 0.95, 1.20, 1.08]. Среднее = <span className="text-emerald-300 font-semibold">1.10</span> — на <strong>10% выше нормы</strong> в среднем по всем своим сменам.
              </div>
            </div>
          </div>

          {/* Цветовые метки */}
          <div className="flex gap-3">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-300 text-xs font-semibold">4</div>
            <div className="flex-1">
              <div className="font-semibold text-white mb-2">Цветовые метки</div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/15 px-2 py-1.5 text-center">
                  <div className="text-emerald-300 font-bold">≥ 1.15</div>
                  <div className="text-emerald-200 text-[10px]">Превосходно</div>
                </div>
                <div className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1.5 text-center">
                  <div className="text-emerald-300 font-bold">1.05–1.14</div>
                  <div className="text-emerald-200 text-[10px]">Хорошо</div>
                </div>
                <div className="rounded-md border border-slate-500/20 bg-slate-500/10 px-2 py-1.5 text-center">
                  <div className="text-slate-300 font-bold">0.95–1.04</div>
                  <div className="text-slate-300 text-[10px]">Норма</div>
                </div>
                <div className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-center">
                  <div className="text-amber-300 font-bold">0.85–0.94</div>
                  <div className="text-amber-200 text-[10px]">Ниже нормы</div>
                </div>
                <div className="rounded-md border border-rose-500/20 bg-rose-500/10 px-2 py-1.5 text-center">
                  <div className="text-rose-300 font-bold">{'< 0.85'}</div>
                  <div className="text-rose-200 text-[10px]">Слабо</div>
                </div>
              </div>
            </div>
          </div>

          {/* Защиты */}
          <div className="flex gap-3 pt-2 border-t border-white/5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-300 text-xs font-semibold">!</div>
            <div className="flex-1">
              <div className="font-semibold text-white mb-1">Защита от случайных всплесков</div>
              <ul className="text-slate-400 leading-relaxed space-y-1 list-disc pl-4">
                <li>
                  <strong className="text-slate-200">Минимум 3 смены</strong> для попадания в основной рейтинг.
                  Меньше — оператор в секции «Накапливают данные».
                </li>
                <li>
                  <strong className="text-slate-200">PI ограничен от 0.5 до 2.0</strong> — лотерейный день с одним крупным заказом не возносит и не валит надолго.
                </li>
                <li>
                  Если в слоте {'<'} 3 наблюдений (редкий случай) — берём fallback: медиана по точке-смене, потом по точке, потом глобально.
                </li>
                <li>
                  <strong className="text-slate-200">Сравнение справедливое</strong> — пятница сравнивается с пятницей, ночь с ночью, Arena с Arena. Не зависит от того сколько смен у оператора.
                </li>
              </ul>
            </div>
          </div>

          {/* Stats */}
          {data?.baseline && (
            <div className="rounded-xl border border-white/8 bg-white/[0.02] p-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-500">
              <span><strong className="text-slate-300">База расчёта:</strong> {data.baseline.shifts_count} смен в {data.baseline.slots_count} уникальных слотах</span>
              <span><strong className="text-slate-300">Период базы:</strong> {data.baseline.from} — {data.baseline.to}</span>
              <span><strong className="text-slate-300">Медиана глобально:</strong> {moneyShort(data.baseline.global_median)}</span>
            </div>
          )}
        </div>
      </Card>

      {/* Основной рейтинг */}
      <Card className="p-5 bg-gray-900/40 backdrop-blur-xl border-white/5">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <Award className="w-4 h-4 text-emerald-400" />
            Основной рейтинг ({qualifying.length})
          </h3>
          {refreshing && <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" />}
        </div>

        {loading && !data ? (
          <div className="flex items-center justify-center py-16 gap-2 text-slate-500">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span className="text-sm">Считаем рейтинг…</span>
          </div>
        ) : qualifying.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-sm">
            Нет операторов с {data?.config.min_qualifying_shifts || 3}+ сменами за этот период.
          </div>
        ) : (
          <div className="space-y-2">
            {qualifying.map((op, i) => {
              const c = piColor(op.pi)
              return (
                <button
                  key={op.operator_id}
                  type="button"
                  onClick={() => setSelected(op)}
                  className="w-full text-left rounded-xl border border-white/10 bg-gray-900/60 p-4 transition hover:border-emerald-400/30 hover:bg-gray-900/80"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center">
                      {rankBadge(i + 1)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-white">{op.operator_short_name || op.operator_name}</div>
                      <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-3">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {op.shifts} смен
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <TrendingUp className="w-3 h-3" />
                          {moneyShort(op.total_revenue)}
                        </span>
                        <span>{moneyShort(op.avg_revenue_per_shift)} / смена</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className={`text-2xl font-bold ${c.text} tabular-nums`}>{op.pi.toFixed(2)}</div>
                        <div className="text-[10px] text-slate-500 uppercase tracking-wide">PI</div>
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
        <Card className="p-5 bg-gray-900/40 backdrop-blur-xl border-white/5">
          <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
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
                className="text-left rounded-xl border border-white/8 bg-gray-900/40 px-3 py-2.5 transition hover:border-white/15"
              >
                <div className="font-medium text-slate-200 text-sm truncate">{op.operator_short_name || op.operator_name}</div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {op.shifts} смен · {moneyShort(op.total_revenue)}
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {selected && (
        <OperatorDetailModal
          item={selected}
          onClose={() => setSelected(null)}
          periodLabel={PERIOD_PRESETS[period].label}
        />
      )}
    </div>
  )
}

function OperatorDetailModal({
  item,
  onClose,
  periodLabel,
}: {
  item: RankingItem
  onClose: () => void
  periodLabel: string
}) {
  useModalEscape(true, onClose)
  if (typeof document === 'undefined') return null

  const sortedShifts = [...item.shift_details].sort((a, b) => b.date.localeCompare(a.date))
  const c = piColor(item.pi)

  return createPortal(
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-900 border border-white/10 rounded-2xl w-full max-w-3xl my-8 animate-in fade-in zoom-in duration-200"
      >
        {/* Header */}
        <div className="sticky top-0 bg-gray-900 border-b border-white/5 rounded-t-2xl z-10 p-5">
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold text-white truncate">
                {item.operator_short_name || item.operator_name}
              </div>
              <div className="text-xs text-slate-400 flex items-center gap-2 mt-1">
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
              className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-white"
              aria-label="Закрыть"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Смен" value={String(item.shifts)} />
            <Stat label="Выручка" value={moneyShort(item.total_revenue)} />
            <Stat label="Средняя за смену" value={moneyShort(item.avg_revenue_per_shift)} />
            <Stat label="PI" value={item.pi.toFixed(2)} />
          </div>
        </div>

        {/* Shift table */}
        <div className="p-5">
          <h4 className="text-xs uppercase tracking-[0.14em] text-slate-400 font-semibold mb-3">
            Разбор по сменам
          </h4>
          <div className="overflow-hidden rounded-xl border border-white/8">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/8 bg-white/[0.03] text-[11px] uppercase tracking-wide text-slate-400">
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
                  return (
                    <tr key={idx} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                      <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{sh.date}</td>
                      <td className="px-3 py-2 text-slate-400">
                        {sh.shift === 'night' ? '🌙 ночь' : '☀️ день'}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-400 tabular-nums">{moneyShort(sh.expected)}</td>
                      <td className="px-3 py-2 text-right text-white tabular-nums">
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

        <div className="sticky bottom-0 bg-gray-900 border-t border-white/5 rounded-b-2xl p-4 flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose} className="border-white/10">
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
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  )
}
