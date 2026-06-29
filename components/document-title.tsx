'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

import { navSections } from '@/lib/nav/sections'

// Плоская карта «адрес → название» из конфига навигации (один источник правды).
const TITLE_BY_PATH: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const section of navSections) {
    for (const item of section.items) {
      if (item.href && item.label) map[item.href] = item.label
    }
  }
  return map
})()

function resolveTitle(pathname: string): string | null {
  if (!pathname) return null
  if (TITLE_BY_PATH[pathname]) return TITLE_BY_PATH[pathname]
  // Для вложенных/динамических путей (/shifts/reports/123) пробуем родительские сегменты.
  const parts = pathname.split('/').filter(Boolean)
  for (let i = parts.length - 1; i > 0; i--) {
    const candidate = '/' + parts.slice(0, i).join('/')
    if (TITLE_BY_PATH[candidate]) return TITLE_BY_PATH[candidate]
  }
  return null
}

/**
 * Подставляет название текущей страницы в заголовок вкладки браузера:
 * «Логирование · Orda Control». Монтируется один раз в layout — работает для всех страниц.
 */
export function DocumentTitle() {
  const pathname = usePathname()
  useEffect(() => {
    const name = resolveTitle(pathname || '')
    document.title = name ? `${name} · Orda Control` : 'Orda Control'
  }, [pathname])
  return null
}
