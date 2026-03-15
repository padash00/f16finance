import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, requireStaffCapabilityRequest } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'operator_structure')
    if (guard) return guard

    const requestClient = createRequestSupabaseClient(req)
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : requestClient

    const [staffRes, companiesRes, operatorsRes, assignmentsRes] = await Promise.all([
      supabase
        .from('staff')
        .select('id, full_name, short_name, role, monthly_salary, phone, email, is_active')
        .eq('is_active', true)
        .in('role', ['owner', 'manager', 'marketer'])
        .order('role', { ascending: true })
        .order('full_name', { ascending: true }),
      supabase
        .from('companies')
        .select('id, name, code, show_in_structure')
        .eq('show_in_structure', true)
        .order('name', { ascending: true }),
      supabase
        .from('operators')
        .select('id, name, short_name, is_active, telegram_chat_id, operator_profiles(full_name, phone, email, position, photo_url, hire_date)')
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase
        .from('operator_company_assignments')
        .select('id, operator_id, company_id, role_in_company, is_primary, is_active, notes, created_at, updated_at')
        .eq('is_active', true)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true }),
    ])

    if (staffRes.error) throw staffRes.error
    if (companiesRes.error) throw companiesRes.error
    if (operatorsRes.error) throw operatorsRes.error
    if (assignmentsRes.error) throw assignmentsRes.error

    return json({
      ok: true,
      data: {
        staff: staffRes.data || [],
        companies: companiesRes.data || [],
        operators: operatorsRes.data || [],
        assignments: assignmentsRes.data || [],
      },
    })
  } catch (error: any) {
    console.error('Structure route error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/structure',
      message: error?.message || 'Structure route error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
