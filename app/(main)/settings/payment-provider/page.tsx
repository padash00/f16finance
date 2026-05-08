'use client'

/**
 * Настройка провайдера платежей по компаниям.
 * Владелец выбирает банк/провайдер для каждой компании. От этого зависят
 * лейблы в UI (Kaspi POS / Halyk POS / Безналичный POS), а в будущем — комиссии.
 */

import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CreditCard, Save, CheckCircle2 } from 'lucide-react'
import { AdminPageHeader } from '@/components/admin/admin-page-header'

interface Provider {
  id: string
  code: string
  name: string
  country_code: string | null
  supports_midnight_split: boolean
}

interface Company {
  id: string
  name: string
  code: string | null
  payment_provider_id: string | null
}

const FLAG: Record<string, string> = { KZ: '🇰🇿', RU: '🇷🇺' }

export default function PaymentProviderSettingsPage() {
  const [providers, setProviders] = useState<Provider[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/admin/companies-payment-providers')
      const data = await r.json()
      setProviders(data.providers || [])
      setCompanies(data.companies || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function changeProvider(companyId: string, providerId: string | null) {
    setSavingId(companyId)
    setSavedId(null)
    try {
      const r = await fetch('/api/admin/companies-payment-providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, providerId }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => null)
        throw new Error(err?.error || 'Не удалось сохранить')
      }
      setCompanies((prev) => prev.map((c) => c.id === companyId ? { ...c, payment_provider_id: providerId } : c))
      setSavedId(companyId)
      setTimeout(() => setSavedId(null), 2000)
    } catch (e: any) {
      alert(e?.message || 'Ошибка')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="space-y-4 px-3 sm:px-4 py-4">
      <AdminPageHeader
        title="Платёжный провайдер"
        subtitle="Каждой компании можно назначить свой банк/провайдер. От этого зависят лейблы в интерфейсе (например «Kaspi POS» vs «Halyk POS»)."
        icon={<CreditCard className="w-5 h-5 text-emerald-400" />}
      />

      <Card className="p-4 sm:p-6">
        {loading ? (
          <div className="text-sm text-slate-400">Загрузка...</div>
        ) : companies.length === 0 ? (
          <div className="text-sm text-slate-400">У вас нет ни одной компании.</div>
        ) : (
          <div className="space-y-3">
            {companies.map((c) => {
              const current = providers.find((p) => p.id === c.payment_provider_id)
              return (
                <div key={c.id} className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-sm font-medium text-white">{c.name}</div>
                    {c.code && <div className="text-xs text-slate-500">Код: {c.code}</div>}
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={c.payment_provider_id || ''}
                      onChange={(e) => void changeProvider(c.id, e.target.value || null)}
                      disabled={savingId === c.id}
                      className="rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
                    >
                      <option value="">— не выбрано —</option>
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.country_code && FLAG[p.country_code] ? FLAG[p.country_code] + ' ' : ''}{p.name}
                          {p.supports_midnight_split ? ' (поддерживает split 00:00)' : ''}
                        </option>
                      ))}
                    </select>
                    {savingId === c.id ? (
                      <span className="text-xs text-slate-400">сохраняем…</span>
                    ) : savedId === c.id ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" /> сохранено
                      </span>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card className="p-4 sm:p-6 bg-amber-500/5 border-amber-500/20">
        <h3 className="mb-2 text-sm font-semibold text-amber-300">Как работает</h3>
        <ul className="space-y-1 text-xs text-amber-100/80 list-disc pl-5">
          <li>Если выбран Kaspi → в интерфейсе показывается «Kaspi POS», «Kaspi Online», «Kaspi QR»</li>
          <li>Если Halyk → «Halyk POS», «Halyk Online»</li>
          <li>Если «Универсальный» (generic) → нейтрально «Безналичный POS»</li>
          <li>Только Kaspi поддерживает разделение по 00:00 (фича сверки) — для других провайдеров оно скрывается</li>
          <li>Изменения применяются сразу после перезагрузки страницы</li>
        </ul>
      </Card>
    </div>
  )
}
