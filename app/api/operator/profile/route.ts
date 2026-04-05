import { NextResponse } from 'next/server'

import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestOperatorContext, listActiveOperatorLeadAssignments } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  try {
    const context = await getRequestOperatorContext(request)
    if ('response' in context) return context.response

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : (context.supabase as any)

    const [operatorRes, leadAssignments, assignmentsRes] = await Promise.all([
      supabase
        .from('operators')
        .select('id,name,short_name,telegram_chat_id,is_active,operator_profiles(*)')
        .eq('id', context.operator.id)
        .maybeSingle(),
      listActiveOperatorLeadAssignments(context.supabase, context.operator.id),
      supabase
        .from('operator_company_assignments')
        .select('id,company_id,role_in_company,is_primary,is_active,notes,company:company_id(id,name,code)')
        .eq('operator_id', context.operator.id)
        .eq('is_active', true)
        .order('is_primary', { ascending: false }),
    ])

    if (operatorRes.error) throw operatorRes.error
    if (assignmentsRes.error) throw assignmentsRes.error
    if (!operatorRes.data) return json({ error: 'operator-not-found' }, 404)
    if (!context.user?.id) return json({ error: 'unauthorized' }, 401)

    const authRes = await context.supabase
      .from('operator_auth')
      .select('username,role,is_active,created_at')
      .eq('user_id', context.user.id)
      .maybeSingle()

    if (authRes.error) throw authRes.error

    const profile = Array.isArray((operatorRes.data as any).operator_profiles)
      ? (operatorRes.data as any).operator_profiles[0] || null
      : (operatorRes.data as any).operator_profiles || null

    return json({
      ok: true,
      operator: {
        id: operatorRes.data.id,
        name: getOperatorDisplayName(operatorRes.data as any, 'Оператор'),
        short_name: operatorRes.data.short_name,
        telegram_chat_id: operatorRes.data.telegram_chat_id,
        is_active: (operatorRes.data as any).is_active ?? true,
        username: authRes.data?.username || null,
        auth_role: authRes.data?.role || null,
        auth_created_at: authRes.data?.created_at || null,
        profile: {
          full_name: profile?.full_name || null,
          photo_url: profile?.photo_url || null,
          position: profile?.position || null,
          phone: profile?.phone || null,
          email: profile?.email || null,
          hire_date: profile?.hire_date || null,
          birth_date: profile?.birth_date || null,
          city: profile?.city || null,
          about: profile?.about || null,
        },
      },
      assignments: (assignmentsRes.data || []).map((item: any) => ({
        id: String(item.id),
        companyId: String(item.company_id),
        companyName: Array.isArray(item.company) ? item.company[0]?.name || null : item.company?.name || null,
        companyCode: Array.isArray(item.company) ? item.company[0]?.code || null : item.company?.code || null,
        role: item.role_in_company,
        isPrimary: Boolean(item.is_primary),
        notes: item.notes || null,
      })),
      leadAssignments: leadAssignments.map((assignment) => ({
        id: assignment.id,
        companyId: assignment.company_id,
        companyName: assignment.company?.name || null,
        companyCode: assignment.company?.code || null,
        role: assignment.role_in_company,
      })),
    })
  } catch (error: any) {
    console.error('Operator profile GET error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/operator/profile:get',
      message: error?.message || 'Operator profile GET error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
