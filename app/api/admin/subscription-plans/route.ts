import { NextResponse } from 'next/server'

import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

type PlanMutationBody = {
  action?: 'createPlan' | 'updatePlan'
  planId?: string | null
  code?: string | null
  name?: string | null
  description?: string | null
  status?: string | null
  priceMonthly?: number | null
  priceYearly?: number | null
  currency?: string | null
  limits?: Record<string, unknown> | null
  features?: Record<string, unknown> | null
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function slugifyCode(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

function normalizeMoney(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error('price-invalid')
  }
  return numeric
}

function normalizeStatus(value: string | null | undefined) {
  const normalized = String(value || 'active').trim().toLowerCase()
  if (normalized !== 'active' && normalized !== 'archived') {
    throw new Error('status-invalid')
  }
  return normalized
}

function normalizeLimits(value: Record<string, unknown> | null | undefined) {
  const source = value || {}
  const normalized: Record<string, number> = {}

  for (const [key, raw] of Object.entries(source)) {
    if (raw === null || raw === undefined || raw === '') continue
    const numeric = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(numeric) || numeric < 0) {
      throw new Error(`limit-invalid:${key}`)
    }
    normalized[key] = numeric
  }

  return normalized
}

function normalizeFeatures(value: Record<string, unknown> | null | undefined) {
  const source = value || {}
  return Object.fromEntries(Object.entries(source).map(([key, raw]) => [key, Boolean(raw)]))
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) {
      return json({ error: 'forbidden' }, 403)
    }

    const body = (await req.json().catch(() => null)) as PlanMutationBody | null
    if (!body?.action) {
      return json({ error: 'invalid-action' }, 400)
    }

    const code = slugifyCode(String(body.code || ''))
    const name = String(body.name || '').trim()
    if (!name) {
      return json({ error: 'Название тарифа обязательно' }, 400)
    }
    if (!code) {
      return json({ error: 'Код тарифа обязателен' }, 400)
    }

    const supabase = createAdminSupabaseClient()
    const payload = {
      code,
      name,
      description: String(body.description || '').trim() || null,
      status: normalizeStatus(body.status),
      price_monthly: normalizeMoney(body.priceMonthly),
      price_yearly: normalizeMoney(body.priceYearly),
      currency: String(body.currency || 'KZT').trim().toUpperCase() || 'KZT',
      limits: normalizeLimits(body.limits),
      features: normalizeFeatures(body.features),
    }

    if (body.action === 'createPlan') {
      const { data, error } = await supabase
        .from('subscription_plans')
        .insert([payload])
        .select('id')
        .single()

      if (error) throw error
      return json({ ok: true, planId: String((data as any).id || '') })
    }

    const planId = String(body.planId || '').trim()
    if (!planId) {
      return json({ error: 'planId required' }, 400)
    }

    const { error } = await supabase
      .from('subscription_plans')
      .update(payload)
      .eq('id', planId)

    if (error) throw error
    return json({ ok: true, planId })
  } catch (error: any) {
    if (String(error?.message || '').startsWith('limit-invalid:')) {
      const key = String(error.message).split(':')[1] || 'unknown'
      return json({ error: `Некорректный лимит для поля "${key}"` }, 400)
    }
    if (error?.message === 'price-invalid') {
      return json({ error: 'Цена тарифа должна быть числом не меньше нуля' }, 400)
    }
    if (error?.message === 'status-invalid') {
      return json({ error: 'Некорректный статус тарифа' }, 400)
    }
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
