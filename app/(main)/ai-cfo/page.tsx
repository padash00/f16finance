'use client'

import { useState } from 'react'
import { Brain, Loader2, TrendingUp, AlertTriangle, ShieldAlert, Sparkles } from 'lucide-react'

type Card = {
  severity: 'good' | 'warn' | 'risk'
  title: string
  finding: string
  root_cause: string
  recommendation: string
}
type Digest = {
  summary: string
  headline_metric: { label: string; value: string } | null
  cards: Card[]
}

const SEV: Record<string, { border: string; bg: string; text: string; icon: typeof TrendingUp; label: string }> = {
  good: { border: 'border-emerald-500/25', bg: 'bg-emerald-500/[0.05]', text: 'text-emerald-300', icon: TrendingUp, label: 'Хорошо' },
  warn: { border: 'border-amber-500/25', bg: 'bg-amber-500/[0.05]', text: 'text-amber-300', icon: AlertTriangle, label: 'Внимание' },
  risk: { border: 'border-rose-500/25', bg: 'bg-rose-500/[0.05]', text: 'text-rose-300', icon: ShieldAlert, label: 'Риск' },
}

export default function AiCfoPage() {
  const [digest, setDigest] = useState<Digest | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [period, setPeriod] = useState(30)

  const run = async (days: number) => {
    setLoading(true)
    setError(null)
    setPeriod(days)
    try {
      const to = new Date()
      const from = new Date(to.getTime() - (days - 1) * 86400000)
      const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
      const res = await fetch('/api/ai/cfo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateFrom: iso(from), dateTo: iso(to) }),
      })
      const j = await res.json()
      if (!res.ok || j?.error) throw new Error(j?.error || 'Ошибка генерации')
      setDigest(j.digest || null)
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app-page-wide space-y-6 text-white">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Brain className="h-6 w-6 text-violet-400" /> AI Финдиректор
          </h1>
          <p className="mt-1 text-sm text-slate-400">Разбор финансов: что произошло, почему и что делать.</p>
        </div>
        <div className="flex gap-2">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => run(d)}
              disabled={loading}
              className={`rounded-lg border px-3 py-1.5 text-sm transition disabled:opacity-50 ${
                period === d && digest ? 'border-violet-500/40 bg-violet-500/15 text-violet-200' : 'border-white/10 text-slate-300 hover:bg-white/[0.04]'
              }`}
            >
              {d} дн
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="text-sm text-rose-400">{error}</p> : null}

      {loading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400">
          <Loader2 className="h-7 w-7 animate-spin text-violet-400" />
          <p className="text-sm">Анализирую финансы за {period} дней…</p>
        </div>
      ) : !digest ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-10 text-center">
          <Sparkles className="mx-auto mb-3 h-8 w-8 text-violet-400" />
          <p className="text-sm text-slate-400">Выберите период выше — AI разберёт доходы, расходы, маржу и риски.</p>
        </div>
      ) : (
        <>
          {digest.summary ? (
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.05] p-5">
              <p className="text-sm leading-relaxed text-violet-100">{digest.summary}</p>
              {digest.headline_metric ? (
                <div className="mt-3 border-t border-white/10 pt-3 text-sm">
                  <span className="text-slate-400">{digest.headline_metric.label}: </span>
                  <b className="text-white">{digest.headline_metric.value}</b>
                </div>
              ) : null}
            </div>
          ) : null}

          {digest.cards.length === 0 ? (
            <p className="text-sm text-slate-500">AI не вернул структурированных карточек — см. сводку выше.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {digest.cards.map((c, i) => {
                const sev = SEV[c.severity] || SEV.warn
                const Icon = sev.icon
                return (
                  <div key={i} className={`rounded-xl border ${sev.border} ${sev.bg} p-4`}>
                    <div className="mb-2 flex items-center gap-2">
                      <Icon className={`h-4 w-4 ${sev.text}`} />
                      <span className={`text-[11px] font-medium uppercase ${sev.text}`}>{sev.label}</span>
                    </div>
                    <h3 className="mb-1.5 font-semibold text-white">{c.title}</h3>
                    <p className="text-sm text-slate-300">{c.finding}</p>
                    {c.root_cause ? (
                      <p className="mt-2 text-xs text-slate-400"><span className="text-slate-500">Причина: </span>{c.root_cause}</p>
                    ) : null}
                    {c.recommendation ? (
                      <p className="mt-1.5 rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-200">
                        <span className="text-violet-300">→ </span>{c.recommendation}
                      </p>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
