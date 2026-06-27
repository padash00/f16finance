'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Check, Ban, FileText } from 'lucide-react'

type Inv = {
  id: string
  organizationId: string
  orgName: string
  orgSlug: string
  amount: number
  currency: string
  dueDate: string | null
  status: string
  paidAt: string | null
  note: string | null
  createdAt: string
}

const STATUS: Record<string, { l: string; chip: string }> = {
  issued: { l: 'Выставлен', chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  paid: { l: 'Оплачен', chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  overdue: { l: 'Просрочен', chip: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
  void: { l: 'Аннулирован', chip: 'bg-slate-500/15 text-slate-500 dark:text-slate-400' },
  draft: { l: 'Черновик', chip: 'bg-slate-500/15 text-slate-500 dark:text-slate-400' },
}
const FILTERS = [
  { k: '', l: 'Все' },
  { k: 'issued', l: 'Выставленные' },
  { k: 'paid', l: 'Оплаченные' },
  { k: 'void', l: 'Аннулированные' },
]
const fmt = (n: number) => new Intl.NumberFormat('ru-RU').format(Math.round(n || 0))
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('ru-RU') : '—')

export default function PlatformInvoicesPage() {
  const [rows, setRows] = useState<Inv[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = async (status: string) => {
    setLoading(true)
    try {
      const r = await fetch(`/api/admin/platform/invoices${status ? `?status=${status}` : ''}`, { cache: 'no-store' })
      const j = await r.json()
      setRows(j.data || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(filter)
  }, [filter])

  const act = async (id: string, action: 'markPaid' | 'void') => {
    setBusy(id)
    try {
      await fetch('/api/admin/platform/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: id, action }),
      })
      await load(filter)
    } finally {
      setBusy(null)
    }
  }

  const totalIssued = rows.filter((r) => r.status === 'issued' || r.status === 'overdue').reduce((s, r) => s + r.amount, 0)

  return (
    <div className="mx-auto max-w-6xl p-6 text-slate-900 dark:text-white">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Счета — все клиенты</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Биллинг по всем организациям. Неоплачено:{' '}
          <b className="tabular-nums text-amber-600 dark:text-amber-300">{fmt(totalIssued)} ₸</b>
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.k}
            onClick={() => setFilter(f.k)}
            className={`rounded-xl border px-3 py-1.5 text-sm transition ${
              filter === f.k
                ? 'border-violet-500/40 bg-violet-500/15 text-violet-700 dark:text-violet-200'
                : 'border-slate-200 text-slate-700 hover:bg-slate-100 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/[0.04]'
            }`}
          >
            {f.l}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-violet-400" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center dark:border-white/15 dark:bg-white/[0.02]">
          <FileText className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
          <p className="mt-3 text-sm font-medium">Счетов нет</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">В этом фильтре пока пусто.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-white/10">
          <div className="divide-y divide-slate-100 dark:divide-white/[0.06]">
            {rows.map((r) => {
              const st = STATUS[r.status] || STATUS.issued
              return (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 bg-white px-4 py-3 transition hover:bg-slate-50 dark:bg-transparent dark:hover:bg-white/[0.02]"
                >
                  <div className="min-w-[180px]">
                    <Link
                      href={`/platform/organizations/${r.organizationId}`}
                      className="font-medium text-slate-900 hover:text-violet-700 dark:text-white dark:hover:text-violet-300"
                    >
                      {r.orgName}
                    </Link>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">
                      {r.orgSlug ? `${r.orgSlug} · ` : ''}{r.dueDate ? `до ${fmtDate(r.dueDate)}` : fmtDate(r.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className={`text-sm font-semibold tabular-nums ${r.status === 'void' ? 'text-slate-400 line-through dark:text-slate-500' : 'text-slate-900 dark:text-white'}`}>
                        {fmt(r.amount)} {r.currency}
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.chip}`}>{st.l}</span>
                  </div>
                  <div className="flex gap-2">
                    {r.status !== 'paid' && r.status !== 'void' ? (
                      <>
                        <button
                          onClick={() => act(r.id, 'markPaid')}
                          disabled={busy === r.id}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 px-2.5 py-1.5 text-xs text-emerald-700 hover:bg-emerald-500/10 disabled:opacity-50 dark:text-emerald-300"
                        >
                          <Check className="h-3.5 w-3.5" /> Оплачен
                        </button>
                        <button
                          onClick={() => act(r.id, 'void')}
                          disabled={busy === r.id}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:border-white/10 dark:text-slate-400 dark:hover:bg-white/[0.04]"
                        >
                          <Ban className="h-3.5 w-3.5" /> Аннулировать
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
