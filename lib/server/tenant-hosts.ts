import { createClient } from '@supabase/supabase-js'

import { getTenantBaseHost, normalizeTenantHost } from '@/lib/core/tenant-domain'

type HostOrganization = {
  id: string
  name: string
  slug: string
  status: string
} | null

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

export async function resolveOrganizationByHost(hostHeader: string | null | undefined): Promise<HostOrganization> {
  const host = normalizeRequestHost(hostHeader)
  if (!host) return null

  const baseHost = getTenantBaseHost().toLowerCase()
  if (host === baseHost || host === `www.${baseHost}`) {
    return null
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
    return {
      id: String(directOrganization.id),
      name: String(directOrganization.name || ''),
      slug: String(directOrganization.slug || ''),
      status: String(directOrganization.status || 'active'),
    }
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
    return null
  }

  return {
    id: String(legacyOrganization.id),
    name: String(legacyOrganization.name || ''),
    slug: String(legacyOrganization.slug || ''),
    status: String(legacyOrganization.status || 'active'),
  }
}
