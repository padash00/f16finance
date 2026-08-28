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

/**
 * Прочитать кэш вручную — для страниц, где загрузка уже написана своей функцией
 * и раскладывает ответ по нескольким состояниям (форма, фильтры, справочники).
 * Переписывать такую страницу на хук ради кэша дорого, а показать прошлые данные
 * мгновенно хочется:
 *
 *   const cached = readApiCache<Data>(url)
 *   if (cached) { apply(cached); setLoading(false) }   // экран уже не пустой
 *   const fresh = await fetch(url) ... ; writeApiCache(url, payload); apply(payload)
 *
 * Кэш общий с useApiCache, поэтому invalidateApiCache() чистит и его. Класть
 * нужно то же, что вернул бы хук — тело `data` из конверта ответа.
 */
export function readApiCache<T>(url: string, ttl = DEFAULT_TTL_MS): T | null {
  const entry = cache.get(url)
  if (!entry || Date.now() - entry.ts >= ttl) return null
  return entry.data as T
}

export function writeApiCache(url: string, data: unknown) {
  cache.set(url, { data, ts: Date.now() })
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
  /** Идёт ручная перезагрузка через refresh() — для спиннера на кнопке «Обновить». */
  refreshing: boolean
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
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Отбрасываем ответы устаревших запросов (быстрое переключение фильтров)
  const requestSeq = useRef(0)
  // Уже показывали данные хотя бы раз? Тогда при смене url НЕ обнуляем экран
  // (иначе последовательная гидрация фильтров/точки из localStorage меняет url
  // несколько раз подряд → страница мигает скелетоном 3-4 раза).
  const shownOnceRef = useRef(hasFresh)

  const load = useCallback(
    async (background: boolean) => {
      if (!active) return
      const seq = ++requestSeq.current
      const target = url!
      if (!background) setLoading(true)
      try {
        // no-store: иначе браузер может отдать свой HTTP-кэш и «Обновить» ничего не меняет
        const res = await fetch(target, { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        if (!res.ok) throw new Error(json?.error || `Ошибка загрузки (${res.status})`)
        const payload = (json?.data ?? json) as T
        cache.set(target, { data: payload, ts: Date.now() })
        if (seq !== requestSeq.current) return
        setData(payload)
        shownOnceRef.current = true
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
      shownOnceRef.current = true
      void load(true)
    } else if (shownOnceRef.current) {
      // Уже что-то показывали (сменился url после первой загрузки) — держим
      // прошлые данные на экране и тихо догружаем новые, без скелетона-мигания.
      void load(true)
    } else {
      // Самая первая загрузка — показываем скелетон.
      setData(null)
      void load(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, active, load])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await load(!!cache.get(url || ''))
    } finally {
      setRefreshing(false)
    }
  }, [load, url])

  return { data, loading, error, refreshing, refresh }
}
