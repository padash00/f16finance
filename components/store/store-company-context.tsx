'use client'

import { createContext, useContext, useEffect, useState } from 'react'

export type StoreCompany = { id: string; name: string; code?: string | null }

type Ctx = {
  /** '' = режим «Общий» (все компании орг); иначе id выбранной компании. */
  companyId: string
  setCompanyId: (id: string) => void
  companies: StoreCompany[]
  loading: boolean
  /** true — выбран «Общий» (агрегат по всем). */
  isAll: boolean
}

const StoreCompanyContext = createContext<Ctx | null>(null)
const LS_KEY = 'store.companyId'

/**
 * Общий контекст выбранной компании для всего модуля «Магазин».
 * «Общий» (companyId='') — агрегат по всем компаниям орг. Выбор компании —
 * изоляция данных по ней. Выбор запоминается в localStorage.
 */
export function StoreCompanyProvider({ children }: { children: React.ReactNode }) {
  const [companies, setCompanies] = useState<StoreCompany[]>([])
  const [loading, setLoading] = useState(true)
  const [companyId, setCompanyIdState] = useState<string>('')

  // Восстанавливаем выбор до загрузки списка.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LS_KEY)
      if (saved) setCompanyIdState(saved)
    } catch {}
  }, [])

  useEffect(() => {
    let ignore = false
    fetch('/api/admin/companies', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (ignore) return
        const list: StoreCompany[] = Array.isArray(j?.data) ? j.data : []
        setCompanies(list)
        // Если сохранённая компания больше не в скоупе — сбрасываем на «Общий».
        setCompanyIdState((cur) => (cur && !list.some((c) => c.id === cur) ? '' : cur))
      })
      .catch(() => {})
      .finally(() => { if (!ignore) setLoading(false) })
    return () => { ignore = true }
  }, [])

  const setCompanyId = (id: string) => {
    setCompanyIdState(id)
    try { window.localStorage.setItem(LS_KEY, id) } catch {}
  }

  return (
    <StoreCompanyContext.Provider value={{ companyId, setCompanyId, companies, loading, isAll: !companyId }}>
      {children}
    </StoreCompanyContext.Provider>
  )
}

export function useStoreCompany(): Ctx {
  const ctx = useContext(StoreCompanyContext)
  if (!ctx) {
    // Fallback вне провайдера — режим «Общий», без переключения.
    return { companyId: '', setCompanyId: () => {}, companies: [], loading: false, isAll: true }
  }
  return ctx
}
