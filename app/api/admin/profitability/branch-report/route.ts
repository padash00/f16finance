import { NextResponse } from 'next/server'

import { buildProfitabilityReport, companyExpenseLines, sumMonths } from '@/lib/domain/profitability-report'
import { calculateOperatorSalarySummary } from '@/lib/domain/salary'
import type { SalaryAdjustmentRow, SalaryDebtRow, SalaryIncomeRow, SalaryOperatorMeta } from '@/lib/domain/salary'
import { calculateStaffAccrualForMonth } from '@/lib/domain/staff-payroll'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { fetchAllRows } from '@/lib/server/forecast-inputs'
import { listSalaryReferenceData } from '@/lib/server/repositories/salary'
import { listOrganizationStaffIds, resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

/**
 * Управленческий отчёт по точке (PDF и печатная форма).
 *
 * Считается тем же расчётом, что /profitability (lib/domain/profitability-report):
 * только журналы точки, налог из журнала расходов, отклонённые расходы не
 * считаются. Поэтому прибыль точки в PDF совпадает с экраном.
 *
 * Формат ответа прежний (BranchData): turnover − turnoverTax − expensesTotal = netProfit.
 */

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

const normalizeMonth = (value: string | null | undefined): string | null => {
  const trimmed = String(value || '').trim()
  if (/^\d{4}-\d{2}$/.test(trimmed)) return trimmed
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed.slice(0, 7)
  return null
}
const shiftMonth = (month: string, offset: number) => {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + offset, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const monthEndISO = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}
const round2 = (value: number) => Math.round(value * 100) / 100

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'profitability.view')
    if (denied) return denied as any

    const url = new URL(req.url)
    const companyId = (url.searchParams.get('company_id') || '').trim()
    const monthFrom = normalizeMonth(url.searchParams.get('from'))
    const monthTo = normalizeMonth(url.searchParams.get('to'))
    const includeExtra = url.searchParams.get('include_extra') === '1'

    if (!companyId) return json({ error: 'company_id обязателен' }, 400)
    if (!monthFrom || !monthTo) return json({ error: 'from и to обязательны (формат YYYY-MM)' }, 400)
    if (monthFrom > monthTo) return json({ error: 'from должен быть ≤ to' }, 400)

    let scope: { allowedCompanyIds: string[] | null }
    try {
      scope = await resolveCompanyScope({ activeOrganizationId: access.activeOrganization?.id || null, requestedCompanyId: companyId, isSuperAdmin: access.isSuperAdmin })
    } catch {
      return json({ error: 'Точка не найдена' }, 404)
    }

    const fromDate = `${monthFrom}-01`
    const toDate = monthEndISO(monthTo)
    const supabase = createAdminSupabaseClient()
    const orgId = access.activeOrganization?.id || null
    const orgFilterId = orgId || '00000000-0000-0000-0000-000000000000'
    const scopeIn = (q: any) => (scope.allowedCompanyIds ? q.in('company_id', scope.allowedCompanyIds) : q)

    const scopedStaffIds = scope.allowedCompanyIds
      ? await listOrganizationStaffIds({ activeOrganizationId: orgId, isSuperAdmin: access.isSuperAdmin })
      : null
    let staffQuery: any = supabase.from('staff').select('id, full_name, created_at, dismissed_at, monthly_salary')
    if (scopedStaffIds) staffQuery = staffQuery.in('id', scopedStaffIds)
    let staffPeriodsQuery: any = supabase.from('staff_salary_periods').select('staff_id, effective_from, monthly_salary')
    if (scopedStaffIds) staffPeriodsQuery = staffPeriodsQuery.in('staff_id', scopedStaffIds)
    let categoriesQuery: any = supabase.from('expense_categories').select('name, accounting_group')
    if (!access.isSuperAdmin) categoriesQuery = categoriesQuery.eq('organization_id', orgFilterId)
    else if (orgId) categoriesQuery = categoriesQuery.eq('organization_id', orgId)
    let companiesQuery: any = supabase.from('companies').select('id, name, code')
    if (scope.allowedCompanyIds) companiesQuery = companiesQuery.in('id', scope.allowedCompanyIds)

    // Выручка всех точек нужна для разнесения адм. ФОТ по доле точки (справочный блок)
    const [companiesRes, incomes, expenses, categoriesRes, staffRes, staffPeriodsRes, salaryAdjustmentsRes, salaryReference] = await Promise.all([
      companiesQuery,
      fetchAllRows<any>(() =>
        scopeIn(
          supabase
            .from('incomes')
            .select('id, date, company_id, shift, zone, cash_amount, kaspi_amount, kaspi_before_midnight, online_amount, card_amount, operator_id, operator_name')
            .gte('date', fromDate)
            .lte('date', toDate)
            .order('date', { ascending: true })
            .order('id', { ascending: true }),
        ),
      ),
      fetchAllRows<any>(() =>
        scopeIn(
          supabase
            .from('expenses')
            .select('id, date, company_id, category, cash_amount, kaspi_amount, status, comment')
            .gte('date', fromDate)
            .lte('date', toDate)
            .order('date', { ascending: true })
            .order('id', { ascending: true }),
        ),
      ),
      categoriesQuery,
      staffQuery,
      staffPeriodsQuery,
      // company_id IS NULL — «неразнесённые» премии/штрафы оператора; учитывались и раньше
      supabase
        .from('operator_salary_adjustments')
        .select('operator_id,amount,kind,company_id,status,date')
        .or(`company_id.eq.${companyId},company_id.is.null`)
        .gte('date', fromDate)
        .lte('date', toDate),
      listSalaryReferenceData(supabase, { companyIds: [companyId] }),
    ])
    if (companiesRes.error) throw companiesRes.error
    if (categoriesRes.error) throw categoriesRes.error
    if (staffRes.error) throw staffRes.error
    if (salaryAdjustmentsRes.error) throw salaryAdjustmentsRes.error

    const companies = (companiesRes.data || []) as Array<{ id: string; name: string; code: string | null }>
    const company = companies.find((c) => String(c.id) === companyId)
    if (!company) return json({ error: 'Точка не найдена' }, 404)

    const categoryGroups: Record<string, string | null> = {}
    for (const row of (categoriesRes.data || []) as any[]) {
      const key = String(row.name || '').trim().toLowerCase()
      if (key) categoryGroups[key] = row.accounting_group ?? null
    }
    const months: string[] = []
    for (let m = monthFrom, guard = 0; m <= monthTo && guard < 120; m = shiftMonth(m, 1), guard++) months.push(m)

    const report = buildProfitabilityReport({ incomes, expenses, companies, categoryGroups, months, includeExtra })
    const entry = report.companies.find((c) => c.id === companyId)
    const total = entry?.total || sumMonths('total', [])
    const companyExpenses = expenses.filter((r: any) => String(r.company_id) === companyId)
    const lines = companyExpenseLines({ months, expenses: companyExpenses, categoryGroups })

    // ===== Начисления зарплаты (справочно, для блока ФОТ в отчёте) =====
    const staffRows = (staffRes.data || []) as Array<{ id: string; created_at: string | null; dismissed_at: string | null }>
    const staffPeriodsRows = staffPeriodsRes.error ? [] : staffPeriodsRes.data || []
    let staffAccruedTotal = 0
    for (const month of months) {
      staffAccruedTotal += calculateStaffAccrualForMonth({
        staff: staffRows.map((row) => ({ id: row.id, created_at: row.created_at, dismissed_at: row.dismissed_at })),
        periods: staffPeriodsRows as any,
        monthStart: `${month}-01`,
        monthEnd: monthEndISO(month),
      }).total
    }

    const companyIncomes = (incomes as any[]).filter((r) => String(r.company_id) === companyId && r.date >= fromDate) as SalaryIncomeRow[]
    const operatorIds = Array.from(new Set(companyIncomes.map((row) => String(row.operator_id || '')).filter(Boolean)))
    let operatorsAccruedTotal = 0
    if (operatorIds.length > 0) {
      const [operatorsRes, debtsRes] = await Promise.all([
        supabase.from('operators').select('id,name,short_name,is_active,role,operator_profiles(hire_date)').in('id', operatorIds),
        supabase.from('debts').select('operator_id,amount,company_id,status,week_start').in('operator_id', operatorIds).eq('status', 'active').gte('week_start', fromDate).lte('week_start', toDate),
      ])
      if (operatorsRes.error) throw operatorsRes.error
      if (debtsRes.error) throw debtsRes.error
      const operatorRows = (operatorsRes.data || []) as any[]
      for (const opId of operatorIds) {
        const opRow = operatorRows.find((r) => r.id === opId)
        const profile = Array.isArray(opRow?.operator_profiles) ? opRow.operator_profiles[0] : opRow?.operator_profiles
        const operatorMeta: SalaryOperatorMeta | null = opRow ? { id: opId, name: opRow.name || '', short_name: opRow.short_name || null, hire_date: profile?.hire_date || null } : null
        const summary = calculateOperatorSalarySummary({
          operatorId: opId,
          operator: operatorMeta,
          companies: salaryReference.companies,
          rules: salaryReference.rules,
          seniorityTiers: salaryReference.seniorityTiers,
          assignments: salaryReference.assignments,
          incomes: companyIncomes,
          adjustments: (salaryAdjustmentsRes.data || []) as SalaryAdjustmentRow[],
          debts: (debtsRes.data || []) as SalaryDebtRow[],
          options: company.code ? { companyCodes: [company.code] } : undefined,
        })
        operatorsAccruedTotal += summary.totalAccrued
      }
    }
    const staffShare = report.total.revenue > 0 ? total.revenue / report.total.revenue : 0
    const staffAllocated = staffAccruedTotal * staffShare

    return json({
      ok: true,
      data: {
        company: { id: company.id, name: company.name, code: company.code },
        period: { from: monthFrom, to: monthTo, fromDate, toDate },
        turnover: round2(total.revenue),
        turnoverTax: round2(total.incomeTax),
        // Налог из журнала — доля от оборота фактическая, а не ставка
        turnoverTaxRate: total.revenue > 0 ? total.incomeTax / total.revenue : 0,
        afterTax: round2(total.revenue - total.incomeTax),
        expenses: lines.lines.map((line) => ({
          category: line.category,
          amount: round2(line.amount),
          cashAmount: round2(line.cashAmount),
          kaspiAmount: round2(line.kaspiAmount),
          count: line.count,
          comments: line.comments,
          accountingGroup: line.accountingGroup,
        })),
        expensesTotal: round2(lines.total),
        netProfit: round2(total.netProfit),
        payrollAccrued: {
          staff: Math.round(staffAllocated),
          operators: Math.round(operatorsAccruedTotal),
          total: Math.round(staffAllocated + operatorsAccruedTotal),
        },
        capex: lines.capex.map((line) => ({
          category: line.category,
          amount: round2(line.amount),
          comments: line.comments,
          count: line.count,
          items: line.items.slice().sort((a, b) => a.date.localeCompare(b.date)).map((i) => ({ ...i, amount: round2(i.amount) })),
        })),
        capexTotal: round2(lines.capexTotal),
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/profitability/branch-report', message: error?.message || 'branch-report failed' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
