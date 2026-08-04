'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export function useUrlState<T extends Record<string, string>>(defaults: T): [T, (patch: Partial<T>) => void] {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  // defaults на вызове почти всегда литерал — новый объект на каждый рендер.
  // Держим первый: иначе state и setState меняли идентичность каждый рендер,
  // эффекты с [setFilters] в зависимостях стреляли снова и снова, каждый —
  // router.replace, а это навигация → template перемонтируется → страница
  // мигает скелетоном по кругу.
  const defaultsRef = useRef(defaults)
  const stableDefaults = defaultsRef.current

  // Читаем params через ref, чтобы setState был стабилен и после смены URL.
  const paramsRef = useRef(params)
  paramsRef.current = params

  const state = useMemo(() => {
    const next = { ...stableDefaults }
    for (const key of Object.keys(stableDefaults)) {
      const value = params.get(key)
      if (value != null) (next as Record<string, string>)[key] = value
    }
    return next
  }, [params, stableDefaults])

  const setState = useCallback(
    (patch: Partial<T>) => {
      const current = paramsRef.current
      const sp = new URLSearchParams(current.toString())
      for (const [rawKey, rawValue] of Object.entries(patch)) {
        const key = rawKey as keyof T
        const value = (rawValue ?? '') as string
        const defaultValue = stableDefaults[key]
        if (!value || value === defaultValue) sp.delete(String(key))
        else sp.set(String(key), value)
      }
      const query = sp.toString()
      // Ничего не изменилось — не трогаем роутер. Пустой replace тем же URL всё
      // равно считается навигацией и перезапускает анимацию входа страницы.
      if (query === current.toString()) return
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [stableDefaults, pathname, router],
  )

  return [state, setState]
}

export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
