'use client'

import { createContext, useContext, useEffect } from 'react'

import { useStoreCompany } from '@/components/store/store-company-context'

type Scope = { storeCompanyId: string | null; loaded: boolean }
const Ctx = createContext<Scope>({ storeCompanyId: null, loaded: false })
export const useStoreScope = () => useContext(Ctx)

/**
 * Скоуп модуля «Магазин» по выбранной в шапке компании (переключатель точек).
 * Пока выбрана конкретная точка:
 *  - все GET-запросы к /api/admin/* без company_id получают company_id = выбранная точка
 *    (изоляция данных; реальная изоляция — на сервере через resolveCompanyScope);
 *  - список точек (/api/admin/companies) и конфиг НЕ трогаем — переключателю нужен
 *    полный список компаний орг.
 * Режим «Общий» (companyId='') — инъекции нет, данные по всем точкам орг.
 */
export function StoreScope({ children }: { children: React.ReactNode }) {
  const { companyId } = useStoreCompany()

  useEffect(() => {
    if (!companyId) return // «Общий» → без инъекции
    const orig = window.fetch
    window.fetch = async (input: any, init?: any) => {
      try {
        if (typeof input === 'string') {
          const method = String(init?.method || 'GET').toUpperCase()
          if (
            method === 'GET' &&
            input.includes('/api/admin/') &&
            !input.includes('/api/admin/store/config') &&
            !/\/api\/admin\/companies(\?|$)/.test(input)
          ) {
            const u = new URL(input, window.location.origin)
            if (!u.searchParams.get('company_id')) {
              u.searchParams.set('company_id', companyId)
              return orig(u.pathname + u.search, init)
            }
          }
        }
      } catch {
        /* fallthrough */
      }
      return orig(input, init)
    }
    return () => {
      window.fetch = orig
    }
  }, [companyId])

  return <Ctx.Provider value={{ storeCompanyId: companyId || null, loaded: true }}>{children}</Ctx.Provider>
}
