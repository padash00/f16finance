import { NextResponse } from 'next/server'

import { normalizeStaffRole } from '@/lib/core/access'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type PromotePayload = {
  operatorId: string
  role: 'manager' | 'marketer' | 'owner' | 'other'
  monthly_salary?: number | null
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)

    const { searchParams } = new URL(req.url)
    const operatorId = searchParams.get('operatorId')?.trim()
    if (!operatorId) return json({ error: 'operatorId обязателен' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    const { data, error } = await supabase
      .from('operator_staff_links')
      .select('id, assigned_role, assigned_at, updated_at, staff:staff_id(id, full_name, short_name, role, monthly_salary, email, phone, is_active)')
      .eq('operator_id', operatorId)
      .maybeSingle()

    if (error) throw error
    return json({ ok: true, data: data || null })
  } catch (error: any) {
    console.error('Operator career GET route error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/operator-career:get',
      message: error?.message || 'Operator career GET route error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)

    const body = (await req.json().catch(() => null)) as { action?: string; payload?: PromotePayload } | null
    if (body?.action !== 'promoteOperator' || !body.payload) {
      return json({ error: 'Неверный формат запроса' }, 400)
    }

    const role = normalizeStaffRole(body.payload.role)
    const operatorId = body.payload.operatorId?.trim()
    if (!operatorId) return json({ error: 'operatorId обязателен' }, 400)
    if (role === 'other') return json({ error: 'Выберите роль повышения' }, 400)

    const salary = body.payload.monthly_salary
    if (salary != null && (!Number.isFinite(salary) || Number(salary) < 0)) {
      return json({ error: 'Оклад должен быть числом не меньше нуля' }, 400)
    }

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    const [{ data: operator, error: operatorError }, { data: profile, error: profileError }, { data: existingLink, error: linkError }] =
      await Promise.all([
        supabase.from('operators').select('id, name, short_name, is_active').eq('id', operatorId).maybeSingle(),
        supabase.from('operator_profiles').select('*').eq('operator_id', operatorId).maybeSingle(),
        supabase.from('operator_staff_links').select('id, staff_id').eq('operator_id', operatorId).maybeSingle(),
      ])

    if (operatorError) throw operatorError
    if (profileError) throw profileError
    if (linkError && linkError.code !== 'PGRST116') throw linkError
    if (!operator) return json({ error: 'Оператор не найден' }, 404)

    const staffPayload = {
      full_name: profile?.full_name?.trim() || operator.name,
      short_name: operator.short_name?.trim() || null,
      role,
      monthly_salary: salary == null ? null : Math.round(Number(salary)),
      phone: profile?.phone?.trim() || null,
      email: profile?.email?.trim() || null,
      is_active: operator.is_active ?? true,
    }

    let staffRow: any = null

    if (existingLink?.staff_id) {
      const { data, error } = await supabase
        .from('staff')
        .update(staffPayload)
        .eq('id', existingLink.staff_id)
        .select('*')
        .single()

      if (error) throw error
      staffRow = data

      const { error: updateLinkError } = await supabase
        .from('operator_staff_links')
        .update({
          assigned_role: role,
          assigned_by: access.user?.id || null,
        })
        .eq('id', existingLink.id)

      if (updateLinkError) throw updateLinkError
    } else {
      const { data: createdStaff, error: createStaffError } = await supabase
        .from('staff')
        .insert([staffPayload])
        .select('*')
        .single()

      if (createStaffError) throw createStaffError
      staffRow = createdStaff

      const { error: createLinkError } = await supabase.from('operator_staff_links').insert([
        {
          operator_id: operatorId,
          staff_id: createdStaff.id,
          assigned_role: role,
          assigned_by: access.user?.id || null,
        },
      ])

      if (createLinkError) throw createLinkError
    }

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'operator-career',
      entityId: String(operatorId),
      action: existingLink?.staff_id ? 'promote-update' : 'promote-create',
      payload: {
        operator_id: operatorId,
        staff_id: staffRow.id,
        role,
        monthly_salary: staffRow.monthly_salary,
      },
    })

    return json({
      ok: true,
      data: {
        staff: staffRow,
        role,
        linked: true,
      },
    })
  } catch (error: any) {
    console.error('Operator career POST route error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/operator-career:post',
      message: error?.message || 'Operator career POST route error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
