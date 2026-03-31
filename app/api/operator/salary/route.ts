import { NextResponse } from 'next/server'

import { addDaysISO, mondayOfDate, toISODateLocal } from '@/lib/core/date'
import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { calculateOperatorWeekSummary } from '@/lib/domain/salary'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestOperatorContext } from '@/lib/server/request-auth'
import { listOperatorSalaryData, listSalaryReferenceData } from '@/lib/server/repositories/salary'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function roundMoney(value: number) {
  return Math.round(Number(value || 0) * 100) / 100
}

function normalizeIsoDate(value: string | null) {
  if (!value) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

function currentWeekStart() {
  return toISODateLocal(mondayOfDate(new Date()))
}

async function ensureSalaryWeekSnapshotLite(params: {
  supabase: ReturnType<typeof createAdminSupabaseClient>
  operatorId: string
  weekStart: string
  references: Awaited<ReturnType<typeof listSalaryReferenceData>>
  companyIds: string[]
}) {
  const weekEnd = addDaysISO(params.weekStart, 6)
  const operatorData = await listOperatorSalaryData(params.supabase, {
    operatorId: params.operatorId,
    dateFrom: params.weekStart,
    dateTo: weekEnd,
    weekStart: params.weekStart,
    companyIds: params.companyIds,
  })

  const summary = calculateOperatorWeekSummary({
    operatorId: params.operatorId,
    companies: params.references.companies,
    rules: params.references.rules,
    assignments: params.references.assignments,
    incomes: operatorData.incomes,
    adjustments: operatorData.adjustments,
    debts: operatorData.debts,
  })

  const { data: existingWeek, error: existingWeekError } = await params.supabase
    .from('operator_salary_weeks')
    .select('id')
    .eq('operator_id', params.operatorId)
    .eq('week_start', params.weekStart)
    .maybeSingle()

  if (existingWeekError) throw existingWeekError

  const { data: activePayments, error: paymentsError } = await params.supabase
    .from('operator_salary_week_payments')
    .select('id,total_amount,payment_date')
    .eq('operator_id', params.operatorId)
    .eq('salary_week_id', existingWeek?.id || '00000000-0000-0000-0000-000000000000')
    .eq('status', 'active')

  if (paymentsError) throw paymentsError

  const paidAmount = roundMoney((activePayments || []).reduce((sum: number, item: any) => sum + Number(item.total_amount || 0), 0))
  const remainingAmount = roundMoney(summary.netAmount - paidAmount)
  const lastPaymentDate =
    (activePayments || [])
      .map((item: any) => String(item.payment_date || ''))
      .filter(Boolean)
      .sort()
      .pop() || null

  const status = paidAmount <= 0 ? 'draft' : remainingAmount <= 0.009 ? 'paid' : 'partial'
  let weekId = existingWeek?.id as string | undefined

  if (!weekId) {
    const { data, error } = await params.supabase
      .from('operator_salary_weeks')
      .insert([
        {
          operator_id: params.operatorId,
          week_start: params.weekStart,
          week_end: weekEnd,
          gross_amount: summary.grossAmount,
          bonus_amount: summary.bonusAmount,
          fine_amount: summary.fineAmount,
          debt_amount: summary.debtAmount,
          advance_amount: summary.advanceAmount,
          net_amount: summary.netAmount,
          paid_amount: paidAmount,
          remaining_amount: remainingAmount,
          status,
          last_payment_date: lastPaymentDate,
          created_by: null,
        },
      ])
      .select('id')
      .single()

    if (error) throw error
    weekId = String(data.id)
  } else {
    const { error } = await params.supabase
      .from('operator_salary_weeks')
      .update({
        week_end: weekEnd,
        gross_amount: summary.grossAmount,
        bonus_amount: summary.bonusAmount,
        fine_amount: summary.fineAmount,
        debt_amount: summary.debtAmount,
        advance_amount: summary.advanceAmount,
        net_amount: summary.netAmount,
        paid_amount: paidAmount,
        remaining_amount: remainingAmount,
        status,
        last_payment_date: lastPaymentDate,
      })
      .eq('id', weekId)

    if (error) throw error
  }

  if (summary.companyAllocations.length > 0) {
    const rows = summary.companyAllocations.map((allocation) => ({
      salary_week_id: weekId,
      operator_id: params.operatorId,
      company_id: allocation.companyId,
      accrued_amount: allocation.accruedAmount,
      share_ratio: allocation.shareRatio,
      allocated_net_amount: allocation.netAmount,
    }))

    const { error: upsertError } = await params.supabase
      .from('operator_salary_week_company_allocations')
      .upsert(rows, { onConflict: 'salary_week_id,company_id' })

    if (upsertError) throw upsertError
  }

  return {
    weekId: String(weekId),
    weekStart: params.weekStart,
    weekEnd,
    summary,
    paidAmount,
    remainingAmount,
    status,
  }
}

export async function GET(request: Request) {
  try {
    const context = await getRequestOperatorContext(request)
    if ('response' in context) return context.response

    const url = new URL(request.url)
    const weekStart = normalizeIsoDate(url.searchParams.get('weekStart')) || currentWeekStart()
    const weekEnd = addDaysISO(weekStart, 6)
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : (context.supabase as any)
    const { data: operatorAssignments, error: operatorAssignmentsError } = await supabase
      .from('operator_company_assignments')
      .select('company_id')
      .eq('operator_id', context.operator.id)
      .eq('is_active', true)

    if (operatorAssignmentsError) throw operatorAssignmentsError

    const operatorCompanyIds = [...new Set((operatorAssignments || []).map((item: any) => String(item.company_id || '')).filter(Boolean))] as string[]
    const references = await listSalaryReferenceData(supabase, { companyIds: operatorCompanyIds })
    const snapshot = await ensureSalaryWeekSnapshotLite({
      supabase,
      operatorId: context.operator.id,
      weekStart,
      references,
      companyIds: operatorCompanyIds,
    })

    const [paymentsRes, allocationsRes, adjustmentsRes, debtsRes, recentWeeksRes] = await Promise.all([
      supabase
        .from('operator_salary_week_payments')
        .select('id,payment_date,cash_amount,kaspi_amount,total_amount,comment,status,created_at')
        .eq('salary_week_id', snapshot.weekId)
        .eq('status', 'active')
        .order('payment_date', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('operator_salary_week_company_allocations')
        .select('company_id,accrued_amount,share_ratio,allocated_net_amount')
        .eq('salary_week_id', snapshot.weekId),
      supabase
        .from('operator_salary_adjustments')
        .select('id,date,amount,kind,comment,company_id,status')
        .eq('operator_id', context.operator.id)
        .gte('date', weekStart)
        .lte('date', weekEnd)
        .in('status', ['active', 'approved'])
        .order('date', { ascending: false }),
      supabase
        .from('debts')
        .select('id,amount,comment,company_id,status,week_start,date')
        .eq('operator_id', context.operator.id)
        .eq('week_start', weekStart)
        .eq('status', 'active')
        .order('date', { ascending: false }),
      supabase
        .from('operator_salary_weeks')
        .select('id,week_start,week_end,net_amount,paid_amount,remaining_amount,status,last_payment_date')
        .eq('operator_id', context.operator.id)
        .order('week_start', { ascending: false })
        .limit(8),
    ])

    if (paymentsRes.error) throw paymentsRes.error
    if (allocationsRes.error) throw allocationsRes.error
    if (adjustmentsRes.error) throw adjustmentsRes.error
    if (debtsRes.error) throw debtsRes.error
    if (recentWeeksRes.error) throw recentWeeksRes.error

    const companyIds = [
      ...new Set(
        [
          ...(allocationsRes.data || []).map((item: any) => item.company_id),
          ...(adjustmentsRes.data || []).map((item: any) => item.company_id),
          ...(debtsRes.data || []).map((item: any) => item.company_id),
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

    const recentWeekIds = (recentWeeksRes.data || []).map((item: any) => String(item.id))
    const { data: recentPayments, error: recentPaymentsError } =
      recentWeekIds.length > 0
        ? await supabase
            .from('operator_salary_week_payments')
            .select('id,salary_week_id,payment_date,total_amount,status')
            .in('salary_week_id', recentWeekIds)
            .eq('status', 'active')
        : { data: [], error: null }

    if (recentPaymentsError) throw recentPaymentsError

    const paymentsByWeek = new Map<string, any[]>()
    for (const payment of recentPayments || []) {
      const key = String((payment as any).salary_week_id)
      const list = paymentsByWeek.get(key) || []
      list.push(payment)
      paymentsByWeek.set(key, list)
    }

    return json({
      ok: true,
      operator: {
        id: context.operator.id,
        name: getOperatorDisplayName(context.operator, 'Оператор'),
        short_name: context.operator.short_name,
      },
      week: {
        id: snapshot.weekId,
        weekStart,
        weekEnd,
        grossAmount: snapshot.summary.grossAmount,
        bonusAmount: snapshot.summary.bonusAmount,
        fineAmount: snapshot.summary.fineAmount,
        debtAmount: snapshot.summary.debtAmount,
        advanceAmount: snapshot.summary.advanceAmount,
        netAmount: snapshot.summary.netAmount,
        paidAmount: snapshot.paidAmount,
        remainingAmount: snapshot.remainingAmount,
        status: snapshot.status,
        allocations: (allocationsRes.data || []).map((item: any) => ({
          companyId: String(item.company_id),
          companyName: companyMap.get(String(item.company_id))?.name || null,
          companyCode: companyMap.get(String(item.company_id))?.code || null,
          accruedAmount: roundMoney(Number(item.accrued_amount || 0)),
          netAmount: roundMoney(Number(item.allocated_net_amount || 0)),
          shareRatio: roundMoney(Number(item.share_ratio || 0)),
          details:
            snapshot.summary.companyAllocations.find((allocation) => allocation.companyId === String(item.company_id)) || null,
        })),
        payments: (paymentsRes.data || []).map((payment: any) => ({
          id: String(payment.id),
          payment_date: payment.payment_date,
          cash_amount: roundMoney(Number(payment.cash_amount || 0)),
          kaspi_amount: roundMoney(Number(payment.kaspi_amount || 0)),
          total_amount: roundMoney(Number(payment.total_amount || 0)),
          comment: payment.comment || null,
          status: payment.status || 'active',
          created_at: payment.created_at || null,
        })),
        adjustments: (adjustmentsRes.data || []).map((item: any) => ({
          id: String(item.id),
          date: item.date,
          amount: roundMoney(Number(item.amount || 0)),
          kind: item.kind,
          comment: item.comment || null,
          companyName: item.company_id ? companyMap.get(String(item.company_id))?.name || null : null,
        })),
        debts: (debtsRes.data || []).map((item: any) => ({
          id: String(item.id),
          amount: roundMoney(Number(item.amount || 0)),
          comment: item.comment || null,
          companyName: item.company_id ? companyMap.get(String(item.company_id))?.name || null : null,
          date: item.date || item.week_start || null,
        })),
      },
      recentWeeks: (recentWeeksRes.data || []).map((item: any) => ({
        id: String(item.id),
        weekStart: item.week_start,
        weekEnd: item.week_end,
        netAmount: roundMoney(Number(item.net_amount || 0)),
        paidAmount: roundMoney(Number(item.paid_amount || 0)),
        remainingAmount: roundMoney(Number(item.remaining_amount || 0)),
        status: item.status || 'draft',
        lastPaymentDate: item.last_payment_date || null,
        paymentsCount: (paymentsByWeek.get(String(item.id)) || []).length,
      })),
    })
  } catch (error: any) {
    console.error('Operator salary GET error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/operator/salary:get',
      message: error?.message || 'Operator salary GET error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
