import { NextResponse } from 'next/server'

import { calculateOperatorSalarySummary } from '@/lib/domain/salary'
import type {
  SalaryAdjustmentRow,
  SalaryDebtRow,
  SalaryIncomeRow,
  SalaryOperatorMeta,
} from '@/lib/domain/salary'
import { calculateStaffAccrualForMonth } from '@/lib/domain/staff-payroll'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { listSalaryReferenceData } from '@/lib/server/repositories/salary'
import { listOrganizationStaffIds, resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

// Константа налога с оборота. Если в будущем понадобится разные ставки —
// перенести в companies.turnover_tax_rate или в profitability_settings.
const TURNOVER_TAX_RATE = 0.02

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function normalizeMonth(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}$/.test(trimmed)) return trimmed
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed.slice(0, 7)
  return null
}

function monthStartISO(month: string) {
  return `${month}-01`
}

function monthEndISO(month: string) {
  const [yearStr, monthStr] = month.split('-')
  const year = Number(yearStr)
  const monthNum = Number(monthStr)
  if (!Number.isFinite(year) || !Number.isFinite(monthNum)) return `${month}-31`
  const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate()
  return `${month}-${String(lastDay).padStart(2, '0')}`
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function iterateMonths(monthFrom: string, monthTo: string): Array<{ monthStart: string; monthEnd: string }> {
  const result: Array<{ monthStart: string; monthEnd: string }> = []
  const [yStr, mStr] = monthFrom.split('-')
  const [yEndStr, mEndStr] = monthTo.split('-')
  let y = Number(yStr)
  let m = Number(mStr)
  const yEnd = Number(yEndStr)
  const mEnd = Number(mEndStr)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(yEnd) || !Number.isFinite(mEnd)) return result
  while (y < yEnd || (y === yEnd && m <= mEnd)) {
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const mm = String(m).padStart(2, '0')
    result.push({ monthStart: `${y}-${mm}-01`, monthEnd: `${y}-${mm}-${String(lastDay).padStart(2, '0')}` })
    m += 1
    if (m > 12) { y += 1; m = 1 }
  }
  return result
}

type ExpenseLine = {
  category: string
  accountingGroup: string
  amount: number
  cashAmount: number
  kaspiAmount: number
  count: number
  topComments: string[]
  items: Array<{ date: string; amount: number; comment: string }>
}

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

    if (!companyId) return json({ error: 'company_id обязателен' }, 400)
    if (!monthFrom || !monthTo) return json({ error: 'from и to обязательны (формат YYYY-MM)' }, 400)
    if (monthFrom > monthTo) return json({ error: 'from должен быть ≤ to' }, 400)

    // Мультитенантная изоляция: проверяем, что запрошенная точка в скоупе активной
    // организации, и получаем allowedCompanyIds (null в LEGACY_SINGLE_TENANT_MODE).
    let scope: { allowedCompanyIds: string[] | null }
    try {
      scope = await resolveCompanyScope({
        activeOrganizationId: access.activeOrganization?.id || null,
        requestedCompanyId: companyId,
        isSuperAdmin: access.isSuperAdmin,
      })
    } catch {
      return json({ error: 'Точка не найдена' }, 404)
    }

    const fromDate = monthStartISO(monthFrom)
    const toDate = monthEndISO(monthTo)

    const supabase = createAdminSupabaseClient()

    // Скоупим адм. сотрудников по организации (no-op пока флаг LEGACY включён).
    const scopedStaffIds = scope.allowedCompanyIds
      ? await listOrganizationStaffIds({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
        })
      : null

    const staffQuery = supabase.from('staff').select('id, full_name, created_at, dismissed_at, monthly_salary')
    if (scopedStaffIds) staffQuery.in('id', scopedStaffIds)

    const [companyRes, incomesRes, expensesRes, categoriesRes, staffRes, staffPeriodsRes, salaryAdjustmentsRes, salaryReference] = await Promise.all([
      supabase.from('companies').select('id, name, code').eq('id', companyId).maybeSingle(),
      supabase
        .from('incomes')
        .select('cash_amount, kaspi_amount, online_amount, card_amount, date, company_id, shift, operator_id, operator_name')
        .eq('company_id', companyId)
        .gte('date', fromDate)
        .lte('date', toDate),
      supabase
        .from('expenses')
        .select('category, cash_amount, kaspi_amount, comment, date')
        .eq('company_id', companyId)
        .gte('date', fromDate)
        .lte('date', toDate),
      supabase.from('expense_categories').select('name, accounting_group'),
      staffQuery,
      supabase.from('staff_salary_periods').select('staff_id, effective_from, monthly_salary'),
      supabase
        .from('operator_salary_adjustments')
        .select('operator_id,amount,kind,company_id,status,date')
        .gte('date', fromDate)
        .lte('date', toDate),
      listSalaryReferenceData(supabase, { companyIds: [companyId] }),
    ])

    if (companyRes.error) throw companyRes.error
    if (!companyRes.data) return json({ error: 'Точка не найдена' }, 404)
    if (incomesRes.error) throw incomesRes.error
    if (expensesRes.error) throw expensesRes.error
    if (categoriesRes.error) throw categoriesRes.error
    if (staffRes.error) throw staffRes.error
    // staff_salary_periods может ещё не быть (миграция не накатана) — тогда idle null.
    const staffPeriodsRows = staffPeriodsRes.error ? [] : (staffPeriodsRes.data || [])
    if (salaryAdjustmentsRes.error) throw salaryAdjustmentsRes.error

    const company = companyRes.data as { id: string; name: string; code: string | null }

    // Оборот: суммируем все каналы доходов за период.
    let turnover = 0
    for (const row of (incomesRes.data || []) as any[]) {
      turnover += Number(row.cash_amount || 0)
      turnover += Number(row.kaspi_amount || 0)
      turnover += Number(row.online_amount || 0)
      turnover += Number(row.card_amount || 0)
    }
    turnover = round2(turnover)

    // Общая выручка ВСЕХ точек за период — чтобы разнести админ-ФОТ по доле этой точки.
    // Раньше вся админ-зарплата клалась целиком на КАЖДУЮ точку → Ramen/Extra ложно убыточны
    // и три отчёта нельзя было складывать (админка считалась трижды).
    let totalTurnover = 0
    {
      let page = 0
      while (true) {
        let totalQuery = supabase
          .from('incomes')
          .select('cash_amount, kaspi_amount, online_amount, card_amount')
          .gte('date', fromDate)
          .lte('date', toDate)
        // Скоуп организации: "общая выручка" не должна выходить за пределы
        // компаний активной организации (no-op пока allowedCompanyIds === null).
        if (scope.allowedCompanyIds) totalQuery = totalQuery.in('company_id', scope.allowedCompanyIds)
        const { data, error } = await totalQuery.range(page * 1000, page * 1000 + 999)
        if (error) throw error
        const chunk = (data || []) as any[]
        for (const r of chunk) {
          totalTurnover += Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.online_amount || 0) + Number(r.card_amount || 0)
        }
        if (chunk.length < 1000) break
        page += 1
      }
    }
    const staffShare = totalTurnover > 0 ? turnover / totalTurnover : 0

    // Маппинг category name → accounting_group.
    const accountingGroupByName = new Map<string, string>()
    for (const row of (categoriesRes.data || []) as any[]) {
      const name = String(row?.name || '').trim()
      if (!name) continue
      accountingGroupByName.set(name, String(row?.accounting_group || 'operating'))
    }

    // Агрегация расходов по category.
    const expenseMap = new Map<string, ExpenseLine>()
    for (const row of (expensesRes.data || []) as any[]) {
      const category = String(row?.category || 'Без категории').trim() || 'Без категории'
      const cash = Number(row?.cash_amount || 0)
      const kaspi = Number(row?.kaspi_amount || 0)
      const total = cash + kaspi
      if (total <= 0) continue

      const accountingGroup = accountingGroupByName.get(category) || 'operating'
      const current = expenseMap.get(category) || {
        category,
        accountingGroup,
        amount: 0,
        cashAmount: 0,
        kaspiAmount: 0,
        count: 0,
        topComments: [],
        items: [],
      }
      current.amount = round2(current.amount + total)
      current.cashAmount = round2(current.cashAmount + cash)
      current.kaspiAmount = round2(current.kaspiAmount + kaspi)
      current.count += 1
      const comment = String(row?.comment || '').trim()
      if (comment && current.topComments.length < 3 && !current.topComments.includes(comment)) {
        current.topComments.push(comment)
      }
      // Для capex сохраняем полный список позиций — пригодится в детализации PDF.
      if (accountingGroup === 'capex') {
        current.items.push({
          date: String(row?.date || ''),
          amount: round2(total),
          comment,
        })
      }
      expenseMap.set(category, current)
    }

    // Разделяем на P&L расходы и CAPEX (вне P&L, справочно).
    const allLines = Array.from(expenseMap.values()).sort((a, b) => b.amount - a.amount)
    const operatingExpenses = allLines.filter((line) => line.accountingGroup !== 'capex' && line.accountingGroup !== 'profit_distribution')
    const capexLines = allLines.filter((line) => line.accountingGroup === 'capex')

    const expensesTotal = round2(operatingExpenses.reduce((sum, line) => sum + line.amount, 0))
    const capexTotal = round2(capexLines.reduce((sum, line) => sum + line.amount, 0))

    const turnoverTax = round2(turnover * TURNOVER_TAX_RATE)
    const netProfit = round2(turnover - turnoverTax - expensesTotal)

    // ===== Начисления зарплаты (по факту, а не по выплатам) =====
    // Адм. сотрудники: для каждого месяца отчёта раскладываем по периодам effective_from.
    const months = iterateMonths(monthFrom, monthTo)
    const staffRows = (staffRes.data || []) as Array<{
      id: string
      full_name: string | null
      created_at: string | null
      dismissed_at: string | null
      monthly_salary: number | null
    }>
    const staffMeta = staffRows.map((row) => ({
      id: row.id,
      created_at: row.created_at,
      dismissed_at: row.dismissed_at,
    }))
    let staffAccruedTotal = 0
    for (const { monthStart, monthEnd } of months) {
      const result = calculateStaffAccrualForMonth({
        staff: staffMeta,
        periods: staffPeriodsRows as any,
        monthStart,
        monthEnd,
      })
      staffAccruedTotal += result.total
    }

    // Операторы: считаем через calculateOperatorSalarySummary, ограничиваясь сменами этой компании.
    const incomesRows = (incomesRes.data || []) as SalaryIncomeRow[]
    const operatorIds = Array.from(
      new Set(incomesRows.map((row) => String(row.operator_id || '')).filter(Boolean)),
    )

    let operatorsAccruedTotal = 0
    if (operatorIds.length > 0) {
      const [operatorsRes, debtsRes] = await Promise.all([
        supabase
          .from('operators')
          .select('id,name,short_name,is_active,role,operator_profiles(hire_date)')
          .in('id', operatorIds),
        supabase
          .from('debts')
          .select('operator_id,amount,company_id,status,week_start')
          .in('operator_id', operatorIds)
          .eq('status', 'active')
          .gte('week_start', fromDate)
          .lte('week_start', toDate),
      ])
      if (operatorsRes.error) throw operatorsRes.error
      if (debtsRes.error) throw debtsRes.error

      const adjustments = (salaryAdjustmentsRes.data || []) as SalaryAdjustmentRow[]
      const debts = (debtsRes.data || []) as SalaryDebtRow[]
      const operatorRows = (operatorsRes.data || []) as any[]
      const companyCode = companyRes.data.code || undefined

      for (const opId of operatorIds) {
        const opRow = operatorRows.find((r) => r.id === opId)
        const profile = Array.isArray(opRow?.operator_profiles)
          ? opRow.operator_profiles[0]
          : opRow?.operator_profiles
        const operatorMeta: SalaryOperatorMeta | null = opRow
          ? {
              id: opId,
              name: opRow.name || '',
              short_name: opRow.short_name || null,
              hire_date: profile?.hire_date || null,
            }
          : null
        const summary = calculateOperatorSalarySummary({
          operatorId: opId,
          operator: operatorMeta,
          companies: salaryReference.companies,
          rules: salaryReference.rules,
          seniorityTiers: salaryReference.seniorityTiers,
          assignments: salaryReference.assignments,
          incomes: incomesRows,
          adjustments,
          debts,
          options: companyCode ? { companyCodes: [companyCode] } : undefined,
        })
        operatorsAccruedTotal += summary.totalAccrued
      }
    }

    // Админ-ФОТ разносим по доле выручки точки (а не целиком на каждую).
    const staffAllocated = staffAccruedTotal * staffShare
    const payrollAccrued = {
      staff: Math.round(staffAllocated),
      operators: Math.round(operatorsAccruedTotal),
      total: Math.round(staffAllocated + operatorsAccruedTotal),
    }

    return json({
      ok: true,
      data: {
        company: {
          id: company.id,
          name: company.name,
          code: company.code,
        },
        period: {
          from: monthFrom,
          to: monthTo,
          fromDate,
          toDate,
        },
        turnover,
        turnoverTax,
        turnoverTaxRate: TURNOVER_TAX_RATE,
        afterTax: round2(turnover - turnoverTax),
        expenses: operatingExpenses.map((line) => ({
          category: line.category,
          amount: line.amount,
          cashAmount: line.cashAmount,
          kaspiAmount: line.kaspiAmount,
          count: line.count,
          comments: line.topComments,
          accountingGroup: line.accountingGroup,
        })),
        expensesTotal,
        netProfit,
        payrollAccrued,
        capex: capexLines.map((line) => ({
          category: line.category,
          amount: line.amount,
          comments: line.topComments,
          count: line.count,
          items: line.items
            .slice()
            .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
        })),
        capexTotal,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/profitability/branch-report',
      message: error?.message || 'branch-report failed',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
