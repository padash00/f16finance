import type { BootstrapData, OperatorSession, Product } from '@/types'

const SESSION_MAX_AGE_MS = 10 * 60 * 60 * 1000 // 10 часов

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
