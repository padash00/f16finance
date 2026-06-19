import { NextResponse } from 'next/server'
import { requireStaffCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireStaffCapability(access, 'goals.view')
    if (denied) return denied
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    // Изоляция: цели — по своей организации. NEVER-pattern для не-суперадмина без орг.
    const orgId = access.activeOrganization?.id || null
    if (!access.isSuperAdmin && !orgId) return NextResponse.json({ data: [], tableExists: true })
    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    let q = supabase.from('goals').select('*').order('period', { ascending: false })
    if (orgId) q = q.eq('organization_id', orgId)
    if (from) q = q.gte('period', from)
    if (to) q = q.lte('period', to)
    const { data, error } = await q
    if (error) {
      if (error.code === '42P01') return NextResponse.json({ data: [], tableExists: false })
      throw error
    }
    return NextResponse.json({ data: data ?? [], tableExists: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireStaffCapability(access, 'goals.view')
    if (denied) return denied
    const body = await request.json()
    const { period, target_income, target_expense, note } = body
    if (!period) return NextResponse.json({ error: 'period required' }, { status: 400 })
    // Изоляция: цель привязывается к своей организации, конфликт — по (organization_id, period).
    const orgId = access.activeOrganization?.id || null
    if (!access.isSuperAdmin && !orgId) return NextResponse.json({ error: 'Нет активной организации' }, { status: 400 })
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const { data, error } = await supabase
      .from('goals')
      .upsert({ organization_id: orgId, period, target_income: target_income ?? 0, target_expense: target_expense ?? 0, note: note ?? null, updated_at: new Date().toISOString() }, { onConflict: 'organization_id,period' })
      .select()
      .single()
    if (error) throw error
    return NextResponse.json({ data })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 })
  }
}
