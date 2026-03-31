import { SITE_URL } from '@/lib/core/site'

function getNormalizedSiteUrl() {
  const raw = String(SITE_URL || '').trim() || 'https://ordaops.kz'
  return raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`
}

export function getTenantBaseHost() {
  const url = new URL(getNormalizedSiteUrl())
  const hostname = url.hostname.replace(/^www\./i, '')
  return url.port ? `${hostname}:${url.port}` : hostname
}

export function buildTenantHost(slug: string) {
  const normalizedSlug = String(slug || '')
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, '')

  if (!normalizedSlug) {
    return getTenantBaseHost()
  }

  return `${normalizedSlug}.${getTenantBaseHost()}`
}

export function normalizeTenantHost(value: string | null | undefined) {
  const trimmed = String(value || '').trim().toLowerCase()
  if (!trimmed) return null
  return trimmed.includes('.') ? trimmed : buildTenantHost(trimmed)
}

export function buildTenantUrl(slugOrHost: string) {
  const siteUrl = new URL(getNormalizedSiteUrl())
  const normalized = String(slugOrHost || '').trim().toLowerCase()
  const host = normalized.includes('.') ? normalized : buildTenantHost(normalized)
  return `${siteUrl.protocol}//${host}`
}
