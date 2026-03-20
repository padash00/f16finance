import type { BootstrapData, Product } from '@/types'

interface AppCache {
  bootstrap?: BootstrapData
  products?: Product[]
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
