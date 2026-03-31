import { NextResponse } from 'next/server'

import { addDaysISO, mondayOfDate, toISODateLocal } from '@/lib/core/date'
import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { calculateOperatorWeekSummary } from '@/lib/domain/salary'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestOperatorContext, listActiveOperatorLeadAssignments } from '@/lib/server/request-auth'
import { listOperatorSalaryData, listSalaryReferenceData } from '@/lib/server/repositories/salary'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function normalizeName(value: string | null | undefined) {
  return (value || '').trim().toLowerCase()
}

function getCurrentWeekStart() {
  return toISODateLocal(mondayOfDate(new Date()))
}

function formatShiftLabel(date: string, shiftType: 'day' | 'night', companyName: string | null) {
  const shiftLabel = shiftType === 'day' ? 'дневная' : 'ночная'
  const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  })
  return `${dateLabel}, ${shiftLabel}${companyName ? ` · ${companyName}` : ''}`
}

export async function GET(request: Request) {
  try {
    const context = await getRequestOperatorContext(request)
    if ('response' in context) return context.response

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : (context.supabase as any)
    const weekStart = getCurrentWeekStart()
    const weekEnd = addDaysISO(weekStart, 6)
    const displayLabels = [
      getOperatorDisplayName(context.operator, 'Оператор'),
      context.operator.name,
      context.operator.short_name || '',
    ]
      .map((value) => normalizeName(value))
      .filter(Boolean)

    const { data: operatorAssignments, error: operatorAssignmentsError } = await supabase
      .from('operator_company_assignments')
      .select('company_id')
      .eq('operator_id', context.operator.id)
      .eq('is_active', true)

    if (operatorAssignmentsError) throw operatorAssignmentsError

    const operatorCompanyIds = [...new Set((operatorAssignments || []).map((item: any) => String(item.company_id || '')).filter(Boolean))] as string[]

    const [
      tasksRes,
      debtsRes,
      shiftsRes,
      references,
      operatorData,
      leadAssignments,
      weekRowRes,
    ] = await Promise.all([
      supabase
        .from('tasks')
        .select('id,status,due_date,priority,title')
        .eq('operator_id', context.operator.id)
        .neq('status', 'archived'),
      supabase
        .from('debts')
        .select('id,amount,comment,status,week_start,date,company_id')
        .eq('operator_id', context.operator.id)
        .eq('status', 'active')
        .order('week_start', { ascending: false })
        .limit(12),
      supabase
        .from('shifts')
        .select('id,company_id,date,shift_type,operator_name')
        .in('company_id', operatorCompanyIds.length > 0 ? operatorCompanyIds : ['00000000-0000-0000-0000-000000000000'])
        .gte('date', weekStart)
        .lte('date', weekEnd)
        .order('date', { ascending: true }),
      listSalaryReferenceData(supabase, { companyIds: operatorCompanyIds }),
      listOperatorSalaryData(supabase, {
        operatorId: context.operator.id,
        dateFrom: weekStart,
        dateTo: weekEnd,
        weekStart,
        companyIds: operatorCompanyIds,
      }),
      listActiveOperatorLeadAssignments(context.supabase, context.operator.id),
      supabase
        .from('operator_salary_weeks')
        .select('id,paid_amount,remaining_amount,status')
        .eq('operator_id', context.operator.id)
        .eq('week_start', weekStart)
        .maybeSingle(),
    ])

    if (tasksRes.error) throw tasksRes.error
    if (debtsRes.error) throw debtsRes.error
    if (shiftsRes.error) throw shiftsRes.error
    if (weekRowRes.error) throw weekRowRes.error

    const ownShifts = (shiftsRes.data || []).filter((shift: any) => displayLabels.includes(normalizeName(shift.operator_name)))
    const companyIds = [
      ...new Set(
        [
          ...ownShifts.map((shift: any) => shift.company_id),
          ...(debtsRes.data || []).map((debt: any) => debt.company_id),
          ...leadAssignments.map((assignment) => assignment.company_id),
        ].filter(Boolean),
      ),
    ]

    const { data: companies, error: companiesError } =
      companyIds.length > 0
        ? await supabase.from('companies').select('id,name,code').in('id', companyIds)
        : { data: [], error: null }

    if (companiesError) throw companiesError

    const companyMap = new Map<string, { name: string | null; code: string | null }>()
    for (const company of companies || []) {
      companyMap.set(String(company.id), {
        name: company.name || null,
        code: (company as any).code || null,
      })
    }

    const weekSummary = calculateOperatorWeekSummary({
      operatorId: context.operator.id,
      companies: references.companies,
      rules: references.rules,
      assignments: references.assignments,
      incomes: operatorData.incomes,
      adjustments: operatorData.adjustments,
      debts: operatorData.debts,
    })

    const paidAmount = Number(weekRowRes.data?.paid_amount || 0)
    const remainingAmount =
      weekRowRes.data?.remaining_amount === null || weekRowRes.data?.remaining_amount === undefined
        ? weekSummary.netAmount - paidAmount
        : Number(weekRowRes.data.remaining_amount || 0)

    const activeTasks = (tasksRes.data || []).filter((task: any) => ['todo', 'in_progress', 'backlog'].includes(task.status))
    const reviewTasks = (tasksRes.data || []).filter((task: any) => task.status === 'review')
    const nextShift = ownShifts
      .filter((shift: any) => new Date(`${shift.date}T00:00:00`).getTime() >= new Date().setHours(0, 0, 0, 0))
      .sort((left: any, right: any) => left.date.localeCompare(right.date))[0]

    return json({
      ok: true,
      operator: {
        id: context.operator.id,
        name: getOperatorDisplayName(context.operator, 'Оператор'),
        short_name: context.operator.short_name,
      },
      week: {
        weekStart,
        weekEnd,
        grossAmount: weekSummary.grossAmount,
        bonusAmount: weekSummary.bonusAmount,
        fineAmount: weekSummary.fineAmount,
        debtAmount: weekSummary.debtAmount,
        advanceAmount: weekSummary.advanceAmount,
        netAmount: weekSummary.netAmount,
        paidAmount,
        remainingAmount,
        status: weekRowRes.data?.status || (paidAmount > 0 ? (remainingAmount <= 0.009 ? 'paid' : 'partial') : 'draft'),
      },
      counters: {
        activeTasks: activeTasks.length,
        reviewTasks: reviewTasks.length,
        activeDebts: (debtsRes.data || []).length,
        activeDebtAmount: (debtsRes.data || []).reduce((sum: number, item: any) => sum + Number(item.amount || 0), 0),
        leadPoints: leadAssignments.length,
      },
      nextShift: nextShift
        ? {
            date: nextShift.date,
            shiftType: nextShift.shift_type,
            companyName: nextShift.company_id ? companyMap.get(String(nextShift.company_id))?.name || null : null,
            label: formatShiftLabel(
              nextShift.date,
              nextShift.shift_type,
              nextShift.company_id ? companyMap.get(String(nextShift.company_id))?.name || null : null,
            ),
          }
        : null,
      activeTasks: activeTasks.slice(0, 3).map((task: any) => ({
        id: String(task.id),
        title: String(task.title || 'Задача'),
        status: String(task.status),
        priority: String(task.priority || 'medium'),
        due_date: task.due_date || null,
      })),
      recentDebts: (debtsRes.data || []).slice(0, 3).map((debt: any) => ({
        id: String(debt.id),
        amount: Number(debt.amount || 0),
        comment: debt.comment || null,
        week_start: debt.week_start || null,
        companyName: debt.company_id ? companyMap.get(String(debt.company_id))?.name || null : null,
      })),
      leadAssignments: leadAssignments.map((assignment) => ({
        id: assignment.id,
        companyId: assignment.company_id,
        companyName: assignment.company?.name || null,
        companyCode: assignment.company?.code || null,
        role: assignment.role_in_company,
        isPrimary: assignment.is_primary,
      })),
    })
  } catch (error: any) {
    console.error('Operator overview GET error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/operator/overview:get',
      message: error?.message || 'Operator overview GET error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
