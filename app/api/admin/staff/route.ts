import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, requireStaffCapabilityRequest } from '@/lib/server/request-auth'
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

export async function POST(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'staff')
    if (guard) return guard

    const requestClient = createRequestSupabaseClient(req)
    const {
      data: { user },
    } = await requestClient.auth.getUser()

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : requestClient

    const body = (await req.json().catch(() => null)) as Body | null
    if (!body?.action) return json({ error: 'Неверный формат запроса' }, 400)

    if (body.action === 'createStaff') {
      const payload = body.payload
      if (!payload.full_name?.trim()) {
        return json({ error: 'ФИО обязательно' }, 400)
      }
      if (!Number.isFinite(payload.monthly_salary) || payload.monthly_salary <= 0) {
        return json({ error: 'Оклад должен быть больше нуля' }, 400)
      }

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

      const { error } = await supabase
        .from('staff')
        .update({ is_active: body.is_active })
        .eq('id', body.staffId)

      if (error) throw error

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
