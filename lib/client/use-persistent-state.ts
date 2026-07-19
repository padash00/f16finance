'use client'

/**
 * useState с памятью в localStorage: фильтры/период/точка переживают уход со
 * страницы и перезагрузку. Ключи скоупим префиксом страницы:
 *
 *   const [period, setPeriod] = usePersistentState('expenses.period', 'month')
 *
 * Значение сериализуется в JSON. SSR-безопасно: первый рендер отдаёт дефолт,
 * после маунта подтягивается сохранённое (страницы портала клиентские — мигания
 * данных нет, фильтры применяются до загрузки).
 */

import { useEffect, useRef, useState } from 'react'

const PREFIX = 'orda.ui.'

export function usePersistentState<T>(key: string, defaultValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const storageKey = PREFIX + key
  const [value, setValue] = useState<T>(defaultValue)
  const loadedRef = useRef(false)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw !== null) setValue(JSON.parse(raw) as T)
    } catch { /* повреждённое значение — остаёмся на дефолте */ }
    loadedRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  useEffect(() => {
    if (!loadedRef.current) return
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value))
    } catch { /* квота/приватный режим — молча пропускаем */ }
  }, [storageKey, value])

  return [value, setValue]
}
