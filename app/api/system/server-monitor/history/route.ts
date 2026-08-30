import { NextResponse } from 'next/server'

import { getRequestAccessContext } from '@/lib/server/request-auth'
import { requireCapability } from '@/lib/server/capabilities'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

const RANGE_SECONDS: Record<string, number> = {
  '1h': 3600,
  '6h': 6 * 3600,
  '24h': 24 * 3600,
  '7d': 7 * 86400,
  '30d': 30 * 86400,
}

function bucketForRange(seconds: number): number {
  if (seconds <= 6 * 3600) return 300
  if (seconds <= 24 * 3600) return 900
  if (seconds <= 7 * 86400) return 3600
  return 7200
}

export async function GET(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response
  const denied = await requireCapability(access, 'server-monitor.view')
  if (denied) return denied
  if (!hasAdminSupabaseCredentials()) return NextResponse.json({ error: 'monitor_backend_not_configured' }, { status: 503 })

  const url = new URL(request.url)
  const serverId = url.searchParams.get('serverId') || ''
  const range = url.searchParams.get('range') || '24h'
  const rangeSeconds = RANGE_SECONDS[range]
  if (!/^[0-9a-f-]{36}$/i.test(serverId) || !rangeSeconds) {
    return NextResponse.json({ error: 'invalid_history_request' }, { status: 422 })
  }
  const organizationId = access.activeOrganization?.id || null
  if (!organizationId) return NextResponse.json({ error: 'organization_required' }, { status: 409 })

  const supabase = createAdminSupabaseClient()
  const { data: server, error: serverError } = await supabase
    .from('server_monitor_servers').select('id').eq('id', serverId).eq('organization_id', organizationId).maybeSingle()
  if (serverError) return NextResponse.json({ error: 'history_lookup_failed' }, { status: 500 })
  if (!server) return NextResponse.json({ error: 'server_not_found' }, { status: 404 })

  const to = new Date()
  const from = new Date(to.getTime() - rangeSeconds * 1000)
  const { data, error } = await supabase.rpc('server_monitor_history', {
    p_server_id: serverId,
    p_from: from.toISOString(),
    p_to: to.toISOString(),
    p_bucket_seconds: bucketForRange(rangeSeconds),
  })
  if (error) {
    console.error('[server-monitor] history failed', error)
    return NextResponse.json({ error: 'history_failed' }, { status: 500 })
  }
  return NextResponse.json({ range, from: from.toISOString(), to: to.toISOString(), points: data || [] })
}
