'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getCashlessLabel, getCashlessShort, getProviderName, supportsMidnightSplit, type PaymentProviderInfo } from '@/lib/core/cashless-labels'

interface CashlessContextValue {
  provider: PaymentProviderInfo | null
  loading: boolean
}

const CashlessContext = createContext<CashlessContextValue>({ provider: null, loading: true })

/**
 * Провайдер payment_provider для веб-админки.
 * Кладётся в layout (один раз на сессию) — все вложенные страницы читают
 * через useCashlessLabels().
 */
export function CashlessProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<PaymentProviderInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/payment-provider')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (cancelled) return
        setProvider(data?.provider || null)
      })
      .catch(() => {
        if (cancelled) return
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const value = useMemo(() => ({ provider, loading }), [provider, loading])
  return <CashlessContext.Provider value={value}>{children}</CashlessContext.Provider>
}

/**
 * Хук возвращает provider-aware лейблы для UI веб-админки.
 *  - L.providerName     — "Kaspi" / "Halyk" / "Безналичный"
 *  - L.pos / .online / .qr — "Kaspi POS" / "Безналичный POS"
 *  - L.cashless         — общий "Kaspi" / "Безналичный"
 */
export function useCashlessLabels() {
  const { provider, loading } = useContext(CashlessContext)
  return useMemo(() => ({
    loading,
    provider,
    providerName: getProviderName(provider),
    providerShort: getCashlessShort(provider),
    pos: getCashlessLabel(provider, 'pos'),
    online: getCashlessLabel(provider, 'online'),
    qr: getCashlessLabel(provider, 'qr'),
    gold: getCashlessLabel(provider, 'gold'),
    red: getCashlessLabel(provider, 'red'),
    kredit: getCashlessLabel(provider, 'kredit'),
    cashless: getCashlessLabel(provider),
    midnightSplitEnabled: supportsMidnightSplit(provider),
  }), [provider, loading])
}
