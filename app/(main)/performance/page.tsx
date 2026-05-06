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
  const [data, setData] = useState<ApiResponse['data'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<RankingItem | null>(null)

  const range = useMemo(() => PERIOD_PRESETS[period].getRange(), [period])

  const load = async (silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ from: range.from, to: range.to })
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
  }, [period])

  if (!isClient) return null

  const qualifying = (data?.ranking || []).filter((r) => r.qualifying)
  const coldStart = (data?.ranking || []).filter((r) => !r.qualifying)

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
            <p className="text-sm text-slate-400 max-w-2xl">
              Performance Index = факт / ожидание. Учитывается контекст каждой смены: точка, день недели, день/ночь.
              Сравнение с медианой такого же слота за прошлые 90 дней. Минимум {data?.config.min_qualifying_shifts || 3} смен для попадания в основной рейтинг.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
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
      <Card className="p-5 bg-blue-500/5 border-blue-500/15 text-sm text-slate-300">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="text-blue-300 font-semibold">Как считается</div>
            <div className="text-slate-400">
              Каждой смене мы подбираем «ожидание» — медианная выручка такой же смены (точка × день недели × день/ночь) за прошлые 90 дней.
              <strong className="text-white"> PI = факт / ожидание</strong>.
              PI = 1.10 значит «оператор делает на 10% больше нормы для своих слотов».
              Среднее PI по всем сменам оператора и есть его балл.
              {data?.baseline && (
                <span className="text-slate-500">
                  {' '}База: {data.baseline.shifts_count} смен в {data.baseline.slots_count} слотах · медиана глобально {moneyShort(data.baseline.global_median)}.
                </span>
              )}
            </div>
          </div>
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
