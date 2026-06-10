'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

type Scope = { storeCompanyId: string | null; loaded: boolean }
const Ctx = createContext<Scope>({ storeCompanyId: null, loaded: false })
export const useStoreScope = () => useContext(Ctx)

/**
 * Жёсткая привязка модуля «Магазин» к точке-магазину (store_company_id).
 * Пока активна:
 *  - все GET-запросы к /api/admin/* без company_id получают company_id = точка-магазин;
 *  - список точек из /api/admin/companies схлопывается до одной (точки-магазина),
 *    поэтому любые переключатели точек внутри магазина показывают только её.
 * Реальная изоляция данных — на сервере (resolveCompanyScope); это UX-лок.
 */
export function StoreScope({ children }: { children: React.ReactNode }) {
  const [storeCompanyId, setStoreCompanyId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let active = true
    fetch('/api/admin/store/config', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (active) { setStoreCompanyId(j?.data?.store_company_id || null); setLoaded(true) } })
      .catch(() => { if (active) setLoaded(true) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!storeCompanyId) return
    const orig = window.fetch
    window.fetch = async (input: any, init?: any) => {
      try {
        if (typeof input === 'string') {
          const method = String(init?.method || 'GET').toUpperCase()
          if (method === 'GET' && input.includes('/api/admin/') && !input.includes('/api/admin/store/config')) {
            // Список точек → только точка-магазин
            if (/\/api\/admin\/companies(\?|$)/.test(input)) {
              const res = await orig(input, init)
              const j = await res.clone().json().catch(() => null)
              if (j && Array.isArray(j.data)) {
                const filtered = { ...j, data: j.data.filter((c: any) => String(c?.id) === storeCompanyId) }
                return new Response(JSON.stringify(filtered), { status: res.status, headers: { 'content-type': 'application/json' } })
              }
              return res
            }
            // Прочие GET → подставить company_id, если не задан
            const u = new URL(input, window.location.origin)
            if (!u.searchParams.get('company_id')) {
              u.searchParams.set('company_id', storeCompanyId)
              return orig(u.pathname + u.search, init)
            }
          }
        }
      } catch { /* fallthrough */ }
      return orig(input, init)
    }
    return () => { window.fetch = orig }
  }, [storeCompanyId])

  if (!loaded) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" /> Загрузка магазина…
      </div>
    )
  }

  return <Ctx.Provider value={{ storeCompanyId, loaded }}>{children}</Ctx.Provider>
}
