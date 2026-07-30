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
  // ВАЖНО: инициализируем выбранную точку СИНХРОННО из localStorage на первом
  // рендере. Иначе companyId стартует с '' и после загрузки конфига прыгает на
  // точку → у страниц, чей запрос зависит от точки, меняется URL → useApiCache
  // сбрасывает данные и перезагружает (полное «мигание» страницы). С синхронной
  // инициализацией точка корректна с первого рендера — лишнего цикла нет.
  const [companyId, setCompanyIdState] = useState<string>(() => {
    if (typeof window === 'undefined') return ''
    try { return window.localStorage.getItem(LS_KEY) || '' } catch { return '' }
  })

  useEffect(() => {
    let ignore = false
    let saved: string | null = null
    try { saved = window.localStorage.getItem(LS_KEY) } catch {}
    const hasSaved = saved !== null

    fetch('/api/admin/store/config', { cache: 'no-store' })
      .then((r) => r.json())
      .catch(() => null)
      .then((cfgJson) => {
        if (ignore) return
        const all = Array.isArray(cfgJson?.data?.companies) ? (cfgJson.data.companies as any[]) : []
        const shops: StoreCompany[] = all
          .filter((c) => c?.store_enabled)
          .map((c) => ({ id: String(c.id), name: String(c.name), code: c.code ?? null }))
        setCompanies(shops)
        const defaultPoint = (cfgJson?.data?.store_company_id as string | null) || ''
        const initial = hasSaved ? String(saved) : defaultPoint
        // Выбор валиден только если он среди магазинов; иначе «Общий».
        const resolved = initial && shops.some((c) => c.id === initial) ? initial : ''
        // Валидация конфигом: меняем состояние ТОЛЬКО если значение отличается —
        // иначе React пропустит ре-рендер (нет лишнего мигания при верном LS).
        setCompanyIdState((prev) => (prev === resolved ? prev : resolved))
      })
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
