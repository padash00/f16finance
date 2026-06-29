'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import {
  Award,
  Calendar,
  Crown,
  Flame,
  Lock,
  Medal,
  RefreshCw,
  Sparkles,
  Star,
  Trophy,
  User,
  X,
} from 'lucide-react'

import { Card } from '@/components/ui/card'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { useModalEscape } from '@/lib/client/use-modal-escape'
import { Button } from '@/components/ui/button'
import {
  ACHIEVEMENTS,
  COLOR_MAP,
  computeAllAchievements,
  type AchievementDef,
  type AchievementIcon,
  type OperatorAchievementRow,
} from '@/lib/achievements'

type IncomeRow = {
  id: string
  date: string
  operator_id: string | null
  shift_id?: string | null
  cash_amount: number
  kaspi_amount: number
  card_amount: number
  online_amount: number
  company_id: string | null
}

type Operator = {
  id: string
  name: string
  short_name: string | null
  is_active: boolean
}

type OperatorProfile = {
  operator_id: string
  full_name: string | null
  photo_url: string | null
}

type PeriodPreset = 'thisMonth' | 'lastMonth' | 'thisYear' | 'lastYear' | 'all'

const PERIOD_PRESETS: Record<PeriodPreset, { label: string; getRange: () => { from: string; to: string } | null }> = {
  thisMonth: {
    label: 'Текущий месяц',
    getRange: () => {
      const now = new Date()
      const from = new Date(now.getFullYear(), now.getMonth(), 1)
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      return { from: toISO(from), to: toISO(to) }
    },
  },
  lastMonth: {
    label: 'Прошлый месяц',
    getRange: () => {
      const now = new Date()
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const to = new Date(now.getFullYear(), now.getMonth(), 0)
      return { from: toISO(from), to: toISO(to) }
    },
  },
  thisYear: {
    label: 'Текущий год',
    getRange: () => {
      const now = new Date()
      const from = new Date(now.getFullYear(), 0, 1)
      const to = new Date(now.getFullYear(), 11, 31)
      return { from: toISO(from), to: toISO(to) }
    },
  },
  lastYear: {
    label: 'Прошлый год',
    getRange: () => {
      const now = new Date()
      const from = new Date(now.getFullYear() - 1, 0, 1)
      const to = new Date(now.getFullYear() - 1, 11, 31)
      return { from: toISO(from), to: toISO(to) }
    },
  },
  all: {
    label: 'Всё время',
    getRange: () => null,
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

function AchievementIconCmp({ kind, className }: { kind: AchievementIcon; className?: string }) {
  if (kind === 'crown') return <Crown className={className} />
  if (kind === 'trophy') return <Trophy className={className} />
  if (kind === 'medal') return <Medal className={className} />
  if (kind === 'sparkles') return <Sparkles className={className} />
  if (kind === 'flame') return <Flame className={className} />
  if (kind === 'star') return <Star className={className} />
  return <Award className={className} />
}

export default function OperatorAchievementsPage() {
  const [period, setPeriod] = useState<PeriodPreset>('thisMonth')
  const [isClient, setIsClient] = useState(false)
  useEffect(() => setIsClient(true), [])

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [profiles, setProfiles] = useState<Map<string, OperatorProfile>>(new Map())
  const [selectedRow, setSelectedRow] = useState<OperatorAchievementRow | null>(null)

  const range = useMemo(() => PERIOD_PRESETS[period].getRange(), [period])

  const load = async (silent = false) => {
    if (silent) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page_size: '20000', page: '0' })
      if (range) {
        params.set('from', range.from)
        params.set('to', range.to)
      }
      const [incomesRes, operatorsRes, profilesRes] = await Promise.all([
        fetch(`/api/admin/incomes?${params}`, { cache: 'no-store' }),
        fetch('/api/admin/operators?activeOnly=false', { cache: 'no-store' }),
        fetch('/api/admin/operators/profiles', { cache: 'no-store' }).catch(() => null),
      ])
      const incomesJson = incomesRes.ok ? await incomesRes.json() : { data: [] }
      const operatorsJson = operatorsRes.ok ? await operatorsRes.json() : { data: [] }
      const profilesJson = profilesRes && profilesRes.ok ? await profilesRes.json() : { data: [] }
      setIncomes(incomesJson.data || [])
      setOperators(operatorsJson.data || [])
      const map = new Map<string, OperatorProfile>()
      for (const p of (profilesJson.data || []) as OperatorProfile[]) {
        if (p.operator_id) map.set(p.operator_id, p)
      }
      setProfiles(map)
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

  // Преобразуем incomes + operators в список OperatorAchievementRow
  const rows: OperatorAchievementRow[] = useMemo(() => {
    if (operators.length === 0) return []
    const byOp = new Map<string, { totalTurnover: number; shifts: Set<string>; days: Set<string> }>()
    for (const op of operators) {
      byOp.set(op.id, { totalTurnover: 0, shifts: new Set(), days: new Set() })
    }
    for (const inc of incomes) {
      if (!inc.operator_id) continue
      const cur = byOp.get(inc.operator_id)
      if (!cur) continue
      cur.totalTurnover += (inc.cash_amount || 0) + (inc.kaspi_amount || 0) + (inc.card_amount || 0) + (inc.online_amount || 0)
      if (inc.shift_id) cur.shifts.add(inc.shift_id)
      if (inc.date) cur.days.add(inc.date)
    }
    const totalAll = Array.from(byOp.values()).reduce((s, x) => s + x.totalTurnover, 0)

    return operators
      .map((op) => {
        const stat = byOp.get(op.id)!
        const profile = profiles.get(op.id)
        const shifts = stat.shifts.size || stat.days.size // если нет shift_id — считаем по дням
        return {
          operatorId: op.id,
          operatorName: profile?.full_name || op.name,
          operatorShortName: op.short_name,
          photo_url: profile?.photo_url || null,
          totalTurnover: stat.totalTurnover,
          shifts,
          avgPerShift: shifts > 0 ? stat.totalTurnover / shifts : 0,
          share: totalAll > 0 ? (stat.totalTurnover / totalAll) * 100 : 0,
        }
      })
      .filter((r) => r.totalTurnover > 0 || r.shifts > 0) // прячем тех у кого нет данных
  }, [operators, incomes, profiles])

  const computed = useMemo(() => computeAllAchievements(rows), [rows])

  const summary = useMemo(() => {
    const map = new Map<string, number>()
    for (const ach of ACHIEVEMENTS) map.set(ach.id, 0)
    for (const c of computed) {
      for (const ach of c.earned) map.set(ach.id, (map.get(ach.id) || 0) + 1)
    }
    return map
  }, [computed])

  if (!isClient) return null

  return (
    <div className="app-page-wide space-y-6">
      {/* Header */}
      <AdminPageHeader
        title="Достижения операторов"
        description="Кто и какие достижения получил за период. Кликните на оператора, чтобы увидеть полный список и прогресс."
        icon={<Award className="h-5 w-5" />}
        accent="violet"
        backHref="/"
        actions={
          <>
            <div className="flex items-center gap-1 bg-white/50 dark:bg-zinc-900/50 p-1 rounded-xl border border-border">
              {(Object.keys(PERIOD_PRESETS) as PeriodPreset[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                    period === p ? 'bg-slate-200 text-slate-900 dark:bg-white/10 dark:text-white' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
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
              className="rounded-xl border border-border"
              title="Обновить"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
          </>
        }
      />

      {error && (
        <Card className="p-4 border-rose-500/30 bg-rose-500/10 text-sm text-rose-300">{error}</Card>
      )}

      {/* Сводка достижений */}
      <Card className="p-5 bg-white dark:bg-slate-900/40 backdrop-blur-xl border-slate-200 dark:border-white/5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-400" />
            Сводка достижений за {PERIOD_PRESETS[period].label.toLowerCase()}
          </h3>
          {refreshing && <RefreshCw className="w-3.5 h-3.5 animate-spin text-slate-400" />}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          {ACHIEVEMENTS.map((ach) => {
            const c = COLOR_MAP[ach.color]
            const count = summary.get(ach.id) || 0
            return (
              <div
                key={ach.id}
                className={`rounded-xl border ${c.border} ${c.bg} p-3 ${count === 0 ? 'opacity-40' : ''}`}
              >
                <div className={`flex items-center gap-2 ${c.text} mb-1`}>
                  <AchievementIconCmp kind={ach.icon} className="w-4 h-4" />
                  <span className="text-xs font-semibold">{ach.title}</span>
                </div>
                <div className="text-[11px] text-slate-400 leading-snug">{ach.desc}</div>
                <div className="mt-2 text-xs text-slate-500">
                  Получили: <span className={c.text}>{count}</span>
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      {/* Список операторов */}
      <Card className="p-5 bg-white dark:bg-slate-900/40 backdrop-blur-xl border-slate-200 dark:border-white/5">
        <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
          <Award className="w-4 h-4 text-amber-400" />
          Кто что получил
        </h3>
        {loading && computed.length === 0 ? (
          <div className="flex items-center justify-center py-16 gap-2 text-slate-500">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span className="text-sm">Загружаем достижения…</span>
          </div>
        ) : computed.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-sm">Нет данных за выбранный период</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {computed.map(({ row, rank, earned }) => (
              <button
                key={row.operatorId}
                type="button"
                onClick={() => setSelectedRow(row)}
                className="text-left rounded-2xl border border-border bg-white dark:bg-slate-900/60 p-4 transition hover:border-amber-400/30 hover:bg-slate-50 dark:hover:bg-slate-900/80"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-gradient-to-br from-amber-100 to-amber-200 dark:from-amber-500/30 dark:to-amber-600/30 overflow-hidden">
                    {row.photo_url ? (
                      <Image src={row.photo_url} alt={row.operatorName} width={40} height={40} className="rounded-full object-cover" />
                    ) : (
                      <User className="h-5 w-5 text-slate-500 dark:text-white/70" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate flex items-center gap-2">
                      {row.operatorShortName || row.operatorName}
                      <span className="text-[10px] font-mono text-slate-500">#{rank}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {earned.length === 0 ? 'Нет достижений' : `${earned.length} из ${ACHIEVEMENTS.length}`}
                    </div>
                  </div>
                </div>
                {earned.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {earned.map((ach) => {
                      const c = COLOR_MAP[ach.color]
                      return (
                        <span
                          key={ach.id}
                          className={`inline-flex items-center gap-1 rounded-md border ${c.border} ${c.bg} px-2 py-0.5 text-[11px] font-medium ${c.text}`}
                          title={ach.desc}
                        >
                          <AchievementIconCmp kind={ach.icon} className="w-3 h-3" />
                          {ach.title}
                        </span>
                      )
                    })}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Модалка с детализацией одного оператора */}
      {selectedRow && (
        <OperatorAchievementsModal
          row={selectedRow}
          onClose={() => setSelectedRow(null)}
          all={computed}
          periodLabel={PERIOD_PRESETS[period].label}
        />
      )}
    </div>
  )
}

function OperatorAchievementsModal({
  row,
  onClose,
  all,
  periodLabel,
}: {
  row: OperatorAchievementRow
  onClose: () => void
  all: ReturnType<typeof computeAllAchievements>
  periodLabel: string
}) {
  useModalEscape(true, onClose)

  const detail = all.find((c) => c.row.operatorId === row.operatorId)
  if (!detail) return null

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-card border border-border rounded-2xl w-full max-w-3xl my-8 animate-in fade-in zoom-in duration-200"
      >
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-slate-200 dark:border-white/5 rounded-t-2xl z-10 p-5">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-border bg-gradient-to-br from-amber-100 to-amber-200 dark:from-amber-500/30 dark:to-amber-600/30 overflow-hidden">
              {row.photo_url ? (
                <Image src={row.photo_url} alt={row.operatorName} width={56} height={56} className="rounded-2xl object-cover" />
              ) : (
                <User className="h-6 w-6 text-slate-500 dark:text-white/70" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-lg font-semibold text-foreground truncate">
                {row.operatorShortName || row.operatorName}
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                <Calendar className="h-3.5 w-3.5" />
                {periodLabel}
                <span className="text-slate-600">·</span>
                <span>#{detail.rank} в рейтинге</span>
              </div>
            </div>
            <button
              onClick={onClose}
              type="button"
              className="rounded-lg p-2 text-muted-foreground hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white"
              aria-label="Закрыть"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Сводка по показателям */}
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Выручка" value={moneyFmt(row.totalTurnover)} />
            <Stat label="Смены" value={String(row.shifts)} />
            <Stat label="Средний за смену" value={moneyFmt(row.avgPerShift)} />
            <Stat label="Доля" value={`${row.share.toFixed(1)}%`} />
          </div>
        </div>

        {/* Полученные достижения */}
        <div className="p-5 space-y-5">
          <section>
            <h4 className="text-xs uppercase tracking-[0.14em] text-slate-400 font-semibold mb-3 flex items-center gap-2">
              <Trophy className="w-3.5 h-3.5 text-amber-400" />
              Получено ({detail.earned.length})
            </h4>
            {detail.earned.length === 0 ? (
              <p className="text-sm text-slate-500">Пока нет достижений за этот период.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {detail.earned.map((ach) => (
                  <AchievementCard key={ach.id} ach={ach} earned />
                ))}
              </div>
            )}
          </section>

          {/* Не полученные с прогрессом */}
          <section>
            <h4 className="text-xs uppercase tracking-[0.14em] text-slate-400 font-semibold mb-3 flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-slate-500" />
              Не получено ({detail.locked.length})
            </h4>
            {detail.locked.length === 0 ? (
              <p className="text-sm text-emerald-400">Все достижения получены! 🎉</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {detail.locked.map((ach) => {
                  const progress = ach.progress?.(row, detail.ctx) || null
                  return <AchievementCard key={ach.id} ach={ach} earned={false} progress={progress} />
                })}
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-card border-t border-slate-200 dark:border-white/5 rounded-b-2xl p-4 flex justify-end">
          <Button variant="outline" size="sm" onClick={onClose} className="border-border">
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
    <div className="rounded-xl border border-border bg-surface-muted px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
    </div>
  )
}

function AchievementCard({
  ach,
  earned,
  progress,
}: {
  ach: AchievementDef
  earned: boolean
  progress?: { current: number; target: number; unit: string } | null
}) {
  const c = COLOR_MAP[ach.color]
  const pct = progress && progress.target > 0 ? Math.min(100, Math.round((progress.current / progress.target) * 100)) : 0

  return (
    <div
      className={`rounded-xl border ${earned ? c.border : 'border-border'} ${
        earned ? c.bg : 'bg-slate-50 dark:bg-white/[0.02]'
      } p-4 ${!earned ? 'opacity-70' : ''}`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${
            earned ? c.bg : 'bg-slate-100 dark:bg-white/5'
          } ${earned ? c.text : 'text-slate-500'}`}
        >
          <AchievementIconCmp kind={ach.icon} className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-semibold ${earned ? 'text-foreground' : 'text-body'}`}>
            {ach.title}
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{ach.desc}</p>
          {progress && !earned && (
            <div className="mt-2.5">
              <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                <span>
                  {progress.unit === '₸'
                    ? Math.round(progress.current).toLocaleString('ru-RU')
                    : progress.current.toFixed(progress.unit === '%' ? 1 : 0)}{' '}
                  / {progress.unit === '₸'
                    ? Math.round(progress.target).toLocaleString('ru-RU')
                    : progress.target}
                  {progress.unit !== '%' && progress.unit !== '₸' ? ` ${progress.unit}` : progress.unit === '%' ? '%' : ''}
                </span>
                <span>{pct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 dark:bg-white/5 overflow-hidden">
                <div
                  className={`h-full ${c.bg.replace('/15', '/60')}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
