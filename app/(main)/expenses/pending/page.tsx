'use client'

import { useEffect, useState } from 'react'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { CheckCircle2, XCircle, Clock, Loader2, AlertCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AdminPageHeader } from '@/components/admin/admin-page-header'

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
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setBusyId(null)
    }
  }

  async function decline(id: string) {
    const reason = window.prompt('Укажите причину отклонения (минимум 10 символов):')
    if (!reason || reason.trim().length < 10) {
      setError('Причина обязательна (≥ 10 символов)')
      return
    }
    setBusyId(id)
    setError(null)
    try {
      const response = await fetch(`/api/admin/expenses/${id}/decline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.error || 'Не удалось отклонить')
      setItems((prev) => prev.filter((x) => x.id !== id))
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
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
        <div className="text-center py-12 text-muted-foreground">Загрузка...</div>
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
                    <Button size="sm" variant="outline" onClick={() => decline(item.id)} disabled={busy}>
                      <XCircle className="w-3 h-3 mr-1" /> Отклонить
                    </Button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
