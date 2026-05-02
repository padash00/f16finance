import { NextResponse } from 'next/server'

import { resolveCompanyScope } from '@/lib/server/organizations'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin && access.staffRole !== 'owner' && access.staffRole !== 'manager') {
      return json({ error: 'forbidden' }, 403)
    }

    const url = new URL(req.url)
    const from = url.searchParams.get('from') || '2025-11-01'
    const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10)
    const companyId = url.searchParams.get('company_id')

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: companyId,
      isSuperAdmin: access.isSuperAdmin,
    })

    let incomeQuery = supabase
      .from('incomes')
      .select('id, date, company_id, operator_id, shift, zone, cash_amount, kaspi_amount, kaspi_before_midnight, online_amount, card_amount, comment, created_at')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true })
      .limit(10000)

    if (companyScope.allowedCompanyIds !== null) {
      if (companyScope.allowedCompanyIds.length === 0) {
        return json({ incomes: [], companies: [], operators: [], auditLogs: [] })
      }
      incomeQuery = incomeQuery.in('company_id', companyScope.allowedCompanyIds)
    }

    const [incomesRes, companiesRes, operatorsRes, auditRes] = await Promise.all([
      incomeQuery,
      supabase
        .from('companies')
        .select('id, name, code')
        .order('name', { ascending: true }),
      supabase
        .from('operators')
        .select('id, name, short_name, is_active')
        .order('name', { ascending: true }),
      supabase
        .from('audit_log')
        .select('id, entity_type, entity_id, action, payload, created_at, actor_user_id')
        .in('entity_type', ['income', 'point-shift-report'])
        .gte('created_at', `${from}T00:00:00.000Z`)
        .lte('created_at', `${to}T23:59:59.999Z`)
        .order('created_at', { ascending: true })
        .limit(20000),
    ])

    if (incomesRes.error) throw incomesRes.error
    if (companiesRes.error) throw companiesRes.error
    if (operatorsRes.error) throw operatorsRes.error
    if (auditRes.error) throw auditRes.error

    return json({
      incomes: incomesRes.data ?? [],
      companies: companiesRes.data ?? [],
      operators: operatorsRes.data ?? [],
      auditLogs: auditRes.data ?? [],
    })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
