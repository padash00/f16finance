import { NextResponse } from 'next/server'

import { addDaysISO } from '@/lib/core/date'
import { calculateOperatorWeekSummary } from '@/lib/domain/salary'
import {
  ensureOrganizationOperatorAccess,
  listOrganizationCompanyIds,
  listOrganizationCompanyCodes,
  listOrganizationOperatorIds,
  resolveCompanyScope,
} from '@/lib/server/organizations'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { listOperatorSalaryData, listSalaryReferenceData } from '@/lib/server/repositories/salary'
import { createRequestSupabaseClient, getRequestAccessContext, requireStaffCapabilityRequest } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

type AdjustmentKind = 'debt' | 'fine' | 'bonus' | 'advance'

type MutationBody =
  | {
      action: 'createAdjustment'
      payload: {
        operator_id: string
        date: string
        amount: number
        kind: AdjustmentKind
        comment?: string | null
        company_id?: string | null
      }
    }
  | {
      action: 'createAdvance'
      payload: {
        operator_id: string
        week_start: string
        company_id: string
        payment_date: string
        cash_amount?: number | null
        kaspi_amount?: number | null
        comment?: string | null
      }
    }
  | {
      action: 'createWeeklyPayment'
      payload: {
        operator_id: string
        week_start: string
        payment_date: string
        cash_amount?: number | null
        kaspi_amount?: number | null
        comment?: string | null
      }
    }
  | {
      action: 'updateOperatorChatId'
      operatorId: string
      telegram_chat_id: string | null
    }
  | {
      action: 'voidPayment'
      paymentId: string
      weekStart: string
      operatorId: string
    }
  | {
      action: 'voidAdjustment'
      adjustmentId: string
      weekStart: string
      operatorId: string
    }
  | {
      action: 'markDebtsPaid'
      operatorId: string
      weekStart: string
    }

type PaymentSplit = {
  cashAmount: number
  kaspiAmount: number
  totalAmount: number
}

type CompanyDistribution = {
  companyId: string
  totalAmount: number
  cashAmount: number
  kaspiAmount: number
}

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

function roundMoney(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100
}

function normalizeSplit(cashAmount?: number | null, kaspiAmount?: number | null): PaymentSplit {
  const cash = roundMoney(Number(cashAmount || 0))
  const kaspi = roundMoney(Number(kaspiAmount || 0))
  const total = roundMoney(cash + kaspi)

  return {
    cashAmount: cash,
    kaspiAmount: kaspi,
    totalAmount: total,
  }
}

function distributeAmount(
  totalAmount: number,
  weights: Array<{ key: string; weight: number }>,
): Map<string, number> {
  const total = roundMoney(totalAmount)
  const result = new Map<string, number>()
  if (!weights.length || total === 0) return result

  const normalizedWeights = weights.map((item) => ({
    key: item.key,
    weight: Math.max(0, roundMoney(item.weight)),
  }))
  const weightTotal = normalizedWeights.reduce((sum, item) => sum + item.weight, 0)

  if (weightTotal <= 0) {
    result.set(normalizedWeights[0].key, total)
    return result
  }

  let assigned = 0
  const drafts = normalizedWeights.map((item) => {
    const raw = (total * item.weight) / weightTotal
    const rounded = roundMoney(raw)
    assigned += rounded
    return {
      key: item.key,
      rounded,
      delta: raw - rounded,
    }
  })

  let remainder = roundMoney(total - assigned)
  drafts.sort((left, right) => right.delta - left.delta)

  for (const item of drafts) {
    if (remainder === 0) break
    const step = remainder > 0 ? 0.01 : -0.01
    item.rounded = roundMoney(item.rounded + step)
    remainder = roundMoney(remainder - step)
  }

  for (const item of drafts) {
    result.set(item.key, roundMoney(item.rounded))
  }

  return result
}

function buildCompanyDistribution(params: {
  cashAmount: number
  kaspiAmount: number
  weights: Array<{ key: string; weight: number }>
}): CompanyDistribution[] {
  const totalByCompany = distributeAmount(roundMoney(params.cashAmount + params.kaspiAmount), params.weights)
  const cashByCompany = distributeAmount(params.cashAmount, params.weights)
  const kaspiByCompany = distributeAmount(params.kaspiAmount, params.weights)

  return params.weights.map((item) => ({
    companyId: item.key,
    totalAmount: totalByCompany.get(item.key) || 0,
    cashAmount: cashByCompany.get(item.key) || 0,
    kaspiAmount: kaspiByCompany.get(item.key) || 0,
  }))
}

async function safeDeleteExpenses(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  expenseIds: string[],
) {
  if (!expenseIds.length) return
  const { error } = await supabase.from('expenses').delete().in('id', expenseIds)
  if (error) throw error
}

async function ensureSalaryWeekSnapshot(params: {
  supabase: ReturnType<typeof createAdminSupabaseClient>
  operatorId: string
  weekStart: string
  actorUserId: string | null
  companyIds?: string[] | null
  references?: Awaited<ReturnType<typeof listSalaryReferenceData>>
}) {
  const weekEnd = addDaysISO(params.weekStart, 6)
  const references = params.references || (await listSalaryReferenceData(params.supabase, { companyIds: params.companyIds || null }))
  const operatorData = await listOperatorSalaryData(params.supabase, {
    operatorId: params.operatorId,
    dateFrom: params.weekStart,
    dateTo: weekEnd,
    weekStart: params.weekStart,
    companyIds: params.companyIds || null,
  })

  const summary = calculateOperatorWeekSummary({
    operatorId: params.operatorId,
    companies: references.companies,
    rules: references.rules,
    assignments: references.assignments,
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

  const paidAmount = roundMoney((activePayments || []).reduce((sum, item) => sum + Number(item.total_amount || 0), 0))
  const remainingAmount = roundMoney(summary.netAmount - paidAmount)
  const lastPaymentDate =
    (activePayments || [])
      .map((item) => String(item.payment_date || ''))
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
          created_by: params.actorUserId,
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
    const newRows = summary.companyAllocations.map((allocation) => ({
      salary_week_id: weekId,
      operator_id: params.operatorId,
      company_id: allocation.companyId,
      accrued_amount: allocation.accruedAmount,
      share_ratio: allocation.shareRatio,
      allocated_net_amount: allocation.netAmount,
    }))

    const { error: upsertAllocationsError } = await params.supabase
      .from('operator_salary_week_company_allocations')
      .upsert(newRows, { onConflict: 'salary_week_id,company_id' })

    if (upsertAllocationsError) throw upsertAllocationsError

    // Удаляем строки которых больше нет (компании вышедшие из расчёта)
    const newCompanyIds = summary.companyAllocations.map((a) => a.companyId)
    const { error: deleteStaleError } = await params.supabase
      .from('operator_salary_week_company_allocations')
      .delete()
      .eq('salary_week_id', weekId)
      .not('company_id', 'in', `(${newCompanyIds.join(',')})`)

    if (deleteStaleError) throw deleteStaleError
  } else {
    const { error: deleteAllocationsError } = await params.supabase
      .from('operator_salary_week_company_allocations')
      .delete()
      .eq('salary_week_id', weekId)

    if (deleteAllocationsError) throw deleteAllocationsError
  }

  return {
    weekId,
    weekStart: params.weekStart,
    weekEnd,
    summary,
    paidAmount,
    remainingAmount,
    status,
  }
}

export async function GET(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'salary')
    if (guard) return guard
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const [allowedCompanyIds, allowedOperatorIds] = await Promise.all([
      listOrganizationCompanyIds({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
      }),
      listOrganizationOperatorIds({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
      }),
    ])
    const allowedCompanyCodes = await listOrganizationCompanyCodes({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const url = new URL(req.url)
    const view = url.searchParams.get('view')
    if (view === 'weekly') {
      const weekStart = normalizeIsoDate(url.searchParams.get('weekStart'))
      if (!weekStart) {
        return json({ error: 'weekStart is required' }, 400)
      }

      const weekEnd = addDaysISO(weekStart, 6)
      const supabase = createAdminSupabaseClient()
      const referencesPromise = listSalaryReferenceData(supabase, { companyIds: allowedCompanyIds || null })

      if (!access.isSuperAdmin && (!allowedOperatorIds || allowedOperatorIds.length === 0)) {
        return json({
          ok: true,
          data: {
            weekStart,
            weekEnd,
            operators: [],
            totals: {
              grossAmount: 0,
              bonusAmount: 0,
              fineAmount: 0,
              debtAmount: 0,
              advanceAmount: 0,
              netAmount: 0,
              paidAmount: 0,
              remainingAmount: 0,
              paidOperators: 0,
              partialOperators: 0,
              activeOperators: 0,
              totalOperators: 0,
            },
          },
        })
      }

      let activeOperatorsQuery = supabase
        .from('operators')
        .select('id,name,short_name,is_active,telegram_chat_id,operator_profiles(*)')
        .eq('is_active', true)
        .eq('is_admin_staff', false)
        .order('name')
      if (allowedOperatorIds) activeOperatorsQuery = activeOperatorsQuery.in('id', allowedOperatorIds)

      let existingWeeksQuery = supabase
        .from('operator_salary_weeks')
        .select('operator_id,remaining_amount,paid_amount,net_amount,status')
        .eq('week_start', weekStart)
      if (allowedOperatorIds) existingWeeksQuery = existingWeeksQuery.in('operator_id', allowedOperatorIds)

      let documentsQuery = supabase.from('operator_documents').select('operator_id,expiry_date')
      if (allowedOperatorIds) documentsQuery = documentsQuery.in('operator_id', allowedOperatorIds)

      const [
        references,
        { data: activeOperators, error: activeOperatorsError },
        { data: existingWeeks, error: existingWeeksError },
        { data: documents, error: documentsError },
      ] = await Promise.all([
        referencesPromise,
        activeOperatorsQuery,
        existingWeeksQuery,
        documentsQuery,
      ])

      if (activeOperatorsError) throw activeOperatorsError
      if (existingWeeksError) throw existingWeeksError
      if (documentsError) throw documentsError

      const activeOperatorIds = new Set(((activeOperators || []) as any[]).map((row) => String(row.id)))
      const persistedOperatorIds = Array.from(
        new Set(
          ((existingWeeks || []) as any[])
            .map((row) => String(row.operator_id || ''))
            .filter(Boolean),
        ),
      )
      const missingOperatorIds = persistedOperatorIds.filter((id) => !activeOperatorIds.has(id))

      let inactiveOperators: any[] = []
      if (missingOperatorIds.length > 0) {
        const { data, error } = await supabase
          .from('operators')
          .select('id,name,short_name,is_active,telegram_chat_id,operator_profiles(*)')
          .in('id', missingOperatorIds)
          .order('name')

        if (error) throw error
        inactiveOperators = (data || []) as any[]
      }

      const today = new Date()
      const expiringThreshold = new Date(today)
      expiringThreshold.setDate(expiringThreshold.getDate() + 30)

      const documentStats = new Map<string, { documents_count: number; expiring_documents: number }>()
      for (const row of documents || []) {
        const operatorId = String((row as any).operator_id || '')
        if (!operatorId) continue

        const current = documentStats.get(operatorId) || { documents_count: 0, expiring_documents: 0 }
        current.documents_count += 1

        const expiryRaw = String((row as any).expiry_date || '')
        const expiryDate = expiryRaw ? new Date(expiryRaw) : null
        if (expiryDate && !Number.isNaN(expiryDate.getTime()) && expiryDate >= today && expiryDate <= expiringThreshold) {
          current.expiring_documents += 1
        }

        documentStats.set(operatorId, current)
      }

      const operatorRows = ([...((activeOperators || []) as any[]), ...inactiveOperators] as any[]).map((row) => {
        const profile = Array.isArray(row.operator_profiles) ? row.operator_profiles[0] : row.operator_profiles
        const docs = documentStats.get(String(row.id)) || { documents_count: 0, expiring_documents: 0 }

        return {
          id: String(row.id),
          name: row.name || 'Без имени',
          short_name: row.short_name || null,
          is_active: row.is_active !== false,
          telegram_chat_id: row.telegram_chat_id || null,
          full_name: profile?.full_name || null,
          photo_url: profile?.photo_url || null,
          position: profile?.position || null,
          phone: profile?.phone || null,
          email: profile?.email || null,
          hire_date: profile?.hire_date || null,
          documents_count: docs.documents_count,
          expiring_documents: docs.expiring_documents,
        }
      })

      const snapshots = await Promise.all(
        operatorRows.map((operator) =>
          ensureSalaryWeekSnapshot({
            supabase,
            operatorId: operator.id,
            weekStart,
            actorUserId: null,
            companyIds: allowedCompanyIds || null,
            references,
          }),
        ),
      )

      const weekIds = snapshots.map((snapshot) => snapshot.weekId)
      const emptyResult = { data: [], error: null as any }

      const [{ data: payments, error: paymentsError }, { data: allocations, error: allocationsError }] = await Promise.all([
        weekIds.length > 0
          ? supabase
              .from('operator_salary_week_payments')
              .select(
                'id,salary_week_id,operator_id,payment_date,cash_amount,kaspi_amount,total_amount,comment,status,created_at',
              )
              .in('salary_week_id', weekIds)
              .order('payment_date', { ascending: false })
              .order('created_at', { ascending: false })
          : Promise.resolve(emptyResult),
        weekIds.length > 0
          ? supabase
              .from('operator_salary_week_company_allocations')
              .select('salary_week_id,company_id,accrued_amount,share_ratio,allocated_net_amount')
              .in('salary_week_id', weekIds)
          : Promise.resolve(emptyResult),
      ])

      if (paymentsError) throw paymentsError
      if (allocationsError) throw allocationsError

      const companyMap = new Map(references.companies.map((company) => [company.id, company]))
      const paymentsByWeek = new Map<string, any[]>()
      const allocationsByWeek = new Map<string, any[]>()

      for (const row of payments || []) {
        const key = String((row as any).salary_week_id)
        const list = paymentsByWeek.get(key) || []
        list.push(row)
        paymentsByWeek.set(key, list)
      }

      for (const row of allocations || []) {
        const key = String((row as any).salary_week_id)
        const list = allocationsByWeek.get(key) || []
        list.push(row)
        allocationsByWeek.set(key, list)
      }

      const weeklyOperators = operatorRows
        .map((operator, index) => {
          const snapshot = snapshots[index]
          const weekPayments = (paymentsByWeek.get(snapshot.weekId) || []).map((payment: any) => ({
            id: String(payment.id),
            payment_date: payment.payment_date,
            cash_amount: roundMoney(Number(payment.cash_amount || 0)),
            kaspi_amount: roundMoney(Number(payment.kaspi_amount || 0)),
            total_amount: roundMoney(Number(payment.total_amount || 0)),
            comment: payment.comment || null,
            status: payment.status || 'active',
            created_at: payment.created_at || null,
          }))

          const weekAllocations = (allocationsByWeek.get(snapshot.weekId) || [])
            .map((allocation: any) => {
              const company = companyMap.get(String(allocation.company_id))
              const fallback = snapshot.summary.companyAllocations.find(
                (item) => item.companyId === String(allocation.company_id),
              )

              return {
                companyId: String(allocation.company_id),
                companyCode: company?.code || fallback?.companyCode || null,
                companyName: company?.name || fallback?.companyName || null,
                accruedAmount: roundMoney(Number(allocation.accrued_amount || fallback?.accruedAmount || 0)),
                bonusAmount: roundMoney(Number(fallback?.bonusAmount || 0)),
                fineAmount: roundMoney(Number(fallback?.fineAmount || 0)),
                debtAmount: roundMoney(Number(fallback?.debtAmount || 0)),
                advanceAmount: roundMoney(Number(fallback?.advanceAmount || 0)),
                netAmount: roundMoney(Number(allocation.allocated_net_amount || fallback?.netAmount || 0)),
                shareRatio: roundMoney(Number(allocation.share_ratio || fallback?.shareRatio || 0)),
              }
            })
            .sort((left, right) => right.netAmount - left.netAmount)

          const hasActivity =
            snapshot.summary.grossAmount > 0 ||
            snapshot.summary.bonusAmount > 0 ||
            snapshot.summary.fineAmount > 0 ||
            snapshot.summary.debtAmount > 0 ||
            snapshot.summary.advanceAmount > 0 ||
            snapshot.paidAmount > 0 ||
            weekPayments.length > 0

          return {
            operator,
            week: {
              id: snapshot.weekId,
              weekStart: snapshot.weekStart,
              weekEnd: snapshot.weekEnd,
              grossAmount: snapshot.summary.grossAmount,
              bonusAmount: snapshot.summary.bonusAmount,
              fineAmount: snapshot.summary.fineAmount,
              debtAmount: snapshot.summary.debtAmount,
              advanceAmount: snapshot.summary.advanceAmount,
              netAmount: snapshot.summary.netAmount,
              paidAmount: snapshot.paidAmount,
              remainingAmount: snapshot.remainingAmount,
              status: snapshot.status,
              companyAllocations: weekAllocations,
              payments: weekPayments,
              shiftsCount: snapshot.summary.shiftsCount,
              autoBonusTotal: snapshot.summary.autoBonusTotal,
              shifts: snapshot.summary.shifts,
            },
            hasActivity,
          }
        })
        .sort((left, right) => {
          if (left.operator.is_active !== right.operator.is_active) {
            return left.operator.is_active ? -1 : 1
          }
          if (left.week.remainingAmount !== right.week.remainingAmount) {
            return right.week.remainingAmount - left.week.remainingAmount
          }
          return String(left.operator.full_name || left.operator.name).localeCompare(
            String(right.operator.full_name || right.operator.name),
            'ru',
          )
        })

      const totals = weeklyOperators.reduce(
        (acc, item) => {
          acc.grossAmount += item.week.grossAmount
          acc.bonusAmount += item.week.bonusAmount
          acc.fineAmount += item.week.fineAmount
          acc.debtAmount += item.week.debtAmount
          acc.advanceAmount += item.week.advanceAmount
          acc.netAmount += item.week.netAmount
          acc.paidAmount += item.week.paidAmount
          acc.remainingAmount += item.week.remainingAmount
          if (item.week.status === 'paid') acc.paidOperators += 1
          if (item.week.status === 'partial') acc.partialOperators += 1
          if (item.operator.is_active) acc.activeOperators += 1
          return acc
        },
        {
          grossAmount: 0,
          bonusAmount: 0,
          fineAmount: 0,
          debtAmount: 0,
          advanceAmount: 0,
          netAmount: 0,
          paidAmount: 0,
          remainingAmount: 0,
          paidOperators: 0,
          partialOperators: 0,
          activeOperators: 0,
        },
      )

      return json({
        ok: true,
        data: {
          weekStart,
          weekEnd,
          companies: references.companies,
          operators: weeklyOperators,
          totals: {
            grossAmount: roundMoney(totals.grossAmount),
            bonusAmount: roundMoney(totals.bonusAmount),
            fineAmount: roundMoney(totals.fineAmount),
            debtAmount: roundMoney(totals.debtAmount),
            advanceAmount: roundMoney(totals.advanceAmount),
            netAmount: roundMoney(totals.netAmount),
            paidAmount: roundMoney(totals.paidAmount),
            remainingAmount: roundMoney(totals.remainingAmount),
            paidOperators: totals.paidOperators,
            partialOperators: totals.partialOperators,
            activeOperators: totals.activeOperators,
            totalOperators: weeklyOperators.length,
          },
        },
      })
    }

    if (view === 'operatorWeekly') {
      const operatorId = (url.searchParams.get('operatorId') || '').trim()
      const weekStart = normalizeIsoDate(url.searchParams.get('weekStart'))

      if (!operatorId || !weekStart) {
        return json({ error: 'operatorId and weekStart are required' }, 400)
      }
      await ensureOrganizationOperatorAccess({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        operatorId,
      })

      const weekEnd = addDaysISO(weekStart, 6)
      const supabase = createAdminSupabaseClient()

      let incomesQuery = supabase
        .from('incomes')
        .select('id, date, company_id, operator_id, shift, zone, cash_amount, kaspi_amount, online_amount, card_amount, comment')
        .eq('operator_id', operatorId)
        .gte('date', weekStart)
        .lte('date', weekEnd)
        .order('date', { ascending: false })
      if (allowedCompanyIds) incomesQuery = incomesQuery.in('company_id', allowedCompanyIds)

      const [
        { data: operatorRow, error: operatorError },
        references,
        { data: incomes, error: incomesError },
      ] = await Promise.all([
        supabase
          .from('operators')
          .select('id, name, short_name, is_active, telegram_chat_id, operator_profiles(*)')
          .eq('id', operatorId)
          .maybeSingle(),
        listSalaryReferenceData(supabase, { companyIds: allowedCompanyIds || null }),
        incomesQuery,
      ])

      if (operatorError) throw operatorError
      if (incomesError) throw incomesError
      if (!operatorRow) return json({ error: 'operator-not-found' }, 404)

      const snapshot = await ensureSalaryWeekSnapshot({ supabase, operatorId, weekStart, actorUserId: null, companyIds: allowedCompanyIds || null, references })

      const [
        { data: payments, error: paymentsError },
        { data: adjustmentsRaw, error: adjustmentsError2 },
      ] = await Promise.all([
        supabase
          .from('operator_salary_week_payments')
          .select('id, payment_date, cash_amount, kaspi_amount, total_amount, comment, status, created_at')
          .eq('salary_week_id', snapshot.weekId)
          .order('payment_date', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase
          .from('operator_salary_adjustments')
          .select('id, date, amount, kind, comment, company_id, status, salary_week_id, linked_expense_id')
          .eq('operator_id', operatorId)
          .gte('date', weekStart)
          .lte('date', weekEnd)
          .order('date', { ascending: false }),
      ])

      if (paymentsError) throw paymentsError
      if (adjustmentsError2) throw adjustmentsError2

      const { data: recentWeeksRaw, error: recentWeeksError } = await supabase
        .from('operator_salary_weeks')
        .select('id, week_start, week_end, net_amount, paid_amount, remaining_amount, status')
        .eq('operator_id', operatorId)
        .order('week_start', { ascending: false })
        .limit(12)

      if (recentWeeksError) throw recentWeeksError

      const companyMap = new Map(references.companies.map((c) => [c.id, c]))
      const allocations = snapshot.summary.companyAllocations.map((a) => {
        const company = companyMap.get(a.companyId)
        return {
          companyId: a.companyId,
          companyCode: company?.code || a.companyCode || null,
          companyName: company?.name || a.companyName || null,
          accruedAmount: a.accruedAmount,
          bonusAmount: a.bonusAmount,
          fineAmount: a.fineAmount,
          debtAmount: a.debtAmount,
          advanceAmount: a.advanceAmount,
          netAmount: a.netAmount,
          shareRatio: a.shareRatio,
        }
      })

      const profile = Array.isArray(operatorRow.operator_profiles) ? operatorRow.operator_profiles[0] : operatorRow.operator_profiles

      return json({
        ok: true,
        data: {
          operator: {
            id: String(operatorRow.id),
            name: operatorRow.name || 'Без имени',
            short_name: operatorRow.short_name || null,
            is_active: operatorRow.is_active !== false,
            full_name: (profile as any)?.full_name || null,
            photo_url: (profile as any)?.photo_url || null,
            position: (profile as any)?.position || null,
            telegram_chat_id: (operatorRow as any).telegram_chat_id || null,
          },
          companies: references.companies,
          week: {
            id: snapshot.weekId,
            weekStart: snapshot.weekStart,
            weekEnd: snapshot.weekEnd,
            grossAmount: snapshot.summary.grossAmount,
            bonusAmount: snapshot.summary.bonusAmount,
            fineAmount: snapshot.summary.fineAmount,
            debtAmount: snapshot.summary.debtAmount,
            advanceAmount: snapshot.summary.advanceAmount,
            netAmount: snapshot.summary.netAmount,
            paidAmount: snapshot.paidAmount,
            remainingAmount: snapshot.remainingAmount,
            status: snapshot.status,
            companyAllocations: allocations,
            payments: (payments || []).map((p: any) => ({
              id: String(p.id),
              payment_date: p.payment_date,
              cash_amount: roundMoney(Number(p.cash_amount || 0)),
              kaspi_amount: roundMoney(Number(p.kaspi_amount || 0)),
              total_amount: roundMoney(Number(p.total_amount || 0)),
              comment: p.comment || null,
              status: p.status || 'active',
            })),
          },
          incomes: incomes || [],
          adjustments: (adjustmentsRaw || []).map((a: any) => ({
            id: String(a.id),
            date: a.date,
            amount: roundMoney(Number(a.amount || 0)),
            kind: a.kind as string,
            comment: a.comment || null,
            company_id: a.company_id || null,
            status: (a.status || 'active') as string,
            salary_week_id: a.salary_week_id || null,
            linked_expense_id: a.linked_expense_id || null,
          })),
          recentWeeks: (recentWeeksRaw || []).map((w: any) => ({
            id: String(w.id),
            weekStart: String(w.week_start),
            weekEnd: String(w.week_end),
            netAmount: roundMoney(Number(w.net_amount || 0)),
            paidAmount: roundMoney(Number(w.paid_amount || 0)),
            remainingAmount: roundMoney(Number(w.remaining_amount || 0)),
            status: (w.status || 'draft') as 'draft' | 'partial' | 'paid',
          })),
        },
      })
    }

    if (view !== 'operatorDetail') {
      return json({ error: 'unsupported-view' }, 400)
    }

      const operatorId = (url.searchParams.get('operatorId') || '').trim()
      const dateFrom = normalizeIsoDate(url.searchParams.get('dateFrom'))
      const dateTo = normalizeIsoDate(url.searchParams.get('dateTo'))

    if (!operatorId || !dateFrom || !dateTo) {
      return json({ error: 'operatorId, dateFrom and dateTo are required' }, 400)
    }
    await ensureOrganizationOperatorAccess({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
      operatorId,
    })

    const supabase = createAdminSupabaseClient()
    let companiesQuery = supabase.from('companies').select('id, name, code').order('name')
    if (allowedCompanyIds) companiesQuery = companiesQuery.in('id', allowedCompanyIds)
    let rulesQuery = supabase
      .from('operator_salary_rules')
      .select(
        'company_code, shift_type, base_per_shift, senior_operator_bonus, senior_cashier_bonus, threshold1_turnover, threshold1_bonus, threshold2_turnover, threshold2_bonus',
      )
      .eq('is_active', true)
    if (allowedCompanyCodes) rulesQuery = rulesQuery.in('company_code', allowedCompanyCodes)
    let assignmentsQuery = supabase
      .from('operator_company_assignments')
      .select('operator_id, company_id, role_in_company, is_active')
      .eq('operator_id', operatorId)
      .eq('is_active', true)
    let incomesQuery2 = supabase
      .from('incomes')
      .select('id, date, company_id, operator_id, shift, zone, cash_amount, kaspi_amount, online_amount, card_amount, comment')
      .eq('operator_id', operatorId)
      .gte('date', dateFrom)
      .lte('date', dateTo)
      .order('date', { ascending: false })
    if (allowedCompanyIds) {
      assignmentsQuery = assignmentsQuery.in('company_id', allowedCompanyIds)
      incomesQuery2 = incomesQuery2.in('company_id', allowedCompanyIds)
    }
    const [
      { data: operator, error: operatorError },
      { data: companies, error: companiesError },
      { data: rules, error: rulesError },
      { data: assignments, error: assignmentsError },
      { data: incomes, error: incomesError },
      { data: payouts, error: payoutsError },
    ] = await Promise.all([
      supabase
        .from('operators')
        .select('id, name, short_name, is_active, operator_profiles(*)')
        .eq('id', operatorId)
        .maybeSingle(),
      companiesQuery,
      rulesQuery,
      assignmentsQuery,
      incomesQuery2,
      supabase
        .from('operator_salary_payouts')
        .select('id, operator_id, date, shift, is_paid, paid_at, comment')
        .eq('operator_id', operatorId)
        .gte('date', dateFrom)
        .lte('date', dateTo),
    ])

    if (operatorError) throw operatorError
    if (companiesError) throw companiesError
    if (rulesError) throw rulesError
    if (assignmentsError) throw assignmentsError
    if (incomesError) throw incomesError
    if (payoutsError) throw payoutsError

    if (!operator) {
      return json({ error: 'operator-not-found' }, 404)
    }

    return json({
      ok: true,
      data: {
        operator,
        companies: companies || [],
        rules: rules || [],
        assignments: assignments || [],
        incomes: incomes || [],
        payouts: payouts || [],
      },
    })
  } catch (error: any) {
    console.error('Admin salary GET error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/salary:get',
      message: error?.message || 'Admin salary GET error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'salary')
    if (guard) return guard
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const allowedCompanyIds = await listOrganizationCompanyIds({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const requestClient = createRequestSupabaseClient(req)
    const {
      data: { user },
    } = await requestClient.auth.getUser()

    const body = (await req.json().catch(() => null)) as MutationBody | null
    if (!body?.action) {
      return json({ error: 'Неверный формат запроса' }, 400)
    }

    const supabase = createAdminSupabaseClient()

    if (body.action === 'createAdjustment') {
      if (!body.payload.operator_id || !body.payload.date || !Number.isFinite(body.payload.amount)) {
        return json({ error: 'Недостаточно данных для корректировки' }, 400)
      }
      await ensureOrganizationOperatorAccess({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        operatorId: body.payload.operator_id,
      })
      if (body.payload.company_id) {
        await resolveCompanyScope({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
          requestedCompanyId: body.payload.company_id,
        })
      }

      const { data, error } = await supabase
        .from('operator_salary_adjustments')
        .insert([
          {
            operator_id: body.payload.operator_id,
            date: body.payload.date,
            amount: Math.round(body.payload.amount),
            kind: body.payload.kind,
            comment: body.payload.comment?.trim() || null,
            company_id: body.payload.company_id || null,
          },
        ])
        .select('id,operator_id,date,amount,kind,comment,company_id')
        .single()

      if (error) throw error
      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'operator-salary-adjustment',
        entityId: String(data.id),
        action: 'create',
        payload: data,
      })
      return json({ ok: true, data })
    }

    if (body.action === 'createAdvance') {
      const weekStart = normalizeIsoDate(body.payload.week_start)
      const paymentDate = normalizeIsoDate(body.payload.payment_date)
      const split = normalizeSplit(body.payload.cash_amount, body.payload.kaspi_amount)

      if (!body.payload.operator_id || !body.payload.company_id || !weekStart || !paymentDate) {
        return json({ error: 'operator_id, company_id, week_start и payment_date обязательны' }, 400)
      }
      await ensureOrganizationOperatorAccess({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        operatorId: body.payload.operator_id,
      })
      await resolveCompanyScope({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        requestedCompanyId: body.payload.company_id,
      })
      if (split.totalAmount <= 0) {
        return json({ error: 'Сумма аванса должна быть больше 0' }, 400)
      }

      const weekBeforeAdvance = await ensureSalaryWeekSnapshot({
        supabase,
        operatorId: body.payload.operator_id,
        weekStart,
        actorUserId: user?.id || null,
        companyIds: allowedCompanyIds || null,
      })

      const expenseComment =
        body.payload.comment?.trim() ||
        `Аванс по зарплате за неделю ${weekStart} - ${weekBeforeAdvance.weekEnd}`

      let expense: any = null
      let adjustment: any = null
      try {
        const expenseResult = await supabase
        .from('expenses')
        .insert([
          {
            date: paymentDate,
            company_id: body.payload.company_id,
            operator_id: body.payload.operator_id,
            category: 'Аванс',
            cash_amount: split.cashAmount,
            kaspi_amount: split.kaspiAmount,
            comment: expenseComment,
            source_type: 'salary_advance',
            source_id: `operator:${body.payload.operator_id}:week:${weekStart}`,
            salary_week_id: weekBeforeAdvance.weekId,
          },
        ])
        .select('id,date,company_id,operator_id,category,cash_amount,kaspi_amount,comment')
        .single()

      if (expenseResult.error) throw expenseResult.error
      expense = expenseResult.data

      const adjustmentResult = await supabase
        .from('operator_salary_adjustments')
        .insert([
          {
            operator_id: body.payload.operator_id,
            date: paymentDate,
            amount: split.totalAmount,
            kind: 'advance',
            comment: expenseComment,
            company_id: body.payload.company_id,
            salary_week_id: weekBeforeAdvance.weekId,
            linked_expense_id: String(expense.id),
            source_type: 'salary_advance',
            status: 'active',
          },
        ])
        .select('id,operator_id,date,amount,kind,comment,company_id,salary_week_id,linked_expense_id')
        .single()

      if (adjustmentResult.error) throw adjustmentResult.error
      adjustment = adjustmentResult.data

      const updateExpenseResult = await supabase
        .from('expenses')
        .update({ source_id: String(adjustment.id) })
        .eq('id', expense.id)
      if (updateExpenseResult.error) throw updateExpenseResult.error
      } catch (transactionError) {
        if (adjustment?.id) {
          await supabase.from('operator_salary_adjustments').delete().eq('id', String(adjustment.id))
        }
        if (expense?.id) {
          await safeDeleteExpenses(supabase, [String(expense.id)])
        }
        throw transactionError
      }

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'operator-salary-adjustment',
        entityId: String(adjustment.id),
        action: 'create-advance',
        payload: {
          week_start: weekStart,
          company_id: body.payload.company_id,
          expense_id: expense.id,
          total_amount: split.totalAmount,
          cash_amount: split.cashAmount,
          kaspi_amount: split.kaspiAmount,
        },
      })

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'expense',
        entityId: String(expense.id),
        action: 'create-from-salary-advance',
        payload: {
          operator_id: body.payload.operator_id,
          week_start: weekStart,
          adjustment_id: adjustment.id,
          total_amount: split.totalAmount,
        },
      })

      return json({
        ok: true,
        data: {
          expense,
          adjustment,
        },
      })
    }

    if (body.action === 'createWeeklyPayment') {
      const weekStart = normalizeIsoDate(body.payload.week_start)
      const paymentDate = normalizeIsoDate(body.payload.payment_date)
      const split = normalizeSplit(body.payload.cash_amount, body.payload.kaspi_amount)

      if (!body.payload.operator_id || !weekStart || !paymentDate) {
        return json({ error: 'operator_id, week_start и payment_date обязательны' }, 400)
      }
      await ensureOrganizationOperatorAccess({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        operatorId: body.payload.operator_id,
      })
      if (split.totalAmount <= 0) {
        return json({ error: 'Сумма выплаты должна быть больше 0' }, 400)
      }

      const weekBeforePayment = await ensureSalaryWeekSnapshot({
        supabase,
        operatorId: body.payload.operator_id,
        weekStart,
        actorUserId: user?.id || null,
        companyIds: allowedCompanyIds || null,
      })

      if (split.totalAmount - weekBeforePayment.remainingAmount > 0.009) {
        return json(
          {
            error: `Сумма выплаты (${split.totalAmount}) превышает остаток по неделе (${weekBeforePayment.remainingAmount})`,
          },
          400,
        )
      }

      const positiveAllocations = weekBeforePayment.summary.companyAllocations.filter((item) => item.netAmount > 0)
      if (positiveAllocations.length === 0) {
        return json({ error: 'Нет положительных начислений по компаниям для выплаты' }, 400)
      }

      const { data: operatorRow } = await supabase
        .from('operators')
        .select('name')
        .eq('id', body.payload.operator_id)
        .single()
      const operatorName = operatorRow?.name || null

      const paymentComment =
        body.payload.comment?.trim() ||
        (operatorName
          ? `Зарплата: ${operatorName} за неделю ${weekStart} - ${weekBeforePayment.weekEnd}`
          : `Зарплата за неделю ${weekStart} - ${weekBeforePayment.weekEnd}`)

      const paymentResult = await supabase
        .from('operator_salary_week_payments')
        .insert([
          {
            salary_week_id: weekBeforePayment.weekId,
            operator_id: body.payload.operator_id,
            payment_date: paymentDate,
            cash_amount: split.cashAmount,
            kaspi_amount: split.kaspiAmount,
            total_amount: split.totalAmount,
            comment: paymentComment,
            created_by: user?.id || null,
          },
        ])
        .select('id,salary_week_id,operator_id,payment_date,cash_amount,kaspi_amount,total_amount,comment,status')
        .single()

      if (paymentResult.error) throw paymentResult.error
      const payment = paymentResult.data

      const distribution = buildCompanyDistribution({
        cashAmount: split.cashAmount,
        kaspiAmount: split.kaspiAmount,
        weights: positiveAllocations.map((item) => ({
          key: item.companyId,
          weight: item.netAmount,
        })),
      }).filter((item) => item.totalAmount > 0)

      const expenseRows: Array<{
        id: string
        company_id: string
        cash_amount: number
        kaspi_amount: number
        comment: string | null
      }> = []

      try {
      for (const item of distribution) {
        const allocationMeta = positiveAllocations.find((allocation) => allocation.companyId === item.companyId)
        const comment = allocationMeta?.companyName
          ? `${paymentComment} • ${allocationMeta.companyName}`
          : paymentComment

        const { data: expense, error: expenseError } = await supabase
          .from('expenses')
          .insert([
            {
              date: paymentDate,
              company_id: item.companyId,
              operator_id: body.payload.operator_id,
              category: 'Зарплата',
              cash_amount: item.cashAmount,
              kaspi_amount: item.kaspiAmount,
              comment,
              source_type: 'salary_payment',
              source_id: String(payment.id),
              salary_week_id: weekBeforePayment.weekId,
            },
          ])
          .select('id,company_id,cash_amount,kaspi_amount,comment')
          .single()

        if (expenseError) throw expenseError
        expenseRows.push(expense as typeof expenseRows[number])
      }

      if (expenseRows.length > 0) {
        const { error: linksError } = await supabase
          .from('operator_salary_week_payment_expenses')
          .insert(
            expenseRows.map((expense) => ({
              payment_id: payment.id,
              company_id: expense.company_id,
              expense_id: String(expense.id),
              cash_amount: expense.cash_amount,
              kaspi_amount: expense.kaspi_amount,
              total_amount: roundMoney(Number(expense.cash_amount || 0) + Number(expense.kaspi_amount || 0)),
            })),
          )

        if (linksError) throw linksError
      }
      } catch (transactionError) {
        await supabase.from('operator_salary_week_payment_expenses').delete().eq('payment_id', String(payment.id))
        if (expenseRows.length > 0) {
          await safeDeleteExpenses(
            supabase,
            expenseRows.map((expense) => String(expense.id)),
          )
        }
        await supabase.from('operator_salary_week_payments').delete().eq('id', String(payment.id))
        throw transactionError
      }

      const weekAfterPayment = await ensureSalaryWeekSnapshot({
        supabase,
        operatorId: body.payload.operator_id,
        weekStart,
        actorUserId: user?.id || null,
        companyIds: allowedCompanyIds || null,
      })

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'operator-salary-week-payment',
        entityId: String(payment.id),
        action: 'create',
        payload: {
          week_start: weekStart,
          payment_date: paymentDate,
          cash_amount: split.cashAmount,
          kaspi_amount: split.kaspiAmount,
          total_amount: split.totalAmount,
          company_count: expenseRows.length,
        },
      })

      return json({
        ok: true,
        data: {
          payment,
          expenses: expenseRows,
          week: weekAfterPayment,
        },
      })
    }

    if (body.action === 'voidPayment') {
      const weekStart2 = normalizeIsoDate(body.weekStart)
      if (!body.paymentId || !weekStart2 || !body.operatorId) {
        return json({ error: 'paymentId, weekStart и operatorId обязательны' }, 400)
      }
      await ensureOrganizationOperatorAccess({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        operatorId: body.operatorId,
      })

      const { data: payment, error: paymentFetchError } = await supabase
        .from('operator_salary_week_payments')
        .select('id, salary_week_id, operator_id, status')
        .eq('id', body.paymentId)
        .maybeSingle()

      if (paymentFetchError) throw paymentFetchError
      if (!payment) return json({ error: 'Платёж не найден' }, 404)
      if (String(payment.operator_id) !== body.operatorId) return json({ error: 'Платёж не принадлежит этому оператору' }, 403)
      if (payment.status === 'voided') return json({ error: 'Платёж уже аннулирован' }, 400)

      const { data: expenseLinks, error: linksError } = await supabase
        .from('operator_salary_week_payment_expenses')
        .select('expense_id')
        .eq('payment_id', body.paymentId)

      if (linksError) throw linksError

      const expenseIds = (expenseLinks || []).map((row: any) => String(row.expense_id))

      if (expenseIds.length > 0) {
        const { error: deleteLinksError } = await supabase
          .from('operator_salary_week_payment_expenses')
          .delete()
          .eq('payment_id', body.paymentId)
        if (deleteLinksError) throw deleteLinksError
        await safeDeleteExpenses(supabase, expenseIds)
      }

      const { error: voidPayError } = await supabase
        .from('operator_salary_week_payments')
        .update({
          status: 'voided',
          voided_at: new Date().toISOString(),
          voided_by: user?.id || null,
        })
        .eq('id', body.paymentId)
      if (voidPayError) throw voidPayError

      const weekAfterVoid = await ensureSalaryWeekSnapshot({ supabase, operatorId: body.operatorId, weekStart: weekStart2, actorUserId: user?.id || null, companyIds: allowedCompanyIds || null })

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'operator-salary-week-payment',
        entityId: body.paymentId,
        action: 'void',
        payload: { operator_id: body.operatorId, week_start: weekStart2, expense_count: expenseIds.length },
      })

      return json({ ok: true, data: { week: weekAfterVoid } })
    }

    if (body.action === 'voidAdjustment') {
      const weekStart2 = normalizeIsoDate(body.weekStart)
      if (!body.adjustmentId || !weekStart2 || !body.operatorId) {
        return json({ error: 'adjustmentId, weekStart и operatorId обязательны' }, 400)
      }
      await ensureOrganizationOperatorAccess({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        operatorId: body.operatorId,
      })

      const { data: adjustment, error: adjFetchError } = await supabase
        .from('operator_salary_adjustments')
        .select('id, operator_id, status, kind, linked_expense_id, amount')
        .eq('id', body.adjustmentId)
        .maybeSingle()

      if (adjFetchError) throw adjFetchError
      if (!adjustment) return json({ error: 'Корректировка не найдена' }, 404)
      if (String(adjustment.operator_id) !== body.operatorId) return json({ error: 'Корректировка не принадлежит этому оператору' }, 403)
      if (adjustment.status === 'voided') return json({ error: 'Корректировка уже аннулирована' }, 400)

      if (adjustment.kind === 'advance' && adjustment.linked_expense_id) {
        const { error: deleteExpError } = await supabase.from('expenses').delete().eq('id', String(adjustment.linked_expense_id))
        if (deleteExpError) throw deleteExpError
      }

      const { error: voidAdjError } = await supabase
        .from('operator_salary_adjustments')
        .update({
          status: 'voided',
          voided_at: new Date().toISOString(),
          voided_by: user?.id || null,
        })
        .eq('id', body.adjustmentId)
      if (voidAdjError) throw voidAdjError

      const weekAfterVoid = await ensureSalaryWeekSnapshot({ supabase, operatorId: body.operatorId, weekStart: weekStart2, actorUserId: user?.id || null, companyIds: allowedCompanyIds || null })

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'operator-salary-adjustment',
        entityId: body.adjustmentId,
        action: 'void',
        payload: { operator_id: body.operatorId, kind: adjustment.kind, amount: adjustment.amount },
      })

      return json({ ok: true, data: { week: weekAfterVoid } })
    }

    if (body.action === 'markDebtsPaid') {
      const weekStart2 = normalizeIsoDate(body.weekStart)
      if (!body.operatorId || !weekStart2) {
        return json({ error: 'operatorId и weekStart обязательны' }, 400)
      }
      await ensureOrganizationOperatorAccess({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        operatorId: body.operatorId,
      })

      const { data: activeDebts, error: fetchError } = await supabase
        .from('debts')
        .select('id, amount')
        .eq('operator_id', body.operatorId)
        .eq('week_start', weekStart2)
        .eq('status', 'active')

      if (fetchError) throw fetchError
      if (!activeDebts || activeDebts.length === 0) {
        return json({ ok: true, data: { marked: 0 } })
      }

      const ids = activeDebts.map((d: any) => d.id)
      const paidAt = new Date().toISOString()
      const [{ error: updateError }] = await Promise.all([
        supabase.from('debts').update({ status: 'paid' }).in('id', ids),
        // Убираем из сканера — инвентарь НЕ возвращаем (оператор оплатил деньгами)
        supabase
          .from('point_debt_items')
          .update({ status: 'deleted', deleted_at: paidAt })
          .eq('operator_id', body.operatorId)
          .eq('week_start', weekStart2)
          .eq('status', 'active'),
      ])

      if (updateError) throw updateError

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'debt',
        entityId: ids[0],
        action: 'mark-paid-bulk',
        payload: {
          operator_id: body.operatorId,
          week_start: weekStart2,
          count: ids.length,
          total: activeDebts.reduce((s: number, d: any) => s + Number(d.amount || 0), 0),
        },
      })

      return json({ ok: true, data: { marked: ids.length } })
    }

    if (!body.operatorId) {
      return json({ error: 'operatorId обязателен' }, 400)
    }
    await ensureOrganizationOperatorAccess({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
      operatorId: body.operatorId,
    })

    const chatIdRaw = body.telegram_chat_id?.trim() || null
    if (chatIdRaw !== null && !/^-?\d+$/.test(chatIdRaw)) {
      return json({ error: 'Неверный формат telegram_chat_id' }, 400)
    }

    const { data, error } = await supabase
      .from('operators')
      .update({ telegram_chat_id: chatIdRaw })
      .eq('id', body.operatorId)
      .select('id,name,short_name,is_active,telegram_chat_id')
      .single()

    if (error) throw error
    await writeAuditLog(supabase, {
      actorUserId: user?.id || null,
      entityType: 'operator',
      entityId: String(data.id),
      action: 'update-telegram-chat-id',
      payload: {
        name: data.name,
        short_name: data.short_name,
        telegram_chat_id: data.telegram_chat_id,
      },
    })
    return json({ ok: true, data })
  } catch (error: any) {
    console.error('Admin salary mutation error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/salary',
      message: error?.message || 'Admin salary mutation error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
