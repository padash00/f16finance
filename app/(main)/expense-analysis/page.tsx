'use client'

import { useEffect, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Loader2, TrendingDown, Wallet, RefreshCw } from 'lucide-react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'

type Category = { category: string; amount: number; prev: number; sharePct: number; changePct: number }
type Insight = { verdict: string; reason: string; action: string; severity: 'high' | 'medium' | 'low' }
type Resp = {
  ok: boolean
  metrics: { categories: Category[]; total: number; totalPrevPct: number }
  insights: Insight[]
  summary: string
  error?: string
}
type Company = { id: string; name: string }

const money = (v: number) => Math.round(v || 0).toLocaleString('ru-RU') + ' ₸'

const C = { card: 'bg-white dark:bg-[#111113]', border: 'border-slate-200 dark:border-[#27272A]', sub: 'text-slate-500 dark:text-[#A1A1AA]' }
const cardCls = `rounded-xl border ${C.border} ${C.card} p-5`

const SEVERITY: Record<string, { border: string; tag: string; label: string }> = {
  high: { border: 'border-rose-300 dark:border-rose-500/40', tag: 'bg-rose-500/15 text-rose-600 dark:text-rose-300', label: 'Важно' },
  medium: { border: 'border-amber-300 dark:border-amber-500/40', tag: 'bg-amber-500/15 text-amber-600 dark:text-amber-300', label: 'Средне' },
  low: { border: 'border-slate-200 dark:border-white/10', tag: 'bg-slate-500/10 text-slate-500 dark:text-slate-300', label: 'Мелочь' },
}

function ChangeBadge({ value, goodWhenUp = false }: { value: number; goodWhenUp?: boolean }) {
  if (!value) return <span className="text-xs text-slate-500 dark:text-[#A1A1AA] tabular-nums">0%</span>
  const up = value > 0
  const color = up === goodWhenUp ? '#22C55E' : '#EF4444'
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-medium tabular-nums" style={{ color }}>
      <Icon className="h-3 w-3" />{Math.abs(value).toFixed(1)}%
    </span>
  )
}

export default function ExpenseAnalysisPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyId] = useState<string>('') // '' = все точки
  const [days, setDays] = useState<number>(90)

  const run = async (cid: string = companyId, d: number = days) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (cid) params.set('company_id', cid)
      params.set('days', String(d))
      const res = await fetch(`/api/ai/expense-analysis?${params.toString()}`, { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok || j?.error) throw new Error(j?.error || 'Ошибка')
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

  // Первичная загрузка + перезапуск при смене точки/периода.
  useEffect(() => {
    run(companyId, days)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, days])

  const metrics = data?.metrics
  const insights = data?.insights || []
  const categories = metrics?.categories || []

  const selectCls =
    'rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 dark:border-white/10 dark:bg-slate-900/40 dark:text-slate-200 dark:hover:bg-white/[0.04]'

  return (
    <div className="app-page-wide space-y-5 text-slate-900 dark:text-[#FAFAFA]">
      <AdminPageHeader
        title="AI Разбор расходов"
        description="Где утекают деньги и что урезать"
        icon={<Wallet className="h-5 w-5" />}
        accent="amber"
        backHref="/"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={loading} className={selectCls} title="Период анализа">
              <option value={30}>Месяц</option>
              <option value={90}>Квартал</option>
              <option value={180}>Полгода</option>
              <option value={365}>Год</option>
            </select>
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} disabled={loading} className={selectCls}>
              <option value="">Все точки</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <button onClick={() => run(companyId, days)} disabled={loading}
              className={`inline-flex items-center gap-1.5 rounded-lg border ${C.border} px-3 py-1.5 text-sm ${C.sub} transition hover:bg-slate-100 dark:hover:bg-white/[0.03] disabled:opacity-50`}>
              <RefreshCw className="h-3.5 w-3.5" /> Обновить
            </button>
          </div>
        }
      />

      {error ? <p className="text-sm text-[#EF4444]">{error}</p> : null}

      {loading && !loaded ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-slate-500 dark:text-[#A1A1AA]">
          <Loader2 className="h-7 w-7 animate-spin text-amber-400" />
          <p className="text-sm">ИИ анализирует расходы…</p>
        </div>
      ) : !data ? null : (
        <div className={loading ? 'space-y-5 opacity-40 transition-opacity' : 'space-y-5'}>
          {/* Сводка сверху */}
          <div className="rounded-2xl border border-amber-200 dark:border-amber-500/20 bg-gradient-to-br from-amber-50 via-white to-white dark:from-amber-900/15 dark:via-[#111113] dark:to-[#111113] p-5">
            <div className="flex flex-wrap items-center gap-5">
              <div className="shrink-0">
                <p className={`text-xs ${C.sub}`}>Расходы за период</p>
                <p className="text-3xl font-bold tabular-nums text-slate-900 dark:text-[#FAFAFA]">{money(metrics?.total || 0)}</p>
                <div className="mt-1"><ChangeBadge value={metrics?.totalPrevPct || 0} /></div>
              </div>
              <p className="min-w-[240px] flex-1 text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                {data.summary
                  ? data.summary
                  : insights.length
                    ? 'ИИ нашёл, на что уходят деньги — смотрите карточки ниже.'
                    : 'Достаточно данных нет, либо AI-разбор недоступен. Цифры по категориям ниже.'}
              </p>
            </div>
          </div>

          {/* Карточки insights */}
          {insights.length ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {insights.map((it, i) => {
                const sv = SEVERITY[it.severity] || SEVERITY.medium
                return (
                  <div key={i} className={`rounded-xl border ${sv.border} ${C.card} p-5`}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-base font-semibold leading-snug text-slate-900 dark:text-[#FAFAFA]">{it.verdict || '—'}</p>
                      <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${sv.tag}`}>{sv.label}</span>
                    </div>
                    {it.reason ? <p className={`mt-2 text-sm leading-relaxed ${C.sub}`}>{it.reason}</p> : null}
                    {it.action ? (
                      <p className="mt-3 flex gap-1.5 text-sm font-medium text-amber-700 dark:text-amber-300">
                        <span aria-hidden>👉</span>
                        <span>{it.action}</span>
                      </p>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : data.summary === '' && !categories.length ? (
            <div className={`${cardCls} text-center`}>
              <p className={`text-sm ${C.sub}`}>За выбранный период расходов не найдено.</p>
            </div>
          ) : null}

          {/* Таблица категорий */}
          {categories.length ? (
            <div className={cardCls}>
              <h3 className="mb-4 text-sm font-semibold flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-amber-500" />Расходы по категориям
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={`text-left text-xs ${C.sub}`}>
                      <th className="pb-2 font-medium">Категория</th>
                      <th className="pb-2 text-right font-medium">Сумма</th>
                      <th className="pb-2 text-right font-medium">Доля</th>
                      <th className="pb-2 text-right font-medium">Изменение</th>
                    </tr>
                  </thead>
                  <tbody>
                    {categories.map((c, i) => (
                      <tr key={i} className="border-t border-slate-100 dark:border-white/[0.06]">
                        <td className="py-2 pr-3 text-slate-700 dark:text-slate-200">{c.category}</td>
                        <td className="py-2 pl-3 text-right tabular-nums font-medium text-slate-900 dark:text-white">{money(c.amount)}</td>
                        <td className={`py-2 pl-3 text-right tabular-nums ${C.sub}`}>{c.sharePct.toFixed(1)}%</td>
                        <td className="py-2 pl-3 text-right"><ChangeBadge value={c.changePct} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {loading ? <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-amber-400" /></div> : null}
          {!insights.length && data.summary === '' && categories.length ? (
            <p className="text-xs text-[#F59E0B]">AI-разбор недоступен, но цифры по категориям посчитаны.</p>
          ) : null}
        </div>
      )}
    </div>
  )
}
