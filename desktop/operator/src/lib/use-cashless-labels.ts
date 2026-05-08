import { useMemo } from 'react'
import type { OperatorSession } from '@/types'
import { getCashlessLabel, getCashlessShort, getProviderName, supportsMidnightSplit } from '@/lib/cashless-labels'

/**
 * Хук возвращает пресет лейблов для UI по текущей сессии оператора.
 * Использует payment_provider из company. Если провайдер не задан → generic.
 *
 * Использование:
 *   const L = useCashlessLabels(session)
 *   <h1>{L.providerName} POS</h1>          → "Kaspi POS" / "Halyk POS" / "Безналичный POS"
 *   <p>{L.cashlessTotal} за смену</p>      → "Kaspi за смену" / "Безналичный за смену"
 */
export function useCashlessLabels(session: OperatorSession | null | undefined) {
  return useMemo(() => {
    const provider = (session?.company as any)?.payment_provider || null
    return {
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
    }
  }, [session?.company])
}

export type CashlessLabels = ReturnType<typeof useCashlessLabels>
