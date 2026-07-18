'use client'

/**
 * Кэш GET-запросов к API со stale-while-revalidate:
 * повторное открытие страницы мгновенно показывает прошлые данные,
 * свежие подтягиваются фоном и тихо заменяют.
 *
 *   const { data, loading, error, refresh } = useApiCache<Item[]>('/api/admin/...')
 *
 * - Первый заход: loading=true → скелетон → данные.
 * - Повторный заход (кэш жив): данные сразу, loading=false, фоновая ревалидация.
 * - После мутаций зови refresh() (дождётся свежих данных и обновит кэш)
 *   или invalidateApiCache('/api/admin/...') чтобы сбросить кэш из другого места.
 *
 * Кэш живёт в памяти вкладки; TTL по умолчанию 5 минут — старше не показываем
 * даже как заглушку, идём как в первый раз.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

type CacheEntry = { data: unknown; ts: number }

const cache = new Map<string, CacheEntry>()

const DEFAULT_TTL_MS = 5 * 60_000

/** Сбросить кэш: без аргумента — весь, с prefix — все ключи, начинающиеся с него. */
export function invalidateApiCache(prefix?: string) {
  if (!prefix) {
    cache.clear()
    return
  }
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}

type UseApiCacheOptions = {
  /** Мс, сколько кэш годен как мгновенная заглушка (по умолчанию 5 мин). */
  ttl?: number
  /** false — не запрашивать (например, пока не выбрана компания). */
  enabled?: boolean
}

type UseApiCacheResult<T> = {
  data: T | null
  loading: boolean
  error: string | null
  /** Принудительно перезагрузить (показывает loading только если данных ещё нет). */
  refresh: () => Promise<void>
}

export function useApiCache<T>(url: string | null, options: UseApiCacheOptions = {}): UseApiCacheResult<T> {
  const { ttl = DEFAULT_TTL_MS, enabled = true } = options
  const active = enabled && !!url

  const fresh = active ? cache.get(url!) : undefined
  const hasFresh = !!fresh && Date.now() - fresh.ts < ttl

  const [data, setData] = useState<T | null>(hasFresh ? (fresh!.data as T) : null)
  const [loading, setLoading] = useState(active && !hasFresh)
  const [error, setError] = useState<string | null>(null)
  // Отбрасываем ответы устаревших запросов (быстрое переключение фильтров)
  const requestSeq = useRef(0)

  const load = useCallback(
    async (background: boolean) => {
      if (!active) return
      const seq = ++requestSeq.current
      const target = url!
      if (!background) setLoading(true)
      try {
        const res = await fetch(target)
        const json = await res.json().catch(() => null)
        if (!res.ok) throw new Error(json?.error || `Ошибка загрузки (${res.status})`)
        const payload = (json?.data ?? json) as T
        cache.set(target, { data: payload, ts: Date.now() })
        if (seq !== requestSeq.current) return
        setData(payload)
        setError(null)
      } catch (e: any) {
        if (seq !== requestSeq.current) return
        // Фоновая ревалидация упала — не пугаем, на экране остаются прошлые данные
        if (!background) setError(e?.message || 'Ошибка загрузки')
      } finally {
        if (seq === requestSeq.current) setLoading(false)
      }
    },
    [url, active],
  )

  useEffect(() => {
    if (!active) return
    const entry = cache.get(url!)
    const isFresh = !!entry && Date.now() - entry.ts < ttl
    if (isFresh) {
      setData(entry!.data as T)
      setLoading(false)
      void load(true)
    } else {
      setData(null)
      void load(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, active, load])

  const refresh = useCallback(async () => {
    await load(!!cache.get(url || ''))
  }, [load, url])

  return { data, loading, error, refresh }
}
