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

    const supabase = createAdminSupabaseClient()
    const url = new URL(req.url)
    const companyId = url.searchParams.get('company_id')
    const search = url.searchParams.get('search')?.trim().toLowerCase()
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: companyId,
      isSuperAdmin: access.isSuperAdmin,
    })

    let query = supabase
      .from('customers')
      .select('id, company_id, name, phone, card_number, email, notes, loyalty_points, total_spent, visits_count, is_active, created_at, updated_at, company:company_id(id, name, code)')
      .eq('is_active', true)
      .order('total_spent', { ascending: false })

    if (companyScope.allowedCompanyIds !== null) {
      if (companyScope.allowedCompanyIds.length === 0) {
        return json({ ok: true, data: [] })
      }
      query = query.in('company_id', companyScope.allowedCompanyIds)
    }

    const { data, error } = await query

    if (error) throw error

    let customers = (data || []).map((row: any) => ({
      ...row,
      company: Array.isArray(row.company) ? row.company[0] || null : row.company || null,
    }))

    if (search) {
      customers = customers.filter(
        (c: any) =>
          c.name?.toLowerCase().includes(search) ||
          c.phone?.toLowerCase().includes(search) ||
          c.card_number?.toLowerCase().includes(search),
      )
    }

    return json({ ok: true, data: customers })
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

    const supabase = createAdminSupabaseClient()
    const body = (await req.json().catch(() => null)) as any
    if (!body?.action) return json({ error: 'missing action' }, 400)

    if (body.action === 'createCustomer') {
      const { name, phone, card_number, email, notes, company_id } = body.payload || {}
      if (!name?.trim()) return json({ error: 'Имя клиента обязательно' }, 400)
      if (company_id) {
        await resolveCompanyScope({
          activeOrganizationId: access.activeOrganization?.id || null,
          requestedCompanyId: company_id,
          isSuperAdmin: access.isSuperAdmin,
        })
      }

      const { data, error } = await supabase
        .from('customers')
        .insert({
          name: name.trim(),
          phone: phone?.trim() || null,
          card_number: card_number?.trim() || null,
          email: email?.trim() || null,
          notes: notes?.trim() || null,
          company_id: company_id || null,
        })
        .select()
        .single()

      if (error) {
        if (error.code === '23505') return json({ error: 'Клиент с таким телефоном или картой уже существует' }, 409)
        throw error
      }

      return json({ ok: true, data })
    }

    if (body.action === 'updateCustomer') {
      const { customerId, payload } = body
      if (!customerId) return json({ error: 'customerId required' }, 400)
      const { data: existing, error: existingError } = await supabase
        .from('customers')
        .select('id, company_id')
        .eq('id', customerId)
        .single()
      if (existingError || !existing) return json({ error: 'customer not found' }, 404)
      if (existing.company_id) {
        await resolveCompanyScope({
          activeOrganizationId: access.activeOrganization?.id || null,
          requestedCompanyId: existing.company_id,
          isSuperAdmin: access.isSuperAdmin,
        })
      }

      const updates: Record<string, any> = { updated_at: new Date().toISOString() }
      if (payload.name !== undefined) updates.name = payload.name.trim()
      if (payload.phone !== undefined) updates.phone = payload.phone?.trim() || null
      if (payload.card_number !== undefined) updates.card_number = payload.card_number?.trim() || null
      if (payload.email !== undefined) updates.email = payload.email?.trim() || null
      if (payload.notes !== undefined) updates.notes = payload.notes?.trim() || null

      const { data, error } = await supabase
        .from('customers')
        .update(updates)
        .eq('id', customerId)
        .select()
        .single()

      if (error) {
        if (error.code === '23505') return json({ error: 'Клиент с таким телефоном или картой уже существует' }, 409)
        throw error
      }

      return json({ ok: true, data })
    }

    if (body.action === 'deleteCustomer') {
      const { customerId } = body
      if (!customerId) return json({ error: 'customerId required' }, 400)
      const { data: existing, error: existingError } = await supabase
        .from('customers')
        .select('id, company_id')
        .eq('id', customerId)
        .single()
      if (existingError || !existing) return json({ error: 'customer not found' }, 404)
      if (existing.company_id) {
        await resolveCompanyScope({
          activeOrganizationId: access.activeOrganization?.id || null,
          requestedCompanyId: existing.company_id,
          isSuperAdmin: access.isSuperAdmin,
        })
      }

      const { error } = await supabase
        .from('customers')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', customerId)

      if (error) throw error
      return json({ ok: true })
    }

    if (body.action === 'adjustPoints') {
      const { customerId, delta } = body
      if (!customerId) return json({ error: 'customerId required' }, 400)
      if (typeof delta !== 'number') return json({ error: 'delta must be a number' }, 400)

      const { data: current, error: fetchError } = await supabase
        .from('customers')
        .select('loyalty_points, company_id')
        .eq('id', customerId)
        .single()

      if (fetchError || !current) return json({ error: 'customer not found' }, 404)
      if (current.company_id) {
        await resolveCompanyScope({
          activeOrganizationId: access.activeOrganization?.id || null,
          requestedCompanyId: current.company_id,
          isSuperAdmin: access.isSuperAdmin,
        })
      }

      const newPoints = Math.max(0, (current.loyalty_points || 0) + delta)

      const { data, error } = await supabase
        .from('customers')
        .update({ loyalty_points: newPoints, updated_at: new Date().toISOString() })
        .eq('id', customerId)
        .select()
        .single()

      if (error) throw error
      return json({ ok: true, data })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (err: any) {
    return json({ error: err?.message || 'internal error' }, 500)
  }
}
