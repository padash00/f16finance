/**
 * Минимальный кеш-хук для GET-запросов (SWR-light, без зависимостей).
 *
 * Что даёт:
 * - При повторном заходе на страницу — мгновенный показ старых данных, фон рефреш
 * - Дедупликация одновременных запросов
 * - Refetch при возврате во вкладку
 * - Глобальная инвалидация: `mutateApi(url)` после POST/PATCH/DELETE
 */

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type CacheEntry<T> = {
  data: T | null
  error: string | null
  fetchedAt: number
}

const cache = new Map<string, CacheEntry<any>>()
const subscribers = new Map<string, Set<() => void>>()
const inflight = new Map<string, Promise<any>>()

function notify(key: string) {
  subscribers.get(key)?.forEach((cb) => cb())
}

async function fetcher<T>(key: string): Promise<T> {
  const res = await fetch(key, { cache: 'no-store' })
  const text = await res.text()
  let body: any = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const msg = body?.error || `HTTP ${res.status}`
    throw new Error(msg)
  }
  return body as T
}

function startFetch<T>(key: string): Promise<T> {
  if (inflight.has(key)) return inflight.get(key) as Promise<T>
  const promise = fetcher<T>(key)
    .then((data) => {
      cache.set(key, { data, error: null, fetchedAt: Date.now() })
      inflight.delete(key)
      notify(key)
      return data
    })
    .catch((err: any) => {
      const existing = cache.get(key)
      cache.set(key, { data: existing?.data ?? null, error: err?.message || 'error', fetchedAt: Date.now() })
      inflight.delete(key)
      notify(key)
      throw err
    })
  inflight.set(key, promise)
  return promise
}

export type UseApiResult<T> = {
  data: T | null
  error: string | null
  loading: boolean    // true только при первой загрузке (когда нет кеша)
  refreshing: boolean // true при фоновом рефреше (есть кеш + запрос идёт)
  refresh: () => Promise<void>
}

export type UseApiOptions = {
  enabled?: boolean              // если false — запрос не делается
  refreshInterval?: number       // мс между авторефрешами (0 = выкл)
  refreshOnFocus?: boolean       // рефреш при возврате во вкладку (по умолч true)
  dedupeIntervalMs?: number      // не повторять fetch если кешу меньше N мс (по умолч 1000)
}

export function useApi<T = any>(
  key: string | null,
  options: UseApiOptions = {},
): UseApiResult<T> {
  const {
    enabled = true,
    refreshInterval = 0,
    refreshOnFocus = true,
    dedupeIntervalMs = 1000,
  } = options

  const [, forceRender] = useState(0)
  const keyRef = useRef(key)
  keyRef.current = key

  // Подписываемся на изменения кеша по этому ключу
  useEffect(() => {
    if (!key) return
    const callback = () => forceRender((n) => n + 1)
    if (!subscribers.has(key)) subscribers.set(key, new Set())
    subscribers.get(key)!.add(callback)
    return () => {
      subscribers.get(key)?.delete(callback)
    }
  }, [key])

  // Первичный запуск + дедуп
  useEffect(() => {
    if (!enabled || !key) return
    const cached = cache.get(key)
    const fresh = cached && Date.now() - cached.fetchedAt < dedupeIntervalMs
    if (!fresh) {
      startFetch<T>(key).catch(() => {})
    }
  }, [key, enabled, dedupeIntervalMs])

  // Refetch на focus
  useEffect(() => {
    if (!refreshOnFocus || !key || !enabled) return
    const handler = () => {
      const cached = cache.get(key)
      // Не дёргаем если только что fetched
      if (cached && Date.now() - cached.fetchedAt < 2000) return
      startFetch(key).catch(() => {})
    }
    window.addEventListener('focus', handler)
    return () => window.removeEventListener('focus', handler)
  }, [key, refreshOnFocus, enabled])

  // Интервал авторефреша
  useEffect(() => {
    if (!refreshInterval || !key || !enabled) return
    const id = setInterval(() => {
      startFetch(key).catch(() => {})
    }, refreshInterval)
    return () => clearInterval(id)
  }, [key, refreshInterval, enabled])

  const refresh = useCallback(async () => {
    if (!key) return
    try {
      await startFetch(key)
    } catch {
      /* ошибка уже в cache.error */
    }
  }, [key])

  const entry = key ? cache.get(key) : undefined
  const data = (entry?.data as T | null) ?? null
  const error = entry?.error ?? null
  const isInflight = key ? inflight.has(key) : false
  const loading = !entry && isInflight  // первая загрузка
  const refreshing = !!entry && isInflight  // фоновый рефреш

  return { data, error, loading, refreshing, refresh }
}

/**
 * Инвалидирует кеш для ключа и принудительно перезагружает.
 * Использовать после POST/PATCH/DELETE: `mutateApi('/api/admin/shifts?...')`.
 * Если без аргумента — рефрешит ВСЕ закешированные ключи (например после смены компании).
 */
export function mutateApi(key?: string) {
  if (key) {
    if (cache.has(key) || inflight.has(key)) {
      startFetch(key).catch(() => {})
    }
    return
  }
  // Refresh all
  for (const k of Array.from(cache.keys())) {
    startFetch(k).catch(() => {})
  }
}

/**
 * Префетч в фоне (для prefetch при ховере на ссылку).
 * `prefetchApi('/api/admin/shifts?weekStart=...')`
 */
export function prefetchApi(key: string) {
  if (!cache.has(key) && !inflight.has(key)) {
    startFetch(key).catch(() => {})
  }
}
