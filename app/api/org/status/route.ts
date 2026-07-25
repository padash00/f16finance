import { NextResponse } from 'next/server'

import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Лёгкий статус подписки активной орг для баннеров веб-приложения.
 * Если орг приостановлена — getRequestAccessContext вернёт 403 с
 * code:'organization-suspended' (по нему клиент показывает экран блокировки).
 */
function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response // suspended/forbidden → клиент разберёт

  const orgId = access.activeOrganization?.id || null
  if (!orgId) return json({ ok: true, subscription: null, billingExempt: false })

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : (access.supabase as any)

  // Толерантно к до-миграционному состоянию (может не быть trial_ends_at/grace_until/billing_exempt).
  let sub: any = null
  try {
    const { data } = await supabase
      .from('organization_subscriptions')
      .select('status, ends_at, trial_ends_at, grace_until')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    sub = data || null
  } catch {
    sub = null
  }

  let billingExempt = false
  try {
    const { data: org } = await supabase.from('organizations').select('billing_exempt').eq('id', orgId).maybeSingle()
    billingExempt = !!(org as any)?.billing_exempt
  } catch {
    billingExempt = false
  }

  return json({
    ok: true,
    billingExempt,
    subscription: sub
      ? {
          status: String(sub.status || ''),
          endsAt: sub.ends_at || null,
          trialEndsAt: sub.trial_ends_at || null,
          graceUntil: sub.grace_until || null,
        }
      : null,
  })
}
