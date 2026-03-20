import { NextResponse } from 'next/server'

import { addDaysISO } from '@/lib/core/date'
import { calculateOperatorWeekSummary } from '@/lib/domain/salary'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { listOperatorSalaryData, listSalaryReferenceData } from '@/lib/server/repositories/salary'
import { createRequestSupabaseClient, requireStaffCapabilityRequest } from '@/lib/server/request-auth'
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
      action: 'toggleShiftPayout'
      payload: {
        operator_id: string
        date: string
        shift: 'day' | 'night'
        is_paid: boolean
        paid_at?: string | null
        comment?: string | null
      }
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
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null
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

async function ensureSalaryWeekSnapshot(params: {
  supabase: ReturnType<typeof createAdminSupabaseClient>
  operatorId: string
  weekStart: string
  actorUserId: string | null
  references?: Awaited<ReturnType<typeof listSalaryReferenceData>>
}) {
  const weekEnd = addDaysISO(params.weekStart, 6)
  const references = params.references || (await listSalaryReferenceData(params.supabase))
  const operatorData = await listOperatorSalaryData(params.supabase, {
    operatorId: params.operatorId,
    dateFrom: params.weekStart,
    dateTo: weekEnd,
    weekStart: params.weekStart,
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

  const { error: deleteAllocationsError } = await params.supabase
    .from('operator_salary_week_company_allocations')
    .delete()
    .eq('salary_week_id', weekId)

  if (deleteAllocationsError) throw deleteAllocationsError

  if (summary.companyAllocations.length > 0) {
    const { error: insertAllocationsError } = await params.supabase
      .from('operator_salary_week_company_allocations')
      .insert(
        summary.companyAllocations.map((allocation) => ({
          salary_week_id: weekId,
          operator_id: params.operatorId,
          company_id: allocation.companyId,
          accrued_amount: allocation.accruedAmount,
          share_ratio: allocation.shareRatio,
          allocated_net_amount: allocation.netAmount,
        })),
      )

    if (insertAllocationsError) throw insertAllocationsError
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

    const url = new URL(req.url)
    const view = url.searchParams.get('view')
    if (view === 'weekly') {
      const weekStart = normalizeIsoDate(url.searchParams.get('weekStart'))
      if (!weekStart) {
        return json({ error: 'weekStart is required' }, 400)
      }

      const weekEnd = addDaysISO(weekStart, 6)
      const supabase = createAdminSupabaseClient()
      const referencesPromise = listSalaryReferenceData(supabase)

      const [
        references,
        { data: operators, error: operatorsError },
        { data: documents, error: documentsError },
      ] = await Promise.all([
        referencesPromise,
        supabase
          .from('operators')
          .select('id,name,short_name,is_active,telegram_chat_id,operator_profiles(*)')
          .order('name'),
        supabase.from('operator_documents').select('operator_id,expiry_date'),
      ])

      if (operatorsError) throw operatorsError
      if (documentsError) throw documentsError

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

      const operatorRows = ((operators || []) as any[]).map((row) => {
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

    if (view !== 'operatorDetail') {
      return json({ error: 'unsupported-view' }, 400)
    }

    const operatorId = (url.searchParams.get('operatorId') || '').trim()
    const dateFrom = normalizeIsoDate(url.searchParams.get('dateFrom'))
    const dateTo = normalizeIsoDate(url.searchParams.get('dateTo'))

    if (!operatorId || !dateFrom || !dateTo) {
      return json({ error: 'operatorId, dateFrom and dateTo are required' }, 400)
    }

    const supabase = createAdminSupabaseClient()
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
      supabase.from('companies').select('id, name, code').order('name'),
      supabase
        .from('operator_salary_rules')
        .select(
          'company_code, shift_type, base_per_shift, senior_operator_bonus, senior_cashier_bonus, threshold1_turnover, threshold1_bonus, threshold2_turnover, threshold2_bonus',
        )
        .eq('is_active', true),
      supabase
        .from('operator_company_assignments')
        .select('operator_id, company_id, role_in_company, is_active')
        .eq('operator_id', operatorId)
        .eq('is_active', true),
      supabase
        .from('incomes')
        .select('id, date, company_id, operator_id, shift, zone, cash_amount, kaspi_amount, card_amount, comment')
        .eq('operator_id', operatorId)
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .order('date', { ascending: false }),
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
      if (split.totalAmount <= 0) {
        return json({ error: 'Сумма аванса должна быть больше 0' }, 400)
      }

      const weekBeforeAdvance = await ensureSalaryWeekSnapshot({
        supabase,
        operatorId: body.payload.operator_id,
        weekStart,
        actorUserId: user?.id || null,
      })

      const expenseComment =
        body.payload.comment?.trim() ||
        `Аванс по зарплате за неделю ${weekStart} - ${weekBeforeAdvance.weekEnd}`

      const { data: expense, error: expenseError } = await supabase
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

      if (expenseError) throw expenseError

      const { data: adjustment, error: adjustmentError } = await supabase
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

      if (adjustmentError) throw adjustmentError

      await supabase
        .from('expenses')
        .update({ source_id: String(adjustment.id) })
        .eq('id', expense.id)

      const weekAfterAdvance = await ensureSalaryWeekSnapshot({
        supabase,
        operatorId: body.payload.operator_id,
        weekStart,
        actorUserId: user?.id || null,
      })

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
          week: weekAfterAdvance,
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
      if (split.totalAmount <= 0) {
        return json({ error: 'Сумма выплаты должна быть больше 0' }, 400)
      }

      const weekBeforePayment = await ensureSalaryWeekSnapshot({
        supabase,
        operatorId: body.payload.operator_id,
        weekStart,
        actorUserId: user?.id || null,
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

      const paymentComment =
        body.payload.comment?.trim() ||
        `Зарплата за неделю ${weekStart} - ${weekBeforePayment.weekEnd}`

      const { data: payment, error: paymentError } = await supabase
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

      if (paymentError) throw paymentError

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

      const weekAfterPayment = await ensureSalaryWeekSnapshot({
        supabase,
        operatorId: body.payload.operator_id,
        weekStart,
        actorUserId: user?.id || null,
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

    if (body.action === 'toggleShiftPayout') {
      const { operator_id, date, shift, is_paid, paid_at, comment } = body.payload
      if (!operator_id || !normalizeIsoDate(date) || !['day', 'night'].includes(shift)) {
        return json({ error: 'invalid-shift-payout-payload' }, 400)
      }

      const { data, error } = await supabase
        .from('operator_salary_payouts')
        .upsert(
          {
            operator_id,
            date,
            shift,
            is_paid,
            paid_at: is_paid ? paid_at || new Date().toISOString() : null,
            comment: comment?.trim() || null,
          },
          { onConflict: 'operator_id,date,shift' },
        )
        .select('id, operator_id, date, shift, is_paid, paid_at, comment')
        .single()

      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'operator-salary-payout',
        entityId: String(data.id),
        action: is_paid ? 'mark-paid' : 'mark-unpaid',
        payload: {
          operator_id: data.operator_id,
          date: data.date,
          shift: data.shift,
          is_paid: data.is_paid,
          paid_at: data.paid_at,
        },
      })

      return json({ ok: true, data })
    }

    if (!body.operatorId) {
      return json({ error: 'operatorId обязателен' }, 400)
    }

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
