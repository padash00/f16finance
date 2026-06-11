import { NextResponse } from 'next/server'

import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canView(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || ['owner', 'manager', 'other'].includes(access.staffRole)
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canView(access)) return json({ error: 'forbidden' }, 403)

    const url = new URL(request.url)
    const staffId = url.searchParams.get('staff_id')
    const status = url.searchParams.get('status')
    const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    let query = supabase
      .from('knowledge_quiz_attempts')
      .select(
        `id, organization_id, staff_id, status, started_at, completed_at,
         score, total_questions, correct_answers,
         staff:staff_id ( id, full_name, short_name, role )`,
      )
      .order('started_at', { ascending: false })
      .limit(limit)

    if (staffId) query = query.eq('staff_id', staffId)
    if (status && status !== 'all') query = query.eq('status', status)
    // Изоляция по организации
    const orgId = access.activeOrganization?.id || null
    if (orgId) query = query.or(`organization_id.is.null,organization_id.eq.${orgId}`)

    const { data, error } = await query
    if (error) throw error

    return json({ ok: true, data: { attempts: data || [] } })
  } catch (error) {
    return json(
      {
        error: 'admin-knowledge-quiz-attempts-failed',
        detail: (error as any)?.message || String(error),
      },
      500,
    )
  }
}
