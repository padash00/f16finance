import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    let q = supabase.from('goals').select('*').order('period', { ascending: false })
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
    const body = await request.json()
    const { period, target_income, target_expense, note } = body
    if (!period) return NextResponse.json({ error: 'period required' }, { status: 400 })
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const { data, error } = await supabase
      .from('goals')
      .upsert({ period, target_income: target_income ?? 0, target_expense: target_expense ?? 0, note: note ?? null, updated_at: new Date().toISOString() }, { onConflict: 'period' })
      .select()
      .single()
    if (error) throw error
    return NextResponse.json({ data })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 })
  }
}
