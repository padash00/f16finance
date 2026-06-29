'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { AlertCircle, ArrowRight, Wallet } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { formatMoney } from '@/lib/core/format'

type Debt = {
  id: string
  total_amount: number
  status: string
  due_date: string | null
}

export function SupplierDebtsWidget() {
  const [openCount, setOpenCount] = useState(0)
  const [openSum, setOpenSum] = useState(0)
  const [overdueCount, setOverdueCount] = useState(0)
  const [overdueSum, setOverdueSum] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetch('/api/admin/store/debts?status=open', { cache: 'no-store' })
        const json = await response.json().catch(() => null)
        if (cancelled || !response.ok || !json?.ok) return
        const debts = (json.data?.debts || []) as Debt[]
        const now = Date.now()
        let oc = 0
        let os = 0
        let xc = 0
        let xs = 0
        for (const d of debts) {
          if (d.status !== 'open') continue
          oc += 1
          os += Number(d.total_amount || 0)
          if (d.due_date && new Date(d.due_date).getTime() < now) {
            xc += 1
            xs += Number(d.total_amount || 0)
          }
        }
        setOpenCount(oc)
        setOpenSum(os)
        setOverdueCount(xc)
        setOverdueSum(xs)
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Card className="border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
            <Wallet className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-foreground">Долги поставщикам</div>
            <div className="text-xs text-muted-foreground">Открытые обязательства</div>
          </div>
        </div>
        <Link
          href="/store/billing"
          className="text-xs text-emerald-600 hover:text-emerald-700 dark:text-emerald-300 dark:hover:text-emerald-200 inline-flex items-center gap-1"
        >
          Перейти <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.03] p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Открыто</div>
          <div className="mt-1 text-lg font-semibold text-amber-600 dark:text-amber-300">
            {loading ? '—' : openCount}
          </div>
          <div className="text-xs text-muted-foreground">
            {loading ? '—' : `${formatMoney(openSum)} ₸`}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.03] p-3">
          <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
            {overdueCount > 0 ? <AlertCircle className="h-3 w-3 text-red-400" /> : null}
            Просрочено
          </div>
          <div className={`mt-1 text-lg font-semibold ${overdueCount > 0 ? 'text-red-500 dark:text-red-300' : 'text-slate-500 dark:text-slate-300'}`}>
            {loading ? '—' : overdueCount}
          </div>
          <div className="text-xs text-muted-foreground">
            {loading ? '—' : `${formatMoney(overdueSum)} ₸`}
          </div>
        </div>
      </div>
    </Card>
  )
}
