import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { createRequestSupabaseClient } from '@/lib/server/request-auth'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { resolveCompanyScope, listOrganizationOperatorIds } from '@/lib/server/organizations'
import { buildOperatorMoney } from '@/lib/domain/operator-analytics'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

// Returns static reference data for operator analytics page:
// companies, operators, operator_profiles, operator_documents
export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'operator-analytics.view')
    if (denied) return denied

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const scope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    // Operator-id allowlist is only used to scope when company scoping is active.
    // When scope.allowedCompanyIds is null (legacy single-tenant / superadmin) we
    // must NOT apply any operator filter so behavior stays unchanged.
    const operatorIds = scope.allowedCompanyIds
      ? await listOrganizationOperatorIds({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
          includeInactive: true,
        })
      : null

    let companiesQuery = supabase.from('companies').select('id,name,code').order('name')
    if (scope.allowedCompanyIds) companiesQuery = companiesQuery.in('id', scope.allowedCompanyIds)

    let operatorsQuery = supabase.from('operators').select('id,name,short_name,is_active').order('name')
    if (operatorIds) operatorsQuery = operatorsQuery.in('id', operatorIds)

    let profilesQuery = supabase.from('operator_profiles').select('operator_id,photo_url,position,phone,email,hire_date')
    if (operatorIds) profilesQuery = profilesQuery.in('operator_id', operatorIds)

    let docsQuery = supabase.from('operator_documents').select('operator_id,expiry_date')
    if (operatorIds) docsQuery = docsQuery.in('operator_id', operatorIds)

    const [compRes, opsRes, profilesRes, docsRes] = await Promise.all([
      companiesQuery,
      operatorsQuery,
      profilesQuery,
      docsQuery,
    ])

    if (compRes.error) throw compRes.error
    if (opsRes.error) throw opsRes.error
    if (profilesRes.error) throw profilesRes.error
    if (docsRes.error) throw docsRes.error

    // Деньги по операторам за период: ?from=YYYY-MM-DD&to=YYYY-MM-DD
    //
    // Раньше их считал браузер, ходя в Supabase напрямую: страница складывала
    // доходы, корректировки и долги у себя. Поэтому цифр не было в приложении,
    // фильтр по организации жил в браузере, а право на эти данные никто не
    // спрашивал. Теперь считает сервер — под тем же правом, что и весь раздел.
    const url = new URL(req.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    let money: unknown = null
    let raw: unknown = null

    if (from && to) {
      const allowedOperatorIds = (opsRes.data || []).map((row: any) => String(row.id))
      const companyIds = (compRes.data || []).map((row: any) => String(row.id))

      let incomesQuery = supabase
        .from('incomes')
        .select('date,company_id,shift,operator_id,cash_amount,kaspi_amount,online_amount,card_amount')
        .gte('date', from)
        .lte('date', to)
      if (companyIds.length > 0) incomesQuery = incomesQuery.in('company_id', companyIds)

      let adjustmentsQuery = supabase
        .from('operator_salary_adjustments')
        .select('operator_id,kind,amount')
        .gte('date', from)
        .lte('date', to)
      if (allowedOperatorIds.length > 0) adjustmentsQuery = adjustmentsQuery.in('operator_id', allowedOperatorIds)

      let debtsQuery = supabase
        .from('debts')
        .select('operator_id,amount,week_start,status')
        .eq('status', 'active')
        .gte('week_start', from)
        .lte('week_start', to)
      if (allowedOperatorIds.length > 0) debtsQuery = debtsQuery.in('operator_id', allowedOperatorIds)

      const [incomesRes, adjRes, debtsRes] = await Promise.all([incomesQuery, adjustmentsQuery, debtsQuery])
      if (incomesRes.error) throw incomesRes.error
      if (adjRes.error) throw adjRes.error
      if (debtsRes.error) throw debtsRes.error

      money = buildOperatorMoney({
        incomes: (incomesRes.data || []) as any,
        adjustments: (adjRes.data || []) as any,
        debts: (debtsRes.data || []) as any,
        operatorIds: allowedOperatorIds,
      })

      // ?raw=1 — те же строки, из которых считается сводка.
      //
      // Нужны странице на сайте: она рисует по ним день за днём и разбивку по
      // способам оплаты. Раньше она брала их из базы сама, из браузера, — то
      // есть мимо права и мимо скоупа организации. Теперь те же строки, но
      // выданные сервером и только тому, кому раздел открыт.
      if (url.searchParams.get('raw') === '1') {
        raw = {
          incomes: incomesRes.data || [],
          adjustments: adjRes.data || [],
          debts: debtsRes.data || [],
        }
      }
    }

    return json({
      ok: true,
      data: {
        companies: compRes.data || [],
        operators: opsRes.data || [],
        profiles: profilesRes.data || [],
        documents: docsRes.data || [],
        ...(money ? { money } : {}),
        ...(raw ? { raw } : {}),
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/operator-analytics GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
