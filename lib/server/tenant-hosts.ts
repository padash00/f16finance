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

// SaaS tenant-host resolution removed — always return null (single-tenant mode)
export async function resolveOrganizationByHost(hostHeader: string | null | undefined): Promise<HostOrganization> {
  return null
}
