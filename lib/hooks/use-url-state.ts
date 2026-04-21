'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export function useUrlState<T extends Record<string, string>>(defaults: T): [T, (patch: Partial<T>) => void] {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const state = useMemo(() => {
    const next = { ...defaults }
    for (const key of Object.keys(defaults)) {
      const value = params.get(key)
      if (value != null) (next as Record<string, string>)[key] = value
    }
    return next
  }, [params, defaults])

  const setState = useCallback(
    (patch: Partial<T>) => {
      const sp = new URLSearchParams(params.toString())
      for (const [rawKey, rawValue] of Object.entries(patch)) {
        const key = rawKey as keyof T
        const value = (rawValue ?? '') as string
        const defaultValue = defaults[key]
        if (!value || value === defaultValue) sp.delete(String(key))
        else sp.set(String(key), value)
      }
      const query = sp.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [defaults, params, pathname, router],
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
