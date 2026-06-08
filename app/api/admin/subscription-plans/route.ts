import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

// Тарифы платформы (subscription_plans). Только суперадмин.

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function num(v: any): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function getSupabase() {
  if (!hasAdminSupabaseCredentials()) throw new Error('admin-supabase-unavailable')
  return createAdminSupabaseClient()
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)

    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('subscription_plans')
      .select('id, code, name, description, status, price_monthly, price_yearly, currency, limits, features')
      .order('price_monthly', { ascending: true })
    if (error) throw error
    return json({ data: data ?? [] })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/subscription-plans GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)

    const body = (await req.json().catch(() => null)) as any
    const action = String(body?.action || 'updatePlan')

    const name = String(body?.name || '').trim()
    const code = String(body?.code || '').trim()
    if (!name) return json({ error: 'Название тарифа обязательно' }, 400)
    if (!code) return json({ error: 'Код тарифа обязателен' }, 400)

    const fields = {
      code,
      name,
      description: body?.description ?? null,
      status: String(body?.status || 'active') === 'archived' ? 'archived' : 'active',
      price_monthly: num(body?.priceMonthly) ?? 0,
      price_yearly: num(body?.priceYearly),
      currency: String(body?.currency || 'KZT'),
      limits: body?.limits && typeof body.limits === 'object' ? body.limits : {},
      features: body?.features && typeof body.features === 'object' ? body.features : {},
    }

    const supabase = getSupabase()

    if (action === 'createPlan') {
      const { data, error } = await supabase
        .from('subscription_plans')
        .insert([fields])
        .select('id')
        .single()
      if (error) throw error
      return json({ ok: true, planId: String((data as any).id) })
    }

    // updatePlan
    const planId = String(body?.planId || '').trim()
    if (!planId) return json({ error: 'planId обязателен' }, 400)
    const { error } = await supabase.from('subscription_plans').update(fields).eq('id', planId)
    if (error) throw error
    return json({ ok: true, planId })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/subscription-plans POST', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
