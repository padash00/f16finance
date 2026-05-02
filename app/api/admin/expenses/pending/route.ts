import { NextResponse } from 'next/server'

import { resolveCompanyScope } from '@/lib/server/organizations'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    if (!access.isSuperAdmin && access.staffRole !== 'owner' && access.staffRole !== 'manager') {
      return json({ error: 'forbidden' }, 403)
    }

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(request)

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    let query = supabase
      .from('expenses')
      .select('id, date, company_id, operator_id, category, cash_amount, kaspi_amount, comment, status, document_kind, one_off_payee, one_off_reason, created_at')
      .eq('status', 'pending_approval')
      .order('created_at', { ascending: false })

    if (companyScope.allowedCompanyIds) {
      if (companyScope.allowedCompanyIds.length === 0) return json({ data: [] })
      query = query.in('company_id', companyScope.allowedCompanyIds)
    }

    const { data, error } = await query
    if (error) throw error
    return json({ data: data ?? [] })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/expenses/pending GET',
      message: error?.message || 'pending list failed',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
