import type { BootstrapData, OperatorSession, Product } from '@/types'

// 30 дней: чтобы при долгом офлайне (нет интернета / лежит сервер, в т.ч. через
// ночь или выходные) оператор всё равно заходил в рабочий режим и мог продавать.
// Устройство физически контролируется точкой; продажи всё равно уходят в очередь
// и синхронизируются при возврате связи.
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000 // 30 дней

interface AppCache {
  bootstrap?: BootstrapData
  products?: Product[]
  operatorSession?: { session: OperatorSession; savedAt: string }
  cachedAt?: string
}

const ipc = window.electron

async function load(): Promise<AppCache> {
  try {
    return (await ipc.cache.get()) as AppCache
  } catch {
    return {}
  }
}

async function save(patch: Partial<AppCache>): Promise<void> {
  const current = await load()
  await ipc.cache.set({ ...current, ...patch, cachedAt: new Date().toISOString() })
}

export async function getCachedBootstrap(): Promise<BootstrapData | null> {
  const c = await load()
  return c.bootstrap ?? null
}

export async function saveBootstrapCache(bootstrap: BootstrapData): Promise<void> {
  await save({ bootstrap })
}

export async function getCachedProducts(): Promise<Product[]> {
  const c = await load()
  return c.products ?? []
}

export async function saveProductsCache(products: Product[]): Promise<void> {
  await save({ products })
}

export async function saveOperatorSession(session: OperatorSession): Promise<void> {
  await save({ operatorSession: { session, savedAt: new Date().toISOString() } })
}

export async function loadOperatorSession(): Promise<OperatorSession | null> {
  const c = await load()
  if (!c.operatorSession) return null
  const age = Date.now() - new Date(c.operatorSession.savedAt).getTime()
  if (age > SESSION_MAX_AGE_MS) return null
  return c.operatorSession.session
}

export async function clearOperatorSession(): Promise<void> {
  const c = await load()
  const { operatorSession: _, ...rest } = c
  await ipc.cache.set({ ...rest })
}

// Кэш витрины для страницы продаж. Используется и для мгновенного показа на
// медленном интернете, и для ОФЛАЙН-продажи: если связи нет, показываем последние
// известные товары/цены (когда связь есть — обновляется в фоне через silent-load).
// 7 дней, чтобы продавать можно было даже после долгого офлайна.
const SALES_CONTEXT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 дней

export async function saveSalesContextCache(context: unknown): Promise<void> {
  try {
    await save({ salesContext: { data: context, savedAt: new Date().toISOString() } } as any)
  } catch {
    /* безопасно игнорируем — это просто кэш */
  }
}

export async function getCachedSalesContext<T = unknown>(): Promise<T | null> {
  try {
    const c = (await load()) as any
    if (!c.salesContext) return null
    const age = Date.now() - new Date(c.salesContext.savedAt).getTime()
    if (age > SALES_CONTEXT_MAX_AGE_MS) return null
    return c.salesContext.data as T
  } catch {
    return null
  }
}
