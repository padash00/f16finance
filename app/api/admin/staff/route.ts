import { NextResponse } from 'next/server'

import { assertOrganizationLimitAvailable, ensureOrganizationStaffAccess, listOrganizationStaffIds } from '@/lib/server/organizations'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, getRequestAccessContext, requireStaffCapabilityRequest } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type StaffRole = 'manager' | 'marketer' | 'owner' | 'other'
type PaySlot = 'first' | 'second' | 'other'

type Body =
  | {
      action: 'createStaff'
      payload: {
        full_name: string
        short_name?: string | null
        role: StaffRole
        monthly_salary: number
        phone?: string | null
        email?: string | null
        hire_date?: string | null
      }
    }
  | {
      action: 'createPayment'
      payload: {
        staff_id: string
        pay_date: string
        slot: PaySlot
        amount: number
        comment?: string | null
      }
    }
  | {
      action: 'toggleStaffStatus'
      staffId: string
      is_active: boolean
    }
  | {
      action: 'deletePayment'
      paymentId: number
    }
  | {
      action: 'updateStaff'
      staffId: string
      payload: {
        full_name: string
        short_name?: string | null
        role: StaffRole
        monthly_salary: number
        phone?: string | null
        email?: string | null
      }
    }

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'staff')
    if (guard) return guard
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const url = new URL(req.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const allowedStaffIds = await listOrganizationStaffIds({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    let staffQuery = supabase
      .from('staff')
      .select('id, full_name, role, short_name, monthly_salary, is_active, phone, email')
      .order('full_name')

    let paymentsQuery = supabase
      .from('staff_salary_payments')
      .select('id, staff_id, pay_date, slot, amount, comment, created_at')
      .order('pay_date', { ascending: true })

    if (from) paymentsQuery = paymentsQuery.gte('pay_date', from)
    if (to) paymentsQuery = paymentsQuery.lte('pay_date', to)

    if (allowedStaffIds) {
      if (allowedStaffIds.length === 0) return json({ staff: [], payments: [] })
      staffQuery = staffQuery.in('id', allowedStaffIds)
      paymentsQuery = paymentsQuery.in('staff_id', allowedStaffIds)
    }

    const [staffRes, paymentsRes] = await Promise.all([staffQuery, paymentsQuery])
    if (staffRes.error) throw staffRes.error
    if (paymentsRes.error) throw paymentsRes.error

    return json({
      staff: staffRes.data ?? [],
      payments: paymentsRes.data ?? [],
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/staff GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'staff')
    if (guard) return guard
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const requestClient = createRequestSupabaseClient(req)
    const {
      data: { user },
    } = await requestClient.auth.getUser()

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : requestClient

    const body = (await req.json().catch(() => null)) as Body | null
    if (!body?.action) return json({ error: 'Неверный формат запроса' }, 400)
    const activeOrganizationId = access.activeOrganization?.id || null

    if (body.action === 'createStaff') {
      const payload = body.payload
      if (!payload.full_name?.trim()) {
        return json({ error: 'ФИО обязательно' }, 400)
      }
      if (!Number.isFinite(payload.monthly_salary) || payload.monthly_salary <= 0) {
        return json({ error: 'Оклад должен быть больше нуля' }, 400)
      }

      await assertOrganizationLimitAvailable({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        activeSubscription: access.activeSubscription,
        key: 'staff',
      })

      const { data, error } = await supabase
        .from('staff')
        .insert([
          {
            full_name: payload.full_name.trim(),
            short_name: payload.short_name?.trim() || null,
            role: payload.role,
            monthly_salary: Math.round(payload.monthly_salary),
            phone: payload.phone?.trim() || null,
            email: payload.email?.trim() || null,
            is_active: true,
          },
        ])
        .select('*')
        .single()

      if (error) throw error

      if (activeOrganizationId) {
        const { error: membershipError } = await supabase.from('organization_members').insert([
          {
            organization_id: activeOrganizationId,
            staff_id: data.id,
            email: data.email || null,
            role: data.role,
            status: data.is_active === false ? 'inactive' : 'active',
            is_default: true,
            metadata: { bootstrap_source: 'staff-create' },
          },
        ])
        if (membershipError) throw membershipError
      }

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'staff',
        entityId: String(data.id),
        action: 'create',
        payload: { full_name: data.full_name, role: data.role, monthly_salary: data.monthly_salary },
      })

      return json({ ok: true, data })
    }

    if (body.action === 'updateStaff') {
      const payload = body.payload
      if (!body.staffId?.trim()) {
        return json({ error: 'staffId обязателен' }, 400)
      }
      await ensureOrganizationStaffAccess({
        activeOrganizationId,
        isSuperAdmin: access.isSuperAdmin,
        staffId: body.staffId,
      })
      if (!payload.full_name?.trim()) {
        return json({ error: 'ФИО обязательно' }, 400)
      }
      if (!Number.isFinite(payload.monthly_salary) || payload.monthly_salary <= 0) {
        return json({ error: 'Оклад должен быть больше нуля' }, 400)
      }

      const { data: existing, error: existingError } = await supabase
        .from('staff')
        .select('*')
        .eq('id', body.staffId)
        .single()
      if (existingError) throw existingError

      const { data, error } = await supabase
        .from('staff')
        .update({
          full_name: payload.full_name.trim(),
          short_name: payload.short_name?.trim() || null,
          role: payload.role,
          monthly_salary: Math.round(payload.monthly_salary),
          phone: payload.phone?.trim() || null,
          email: payload.email?.trim() || null,
        })
        .eq('id', body.staffId)
        .select('*')
        .single()

      if (error) throw error

      if (activeOrganizationId) {
        const { error: membershipError } = await supabase
          .from('organization_members')
          .update({
            email: data.email || null,
            role: data.role,
            status: data.is_active === false ? 'inactive' : 'active',
          })
          .eq('organization_id', activeOrganizationId)
          .eq('staff_id', body.staffId)
        if (membershipError) throw membershipError
      }

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'staff',
        entityId: String(body.staffId),
        action: 'update',
        payload: {
          previous: {
            full_name: existing.full_name,
            short_name: existing.short_name,
            role: existing.role,
            monthly_salary: existing.monthly_salary,
            phone: existing.phone,
            email: existing.email,
          },
          next: {
            full_name: data.full_name,
            short_name: data.short_name,
            role: data.role,
            monthly_salary: data.monthly_salary,
            phone: data.phone,
            email: data.email,
          },
        },
      })

      return json({ ok: true, data })
    }

    if (body.action === 'toggleStaffStatus') {
      if (!body.staffId?.trim()) {
        return json({ error: 'staffId обязателен' }, 400)
      }
      await ensureOrganizationStaffAccess({
        activeOrganizationId,
        isSuperAdmin: access.isSuperAdmin,
        staffId: body.staffId,
      })

      const { error } = await supabase
        .from('staff')
        .update({ is_active: body.is_active })
        .eq('id', body.staffId)

      if (error) throw error

      if (activeOrganizationId) {
        const { error: membershipError } = await supabase
          .from('organization_members')
          .update({ status: body.is_active ? 'active' : 'inactive' })
          .eq('organization_id', activeOrganizationId)
          .eq('staff_id', body.staffId)
        if (membershipError) throw membershipError
      }

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'staff',
        entityId: String(body.staffId),
        action: body.is_active ? 'activate' : 'archive',
        payload: { is_active: body.is_active },
      })

      return json({ ok: true })
    }

    if (body.action === 'deletePayment') {
      const paymentId = Number(body.paymentId)
      if (!Number.isFinite(paymentId)) {
        return json({ error: 'paymentId обязателен' }, 400)
      }

      const { data: existing, error: existingError } = await supabase
        .from('staff_salary_payments')
        .select('*')
        .eq('id', paymentId)
        .single()
      if (existingError) throw existingError
      await ensureOrganizationStaffAccess({
        activeOrganizationId,
        isSuperAdmin: access.isSuperAdmin,
        staffId: String(existing.staff_id),
      })

      const { error } = await supabase.from('staff_salary_payments').delete().eq('id', paymentId)
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'staff-payment',
        entityId: String(paymentId),
        action: 'delete',
        payload: {
          staff_id: existing.staff_id,
          amount: existing.amount,
          slot: existing.slot,
          pay_date: existing.pay_date,
        },
      })

      return json({ ok: true })
    }

    const payload = body.payload
    if (!payload.staff_id || !payload.pay_date) {
      return json({ error: 'staff_id и pay_date обязательны' }, 400)
    }
    await ensureOrganizationStaffAccess({
      activeOrganizationId,
      isSuperAdmin: access.isSuperAdmin,
      staffId: payload.staff_id,
    })
    if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
      return json({ error: 'Сумма выплаты должна быть больше нуля' }, 400)
    }

    const { data, error } = await supabase
      .from('staff_salary_payments')
      .insert([
        {
          staff_id: payload.staff_id,
          pay_date: payload.pay_date,
          slot: payload.slot,
          amount: Math.round(payload.amount),
          comment: payload.comment?.trim() || null,
        },
      ])
      .select('*')
      .single()

    if (error) throw error

    await writeAuditLog(supabase, {
      actorUserId: user?.id || null,
      entityType: 'staff-payment',
      entityId: String(data.id),
      action: 'create',
      payload: { staff_id: payload.staff_id, amount: data.amount, slot: data.slot, pay_date: data.pay_date },
    })

    return json({ ok: true, data })
  } catch (error: any) {
    console.error('Admin staff mutation error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/staff',
      message: error?.message || 'Admin staff mutation error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
