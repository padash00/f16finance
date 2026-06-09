'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Check, Ban } from 'lucide-react'

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

const STATUS: Record<string, { l: string; c: string }> = {
  issued: { l: 'Выставлен', c: 'text-amber-300' },
  paid: { l: 'Оплачен', c: 'text-emerald-300' },
  overdue: { l: 'Просрочен', c: 'text-rose-300' },
  void: { l: 'Аннулирован', c: 'text-slate-500' },
  draft: { l: 'Черновик', c: 'text-slate-400' },
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
    <div className="p-6 text-white">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold">Счета — все клиенты</h1>
        <p className="mt-1 text-sm text-slate-400">Биллинг по всем организациям. Неоплачено: <b className="text-amber-300">{fmt(totalIssued)} ₸</b></p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.k}
            onClick={() => setFilter(f.k)}
            className={`rounded-lg border px-3 py-1.5 text-sm transition ${
              filter === f.k ? 'border-violet-500/40 bg-violet-500/15 text-violet-200' : 'border-white/10 text-slate-300 hover:bg-white/[0.04]'
            }`}
          >
            {f.l}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-violet-400" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">Счетов нет.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => {
            const st = STATUS[r.status] || STATUS.issued
            return (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <div className="min-w-[180px]">
                  <Link href={`/platform/organizations/${r.organizationId}`} className="font-medium text-white hover:text-violet-300">{r.orgName}</Link>
                  <p className="text-[11px] text-slate-500">{r.orgSlug ? `${r.orgSlug} · ` : ''}{r.dueDate ? `до ${fmtDate(r.dueDate)}` : fmtDate(r.createdAt)}</p>
                </div>
                <div className="text-right">
                  <p className={r.status === 'void' ? 'text-slate-500 line-through' : 'text-white'}>{fmt(r.amount)} {r.currency}</p>
                  <p className={`text-[11px] ${st.c}`}>{st.l}</p>
                </div>
                <div className="flex gap-2">
                  {r.status !== 'paid' && r.status !== 'void' ? (
                    <>
                      <button onClick={() => act(r.id, 'markPaid')} disabled={busy === r.id} className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 px-2.5 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-50">
                        <Check className="h-3.5 w-3.5" /> Оплачен
                      </button>
                      <button onClick={() => act(r.id, 'void')} disabled={busy === r.id} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-400 hover:bg-white/[0.04] disabled:opacity-50">
                        <Ban className="h-3.5 w-3.5" /> Аннулировать
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
