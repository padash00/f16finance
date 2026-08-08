import { NextResponse } from 'next/server'

import { computeCashflow } from '@/lib/domain/cashflow'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Готовое движение денег по дням.
 *
 * Страница `/cashflow` тянет сырые журналы доходов и расходов и сворачивает
 * их у себя. Мобильному приложению пришлось бы повторить эту свёртку на Swift
 * — и накопительный баланс в двух местах неизбежно разошёлся бы.
 *
 * Здесь расчёт выполняется на сервере общей функцией `computeCashflow`, и
 * клиент получает готовые дни и итоги.
 *
 *   GET /api/admin/cashflow/summary?from=2026-08-01&to=2026-08-31[&company_id=…]
 */

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function isDate(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/** PostgREST отдаёт максимум 1000 строк за запрос — иначе месяц по всем точкам обрежется. */
async function fetchAll<Row>(buildQuery: () => any): Promise<Row[]> {
  const CHUNK = 1000
  const all: Row[] = []
  let cursor = 0
  for (let guard = 0; guard < 100; guard += 1) {
    const { data, error } = await buildQuery().range(cursor, cursor + CHUNK - 1)
    if (error) throw error
    const batch = (data || []) as Row[]
    all.push(...batch)
    if (batch.length < CHUNK) break
    cursor += CHUNK
  }
  return all
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'cashflow.view')
    if (denied) return denied

    const url = new URL(req.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    if (!isDate(from) || !isDate(to)) {
      return json({ error: 'from и to в формате YYYY-MM-DD' }, 400)
    }

    const requestedCompanyId = url.searchParams.get('company_id') || null

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
      requestedCompanyId,
    })

    const empty = { from, to, days: [], totals: null }
    if (companyScope.allowedCompanyIds !== null && companyScope.allowedCompanyIds.length === 0) {
      return json({ ok: true, data: empty })
    }

    const incomes = await fetchAll<any>(() => {
      let q = supabase
        .from('incomes')
        .select('date, company_id, cash_amount, kaspi_amount, online_amount, card_amount')
        .gte('date', from)
        .lte('date', to)
        .order('date', { ascending: true })
      if (companyScope.allowedCompanyIds) q = q.in('company_id', companyScope.allowedCompanyIds)
      return q
    })

    // Отклонённые расходы деньгами не стали — в движение денег они не входят.
    // Тот же фильтр стоит в `/api/admin/weekly-act`.
    const expenses = await fetchAll<any>(() => {
      let q = supabase
        .from('expenses')
        .select('date, company_id, cash_amount, kaspi_amount, status')
        .gte('date', from)
        .lte('date', to)
        .neq('status', 'declined')
        .order('date', { ascending: true })
      if (companyScope.allowedCompanyIds) q = q.in('company_id', companyScope.allowedCompanyIds)
      return q
    })

    const { days, totals } = computeCashflow(incomes, expenses)

    return json({ ok: true, data: { from, to, days, totals } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/cashflow/summary GET',
      message: error?.message || 'error',
    })
    return json({ error: error?.message || 'Не удалось посчитать движение денег' }, 500)
  }
}
