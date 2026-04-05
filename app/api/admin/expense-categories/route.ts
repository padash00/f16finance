import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function getSupabase(req: Request) {
  return hasAdminSupabaseCredentials()
    ? createAdminSupabaseClient()
    : createRequestSupabaseClient(req)
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const supabase = getSupabase(req)
    const result = await supabase
      .from('expense_categories')
      .select('id, name, accounting_group, monthly_budget')
      .order('name')
    if (result.error) throw result.error
    const data = result.data ?? []

    return json({ data: data ?? [] })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/expense-categories GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin && access.staffRole !== 'owner') {
      return json({ error: 'forbidden' }, 403)
    }

    const body = await req.json().catch(() => null) as {
      name?: string | null
      accounting_group?: string | null
      monthly_budget?: number | null
    } | null
    const name = String(body?.name || '').trim()
    if (!name) return json({ error: 'Название категории обязательно' }, 400)

    const supabase = getSupabase(req)
    const { data, error } = await supabase
      .from('expense_categories')
      .insert([{
        name,
        accounting_group: String(body?.accounting_group || '').trim() || 'operating',
        monthly_budget: Number(body?.monthly_budget || 0) || 0,
      }])
      .select('id, name, accounting_group, monthly_budget')
      .single()
    if (error) throw error

    return json({ ok: true, data })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/expense-categories POST', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function PATCH(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin && access.staffRole !== 'owner') {
      return json({ error: 'forbidden' }, 403)
    }

    const body = await req.json().catch(() => null) as {
      id?: string | null
      name?: string | null
      accounting_group?: string | null
      monthly_budget?: number | null
    } | null
    const id = String(body?.id || '').trim()
    const name = String(body?.name || '').trim()
    if (!id) return json({ error: 'id обязателен' }, 400)
    if (!name) return json({ error: 'Название категории обязательно' }, 400)

    const supabase = getSupabase(req)
    const { data, error } = await supabase
      .from('expense_categories')
      .update({
        name,
        accounting_group: String(body?.accounting_group || '').trim() || 'operating',
        monthly_budget: Number(body?.monthly_budget || 0) || 0,
      })
      .eq('id', id)
      .select('id, name, accounting_group, monthly_budget')
      .single()
    if (error) throw error

    return json({ ok: true, data })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/expense-categories PATCH', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function DELETE(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin && access.staffRole !== 'owner') {
      return json({ error: 'forbidden' }, 403)
    }

    const id = String(new URL(req.url).searchParams.get('id') || '').trim()
    if (!id) return json({ error: 'id обязателен' }, 400)

    const supabase = getSupabase(req)
    const { error } = await supabase.from('expense_categories').delete().eq('id', id)
    if (error) throw error
    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/expense-categories DELETE', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
