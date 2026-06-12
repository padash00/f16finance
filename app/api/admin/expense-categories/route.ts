import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { listOrganizationCompanyIds } from '@/lib/server/organizations'
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

function currentMonthRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const toIso = (d: Date) => d.toISOString().slice(0, 10)
  return { from: toIso(start), to: toIso(end) }
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const denied = await requireCapability(access, 'categories.view')
    if (denied) return denied as any

    const supabase = getSupabase(req)
    let catQuery = supabase
      .from('expense_categories')
      .select('id, name, accounting_group, monthly_budget')
      .order('name')
    // Скоуп по активной организации (+ глобальные дефолты с organization_id IS NULL).
    // Супер-админ тоже скоупится по активной орг (изоляция в контексте орг).
    const orgId = access.activeOrganization?.id || null
    if (orgId) catQuery = catQuery.or(`organization_id.is.null,organization_id.eq.${orgId}`)
    const result = await catQuery
    if (result.error) throw result.error
    const categories = result.data ?? []

    const withUsage = String(new URL(req.url).searchParams.get('with_usage') || '').trim() === '1'
    if (!withUsage) {
      return json({ data: categories })
    }

    const { from, to } = currentMonthRange()
    const allowedCompanyIds = await listOrganizationCompanyIds({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    let spentQuery = supabase
      .from('expenses')
      .select('category, cash_amount, kaspi_amount')
      .gte('date', from)
      .lte('date', to)
    if (allowedCompanyIds) {
      if (allowedCompanyIds.length === 0) {
        return json({
          data: categories.map((c: any) => ({ ...c, spent_this_month: 0 })),
          period: { from, to },
        })
      }
      spentQuery = spentQuery.in('company_id', allowedCompanyIds)
    }
    const { data: spentRows, error: spentError } = await spentQuery
    if (spentError) throw spentError

    const byCategory = new Map<string, number>()
    for (const row of spentRows || []) {
      const key = String((row as any).category || '').trim()
      if (!key) continue
      const total = Number((row as any).cash_amount || 0) + Number((row as any).kaspi_amount || 0)
      byCategory.set(key, (byCategory.get(key) || 0) + total)
    }

    const enriched = categories.map((c: any) => ({
      ...c,
      spent_this_month: byCategory.get(String(c.name || '').trim()) || 0,
    }))

    return json({ data: enriched, period: { from, to } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/expense-categories GET', message: error?.message || 'error' })
    return json({
      error: error?.message || error?.details || error?.hint || error?.code || 'Ошибка сервера',
      detail: error?.details || null,
      hint: error?.hint || null,
      code: error?.code || null,
    }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const denied = await requireCapability(access, 'categories.create')
    if (denied) return denied as any

    // Capability checks выше уже отсеивают; здесь — любой staff
    if (!access.isSuperAdmin && !access.staffRole) {
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
        organization_id: access.activeOrganization?.id || null,
      }])
      .select('id, name, accounting_group, monthly_budget')
      .single()
    if (error) throw error

    return json({ ok: true, data })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/expense-categories POST', message: error?.message || 'error' })
    return json({
      error: error?.message || error?.details || error?.hint || error?.code || 'Ошибка сервера',
      detail: error?.details || null,
      hint: error?.hint || null,
      code: error?.code || null,
    }, 500)
  }
}

export async function PATCH(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const denied = await requireCapability(access, 'categories.edit')
    if (denied) return denied as any

    // Capability checks выше уже отсеивают; здесь — любой staff
    if (!access.isSuperAdmin && !access.staffRole) {
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
    return json({
      error: error?.message || error?.details || error?.hint || error?.code || 'Ошибка сервера',
      detail: error?.details || null,
      hint: error?.hint || null,
      code: error?.code || null,
    }, 500)
  }
}

export async function DELETE(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const denied = await requireCapability(access, 'categories.delete')
    if (denied) return denied as any

    // Capability checks выше уже отсеивают; здесь — любой staff
    if (!access.isSuperAdmin && !access.staffRole) {
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
    return json({
      error: error?.message || error?.details || error?.hint || error?.code || 'Ошибка сервера',
      detail: error?.details || null,
      hint: error?.hint || null,
      code: error?.code || null,
    }, 500)
  }
}
