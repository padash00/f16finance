import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope, resolveEffectiveOrganizationId } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

// Планировщик закупа на следующую неделю (для weekly-report PDF).
// Доступ — любой staff (страница weekly-report уже гейтится middleware).

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManage(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || !!access.staffRole
}

function getSupabase(access: { supabase: any }) {
  return hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
}

const SELECT_COLS =
  'id, organization_id, company_id, week_start, day_of_week, category, title, supplier, quantity, amount, comment, status, created_at, updated_at'

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!canManage(access)) return json({ error: 'forbidden' }, 403)

    const supabase = getSupabase(access)
    const url = new URL(req.url)
    const weekStart = String(url.searchParams.get('week_start') || '').trim()
    const companyId = String(url.searchParams.get('company_id') || '').trim()

    let query = supabase
      .from('purchase_plan_items')
      .select(SELECT_COLS)
      .order('day_of_week', { ascending: true })
      .order('created_at', { ascending: true })

    if (weekStart) query = query.eq('week_start', weekStart)
    if (companyId) query = query.eq('company_id', companyId)

    const scope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    if (scope.allowedCompanyIds) {
      if (scope.allowedCompanyIds.length === 0) return json({ data: [] })
      query = query.in('company_id', scope.allowedCompanyIds)
    }

    const { data, error } = await query
    if (error) throw error
    return json({ data: data ?? [] })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/purchase-plan GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!canManage(access)) return json({ error: 'forbidden' }, 403)

    const body = (await req.json().catch(() => null)) as {
      company_id?: string | null
      week_start?: string | null
      day_of_week?: number | null
      category?: string | null
      title?: string | null
      supplier?: string | null
      quantity?: number | null
      amount?: number | null
      comment?: string | null
    } | null

    const weekStart = String(body?.week_start || '').trim()
    const dayOfWeek = Number(body?.day_of_week)
    const title = String(body?.title || '').trim()

    if (!weekStart) return json({ error: 'week_start обязателен' }, 400)
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) {
      return json({ error: 'day_of_week должен быть 1..7' }, 400)
    }
    if (!title) return json({ error: 'Укажите, что закупаем' }, 400)

    const supabase = getSupabase(access)
    const organizationId = await resolveEffectiveOrganizationId({
      supabase,
      activeOrganizationId: access.activeOrganization?.id || null,
    }).catch(() => null)

    const insertRow = {
      organization_id: organizationId,
      company_id: String(body?.company_id || '').trim() || null,
      week_start: weekStart,
      day_of_week: dayOfWeek,
      category: String(body?.category || '').trim() || null,
      title,
      supplier: String(body?.supplier || '').trim() || null,
      quantity: body?.quantity != null && body.quantity !== ('' as any) ? Number(body.quantity) : null,
      amount: body?.amount != null && body.amount !== ('' as any) ? Number(body.amount) : null,
      comment: String(body?.comment || '').trim() || null,
      status: 'planned',
      created_by: (access as any).user?.id || null,
    }

    const { data, error } = await supabase
      .from('purchase_plan_items')
      .insert([insertRow])
      .select(SELECT_COLS)
      .single()
    if (error) throw error

    return json({ ok: true, data })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/purchase-plan POST', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function PATCH(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!canManage(access)) return json({ error: 'forbidden' }, 403)

    const body = (await req.json().catch(() => null)) as {
      id?: string | null
      day_of_week?: number | null
      category?: string | null
      title?: string | null
      supplier?: string | null
      quantity?: number | null
      amount?: number | null
      comment?: string | null
      status?: string | null
    } | null

    const id = String(body?.id || '').trim()
    if (!id) return json({ error: 'id обязателен' }, 400)

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body?.day_of_week != null) {
      const d = Number(body.day_of_week)
      if (!Number.isInteger(d) || d < 1 || d > 7) return json({ error: 'day_of_week должен быть 1..7' }, 400)
      patch.day_of_week = d
    }
    if (body?.title !== undefined) {
      const t = String(body?.title || '').trim()
      if (!t) return json({ error: 'Укажите, что закупаем' }, 400)
      patch.title = t
    }
    if (body?.category !== undefined) patch.category = String(body?.category || '').trim() || null
    if (body?.supplier !== undefined) patch.supplier = String(body?.supplier || '').trim() || null
    if (body?.comment !== undefined) patch.comment = String(body?.comment || '').trim() || null
    if (body?.quantity !== undefined) patch.quantity = body?.quantity != null && body.quantity !== ('' as any) ? Number(body.quantity) : null
    if (body?.amount !== undefined) patch.amount = body?.amount != null && body.amount !== ('' as any) ? Number(body.amount) : null
    if (body?.status !== undefined) {
      const s = String(body?.status || '').trim()
      if (s !== 'planned' && s !== 'bought') return json({ error: 'Неверный статус' }, 400)
      patch.status = s
    }

    const supabase = getSupabase(access)
    const { data, error } = await supabase
      .from('purchase_plan_items')
      .update(patch)
      .eq('id', id)
      .select(SELECT_COLS)
      .single()
    if (error) throw error

    return json({ ok: true, data })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/purchase-plan PATCH', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function DELETE(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!canManage(access)) return json({ error: 'forbidden' }, 403)

    const id = String(new URL(req.url).searchParams.get('id') || '').trim()
    if (!id) return json({ error: 'id обязателен' }, 400)

    const supabase = getSupabase(access)
    const { error } = await supabase.from('purchase_plan_items').delete().eq('id', id)
    if (error) throw error
    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/purchase-plan DELETE', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
