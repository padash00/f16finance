import { NextResponse } from 'next/server'

import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const { staffRole, isSuperAdmin } = access
    if (!isSuperAdmin && staffRole !== 'owner' && staffRole !== 'manager') {
      return json({ error: 'forbidden' }, 403)
    }
    const activeOrganizationId = access.activeOrganization?.id || null

    const supabase = createAdminSupabaseClient()
    const url = new URL(req.url)
    const companyId = url.searchParams.get('company_id')
    const companyScope = await resolveCompanyScope({
      activeOrganizationId,
      requestedCompanyId: companyId,
      isSuperAdmin: access.isSuperAdmin,
    })

    let query = supabase
      .from('discounts')
      .select('*')
      .order('created_at', { ascending: false })

    if (companyScope.allowedCompanyIds !== null) {
      if (companyScope.allowedCompanyIds.length === 0) {
        return json({ ok: true, data: [] })
      }
      query = query.in('company_id', companyScope.allowedCompanyIds)
    }

    const { data, error } = await query
    if (error) throw error

    return json({ ok: true, data: data || [] })
  } catch (err: any) {
    return json({ error: err?.message || 'internal error' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const { staffRole, isSuperAdmin } = access
    if (!isSuperAdmin && staffRole !== 'owner' && staffRole !== 'manager') {
      return json({ error: 'forbidden' }, 403)
    }
    const activeOrganizationId = access.activeOrganization?.id || null

    const supabase = createAdminSupabaseClient()
    const body = (await req.json().catch(() => null)) as any
    if (!body?.action) return json({ error: 'missing action' }, 400)

    if (body.action === 'createDiscount') {
      const { name, type, value, promo_code, min_order_amount, valid_from, valid_to, usage_limit, company_id } = body.payload || {}
      if (!name?.trim()) return json({ error: 'Название скидки обязательно' }, 400)
      if (!['percent', 'fixed', 'promo_code'].includes(type)) return json({ error: 'Неверный тип скидки' }, 400)
      if (typeof value !== 'number' || value < 0) return json({ error: 'Значение скидки обязательно' }, 400)
      if (!company_id && !isSuperAdmin) {
        return json({ error: 'company_id обязателен для скидки организации' }, 400)
      }
      if (company_id) {
        await resolveCompanyScope({
          activeOrganizationId,
          requestedCompanyId: company_id,
          isSuperAdmin: access.isSuperAdmin,
        })
      }

      const { data, error } = await supabase
        .from('discounts')
        .insert({
          name: name.trim(),
          type,
          value,
          promo_code: promo_code?.trim() || null,
          min_order_amount: min_order_amount || 0,
          valid_from: valid_from || null,
          valid_to: valid_to || null,
          usage_limit: usage_limit || null,
          company_id: company_id || null,
        })
        .select()
        .single()

      if (error) {
        if (error.code === '23505') return json({ error: 'Промокод уже существует' }, 409)
        throw error
      }

      return json({ ok: true, data })
    }

    if (body.action === 'updateDiscount') {
      const { discountId, payload } = body
      if (!discountId) return json({ error: 'discountId required' }, 400)
      const { data: existing, error: existingError } = await supabase
        .from('discounts')
        .select('id, company_id')
        .eq('id', discountId)
        .single()
      if (existingError || !existing) return json({ error: 'discount not found' }, 404)
      if (!existing.company_id && !isSuperAdmin) {
        return json({ error: 'global-discount-forbidden' }, 403)
      }
      if (existing.company_id) {
        await resolveCompanyScope({
          activeOrganizationId,
          requestedCompanyId: existing.company_id,
          isSuperAdmin: access.isSuperAdmin,
        })
      }

      const updates: Record<string, any> = {}
      if (payload.name !== undefined) updates.name = payload.name.trim()
      if (payload.type !== undefined) updates.type = payload.type
      if (payload.value !== undefined) updates.value = payload.value
      if (payload.promo_code !== undefined) updates.promo_code = payload.promo_code?.trim() || null
      if (payload.min_order_amount !== undefined) updates.min_order_amount = payload.min_order_amount
      if (payload.valid_from !== undefined) updates.valid_from = payload.valid_from || null
      if (payload.valid_to !== undefined) updates.valid_to = payload.valid_to || null
      if (payload.usage_limit !== undefined) updates.usage_limit = payload.usage_limit || null
      if (payload.is_active !== undefined) updates.is_active = payload.is_active

      const { data, error } = await supabase
        .from('discounts')
        .update(updates)
        .eq('id', discountId)
        .select()
        .single()

      if (error) {
        if (error.code === '23505') return json({ error: 'Промокод уже существует' }, 409)
        throw error
      }

      return json({ ok: true, data })
    }

    if (body.action === 'deleteDiscount') {
      const { discountId } = body
      if (!discountId) return json({ error: 'discountId required' }, 400)
      const { data: existing, error: existingError } = await supabase
        .from('discounts')
        .select('id, company_id')
        .eq('id', discountId)
        .single()
      if (existingError || !existing) return json({ error: 'discount not found' }, 404)
      if (!existing.company_id && !isSuperAdmin) {
        return json({ error: 'global-discount-forbidden' }, 403)
      }
      if (existing.company_id) {
        await resolveCompanyScope({
          activeOrganizationId,
          requestedCompanyId: existing.company_id,
          isSuperAdmin: access.isSuperAdmin,
        })
      }

      const { error } = await supabase
        .from('discounts')
        .update({ is_active: false })
        .eq('id', discountId)

      if (error) throw error
      return json({ ok: true })
    }

    if (body.action === 'validatePromoCode') {
      const { promo_code, company_id, order_amount } = body
      if (!promo_code?.trim()) return json({ error: 'promo_code required' }, 400)
      if (!company_id && !isSuperAdmin) {
        return json({ error: 'company_id required' }, 400)
      }
      if (company_id) {
        await resolveCompanyScope({
          activeOrganizationId,
          requestedCompanyId: company_id,
          isSuperAdmin: access.isSuperAdmin,
        })
      }

      const today = new Date().toISOString().split('T')[0]

      let query = supabase
        .from('discounts')
        .select('*')
        .eq('is_active', true)
        .eq('type', 'promo_code')
        .ilike('promo_code', promo_code.trim())

      if (company_id) {
        query = query.eq('company_id', company_id)
      }

      const { data, error } = await query.maybeSingle()
      if (error) throw error
      if (!data) return json({ ok: false, error: 'Промокод не найден или неактивен' }, 404)

      if (data.valid_from && data.valid_from > today) {
        return json({ ok: false, error: 'Промокод ещё не активен' }, 400)
      }
      if (data.valid_to && data.valid_to < today) {
        return json({ ok: false, error: 'Срок действия промокода истёк' }, 400)
      }
      if (data.usage_limit !== null && data.usage_count >= data.usage_limit) {
        return json({ ok: false, error: 'Лимит использований промокода исчерпан' }, 400)
      }
      if (order_amount !== undefined && data.min_order_amount > 0 && order_amount < data.min_order_amount) {
        return json({ ok: false, error: `Минимальная сумма заказа: ${data.min_order_amount} ₸` }, 400)
      }

      return json({ ok: true, data })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (err: any) {
    return json({ error: err?.message || 'internal error' }, 500)
  }
}
