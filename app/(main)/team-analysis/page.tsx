'use client'

import { useEffect, useState } from 'react'
import { Users, Loader2, RefreshCw, Star, AlertTriangle, GraduationCap, Sparkles } from 'lucide-react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'

type OperatorMetric = {
  id: string
  name: string
  shifts: number
  turnover: number
  revenuePerShift: number
  gross: number
  net: number
  paid: number
  remaining: number
  bonus: number
  fine: number
  debt: number
  revenuePerSalary: number
}
type Insight = { verdict: string; reason: string; action: string; severity: 'high' | 'medium' | 'low' }
type Resp = {
  ok: boolean
  metrics: { operators: OperatorMetric[]; aggregates?: any }
  insights: Insight[]
  summary: string
  error?: string
}
type Company = { id: string; name: string }

const money = (n: number) => Math.round(n || 0).toLocaleString('ru-RU') + ' ₸'
const num = (n: number) => Math.round(n || 0).toLocaleString('ru-RU')

const cardCls = 'rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40'
const sub = 'text-slate-500 dark:text-slate-400'
const thCls = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400'
const tdCls = 'px-3 py-2 text-sm text-slate-700 dark:text-slate-200 tabular-nums'

const SEV: Record<Insight['severity'], { accent: string; chip: string; label: string; icon: React.ReactNode }> = {
  high: {
    accent: 'text-rose-600 dark:text-rose-400',
    chip: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    label: 'Внимание',
    icon: <AlertTriangle className="h-4 w-4 text-rose-500" />,
  },
  medium: {
    accent: 'text-amber-600 dark:text-amber-400',
    chip: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    label: 'Развитие',
    icon: <GraduationCap className="h-4 w-4 text-amber-500" />,
  },
  low: {
    accent: 'text-emerald-600 dark:text-emerald-400',
    chip: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    label: 'Звезда',
    icon: <Star className="h-4 w-4 text-emerald-500" />,
  },
}

export default function TeamAnalysisPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyId] = useState<string>('')
  const [days, setDays] = useState<number>(30)
  const [custom, setCustom] = useState<boolean>(false)
  const [from, setFrom] = useState<string>('')
  const [to, setTo] = useState<string>('')

  const run = async (
    cid: string = companyId,
    d: number = days,
    useCustom: boolean = custom,
    f: string = from,
    t: string = to,
  ) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (cid) params.set('company_id', cid)
      if (useCustom && f && t) {
        params.set('from', f)
        params.set('to', t)
      } else {
        params.set('days', String(d))
      }
      const res = await fetch(`/api/ai/team-analysis?${params.toString()}`, { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok || j?.error) throw new Error(j?.error === 'forbidden' ? 'Нет доступа' : j?.error || 'Ошибка')
      setData(j as Resp)
      setLoaded(true)
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  // Список точек.
  useEffect(() => {
    let active = true
    fetch('/api/admin/companies', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (!active) return
        setCompanies((Array.isArray(j?.data) ? j.data : []) as Company[])
      })
      .catch(() => { if (active) setCompanies([]) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    // В режиме «Свой период» ждём, пока заданы обе даты.
    if (custom && (!from || !to)) return
    run(companyId, days, custom, from, to)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, days, custom, from, to])

  const operators = data?.metrics?.operators || []
  const insights = data?.insights || []

  return (
    <div className="app-page-wide space-y-5 text-slate-900 dark:text-white">
      <AdminPageHeader
        title="AI Разбор команды"
        description="Кто звезда, кто проседает, справедлива ли оплата"
        icon={<Users className="h-5 w-5" />}
        accent="violet"
        backHref="/"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={custom ? 'custom' : String(days)}
              onChange={(e) => {
                const v = e.target.value
                if (v === 'custom') {
                  setCustom(true)
                } else {
                  setCustom(false)
                  setDays(Number(v))
                }
              }}
              disabled={loading}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-200 dark:hover:bg-white/[0.04]"
              title="Период анализа"
            >
              <option value={7}>Неделя</option>
              <option value={14}>2 недели</option>
              <option value={30}>Месяц</option>
              <option value={60}>2 месяца</option>
              <option value={90}>Квартал</option>
              <option value="custom">Свой период</option>
            </select>
            {custom ? (
              <>
                <input
                  type="date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => setFrom(e.target.value)}
                  disabled={loading}
                  title="С"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-200 dark:hover:bg-white/[0.04]"
                />
                <input
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}
                  disabled={loading}
                  title="По"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-200 dark:hover:bg-white/[0.04]"
                />
              </>
            ) : null}
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              disabled={loading}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-200 dark:hover:bg-white/[0.04]"
            >
              <option value="">Все точки</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button
              onClick={() => run()}
              disabled={loading}
              className={`inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm ${sub} transition hover:bg-slate-100 disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/[0.04]`}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Обновить
            </button>
          </div>
        }
      />

      <p className={`text-xs ${sub}`}>
        {companyId
          ? `По точке: ${companies.find((c) => c.id === companyId)?.name || '—'}`
          : 'По всем точкам'}
      </p>

      {error ? <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}

      {loading && !loaded ? (
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-slate-500 dark:text-slate-400">
          <Loader2 className="h-7 w-7 animate-spin text-violet-500" />
          <p className="text-sm">{custom ? 'ИИ анализирует команду за выбранный период…' : `ИИ анализирует команду за ${days} дней…`}</p>
        </div>
      ) : !data ? null : operators.length === 0 ? (
        <div className={cardCls}>
          <p className={`text-sm ${sub}`}>Нет данных по операторам за выбранный период.</p>
        </div>
      ) : (
        <div className={loading ? 'space-y-5 opacity-50 transition-opacity' : 'space-y-5'}>

          {/* AI-сводка наверху */}
          {data.summary ? (
            <div className="rounded-2xl border border-violet-200 bg-violet-500/[0.06] p-5 dark:border-violet-500/20">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
                <span aria-hidden>🧠</span> Главное по команде
                <Sparkles className="h-4 w-4 text-violet-500" aria-hidden />
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-200">{data.summary}</p>
            </div>
          ) : null}

          {/* Карточки инсайтов: вывод → причина → действие */}
          {insights.length ? (
            <div className="grid gap-4 md:grid-cols-2">
              {insights.map((it, i) => {
                const sev = SEV[it.severity] || SEV.medium
                return (
                  <div key={i} className={cardCls}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5">{sev.icon}</span>
                        <h3 className={`text-base font-semibold leading-snug ${sev.accent}`}>{it.verdict}</h3>
                      </div>
                      <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${sev.chip}`}>{sev.label}</span>
                    </div>
                    {it.reason ? (
                      <p className={`mt-2.5 text-sm leading-relaxed ${sub}`}>
                        <span className="font-medium text-slate-600 dark:text-slate-300">Почему: </span>{it.reason}
                      </p>
                    ) : null}
                    {it.action ? (
                      <p className="mt-2 flex items-start gap-1.5 text-sm font-semibold text-violet-700 dark:text-violet-300">
                        <span aria-hidden>👉</span>
                        <span className="leading-relaxed">{it.action}</span>
                      </p>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : data.summary ? null : (
            <p className={`text-xs ${sub}`}>AI-разбор недоступен — показаны только цифры.</p>
          )}

          {/* Таблица операторов */}
          <div className={cardCls}>
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
              <Users className="h-4 w-4 text-violet-500" /> Операторы за период
            </h2>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-white/10">
              <table className="min-w-full">
                <thead className="bg-slate-50 dark:bg-white/[0.03]">
                  <tr>
                    <th className={thCls}>Оператор</th>
                    <th className={thCls}>Смены</th>
                    <th className={thCls}>Выручка/смену</th>
                    <th className={thCls}>Начислено</th>
                    <th className={thCls}>К выплате</th>
                    <th className={thCls}>Бонусы</th>
                    <th className={thCls}>Штрафы</th>
                    <th className={thCls}>Долги</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {operators.map((o) => (
                    <tr key={o.id}>
                      <td className={`${tdCls} font-medium`}>{o.name}</td>
                      <td className={tdCls}>{o.shifts}</td>
                      <td className={tdCls}>{o.revenuePerShift ? money(o.revenuePerShift) : '—'}</td>
                      <td className={tdCls}>{money(o.gross)}</td>
                      <td className={`${tdCls} font-semibold`}>{money(o.net)}</td>
                      <td className={tdCls}>
                        {o.bonus > 0 ? <span className="text-emerald-600 dark:text-emerald-400">+{num(o.bonus)} ₸</span> : '—'}
                      </td>
                      <td className={tdCls}>
                        {o.fine > 0 ? <span className="text-rose-600 dark:text-rose-400">−{num(o.fine)} ₸</span> : '—'}
                      </td>
                      <td className={tdCls}>
                        {o.debt > 0 ? <span className="text-amber-600 dark:text-amber-400">{money(o.debt)}</span> : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={`mt-3 text-xs ${sub}`}>
              Период: {data.metrics?.aggregates?.dateFrom || ''} — {data.metrics?.aggregates?.dateTo || ''} · {operators.length} операторов
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
