'use client'

import { createContext, useCallback, useContext, useMemo } from 'react'

import { useStoreCompany } from '@/components/store/store-company-context'

type Scope = { storeCompanyId: string | null; loaded: boolean }
const Ctx = createContext<Scope>({ storeCompanyId: null, loaded: false })
export const useStoreScope = () => useContext(Ctx)

/**
 * Дописать выбранную в шапке точку к адресу запроса.
 *
 * Пустой companyId — режим «Общий», адрес не трогаем: сервер отдаст данные по
 * всем точкам организации. Уже проставленный вручную company_id имеет приоритет
 * (страница знает про свою точку лучше, чем переключатель).
 *
 * Реальная изоляция всё равно на сервере (resolveCompanyScope); здесь — выбор
 * того, что показать.
 */
export function withStoreCompany(url: string, companyId: string | null | undefined): string {
  if (!companyId) return url
  const [path, hash = ''] = url.split('#')
  const [base, query = ''] = path.split('?')
  const params = new URLSearchParams(query)
  if (params.get('company_id')) return url
  params.set('company_id', companyId)
  return `${base}?${params.toString()}${hash ? `#${hash}` : ''}`
}

/**
 * Хук для страниц модуля: `const storeUrl = useStoreApiUrl()` и дальше
 * `fetch(storeUrl('/api/admin/store/audit'))`.
 *
 * ПОЧЕМУ явно, а не подменой window.fetch (как было раньше): патч ставился в
 * useEffect родителя, а эффекты в React выполняются снизу вверх — эффект
 * страницы успевал выстрелить до установки патча. После перезагрузки страницы
 * первый запрос уходил без точки и показывал данные по всем точкам орг.
 */
export function useStoreApiUrl() {
  const { storeCompanyId } = useStoreScope()
  return useCallback((url: string) => withStoreCompany(url, storeCompanyId), [storeCompanyId])
}

/**
 * Скоуп модуля «Магазин» по выбранной в шапке компании (переключатель точек).
 * Список точек (/api/admin/companies) и конфиг магазина сознательно НЕ скоупим —
 * переключателю нужен полный список компаний организации.
 */
export function StoreScope({ children }: { children: React.ReactNode }) {
  const { companyId } = useStoreCompany()
  const value = useMemo(() => ({ storeCompanyId: companyId || null, loaded: true }), [companyId])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
