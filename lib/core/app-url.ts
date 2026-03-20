const HTTPS_PREFIX = 'https://'

function normalizeAppUrl(value: string | null | undefined) {
  const trimmed = value?.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed.replace(/\/+$/, '')
  }

  return `${HTTPS_PREFIX}${trimmed.replace(/\/+$/, '')}`
}

export function getConfiguredAppUrl() {
  return (
    normalizeAppUrl(process.env.NEXT_PUBLIC_APP_URL) ||
    normalizeAppUrl(process.env.APP_URL) ||
    normalizeAppUrl(process.env.NEXT_PUBLIC_SITE_URL) ||
    normalizeAppUrl(process.env.SITE_URL) ||
    normalizeAppUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
    normalizeAppUrl(process.env.VERCEL_URL)
  )
}

export function getPublicAppUrl(fallbackOrigin?: string) {
  return getConfiguredAppUrl() || normalizeAppUrl(fallbackOrigin) || 'http://localhost:3000'
}
