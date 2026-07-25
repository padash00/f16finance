import { NextResponse } from 'next/server'

import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Онбординг-тур активной орг:
 *  GET  → { show } — показывать ли тур (orgs.onboarding_tour_enabled && !member.onboarding_done)
 *  POST → отметить тур пройденным (onboarding_done=true) для текущего пользователя в орг.
 * Толерантно к до-миграционному состоянию (нет колонок → show:false).
 */
function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const orgId = access.activeOrganization?.id || null
  const userId = access.user?.id || null
  if (!orgId || !userId) return json({ show: false })

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : (access.supabase as any)

  try {
    const { data: org } = await supabase
      .from('organizations')
      .select('onboarding_tour_enabled')
      .eq('id', orgId)
      .maybeSingle()
    if (!(org as any)?.onboarding_tour_enabled) return json({ show: false })

    const { data: member } = await supabase
      .from('organization_members')
      .select('onboarding_done')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .maybeSingle()

    return json({ show: !(member as any)?.onboarding_done })
  } catch {
    return json({ show: false })
  }
}

export async function POST(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const orgId = access.activeOrganization?.id || null
  const userId = access.user?.id || null
  if (!orgId || !userId) return json({ ok: true })

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : (access.supabase as any)
  try {
    await supabase
      .from('organization_members')
      .update({ onboarding_done: true })
      .eq('organization_id', orgId)
      .eq('user_id', userId)
  } catch {
    /* до-миграции — молча */
  }
  return json({ ok: true })
}
