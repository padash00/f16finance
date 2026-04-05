import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

export async function GET(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  try {
    const supabase = createAdminSupabaseClient()
    const { data, error } = await supabase
      .from('telegram_allowed_users')
      .select('id, telegram_user_id, label, can_finance, created_at')
      .order('created_at', { ascending: false })

    if (error) {
      // Table doesn't exist yet
      if (error.code === '42P01') {
        return NextResponse.json({ data: [], tableExists: false })
      }
      throw error
    }
    return NextResponse.json({ data: data ?? [], tableExists: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const body = await request.json().catch(() => ({}))
  const telegramUserId = String(body.telegram_user_id || '').trim()
  const label = String(body.label || '').trim() || null
  const canFinance = body.can_finance !== false

  if (!telegramUserId) {
    return NextResponse.json({ error: 'telegram_user_id обязателен' }, { status: 400 })
  }

  try {
    const supabase = createAdminSupabaseClient()
    const { data, error } = await supabase
      .from('telegram_allowed_users')
      .upsert([{ telegram_user_id: telegramUserId, label, can_finance: canFinance }], {
        onConflict: 'telegram_user_id',
      })
      .select('id, telegram_user_id, label, can_finance')
      .single()

    if (error) throw error
    return NextResponse.json({ ok: true, data })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })

  try {
    const supabase = createAdminSupabaseClient()
    const { error } = await supabase.from('telegram_allowed_users').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const body = await request.json().catch(() => ({}))
  const { id, label, can_finance } = body
  if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })

  try {
    const supabase = createAdminSupabaseClient()
    const { error } = await supabase
      .from('telegram_allowed_users')
      .update({ label: label ?? null, can_finance: can_finance !== false })
      .eq('id', id)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
