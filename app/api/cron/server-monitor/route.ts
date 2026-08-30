import { NextResponse } from 'next/server'

import { verifyCronRequest } from '@/lib/server/cron-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { processMonitorNotificationOutbox } from '@/lib/server-monitoring/notifications'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  if (!hasAdminSupabaseCredentials()) return NextResponse.json({ error: 'monitor_backend_not_configured' }, { status: 503 })

  try {
    const supabase = createAdminSupabaseClient()
    const { data: heartbeat, error } = await supabase.rpc('server_monitor_check_offline', {
      p_now: new Date().toISOString(),
    })
    if (error) throw error
    const notifications = await processMonitorNotificationOutbox(40)
    const { data: retention, error: retentionError } = await supabase.rpc('server_monitor_cleanup_retention', {
      p_now: new Date().toISOString(),
    })
    if (retentionError) throw retentionError
    return NextResponse.json({ ok: true, heartbeat, notifications, retention })
  } catch (error) {
    console.error('[server-monitor] cron failed', error)
    return NextResponse.json({ error: 'server_monitor_cron_failed' }, { status: 500 })
  }
}
