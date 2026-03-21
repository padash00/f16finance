import type { MetadataRoute } from 'next'

import { SITE_URL } from '@/lib/core/site'

const PRIVATE_PATHS = [
  '/api/',
  '/login',
  '/welcome',
  '/dashboard',
  '/setup-required',
  '/unauthorized',
  '/forgot-password',
  '/reset-password',
  '/set-password',
  '/income',
  '/expenses',
  '/salary',
  '/reports',
  '/analysis',
  '/weekly-report',
  '/cashflow',
  '/forecast',
  '/ratings',
  '/birthdays',
  '/structure',
  '/staff',
  '/tax',
  '/profitability',
  '/goals',
  '/operators',
  '/kpi',
  '/tasks',
  '/shifts',
  '/debug',
  '/settings',
  '/telegram',
  '/access',
  '/pass',
  '/categories',
  '/point-devices',
  '/operator-',
] as const

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [...PRIVATE_PATHS],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
