import type { MetadataRoute } from 'next'

import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/core/site'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: '/',
    display: 'standalone',
    background_color: '#050816',
    theme_color: '#f59e0b',
    lang: 'ru',
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
      },
    ],
  }
}
