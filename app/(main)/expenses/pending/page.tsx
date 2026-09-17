'use client'

import { useEffect, useState } from 'react'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { CheckCircle2, XCircle, Clock, Loader2, AlertCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AppModal } from '@/components/ui/app-modal'
import { toast } from '@/hooks/use-toast'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { CardSkeleton } from '@/components/skeleton'

type PendingExpense = {
  id: string
  date: string
  company_id: string
  category: string
  cash_amount: number
  kaspi_amount: number
  comment: string | null
  one_off_payee: string | null
  one_off_reason: string | null
  created_at: string
}

type Company = { id: string; name: string }

export default function PendingExpensesPage() {
  const { can } = useCapabilities()
  const canApprove = can('expenses-pending.approve')
  const canDecline = can('expenses-pending.decline')

  const [items, setItems] = useState<PendingExpense[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Причина отклонения — в окне, а не в window.prompt: при короткой причине текст сохраняется
  const [declineTarget, setDeclineTarget] = useState<PendingExpense | null>(null)
  const [declineReason, setDeclineReason] = useState('')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [pendRes, compRes] = await Promise.all([
        fetch('/api/admin/expenses/pending', { cache: 'no-store' }),
        fetch('/api/admin/companies', { cache: 'no-store' }),
      ])
      if (!pendRes.ok) {
        const j = await pendRes.json().catch(() => ({}))
        throw new Error(j.error || 'Не удалось загрузить список')
      }
      const pend = (await pendRes.json()).data || []
      const comps = compRes.ok ? (await compRes.json()).data || [] : []
      setItems(pend)
      setCompanies(comps)
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const companyName = (id: string) => companies.find((c) => c.id === id)?.name || '—'

  async function approve(id: string) {
    setBusyId(id)
    setError(null)
    try {
      const response = await fetch(`/api/admin/expenses/${id}/approve`, { method: 'POST' })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.error || 'Не удалось одобрить')
      setItems((prev) => prev.filter((x) => x.id !== id))
      toast({ title: 'Расход одобрен' })
    } catch (e: any) {
      toast({ title: 'Не удалось одобрить', description: e?.message, variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  async function submitDecline() {
    if (!declineTarget || busyId) return
    const reason = declineReason.trim()
    if (reason.length < 10) {
      toast({ title: 'Причина обязательна', description: 'Минимум 10 символов.', variant: 'destructive' })
      return
    }
    const id = declineTarget.id
    setBusyId(id)
    try {
      const response = await fetch(`/api/admin/expenses/${id}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.error || 'Не удалось отклонить')
      setItems((prev) => prev.filter((x) => x.id !== id))
      setDeclineTarget(null)
      setDeclineReason('')
      toast({ title: 'Расход отклонён' })
    } catch (e: any) {
      toast({ title: 'Не удалось отклонить', description: e?.message, variant: 'destructive' })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="app-page-wide space-y-6">
      <AdminPageHeader
        title="Ожидают одобрения"
        description="Расходы без чека от менеджера, требуют решения владельца"
        icon={<Clock className="h-5 w-5" />}
        accent="emerald"
        backHref="/expenses"
      />

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} rows={2} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card className="p-8 text-center">
          <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Нет расходов, ожидающих одобрения</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const total = Number(item.cash_amount || 0) + Number(item.kaspi_amount || 0)
            const busy = busyId === item.id
            return (
              <Card key={item.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-1 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      <span>{new Date(item.created_at).toLocaleString('ru-RU')}</span>
                      <span>·</span>
                      <span>{companyName(item.company_id)}</span>
                      <span>·</span>
                      <span>{item.category}</span>
                    </div>
                    <div className="font-semibold mb-1">{item.one_off_payee || 'Получатель не указан'}</div>
                    <div className="text-sm text-muted-foreground">{item.one_off_reason || '—'}</div>
                    {item.comment && (
                      <div className="text-xs text-muted-foreground mt-1 italic">{item.comment}</div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xl font-bold">{total.toLocaleString('ru-RU')} ₸</div>
                    <div className="text-xs text-muted-foreground">{item.date}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  {canApprove && (
                    <Button size="sm" onClick={() => approve(item.id)} disabled={busy}>
                      {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                      Одобрить
                    </Button>
                  )}
                  {canDecline && (
                    <Button size="sm" variant="outline" onClick={() => { setDeclineTarget(item); setDeclineReason('') }} disabled={busy}>
                      <XCircle className="w-3 h-3 mr-1" /> Отклонить
                    </Button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <AppModal
        open={!!declineTarget}
        onClose={() => { if (!busyId) { setDeclineTarget(null); setDeclineReason('') } }}
        title="Отклонить расход"
        maxWidth="max-w-md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setDeclineTarget(null); setDeclineReason('') }} disabled={!!busyId}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={submitDecline} disabled={!!busyId}>
              {busyId ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : null}
              Отклонить
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            {declineTarget?.one_off_payee || 'Получатель не указан'} ·{' '}
            {(Number(declineTarget?.cash_amount || 0) + Number(declineTarget?.kaspi_amount || 0)).toLocaleString('ru-RU')} ₸
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Причина отклонения (минимум 10 символов)</label>
            <textarea
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm"
              placeholder="Например: нет чека, оплата не согласована"
            />
          </div>
        </div>
      </AppModal>
    </div>
  )
}
