'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Briefcase,
  Building2,
  Cake,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingUp,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  WifiOff,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

type Analytics = {
  headcount: { operators: number; staff: number; hybrid: number; total: number }
  byRole: Array<{ role: string; label: string; count: number }>
  byCompany: Array<{ company_id: string; name: string; count: number }>
  turnover: { hired: number; dismissed: number; net: number; period_days: number }
  tenure: { avg_months_operator: number; avg_months_staff: number }
  upcoming: {
    birthdays: Array<{ name: string; date: string; days_until: number }>
    anniversaries: Array<{ name: string; hire_date: string; years: number; days_until: number }>
  }
  issues: { no_login: Array<{ id: string; name: string }> }
}

type Period = 7 | 30 | 90 | 365

function tenureLabel(months: number): string {
  if (months < 1) return '< 1 мес'
  if (months < 12) return `${months} мес`
  const y = Math.floor(months / 12)
  const m = months % 12
  if (m === 0) return `${y} ${y === 1 ? 'год' : y < 5 ? 'года' : 'лет'}`
  return `${y} ${y === 1 ? 'г' : 'л'} ${m} мес`
}

function whenLabel(daysUntil: number): string {
  if (daysUntil === 0) return 'сегодня'
  if (daysUntil === 1) return 'завтра'
  if (daysUntil < 7) return `через ${daysUntil} ${daysUntil < 5 ? 'дня' : 'дней'}`
  const weeks = Math.floor(daysUntil / 7)
  return `через ${weeks} нед`
}

export default function HrAnalytics() {
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>(30)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/hr/analytics?days=${period}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Ошибка')
      setData(json as Analytics)
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period])

  const maxByCompany = useMemo(() => Math.max(1, ...(data?.byCompany.map((c) => c.count) || [1])), [data])
  const maxByRole = useMemo(() => Math.max(1, ...(data?.byRole.map((r) => r.count) || [1])), [data])

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <Card className="p-4 bg-white dark:bg-gray-900/70 border-slate-200 dark:border-gray-800">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500 uppercase tracking-wider">Период:</span>
            {([7, 30, 90, 365] as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                  period === p
                    ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/40'
                    : 'border-slate-200 dark:border-gray-700 text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-400 dark:hover:border-gray-500'
                }`}
              >
                {p === 7 ? '7 дней' : p === 30 ? 'Месяц' : p === 90 ? 'Квартал' : 'Год'}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="border-slate-200 dark:border-gray-700">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </Button>
        </div>
      </Card>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300 text-sm">
          {error}
        </div>
      )}

      {!data ? (
        <Card className="p-8 text-center text-sm text-muted-foreground bg-white dark:bg-gray-900/60 border-slate-200 dark:border-gray-800">
          <Loader2 className="w-6 h-6 animate-spin text-gray-500 mx-auto mb-2" />
          Считаем метрики…
        </Card>
      ) : (
        <>
          {/* Headcount cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <BigStat
              icon={<Users className="w-4 h-4" />}
              label="Всего активных"
              value={data.headcount.total}
              tone="indigo"
            />
            <BigStat
              icon={<Briefcase className="w-4 h-4" />}
              label="Операторов"
              value={data.headcount.operators}
              tone="emerald"
              hint={data.headcount.hybrid > 0 ? `+${data.headcount.hybrid} hybrid` : undefined}
            />
            <BigStat
              icon={<UserCheck className="w-4 h-4" />}
              label="Админ-сотрудников"
              value={data.headcount.staff}
              tone="blue"
            />
            <BigStat
              icon={<Sparkles className="w-4 h-4" />}
              label="Гибридов"
              value={data.headcount.hybrid}
              tone="purple"
            />
          </div>

          {/* Turnover + Tenure */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card className="p-5 bg-white dark:bg-gray-900/60 border-slate-200 dark:border-gray-800">
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-indigo-700 dark:text-indigo-300" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Текучка за период</h3>
                <span className="text-xs text-gray-500 ml-auto">{data.turnover.period_days} дней</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <SmallStat
                  icon={<UserPlus className="w-3.5 h-3.5" />}
                  label="Найм"
                  value={data.turnover.hired}
                  tone="emerald"
                />
                <SmallStat
                  icon={<UserMinus className="w-3.5 h-3.5" />}
                  label="Уволено"
                  value={data.turnover.dismissed}
                  tone="red"
                />
                <SmallStat
                  icon={data.turnover.net >= 0 ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
                  label="Прирост"
                  value={(data.turnover.net >= 0 ? '+' : '') + data.turnover.net}
                  tone={data.turnover.net >= 0 ? 'emerald' : 'red'}
                />
              </div>
            </Card>

            <Card className="p-5 bg-white dark:bg-gray-900/60 border-slate-200 dark:border-gray-800">
              <div className="flex items-center gap-2 mb-3">
                <Cake className="w-4 h-4 text-pink-700 dark:text-pink-300" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Средний стаж</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <div className="text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300/80">Операторы</div>
                  <div className="text-lg font-bold text-emerald-700 dark:text-emerald-200 mt-0.5">{tenureLabel(data.tenure.avg_months_operator)}</div>
                </div>
                <div className="px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                  <div className="text-[10px] uppercase tracking-wider text-blue-700 dark:text-blue-300/80">Админ.</div>
                  <div className="text-lg font-bold text-blue-700 dark:text-blue-200 mt-0.5">{tenureLabel(data.tenure.avg_months_staff)}</div>
                </div>
              </div>
            </Card>
          </div>

          {/* Distribution: by role + by company */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card className="p-5 bg-white dark:bg-gray-900/60 border-slate-200 dark:border-gray-800">
              <div className="flex items-center gap-2 mb-3">
                <Briefcase className="w-4 h-4 text-amber-700 dark:text-amber-300" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">По должностям</h3>
              </div>
              <div className="space-y-2">
                {data.byRole.length === 0 && <div className="text-xs text-gray-500">Нет данных</div>}
                {data.byRole.map((r) => (
                  <BarRow key={r.role} label={r.label} count={r.count} max={maxByRole} tone="amber" />
                ))}
              </div>
            </Card>

            <Card className="p-5 bg-white dark:bg-gray-900/60 border-slate-200 dark:border-gray-800">
              <div className="flex items-center gap-2 mb-3">
                <Building2 className="w-4 h-4 text-cyan-700 dark:text-cyan-300" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">По точкам</h3>
              </div>
              <div className="space-y-2">
                {data.byCompany.length === 0 && <div className="text-xs text-gray-500">Нет назначений</div>}
                {data.byCompany.map((c) => (
                  <BarRow key={c.company_id} label={c.name} count={c.count} max={maxByCompany} tone="cyan" />
                ))}
              </div>
            </Card>
          </div>

          {/* Upcoming events + issues */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Card className="p-5 bg-white dark:bg-gray-900/60 border-slate-200 dark:border-gray-800">
              <div className="flex items-center gap-2 mb-3">
                <Cake className="w-4 h-4 text-pink-700 dark:text-pink-300" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Скоро ДР</h3>
                <span className="ml-auto text-xs text-gray-500">{data.upcoming.birthdays.length}</span>
              </div>
              {data.upcoming.birthdays.length === 0 ? (
                <div className="text-xs text-gray-500">В ближайшие 30 дней — нет</div>
              ) : (
                <ul className="space-y-1.5">
                  {data.upcoming.birthdays.slice(0, 6).map((b, i) => (
                    <li key={i} className="text-sm flex items-center justify-between gap-2">
                      <span className="text-slate-900 dark:text-white truncate">{b.name}</span>
                      <span className="text-xs text-pink-700 dark:text-pink-300 shrink-0">{whenLabel(b.days_until)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-5 bg-white dark:bg-gray-900/60 border-slate-200 dark:border-gray-800">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-4 h-4 text-amber-700 dark:text-amber-300" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Годовщины</h3>
                <span className="ml-auto text-xs text-gray-500">{data.upcoming.anniversaries.length}</span>
              </div>
              {data.upcoming.anniversaries.length === 0 ? (
                <div className="text-xs text-gray-500">Нет в ближайшие 30 дней</div>
              ) : (
                <ul className="space-y-1.5">
                  {data.upcoming.anniversaries.slice(0, 6).map((a, i) => (
                    <li key={i} className="text-sm flex items-center justify-between gap-2">
                      <span className="text-slate-900 dark:text-white truncate">{a.name}</span>
                      <span className="text-xs text-amber-700 dark:text-amber-300 shrink-0">
                        {a.years} {a.years === 1 ? 'год' : a.years < 5 ? 'года' : 'лет'} · {whenLabel(a.days_until)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-5 bg-white dark:bg-gray-900/60 border-slate-200 dark:border-gray-800">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-orange-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Без логина</h3>
                <span className="ml-auto text-xs text-gray-500">{data.issues.no_login.length}</span>
              </div>
              {data.issues.no_login.length === 0 ? (
                <div className="text-xs text-gray-500 flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 text-emerald-400" /> Все могут зайти в систему
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {data.issues.no_login.slice(0, 6).map((p) => (
                    <li key={p.id} className="text-sm flex items-center gap-2">
                      <WifiOff className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                      <span className="text-slate-900 dark:text-white truncate">{p.name}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function BigStat({
  icon,
  label,
  value,
  tone,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
  tone: 'indigo' | 'emerald' | 'blue' | 'purple'
  hint?: string
}) {
  const toneMap = {
    indigo: 'from-indigo-500/15 to-blue-500/5 border-indigo-500/30 text-indigo-300',
    emerald: 'from-emerald-500/15 to-green-500/5 border-emerald-500/30 text-emerald-300',
    blue: 'from-blue-500/15 to-cyan-500/5 border-blue-500/30 text-blue-300',
    purple: 'from-purple-500/15 to-fuchsia-500/5 border-purple-500/30 text-purple-300',
  }
  return (
    <Card className={`p-4 bg-gradient-to-br ${toneMap[tone]} border`}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[10px] uppercase tracking-wider opacity-90">{label}</span>
      </div>
      <div className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{value}</div>
      {hint && <div className="text-[10px] text-slate-500 dark:text-gray-400 mt-0.5">{hint}</div>}
    </Card>
  )
}

function SmallStat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
  tone: 'emerald' | 'red'
}) {
  const toneMap = {
    emerald: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-700 dark:text-emerald-300',
    red: 'bg-red-500/10 border-red-500/25 text-red-700 dark:text-red-300',
  }
  return (
    <div className={`px-3 py-2.5 rounded-lg border ${toneMap[tone]}`}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider opacity-90">
        {icon} {label}
      </div>
      <div className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">{value}</div>
    </div>
  )
}

function BarRow({ label, count, max, tone }: { label: string; count: number; max: number; tone: 'amber' | 'cyan' }) {
  const pct = (count / max) * 100
  const toneMap = {
    amber: 'bg-amber-500/30',
    cyan: 'bg-cyan-500/30',
  }
  return (
    <div className="flex items-center gap-3">
      <div className="w-32 text-xs text-slate-700 dark:text-gray-300 truncate">{label}</div>
      <div className="flex-1 h-2 rounded-full bg-slate-200 dark:bg-gray-800 overflow-hidden">
        <div className={`h-full ${toneMap[tone]} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-xs text-slate-500 dark:text-gray-400 w-8 text-right font-medium">{count}</div>
    </div>
  )
}
