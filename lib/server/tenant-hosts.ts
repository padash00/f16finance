import { createClient } from '@supabase/supabase-js'

import { getTenantBaseHost, normalizeTenantHost } from '@/lib/core/tenant-domain'

type HostOrganization = {
  id: string
  name: string
  slug: string
  status: string
} | null

const HOST_CACHE_TTL_MS = 60_000 // 1 minute
const hostCache = new Map<string, { value: HostOrganization; expiresAt: number }>()
const defaultOrgCache = new Map<string, { value: HostOrganization; expiresAt: number }>()

function createServiceSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY

  if (!url || !key) return null

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export function normalizeRequestHost(hostHeader: string | null | undefined) {
  const rawHost = String(hostHeader || '')
    .trim()
    .toLowerCase()
    .split(':')[0]

  return normalizeTenantHost(rawHost)
}

export function getDefaultOrganizationSlug() {
  return String(process.env.DEFAULT_ORGANIZATION_SLUG || 'f16')
    .trim()
    .toLowerCase()
}

export async function resolveDefaultOrganization(): Promise<HostOrganization> {
  const slug = getDefaultOrganizationSlug()
  if (!slug) return null

  const cached = defaultOrgCache.get(slug)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const supabase = createServiceSupabaseClient()
  if (!supabase) return null

  const { data } = await supabase
    .from('organizations')
    .select('id, name, slug, status')
    .eq('slug', slug)
    .limit(1)
    .maybeSingle()

  const result: HostOrganization = (data as any)?.id
    ? {
        id: String((data as any).id),
        name: String((data as any).name || ''),
        slug: String((data as any).slug || ''),
        status: String((data as any).status || 'active'),
      }
    : null

  defaultOrgCache.set(slug, { value: result, expiresAt: Date.now() + HOST_CACHE_TTL_MS })
  return result
}

export async function resolveOrganizationByHost(hostHeader: string | null | undefined): Promise<HostOrganization> {
  const host = normalizeRequestHost(hostHeader)
  if (!host) return null

  const baseHost = getTenantBaseHost().toLowerCase()
  if (host === baseHost || host === `www.${baseHost}`) {
    return null
  }

  const cached = hostCache.get(host)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const supabase = createServiceSupabaseClient()
  if (!supabase) return null

  const directMatch = await supabase
    .from('tenant_domains')
    .select('organization:organization_id(id, name, slug, status)')
    .eq('host', host)
    .order('is_primary', { ascending: false })
    .limit(1)
    .maybeSingle()

  const directOrganization = Array.isArray((directMatch.data as any)?.organization)
    ? (directMatch.data as any)?.organization?.[0] || null
    : (directMatch.data as any)?.organization || null

  if (directOrganization?.id) {
    const result: HostOrganization = {
      id: String(directOrganization.id),
      name: String(directOrganization.name || ''),
      slug: String(directOrganization.slug || ''),
      status: String(directOrganization.status || 'active'),
    }
    hostCache.set(host, { value: result, expiresAt: Date.now() + HOST_CACHE_TTL_MS })
    return result
  }

  if (!host.endsWith(`.${baseHost}`)) {
    return null
  }

  const slugFallback = host.slice(0, -(baseHost.length + 1)).trim()
  if (!slugFallback) {
    return null
  }

  const legacyMatch = await supabase
    .from('tenant_domains')
    .select('organization:organization_id(id, name, slug, status)')
    .eq('host', slugFallback)
    .order('is_primary', { ascending: false })
    .limit(1)
    .maybeSingle()

  const legacyOrganization = Array.isArray((legacyMatch.data as any)?.organization)
    ? (legacyMatch.data as any)?.organization?.[0] || null
    : (legacyMatch.data as any)?.organization || null

  if (!legacyOrganization?.id) {
    hostCache.set(host, { value: null, expiresAt: Date.now() + HOST_CACHE_TTL_MS })
    return null
  }

  const legacyResult: HostOrganization = {
    id: String(legacyOrganization.id),
    name: String(legacyOrganization.name || ''),
    slug: String(legacyOrganization.slug || ''),
    status: String(legacyOrganization.status || 'active'),
  }
  hostCache.set(host, { value: legacyResult, expiresAt: Date.now() + HOST_CACHE_TTL_MS })
  return legacyResult
}
