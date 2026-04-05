import type { MetadataRoute } from 'next'

import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/core/site'

function shortName(): string {
  if (SITE_NAME.length <= 12) return SITE_NAME
  return `${SITE_NAME.slice(0, 11)}…`
}

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: shortName(),
    description: SITE_DESCRIPTION,
    /** Ярлык PWA открывает кабинет оператора (смартфон). Админка доступна по обычному URL в браузере. */
    start_url: '/operator',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#050816',
    theme_color: '#f59e0b',
    lang: 'ru',
    categories: ['business', 'finance', 'productivity'],
    icons: [
      {
        src: '/icon',
        sizes: '64x64',
        type: 'image/png',
      },
      {
        src: '/apple-icon',
        sizes: '180x180',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa-192',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa-512',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/pwa-512',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
