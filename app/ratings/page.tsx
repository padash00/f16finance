'use client'

import { useMemo, useState } from 'react'

import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { useIncome } from '@/hooks/use-income'
import { useOperators } from '@/hooks/use-operators'
import { CalendarDays, Loader2, Medal, TrendingUp, Trophy, Users2 } from 'lucide-react'

// ================== HELPERS ==================
const toISODateLocal = (d: Date) => {
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}
const todayISO = () => toISODateLocal(new Date())
const addDaysISO = (iso: string, diff: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1)
  dt.setDate(dt.getDate() + diff)
  return toISODateLocal(dt)
}
const fmtMoney = (v: number) => {
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return (v / 1_000_000).toFixed(1) + ' млн ₸'
  if (abs >= 1_000) return (v / 1_000).toFixed(0) + ' тыс ₸'
  return v.toLocaleString('ru-RU') + ' ₸'
}

// ================== MEDAL ==================
function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-xl">🥇</span>
  if (rank === 2) return <span className="text-xl">🥈</span>
  if (rank === 3) return <span className="text-xl">🥉</span>
  return <span className="w-6 h-6 flex items-center justify-center rounded-full bg-gray-800 text-xs text-gray-400 font-bold">{rank}</span>
}

// ================== PAGE ==================
export default function RatingsPage() {
  const [dateFrom, setDateFrom] = useState(() => addDaysISO(todayISO(), -29))
  const [dateTo, setDateTo] = useState(() => todayISO())

  const { operators, loading: operatorsLoading } = useOperators({ activeOnly: false })
  const { rows: incomeRows, loading: incomeLoading } = useIncome({ from: dateFrom, to: dateTo })

  const loading = operatorsLoading || incomeLoading

  const operatorMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const op of operators) {
      const displayName =
        op.operator_profiles?.[0]?.full_name || op.name || op.short_name || op.id
      map.set(op.id, displayName)
    }
    return map
  }, [operators])

  const leaderboard = useMemo(() => {
    const stats = new Map<string, { revenue: number; shifts: number; days: Set<string> }>()

    for (const row of incomeRows) {
      if (!row.operator_id) continue
      const total =
        (row.cash_amount || 0) +
        (row.kaspi_amount || 0) +
        (row.online_amount || 0) +
        (row.card_amount || 0)
      if (!total) continue

      const existing = stats.get(row.operator_id) ?? { revenue: 0, shifts: 0, days: new Set<string>() }
      existing.revenue += total
      existing.shifts += 1
      existing.days.add(row.date)
      stats.set(row.operator_id, existing)
    }

    return Array.from(stats.entries())
      .map(([operatorId, s]) => ({
        operatorId,
        name: operatorMap.get(operatorId) || `Оператор ${operatorId.slice(0, 6)}`,
        revenue: s.revenue,
        shifts: s.shifts,
        days: s.days.size,
        avgCheck: s.shifts > 0 ? s.revenue / s.shifts : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [incomeRows, operatorMap])

  const totalRevenue = useMemo(() => leaderboard.reduce((s, r) => s + r.revenue, 0), [leaderboard])

  return (
    <div className="app-shell-layout bg-gradient-to-br from-gray-900 to-gray-950 text-foreground">
      <Sidebar />
      <main className="app-main">
        <div className="app-page max-w-5xl space-y-6">

          {/* Header */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-900/30 via-gray-900 to-orange-900/30 p-6 border border-amber-500/20">
            <div className="absolute top-0 right-0 w-64 h-64 bg-amber-600 rounded-full blur-3xl opacity-10 pointer-events-none" />
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 relative z-10">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-amber-500/20 rounded-xl">
                  <Trophy className="w-8 h-8 text-amber-400" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                    Рейтинг операторов
                  </h1>
                  <p className="text-sm text-gray-400">Лидерборд по выручке, сменам и среднему чеку</p>
                </div>
              </div>

              <div className="flex items-center gap-2 px-3 py-2 bg-gray-800/50 rounded-xl border border-gray-700">
                <CalendarDays className="w-4 h-4 text-amber-400 shrink-0" />
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="bg-transparent text-sm text-gray-200 outline-none w-[120px]"
                />
                <span className="text-gray-500">—</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="bg-transparent text-sm text-gray-200 outline-none w-[120px]"
                />
              </div>
            </div>
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Card className="p-4 bg-gray-900/80 border-amber-500/20">
              <div className="flex items-center gap-2 mb-2">
                <Users2 className="w-4 h-4 text-amber-400" />
                <p className="text-xs text-gray-400">Операторов в рейтинге</p>
              </div>
              <p className="text-xl font-bold text-amber-400">{leaderboard.length}</p>
            </Card>
            <Card className="p-4 bg-gray-900/80 border-emerald-500/20">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <p className="text-xs text-gray-400">Суммарная выручка</p>
              </div>
              <p className="text-xl font-bold text-emerald-400">{fmtMoney(totalRevenue)}</p>
            </Card>
            <Card className="p-4 bg-gray-900/80 border-blue-500/20 col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 mb-2">
                <Medal className="w-4 h-4 text-blue-400" />
                <p className="text-xs text-gray-400">Лидер периода</p>
              </div>
              <p className="text-xl font-bold text-white truncate">{leaderboard[0]?.name || '—'}</p>
              {leaderboard[0] && (
                <p className="text-xs text-emerald-400 mt-1">{fmtMoney(leaderboard[0].revenue)}</p>
              )}
            </Card>
          </div>

          {/* Leaderboard */}
          <Card className="p-5 bg-gray-900/80 border-gray-800">
            <h2 className="text-sm font-semibold text-white mb-4">Таблица лидеров</h2>

            {loading ? (
              <div className="flex items-center justify-center h-32 gap-2 text-gray-500">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Загружаю данные...</span>
              </div>
            ) : leaderboard.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-gray-600">
                <Trophy className="w-8 h-8 opacity-30" />
                <p className="text-sm">Нет данных за выбранный период</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 border-b border-gray-800 text-xs uppercase tracking-wide">
                      <th className="text-left py-2 pr-3 font-medium w-10">#</th>
                      <th className="text-left py-2 pr-4 font-medium">Оператор</th>
                      <th className="text-right py-2 pr-4 font-medium">Выручка</th>
                      <th className="text-right py-2 pr-4 font-medium">Смены</th>
                      <th className="text-right py-2 pr-4 font-medium">Рабочих дней</th>
                      <th className="text-right py-2 font-medium">Средний чек</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((row, index) => {
                      const rank = index + 1
                      const sharePercent = totalRevenue > 0 ? (row.revenue / totalRevenue) * 100 : 0
                      return (
                        <tr
                          key={row.operatorId}
                          className={`border-b border-gray-800/40 hover:bg-gray-800/20 transition-colors ${rank <= 3 ? 'bg-amber-500/3' : ''}`}
                        >
                          <td className="py-3 pr-3">
                            <RankBadge rank={rank} />
                          </td>
                          <td className="py-3 pr-4">
                            <div>
                              <p className={`font-medium ${rank === 1 ? 'text-amber-300' : rank === 2 ? 'text-gray-200' : rank === 3 ? 'text-orange-300' : 'text-gray-300'}`}>
                                {row.name}
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                <div className="h-1 rounded-full bg-gray-800 flex-1 max-w-[120px]">
                                  <div
                                    className="h-1 rounded-full bg-gradient-to-r from-amber-500 to-orange-500"
                                    style={{ width: `${sharePercent}%` }}
                                  />
                                </div>
                                <span className="text-xs text-gray-500">{sharePercent.toFixed(1)}%</span>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 pr-4 text-right">
                            <span className="font-bold text-emerald-400">{fmtMoney(row.revenue)}</span>
                          </td>
                          <td className="py-3 pr-4 text-right text-gray-300">{row.shifts}</td>
                          <td className="py-3 pr-4 text-right text-gray-300">{row.days}</td>
                          <td className="py-3 text-right text-blue-400 font-medium">{fmtMoney(row.avgCheck)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Top 3 podium */}
          {leaderboard.length >= 3 && (
            <Card className="p-5 bg-gray-900/80 border-amber-500/20">
              <h2 className="text-sm font-semibold text-white mb-4">Подиум</h2>
              <div className="flex items-end justify-center gap-3">
                {/* 2nd */}
                <div className="flex flex-col items-center gap-2">
                  <div className="w-20 h-20 rounded-2xl bg-gray-800 border border-gray-700 flex items-center justify-center">
                    <span className="text-3xl">🥈</span>
                  </div>
                  <div className="w-24 h-16 bg-gray-700/50 rounded-t-xl flex flex-col items-center justify-center gap-1">
                    <span className="text-xs text-gray-300 font-medium truncate w-full text-center px-1">{leaderboard[1]?.name}</span>
                    <span className="text-xs text-gray-400">{fmtMoney(leaderboard[1]?.revenue ?? 0)}</span>
                  </div>
                </div>
                {/* 1st */}
                <div className="flex flex-col items-center gap-2">
                  <div className="w-24 h-24 rounded-2xl bg-amber-900/30 border border-amber-500/30 flex items-center justify-center shadow-lg shadow-amber-500/10">
                    <span className="text-4xl">🥇</span>
                  </div>
                  <div className="w-28 h-24 bg-amber-500/10 border border-amber-500/20 rounded-t-xl flex flex-col items-center justify-center gap-1">
                    <span className="text-xs text-amber-300 font-semibold truncate w-full text-center px-1">{leaderboard[0]?.name}</span>
                    <span className="text-sm font-bold text-emerald-400">{fmtMoney(leaderboard[0]?.revenue ?? 0)}</span>
                    <span className="text-xs text-gray-500">{leaderboard[0]?.shifts} смен</span>
                  </div>
                </div>
                {/* 3rd */}
                <div className="flex flex-col items-center gap-2">
                  <div className="w-20 h-20 rounded-2xl bg-orange-900/20 border border-orange-500/20 flex items-center justify-center">
                    <span className="text-3xl">🥉</span>
                  </div>
                  <div className="w-24 h-12 bg-orange-500/5 rounded-t-xl flex flex-col items-center justify-center gap-1">
                    <span className="text-xs text-orange-300 font-medium truncate w-full text-center px-1">{leaderboard[2]?.name}</span>
                    <span className="text-xs text-gray-400">{fmtMoney(leaderboard[2]?.revenue ?? 0)}</span>
                  </div>
                </div>
              </div>
            </Card>
          )}

        </div>
      </main>
    </div>
  )
}
