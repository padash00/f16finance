import { NextResponse } from 'next/server'

import {
  DEFAULT_TAX_RATE,
  MAX_TAX_RATE,
  MIN_TAX_RATE,
  MRP,
  MZP,
  SELF_SOCIAL_MONTHLY,
  SIMPLIFIED_LIMIT,
  TAX_YEAR,
  VAT_THRESHOLD,
  computePayrollTaxes,
  computeTaxBurden,
  computeTaxSummary,
  computeYearOutlook,
  dayOfYear,
  normalizeRate,
} from '@/lib/domain/tax'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { listOrganizationStaffIds, resolveCompanyScope } from '@/lib/server/organizations'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Готовый расчёт налогов ИП на упрощёнке.
 *
 * Страница `/tax` держит ставки, пороги и формулы у себя в компоненте.
 * Повторять их на Swift нельзя: по этой цифре платят в бюджет, и две
 * реализации одного налога рано или поздно разойдутся.
 *
 * Здесь всё считается общими функциями из `lib/domain/tax`, клиент получает
 * готовые величины и сам ничего не складывает.
 *
 *   GET /api/admin/tax/summary?from=2026-01-01&to=2026-08-08[&rate=2][&include_extra=1]
 */

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function isDate(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/** PostgREST отдаёт максимум 1000 строк за запрос — год по всем точкам иначе обрежется. */
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
    const denied = await requireCapability(access, 'tax.view')
    if (denied) return denied

    const url = new URL(req.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    if (!isDate(from) || !isDate(to)) {
      return json({ error: 'from и to в формате YYYY-MM-DD' }, 400)
    }
    const rate = normalizeRate(url.searchParams.get('rate') ?? DEFAULT_TAX_RATE)
    const includeExtra = url.searchParams.get('include_extra') === '1'

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const constants = {
      year: TAX_YEAR,
      mrp: MRP,
      mzp: MZP,
      selfSocialMonthly: SELF_SOCIAL_MONTHLY,
      vatThreshold: VAT_THRESHOLD,
      simplifiedLimit: SIMPLIFIED_LIMIT,
      defaultRate: DEFAULT_TAX_RATE,
      minRate: MIN_TAX_RATE,
      maxRate: MAX_TAX_RATE,
    }

    if (companyScope.allowedCompanyIds !== null && companyScope.allowedCompanyIds.length === 0) {
      const empty = computeTaxSummary([], { rate })
      return json({
        ok: true,
        data: {
          from,
          to,
          ...empty,
          payroll: computePayrollTaxes([]),
          burden: computeTaxBurden(empty, 0),
          year: computeYearOutlook(0, dayOfYear()),
          excludedCompanies: [],
          constants,
        },
      })
    }

    let companiesQuery = supabase.from('companies').select('id, name, code')
    if (companyScope.allowedCompanyIds) {
      companiesQuery = companiesQuery.in('id', companyScope.allowedCompanyIds)
    }
    const { data: companyRows, error: companiesError } = await companiesQuery
    if (companiesError) throw companiesError

    // Точки-«экстра» по умолчанию из налогооблагаемого оборота исключены —
    // те же правила, что на страницах `/weekly-report` и `/reports`.
    const excludedCompanies = includeExtra
      ? []
      : (companyRows || []).filter(
          (row: any) => String(row.code || '').toLowerCase() === 'extra' || row.name === 'F16 Extra',
        )
    const excludedCompanyIds = excludedCompanies.map((row: any) => String(row.id))

    const yearStart = `${new Date().getFullYear()}-01-01`
    const today = new Date().toISOString().slice(0, 10)
    // Прогноз до порогов НДС и упрощёнки считается всегда от начала года,
    // независимо от выбранного периода: порог годовой.
    const yearFrom = yearStart < from ? yearStart : from
    const yearTo = today > to ? today : to

    const incomes = await fetchAll<any>(() => {
      let q = supabase
        .from('incomes')
        .select('date, company_id, cash_amount, kaspi_amount, online_amount, card_amount')
        .gte('date', yearFrom)
        .lte('date', yearTo)
        .order('date', { ascending: true })
      if (companyScope.allowedCompanyIds) q = q.in('company_id', companyScope.allowedCompanyIds)
      return q
    })

    const periodRows = incomes.filter((row: any) => {
      const date = String(row.date || '')
      return date >= from && date <= to
    })
    const yearRows = incomes.filter((row: any) => {
      const date = String(row.date || '')
      return date >= yearStart && date <= today
    })

    const summary = computeTaxSummary(periodRows, { rate, excludedCompanyIds })
    const yearSummary = computeTaxSummary(yearRows, { rate, excludedCompanyIds })

    // Оклады — только у работающих: уволенный в бюджет уже не стоит.
    const allowedStaffIds = await listOrganizationStaffIds({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    let salaries: number[] = []
    if (!allowedStaffIds || allowedStaffIds.length > 0) {
      let staffQuery = supabase.from('staff').select('id, monthly_salary, is_active')
      if (allowedStaffIds) staffQuery = staffQuery.in('id', allowedStaffIds)
      const { data: staffRows, error: staffError } = await staffQuery
      if (staffError) throw staffError
      salaries = (staffRows || [])
        .filter((row: any) => row.is_active !== false && Number(row.monthly_salary || 0) > 0)
        .map((row: any) => Number(row.monthly_salary || 0))
    }

    const payroll = computePayrollTaxes(salaries)

    return json({
      ok: true,
      data: {
        from,
        to,
        ...summary,
        payroll,
        burden: computeTaxBurden(summary, payroll.monthlyTax),
        year: computeYearOutlook(yearSummary.revenue, dayOfYear()),
        excludedCompanies: excludedCompanies.map((row: any) => ({ id: row.id, name: row.name })),
        constants,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/tax/summary GET',
      message: error?.message || 'error',
    })
    return json({ error: error?.message || 'Не удалось посчитать налоги' }, 500)
  }
}
