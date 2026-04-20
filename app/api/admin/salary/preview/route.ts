import { NextResponse } from 'next/server'

import { addDaysISO } from '@/lib/core/date'
import { calculateOperatorWeekSummary } from '@/lib/domain/salary'
import type { PointRuleRow } from '@/lib/domain/point-rules'
import {
  ensureOrganizationOperatorAccess,
  resolveCompanyScope,
} from '@/lib/server/organizations'
import { listOperatorSalaryData, listSalaryReferenceData } from '@/lib/server/repositories/salary'
import { createRequestSupabaseClient, getRequestAccessContext, requireStaffCapabilityRequest } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function normalizeIsoDate(value: string | null | undefined) {
  if (!value) return null
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null
  const d = new Date(trimmed)
  return Number.isNaN(d.getTime()) ? null : trimmed
}

export async function GET(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'salary')
    if (guard) return guard
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const url = new URL(req.url)
    const operatorId = String(url.searchParams.get('operator_id') || '').trim()
    const weekStart = normalizeIsoDate(url.searchParams.get('week_start'))
    if (!operatorId) return json({ ok: false, error: 'operator_id обязателен' }, 400)
    if (!weekStart) return json({ ok: false, error: 'week_start должен быть в формате YYYY-MM-DD' }, 400)

    try {
      await ensureOrganizationOperatorAccess({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        operatorId,
      })
    } catch {
      return json({ ok: false, error: 'Нет доступа к оператору' }, 403)
    }

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const weekEnd = addDaysISO(weekStart, 6)
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const scopedCompanyIds = companyScope.allowedCompanyIds

    let shiftRulesQuery = supabase
      .from('point_rules')
      .select('id,company_id,scope,event,name,description,priority,is_active,stop_processing,conditions,actions')
      .eq('scope', 'salary')
      .eq('event', 'salary.shift.computed')
      .eq('is_active', true)
      .order('priority', { ascending: true })
    if (scopedCompanyIds) {
      if (scopedCompanyIds.length > 0) {
        shiftRulesQuery = shiftRulesQuery.or(`company_id.is.null,company_id.in.(${scopedCompanyIds.map((id) => `"${id}"`).join(',')})`)
      }
    }

    const [operatorRow, references, operatorData, shiftRulesRes] = await Promise.all([
      supabase.from('operators').select('id,name,short_name').eq('id', operatorId).maybeSingle(),
      listSalaryReferenceData(supabase, { companyIds: scopedCompanyIds }),
      listOperatorSalaryData(supabase, {
        operatorId,
        dateFrom: weekStart,
        dateTo: weekEnd,
        weekStart,
        companyIds: scopedCompanyIds,
      }),
      shiftRulesQuery,
    ])

    if (operatorRow.error) throw operatorRow.error
    if (shiftRulesRes.error) throw shiftRulesRes.error
    if (!operatorRow.data) return json({ ok: false, error: 'Оператор не найден' }, 404)

    const shiftRules = (shiftRulesRes.data || []) as PointRuleRow[]

    const summary = calculateOperatorWeekSummary({
      operatorId,
      companies: references.companies,
      rules: references.rules,
      shiftRules,
      assignments: references.assignments,
      incomes: operatorData.incomes,
      adjustments: operatorData.adjustments,
      debts: operatorData.debts,
    })

    return json({
      ok: true,
      data: {
        operator: {
          id: String(operatorRow.data.id),
          name: operatorRow.data.name || 'Оператор',
          short_name: operatorRow.data.short_name || null,
        },
        weekStart,
        weekEnd,
        shiftRulesCount: shiftRules.length,
        summary: {
          grossAmount: summary.grossAmount,
          bonusAmount: summary.bonusAmount,
          fineAmount: summary.fineAmount,
          debtAmount: summary.debtAmount,
          advanceAmount: summary.advanceAmount,
          netAmount: summary.netAmount,
          autoBonusTotal: summary.autoBonusTotal,
          shiftsCount: summary.shiftsCount,
        },
        shifts: summary.shifts.map((shift) => ({
          id: shift.id,
          date: shift.date,
          shift: shift.shift,
          companyId: shift.companyId,
          companyCode: shift.companyCode,
          companyName: shift.companyName,
          totalIncome: shift.totalIncome,
          baseSalary: shift.baseSalary,
          autoBonus: shift.autoBonus,
          roleBonus: shift.roleBonus,
          salary: shift.salary,
          matchedRules: shift.matchedRules || [],
        })),
        companyAllocations: summary.companyAllocations,
      },
    })
  } catch (error: any) {
    console.error('Admin salary preview GET error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/salary/preview:get',
      message: error?.message || 'Admin salary preview GET error',
    })
    return json({ ok: false, error: error?.message || 'Ошибка сервера' }, 500)
  }
}
