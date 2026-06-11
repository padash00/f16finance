import { NextResponse } from 'next/server'
import { requireCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { writeAuditLog } from '@/lib/server/audit'
import {
  resolveCompanyScope,
  listOrganizationStaffIds,
  listOrganizationOperatorIds,
} from '@/lib/server/organizations'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function normalizePersonName(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function monthRangeFromDate(payDate: string) {
  const [yearRaw, monthRaw] = String(payDate || '').split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null
  const mm = String(month).padStart(2, '0')
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return {
    monthKey: `${year}-${mm}`,
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${String(endDay).padStart(2, '0')}`,
  }
}

function addDaysISO(isoDate: string, days: number) {
  const [yearRaw, monthRaw, dayRaw] = String(isoDate || '').split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return ''
  const value = new Date(Date.UTC(year, month - 1, day + days))
  const yyyy = value.getUTCFullYear()
  const mm = String(value.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(value.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function salaryPaymentSlotLabel(slot: string) {
  if (slot === 'first') return 'выплата 1-го числа'
  if (slot === 'second') return 'выплата 15-го числа'
  return 'разовая выплата'
}

function salaryPaymentClosingPeriodLabel(payDate: string, previousPayDate: string | null) {
  const to = String(payDate || '')
  if (!previousPayDate) return `до ${to}`
  const nextDayAfterPrevious = addDaysISO(previousPayDate, 1)
  const from = nextDayAfterPrevious && nextDayAfterPrevious <= to ? nextDayAfterPrevious : to
  return `${from} - ${to}`
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'salary.view')
    if (denied) return denied as any
    // Capability checks выше уже отсеивают; здесь — любой staff
    const canView = access.isSuperAdmin || !!access.staffRole
    if (!canView) return json({ error: 'forbidden' }, 403)

    const url = new URL(req.url)
    const includeArchived = url.searchParams.get('include_archived') === '1'

    const supabase = createAdminSupabaseClient()

    // Multi-tenant scoping. While LEGACY_SINGLE_TENANT_MODE is true,
    // scope.allowedCompanyIds is null and every guard below is a no-op.
    const scope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    // staff_adjustments / staff_salary_payments scope by staff_id (no company_id),
    // debts / point_debt_items scope by operator_id. Resolve the allowed id lists
    // only when scoping is actually active.
    const allowedStaffIds = scope.allowedCompanyIds
      ? await listOrganizationStaffIds({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
        })
      : null
    const allowedOperatorIds = scope.allowedCompanyIds
      ? await listOrganizationOperatorIds({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
          includeInactive: true,
        })
      : null

    const staffQuery = supabase
      .from('staff')
      .select('id, full_name, short_name, role, monthly_salary, extra_day_company_code, extra_day_shift_type, telegram_chat_id, is_active, dismissed_at, dismissal_date')
      .order('full_name')
    if (allowedStaffIds) staffQuery.in('id', allowedStaffIds)

    const adjQuery = supabase
      .from('staff_adjustments')
      .select('id, staff_id, kind, amount, date, comment, status, created_at, closed_by_payment_id, source_payment_id, closed_at')
      .order('created_at', { ascending: false })
    if (allowedStaffIds) adjQuery.in('staff_id', allowedStaffIds)

    const paymentsQuery = supabase
      .from('staff_salary_payments')
      .select('id, staff_id, pay_date, slot, amount, comment, created_at')
      .order('pay_date', { ascending: false })
      .limit(200)
    if (allowedStaffIds) paymentsQuery.in('staff_id', allowedStaffIds)

    const adminOpsQuery = supabase
      .from('operators')
      .select('id, name, short_name, role, telegram_chat_id, is_active, is_admin_staff')
      .eq('is_active', true)
      .eq('is_admin_staff', true)
      .order('name')
    if (allowedOperatorIds) adminOpsQuery.in('id', allowedOperatorIds)

    const adminOpDebtsQuery = supabase
      .from('debts')
      .select('id, operator_id, amount, client_name, week_start, comment')
      .eq('status', 'active')
    if (allowedOperatorIds) adminOpDebtsQuery.in('operator_id', allowedOperatorIds)

    const adminOpDebtItemsQuery = supabase
      .from('point_debt_items')
      .select('id, operator_id, total_amount, client_name, week_start, created_at, comment')
      .eq('status', 'active')
    if (allowedOperatorIds) adminOpDebtItemsQuery.in('operator_id', allowedOperatorIds)

    const expensesQuery = supabase
      .from('expenses')
      .select('id, source_type, source_id')
      .in('source_type', ['salary_payment', 'salary_advance'])
    if (scope.allowedCompanyIds) expensesQuery.in('company_id', scope.allowedCompanyIds)

    const [staffRes, adjRes, paymentsRes, rulesRes, adminOpsRes, adminOpDebtsRes, adminOpDebtItemsRes, expensesRes] = await Promise.all([
      staffQuery,
      adjQuery,
      paymentsQuery,
      supabase
        .from('operator_salary_rules')
        .select('company_code, shift_type, base_per_shift')
        .eq('is_active', true),
      adminOpsQuery,
      adminOpDebtsQuery,
      adminOpDebtItemsQuery,
      expensesQuery,
    ])

    if (staffRes.error) throw staffRes.error
    if (adjRes.error) throw adjRes.error
    if (paymentsRes.error) throw paymentsRes.error
    if (rulesRes.error) throw rulesRes.error
    if (adminOpsRes.error) throw adminOpsRes.error
    if (adminOpDebtsRes.error) throw adminOpDebtsRes.error
    if (adminOpDebtItemsRes.error) throw adminOpDebtItemsRes.error
    if (expensesRes.error) throw expensesRes.error

    // Все staff (вкл. архивных) — для матчинга operator↔staff, чтобы уволенный
    // сотрудник не «воскресал» как виртуальный из operators.is_admin_staff.
    const allStaffRows = (staffRes.data ?? []) as any[]
    const baseStaff = allStaffRows
      .filter((row) => (includeArchived ? true : row.is_active !== false))
      .map((row) => ({ ...row, source_type: 'staff' }))
    const staffIdSet = new Set(allStaffRows.map((row) => String(row.id)))
    const staffByTelegram = new Map<string, string>()
    const staffByName = new Map<string, string>()
    for (const row of allStaffRows) {
      const staffId = String(row.id)
      const telegram = String(row.telegram_chat_id || '').trim()
      if (telegram) staffByTelegram.set(telegram, staffId)
      const fullNameKey = normalizePersonName(row.full_name || '')
      const shortNameKey = normalizePersonName(row.short_name || '')
      if (fullNameKey) staffByName.set(fullNameKey, staffId)
      if (shortNameKey) staffByName.set(shortNameKey, staffId)
    }

    const adminOps = (adminOpsRes.data ?? []) as any[]
    const canonicalStaffIdByOperatorId = new Map<string, string>()
    const canonicalByAdminOpName = new Map<string, string>()
    for (const op of adminOps) {
      const opId = String(op.id)
      const opTelegram = String(op.telegram_chat_id || '').trim()
      const opNameKey = normalizePersonName(op.name || op.short_name || '')
      const matchedStaffId =
        (opTelegram && staffByTelegram.get(opTelegram)) ||
        (opNameKey && staffByName.get(opNameKey)) ||
        null
      const canonicalId = matchedStaffId || opId
      canonicalStaffIdByOperatorId.set(opId, canonicalId)
      if (opNameKey) canonicalByAdminOpName.set(opNameKey, canonicalId)
    }

    const virtualStaffFromOperators = adminOps
      .filter((op) => {
        const opId = String(op.id)
        if (staffIdSet.has(opId)) return false
        return canonicalStaffIdByOperatorId.get(opId) === opId
      })
      .map((op) => ({
        id: String(op.id),
        full_name: String(op.name || 'Админ-сотрудник'),
        short_name: op.short_name || null,
        role: op.role || 'other',
        monthly_salary: 0,
        extra_day_company_code: null,
        extra_day_shift_type: null,
        telegram_chat_id: op.telegram_chat_id || null,
        is_active: true,
        source_type: 'operator',
      }))

    // Map staffId → { payDate, createdAt } of the most recent payment.
    const lastPaymentByStaff = new Map<string, { payDate: string; createdAt: string }>()
    for (const payment of (paymentsRes.data ?? []) as any[]) {
      const staffId = String(payment?.staff_id || '')
      const payDate = String(payment?.pay_date || '')
      const createdAt = String(payment?.created_at || '')
      if (!staffId || !payDate) continue
      const existing = lastPaymentByStaff.get(staffId)
      if (!existing || payDate > existing.payDate) {
        lastPaymentByStaff.set(staffId, { payDate, createdAt })
      }
    }

    const adminOperatorIdSet = new Set(adminOps.map((op) => String(op.id)))
    type DebtAccum = { amount: number; latestCreatedAt: string; comments: string[] }
    const debtByStaff = new Map<string, DebtAccum>()

    function resolveDebtStaffId(operatorId: string | null, clientName: string | null): string | null {
      if (operatorId && adminOperatorIdSet.has(operatorId)) {
        return canonicalStaffIdByOperatorId.get(operatorId) || operatorId
      }
      if (!operatorId) {
        const key = normalizePersonName(clientName || '')
        return key ? staffByName.get(key) || canonicalByAdminOpName.get(key) || null : null
      }
      return null
    }

    function accumDebt(staffId: string, amount: number, comment: string | null, createdAt: string | null) {
      if (amount <= 0) return
      const now = createdAt || new Date().toISOString()
      const existing = debtByStaff.get(staffId)
      if (existing) {
        existing.amount += amount
        if (now > existing.latestCreatedAt) existing.latestCreatedAt = now
        if (comment) existing.comments.push(String(comment))
      } else {
        debtByStaff.set(staffId, { amount, latestCreatedAt: now, comments: comment ? [String(comment)] : [] })
      }
    }

    // Step 1: full weeks from debts table — only weeks that started AFTER pay_date.
    // These weeks are entirely post-payment so we use the full aggregate amount.
    for (const row of (adminOpDebtsRes.data ?? []) as any[]) {
      const operatorId = row.operator_id ? String(row.operator_id) : null
      const staffId = resolveDebtStaffId(operatorId, row.client_name)
      if (!staffId) continue

      const lastPay = lastPaymentByStaff.get(staffId)
      if (lastPay) {
        const weekStart = String(row.week_start || '')
        if (!weekStart || weekStart <= lastPay.payDate) continue  // skip weeks on/before pay_date
      }

      accumDebt(staffId, Math.round(Number(row.amount || 0)), row.comment, null)
    }

    // Step 2: partial week from point_debt_items — items created AFTER pay_date
    // in the week that contains the payment date (week_start <= pay_date).
    // This gives sub-week precision for the payment week itself.
    for (const row of (adminOpDebtItemsRes.data ?? []) as any[]) {
      const operatorId = row.operator_id ? String(row.operator_id) : null
      const staffId = resolveDebtStaffId(operatorId, row.client_name)
      if (!staffId) continue

      const lastPay = lastPaymentByStaff.get(staffId)
      if (!lastPay) continue  // no payment → already covered by step 1 (no filter there)

      const weekStart = String(row.week_start || '')
      if (weekStart > lastPay.payDate) continue  // full week → already counted in step 1

      const itemCreatedAt = row.created_at ? String(row.created_at) : null
      if (!itemCreatedAt) continue
      const itemDate = itemCreatedAt.slice(0, 10)
      if (itemDate < lastPay.payDate) continue
      if (itemDate === lastPay.payDate && itemCreatedAt <= lastPay.createdAt) continue

      accumDebt(staffId, Math.round(Number(row.total_amount || 0)), row.comment, itemCreatedAt)
    }

    const todayISO = new Date().toISOString().slice(0, 10)
    const syntheticDebtAdjustments = Array.from(debtByStaff.entries()).map(([staffId, accum]) => ({
      id: `operator-debt:${staffId}`,
      staff_id: staffId,
      kind: 'debt',
      amount: accum.amount,
      // Use today as date so filterStaffAdjustmentsForSlot always includes this
      // in the current active period, regardless of when individual items were created.
      date: todayISO,
      created_at: new Date().toISOString(),
      comment: accum.comments.slice(0, 5).join(' · ') || 'Долги из операторской программы',
      status: 'active',
    }))

    const paymentRows = (paymentsRes.data ?? []) as any[]
    const adjustmentRows = (adjRes.data ?? []) as any[]
    const expenseRows = (expensesRes.data ?? []) as any[]

    const expectedPaymentSourceIds = new Set<string>()
    for (const payment of paymentRows) {
      const staffId = String(payment?.staff_id || '')
      const payDate = String(payment?.pay_date || '')
      const slot = String(payment?.slot || '')
      const monthRange = monthRangeFromDate(payDate)
      if (!staffId || !monthRange || !slot) continue
      expectedPaymentSourceIds.add(`staff:${staffId}:month:${monthRange.monthKey}:slot:${slot}`)
    }
    const actualPaymentSourceIds = new Set<string>(
      expenseRows
        .filter((row) => String(row?.source_type || '') === 'salary_payment')
        .map((row) => String(row?.source_id || ''))
        .filter((value) => value.startsWith('staff:')),
    )
    const missingPaymentExpenseCount = [...expectedPaymentSourceIds].filter((id) => !actualPaymentSourceIds.has(id)).length
    const orphanPaymentExpenseCount = [...actualPaymentSourceIds].filter((id) => !expectedPaymentSourceIds.has(id)).length

    const expectedAdvanceSourceIds = new Set<string>(
      adjustmentRows
        .filter((row) =>
          String(row?.kind || '') === 'advance' &&
          String(row?.status || 'active') === 'active' &&
          !row?.source_payment_id
        )
        .map((row) => `staff-adjustment:${String(row?.id || '')}`)
        .filter((value) => value !== 'staff-adjustment:'),
    )
    const actualAdvanceSourceIds = new Set<string>(
      expenseRows
        .filter((row) => String(row?.source_type || '') === 'salary_advance')
        .map((row) => String(row?.source_id || ''))
        .filter((value) => value.startsWith('staff-adjustment:')),
    )
    const missingAdvanceExpenseCount = [...expectedAdvanceSourceIds].filter((id) => !actualAdvanceSourceIds.has(id)).length
    const orphanAdvanceExpenseCount = [...actualAdvanceSourceIds].filter((id) => !expectedAdvanceSourceIds.has(id)).length

    const { data: debtPaymentsData } = await supabase
      .from('staff_debt_payments')
      .select('id, staff_id, amount, comment, paid_at, status')
      .eq('status', 'active')
      .order('paid_at', { ascending: false })

    return json({
      // Capability checks выше уже отсеивают; здесь — любой staff
      can_edit: access.isSuperAdmin || !!access.staffRole,
      staff: [...baseStaff, ...virtualStaffFromOperators],
      adjustments: [...(adjRes.data ?? []), ...syntheticDebtAdjustments],
      debtPayments: debtPaymentsData ?? [],
      payments: paymentsRes.data ?? [],
      salaryRules: rulesRes.data ?? [],
      consistency: {
        has_issues:
          missingPaymentExpenseCount > 0 ||
          orphanPaymentExpenseCount > 0 ||
          missingAdvanceExpenseCount > 0 ||
          orphanAdvanceExpenseCount > 0,
        missing_payment_expense_count: missingPaymentExpenseCount,
        orphan_payment_expense_count: orphanPaymentExpenseCount,
        missing_advance_expense_count: missingAdvanceExpenseCount,
        orphan_advance_expense_count: orphanAdvanceExpenseCount,
      },
    })
  } catch (e: any) {
    return json({ error: e?.message || 'Error' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'salary.create_payment')
    if (denied) return denied as any
    // Capability checks выше уже отсеивают; здесь — любой staff
    if (!access.isSuperAdmin && !access.staffRole) return json({ error: 'forbidden' }, 403)

    const supabase = createAdminSupabaseClient()
    const body = await req.json().catch(() => null)
    const action = body?.action

    // Multi-tenant scoping for mutations. While LEGACY_SINGLE_TENANT_MODE is true,
    // scope.allowedCompanyIds is null, allowedStaffIds stays null, and the guard
    // below is a no-op (never rejects). It only takes effect after the flag flips.
    const scope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const allowedStaffIds = scope.allowedCompanyIds
      ? await listOrganizationStaffIds({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
        })
      : null
    // Returns true only when scoping is active AND the staff_id is out of scope.
    const staffOutOfScope = (staffId: string | null | undefined) =>
      !!allowedStaffIds && !allowedStaffIds.includes(String(staffId || ''))

    // ── Add adjustment (debt / fine / bonus / advance) ──────────────────────
    if (action === 'addAdjustment') {
      const { staff_id, kind, amount, date, comment, company_id } = body
      if (!staff_id || !kind || !amount) return json({ error: 'staff_id, kind, amount обязательны' }, 400)
      if (staffOutOfScope(staff_id)) return json({ error: 'forbidden' }, 403)
      if (!['debt', 'fine', 'bonus', 'advance'].includes(kind)) return json({ error: 'Неверный kind' }, 400)
      if (amount <= 0) return json({ error: 'Сумма должна быть > 0' }, 400)

      if (kind === 'advance' && !company_id) {
        return json({ error: 'Для аванса нужно выбрать компанию' }, 400)
      }

      const { data, error } = await supabase
        .from('staff_adjustments')
        .insert({ staff_id, kind, amount: Math.round(amount), date: date || new Date().toISOString().slice(0, 10), comment: comment?.trim() || null, status: 'active' })
        .select()
        .single()

      if (error) throw error

      if (kind === 'advance') {
        const { data: staffMember } = await supabase
          .from('staff')
          .select('full_name')
          .eq('id', staff_id)
          .maybeSingle()
        const advanceComment = comment?.trim() || `Аванс: ${staffMember?.full_name || 'сотрудник'}`
        const { error: expenseError } = await supabase
          .from('expenses')
          .insert({
            date: date || new Date().toISOString().slice(0, 10),
            company_id,
            category: 'Аванс',
            cash_amount: Math.round(amount),
            kaspi_amount: 0,
            comment: advanceComment,
            source_type: 'salary_advance',
            source_id: `staff-adjustment:${String(data.id)}`,
          })
        if (expenseError) throw expenseError
      }

      await writeAuditLog(supabase, { entityType: 'staff-adjustment', entityId: data.id, action: 'create', payload: { staff_id, kind, amount, date } })
      return json({ ok: true, data })
    }

    // ── Remove adjustment ───────────────────────────────────────────────────
    if (action === 'removeAdjustment') {
      const { id } = body
      if (!id) return json({ error: 'id обязателен' }, 400)
      const { data: adjRow, error: adjFetchError } = await supabase
        .from('staff_adjustments')
        .select('id, kind, staff_id')
        .eq('id', id)
        .maybeSingle()
      if (adjFetchError) throw adjFetchError
      if (!adjRow?.id) return json({ error: 'Корректировка не найдена' }, 404)
      if (staffOutOfScope((adjRow as any).staff_id)) return json({ error: 'forbidden' }, 403)

      // Advance adjustments create an expense row; remove it on void for consistency.
      if (String(adjRow.kind || '') === 'advance') {
        const sourceId = `staff-adjustment:${String(adjRow.id)}`
        const { error: expensesDeleteError } = await supabase
          .from('expenses')
          .delete()
          .eq('source_type', 'salary_advance')
          .eq('source_id', sourceId)
        if (expensesDeleteError) throw expensesDeleteError
      }

      const { error: adjVoidError } = await supabase.from('staff_adjustments').update({ status: 'voided' }).eq('id', id)
      if (adjVoidError) throw adjVoidError
      await writeAuditLog(supabase, { entityType: 'staff-adjustment', entityId: String(id), action: 'void' })
      return json({ ok: true })
    }

    // ── Pay debt: закрыть долги сотрудника ──────────────────────────────────
    // Долг сотрудника складывается из:
    //  1) операторских клиентских долгов (debts + point_debt_items) по операторам,
    //     привязанным к этому staff через operator_staff_links (или сам id оператора);
    //  2) админских корректировок staff_adjustments (kind=debt).
    // Помечаем всё оплаченным (как операторский markDebtsPaid: деньги вернули,
    // инвентарь со сканера убираем).
    if (action === 'payStaffDebt') {
      const { staff_id } = body
      if (!staff_id) return json({ error: 'staff_id обязателен' }, 400)
      if (staffOutOfScope(staff_id)) return json({ error: 'forbidden' }, 403)

      const paidAt = new Date().toISOString()
      const comment = typeof body.comment === 'string' && body.comment.trim() ? body.comment.trim() : null

      // Операторы этого сотрудника (+ сам id — вдруг это оператор)
      const operatorIds = new Set<string>([String(staff_id)])
      const { data: links } = await supabase
        .from('operator_staff_links')
        .select('operator_id')
        .eq('staff_id', staff_id)
      for (const l of (links || []) as any[]) if (l.operator_id) operatorIds.add(String(l.operator_id))
      const opIds = Array.from(operatorIds)

      // Собираем затронутые строки (запоминаем id для возможной отмены)
      const { data: opDebts } = await supabase
        .from('debts').select('id, amount').in('operator_id', opIds).eq('status', 'active')
      const debtIds = (opDebts || []).map((d: any) => String(d.id))
      const { data: items } = await supabase
        .from('point_debt_items').select('id').in('operator_id', opIds).eq('status', 'active')
      const itemIds = (items || []).map((i: any) => String(i.id))
      const { data: adjDebts } = await supabase
        .from('staff_adjustments').select('id, amount').eq('staff_id', staff_id).eq('kind', 'debt').or('status.is.null,status.eq.active')
      const adjIds = (adjDebts || []).map((d: any) => String(d.id))

      if (debtIds.length === 0 && adjIds.length === 0) return json({ error: 'Нет активного долга' }, 400)

      const total =
        (opDebts || []).reduce((s: number, d: any) => s + Number(d.amount || 0), 0) +
        (adjDebts || []).reduce((s: number, d: any) => s + Number(d.amount || 0), 0)

      if (debtIds.length) await supabase.from('debts').update({ status: 'paid', paid_at: paidAt }).in('id', debtIds)
      if (itemIds.length) await supabase.from('point_debt_items').update({ status: 'deleted', deleted_at: paidAt }).in('id', itemIds)
      if (adjIds.length) await supabase.from('staff_adjustments').update({ status: 'paid' }).in('id', adjIds)

      const { data: rec, error: recErr } = await supabase
        .from('staff_debt_payments')
        .insert({
          staff_id,
          amount: Math.round(total),
          comment,
          debt_ids: debtIds,
          item_ids: itemIds,
          adjustment_ids: adjIds,
          status: 'active',
          organization_id: access.activeOrganization?.id || null,
          paid_at: paidAt,
          paid_by: access.user?.id || null,
        })
        .select('id')
        .single()
      if (recErr) throw recErr

      await writeAuditLog(supabase, { entityType: 'staff-debt-payment', entityId: String(rec.id), action: 'create', payload: { staff_id, total, count: debtIds.length + adjIds.length } })
      return json({ ok: true, data: { id: rec.id, count: debtIds.length + adjIds.length, total } })
    }

    // ── Void debt payment (аннулировать оплату долга → вернуть долги активными) ─
    if (action === 'voidStaffDebtPayment') {
      const { id } = body
      if (!id) return json({ error: 'id обязателен' }, 400)
      const { data: rec, error: recErr } = await supabase
        .from('staff_debt_payments').select('*').eq('id', id).maybeSingle()
      if (recErr) throw recErr
      if (!rec?.id) return json({ error: 'Платёж не найден' }, 404)
      if (staffOutOfScope((rec as any).staff_id)) return json({ error: 'forbidden' }, 403)
      if (rec.status === 'voided') return json({ ok: true })

      const debtIds = ((rec.debt_ids || []) as string[])
      const itemIds = ((rec.item_ids || []) as string[])
      const adjIds = ((rec.adjustment_ids || []) as string[])
      if (debtIds.length) await supabase.from('debts').update({ status: 'active', paid_at: null }).in('id', debtIds)
      if (itemIds.length) await supabase.from('point_debt_items').update({ status: 'active', deleted_at: null }).in('id', itemIds)
      if (adjIds.length) await supabase.from('staff_adjustments').update({ status: 'active' }).in('id', adjIds)
      await supabase.from('staff_debt_payments').update({ status: 'voided', voided_at: new Date().toISOString() }).eq('id', id)

      await writeAuditLog(supabase, { entityType: 'staff-debt-payment', entityId: String(id), action: 'void', payload: { staff_id: (rec as any).staff_id } })
      return json({ ok: true })
    }

    // ── Add extra day (manager shift bonus) ─────────────────────────────────
    if (action === 'addExtraDay') {
      const { staff_id, date, custom_amount } = body
      if (!staff_id) return json({ error: 'staff_id обязателен' }, 400)
      if (staffOutOfScope(staff_id)) return json({ error: 'forbidden' }, 403)

      // Get staff extra day settings
      const { data: staffMember } = await supabase
        .from('staff')
        .select('extra_day_company_code, extra_day_shift_type, full_name')
        .eq('id', staff_id)
        .single()

      let amount = custom_amount || 8000
      if (staffMember?.extra_day_company_code) {
        const { data: rule } = await supabase
          .from('operator_salary_rules')
          .select('base_per_shift')
          .eq('company_code', staffMember.extra_day_company_code)
          .eq('shift_type', staffMember.extra_day_shift_type || 'day')
          .eq('is_active', true)
          .maybeSingle()
        if (rule?.base_per_shift) amount = rule.base_per_shift
      }

      const { data, error } = await supabase
        .from('staff_adjustments')
        .insert({ staff_id, kind: 'bonus', amount: Math.round(amount), date: date || new Date().toISOString().slice(0, 10), comment: 'Доп. выход', status: 'active' })
        .select()
        .single()

      if (error) throw error
      await writeAuditLog(supabase, { entityType: 'staff-adjustment', entityId: data.id, action: 'extra-day', payload: { staff_id, amount, date } })
      return json({ ok: true, data })
    }

    // ── Create payment (1st or 15th) ────────────────────────────────────────
    if (action === 'createPayment') {
      const { staff_id, pay_date, slot, cash_amount, kaspi_amount, expected_amount, comment, company_id } = body
      if (!staff_id || !pay_date) return json({ error: 'staff_id и pay_date обязательны' }, 400)
      if (staffOutOfScope(staff_id)) return json({ error: 'forbidden' }, 403)
      if (!company_id) return json({ error: 'company_id обязателен' }, 400)
      const total = Math.round((cash_amount || 0) + (kaspi_amount || 0))
      if (total <= 0) return json({ error: 'Сумма выплаты должна быть > 0' }, 400)
      if (slot !== 'first' && slot !== 'second') {
        return json({ error: 'Слот выплаты должен быть first или second' }, 400)
      }
      const normalizedSlot = slot
      const monthRange = monthRangeFromDate(pay_date)
      if (!monthRange) return json({ error: 'Некорректная дата выплаты' }, 400)

      const { data: monthPayments, error: monthPaymentsError } = await supabase
        .from('staff_salary_payments')
        .select('id, slot, pay_date')
        .eq('staff_id', staff_id)
        .gte('pay_date', monthRange.from)
        .lte('pay_date', monthRange.to)
      if (monthPaymentsError) throw monthPaymentsError

      const monthPaidSlots = new Set(
        (monthPayments || [])
          .map((row: any) => String(row.slot || ''))
          .filter((value) => value === 'first' || value === 'second'),
      )
      if (monthPaidSlots.has('first') && monthPaidSlots.has('second')) {
        return json(
          { error: `Месяц ${monthRange.monthKey} уже закрыт по выплатам. Следующая выплата доступна в следующем месяце.` },
          409,
        )
      }

      // Prevent duplicate payout for the same employee/slot/month.
      const { data: duplicatePayment, error: duplicatePaymentError } = await supabase
        .from('staff_salary_payments')
        .select('id, pay_date')
        .eq('staff_id', staff_id)
        .eq('slot', normalizedSlot)
        .gte('pay_date', monthRange.from)
        .lte('pay_date', monthRange.to)
        .limit(1)
        .maybeSingle()
      if (duplicatePaymentError) throw duplicatePaymentError
      if (duplicatePayment?.id) {
        return json(
          { error: `Выплата за слот "${normalizedSlot}" в ${monthRange.monthKey} уже проведена (${duplicatePayment.pay_date})` },
          409,
        )
      }

      // Get staff name for expense comment
      const { data: staffMember } = await supabase
        .from('staff')
        .select('full_name, monthly_salary')
        .eq('id', staff_id)
        .single()
      const { data: previousPayments, error: previousPaymentsError } = await supabase
        .from('staff_salary_payments')
        .select('pay_date, created_at')
        .eq('staff_id', staff_id)
        .lte('pay_date', pay_date)
        .order('pay_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
      if (previousPaymentsError) throw previousPaymentsError
      const previousPayDate = previousPayments?.[0]?.pay_date ? String(previousPayments[0].pay_date) : null
      const previousPayCreatedAt = previousPayments?.[0]?.created_at ? String(previousPayments[0].created_at) : null
      const slotLabel = salaryPaymentSlotLabel(normalizedSlot)
      const closingPeriodLabel = salaryPaymentClosingPeriodLabel(pay_date, previousPayDate)

      // 1. Create expense record (required for consistency with salary expenses flow)
      const expenseComment = `Зарплата: ${staffMember?.full_name || 'сотрудник'} (${slotLabel}, период ${closingPeriodLabel})`
      const expenseResult = await supabase
        .from('expenses')
        .insert({
          date: pay_date,
          company_id,
          category: 'Зарплата',
          cash_amount: Math.round(cash_amount || 0),
          kaspi_amount: Math.round(kaspi_amount || 0),
          comment: expenseComment,
          source_type: 'salary_payment',
          source_id: `staff:${staff_id}:month:${monthRange.monthKey}:slot:${normalizedSlot}`,
        })
        .select('id')
        .single()
      if (expenseResult.error) throw expenseResult.error
      const expenseId = String(expenseResult.data?.id || '')

      // 2. Create salary payment record
      const { data: payment, error: payErr } = await supabase
        .from('staff_salary_payments')
        .insert({
          staff_id,
          pay_date,
          slot: normalizedSlot,
          amount: total,
          comment: comment?.trim() || null,
        })
        .select()
        .single()

      if (payErr) throw payErr

      // 3. Mark active adjustments since previous payout up to current payout date as paid.
      const { data: candidateAdjustments, error: adjFetchError } = await supabase
        .from('staff_adjustments')
        .select('id, kind, amount, date, created_at')
        .eq('staff_id', staff_id)
        .eq('status', 'active')
        .lte('date', pay_date)
      if (adjFetchError) throw adjFetchError

      const adjustmentsToClose = (candidateAdjustments || [])
        .filter((row: any) => {
          if (!previousPayDate) return true
          const rowDate = String(row?.date || '')
          if (rowDate < previousPayDate) return false
          if (rowDate > previousPayDate) return true
          const rowCreatedAt = row?.created_at ? String(row.created_at) : null
          if (rowCreatedAt && previousPayCreatedAt) return rowCreatedAt > previousPayCreatedAt
          if (rowCreatedAt && !previousPayCreatedAt) return true
          if (!rowCreatedAt && previousPayCreatedAt) return false
          return false
        })
      const idsToClose = adjustmentsToClose
        .map((row: any) => String(row.id))

      if (idsToClose.length > 0) {
        const closedAt = new Date().toISOString()
        const { error: adjPayError } = await supabase
          .from('staff_adjustments')
          .update({
            status: 'paid',
            closed_by_payment_id: payment.id,
            closed_at: closedAt,
          })
          .in('id', idsToClose)
        if (adjPayError) throw adjPayError
      }

      const halfSalary = Math.round(Number(staffMember?.monthly_salary || 0) / 2)
      const adjustmentTotals = adjustmentsToClose.reduce(
        (acc, row: any) => {
          const kind = String(row?.kind || '')
          const amount = Math.round(Number(row?.amount || 0))
          if (kind === 'bonus') acc.bonuses += amount
          if (kind === 'debt') acc.debts += amount
          if (kind === 'fine') acc.fines += amount
          if (kind === 'advance') acc.advances += amount
          return acc
        },
        { bonuses: 0, debts: 0, fines: 0, advances: 0 },
      )
      const serverCalculatedToPay =
        halfSalary +
        adjustmentTotals.bonuses -
        adjustmentTotals.debts -
        adjustmentTotals.fines -
        adjustmentTotals.advances
      const clientExpectedAmount = Math.round(Number(expected_amount))
      const calculatedToPay = Number.isFinite(clientExpectedAmount) ? clientExpectedAmount : serverCalculatedToPay
      const overpaymentAmount = Math.max(0, total - calculatedToPay)
      let overpaymentAdjustmentId: string | null = null

      if (overpaymentAmount > 0) {
        const { data: overpaymentAdjustment, error: overpaymentError } = await supabase
          .from('staff_adjustments')
          .insert({
            staff_id,
            kind: 'advance',
            amount: overpaymentAmount,
            date: pay_date,
            comment: `Переплата по выплате ${pay_date}: выдано ${total.toLocaleString('ru-RU')} ₸, по расчету ${calculatedToPay.toLocaleString('ru-RU')} ₸`,
            status: 'active',
            source_payment_id: payment.id,
          })
          .select('id')
          .single()
        if (overpaymentError) throw overpaymentError
        overpaymentAdjustmentId = String(overpaymentAdjustment.id)

        await writeAuditLog(supabase, {
          entityType: 'staff-adjustment',
          entityId: overpaymentAdjustmentId,
          action: 'create',
          payload: {
            staff_id,
            kind: 'advance',
            amount: overpaymentAmount,
            date: pay_date,
            source: 'salary_overpayment',
            payment_id: payment.id,
          },
        })
      }

      await writeAuditLog(supabase, {
        entityType: 'staff-payment',
        entityId: String(payment.id),
        action: 'create',
        payload: {
          staff_id,
          total,
          calculated_to_pay: calculatedToPay,
          server_calculated_to_pay: serverCalculatedToPay,
          overpayment_amount: overpaymentAmount,
          overpayment_adjustment_id: overpaymentAdjustmentId,
          pay_date,
          slot,
          slot_label: slotLabel,
          closing_period: closingPeriodLabel,
          previous_pay_date: previousPayDate,
          closed_adjustment_ids: idsToClose,
          expense_id: expenseId,
        },
      })
      return json({ ok: true, payment, expense_id: expenseId, overpayment_adjustment_id: overpaymentAdjustmentId })
    }

    // ── Delete payment ──────────────────────────────────────────────────────
    if (action === 'deletePayment') {
      const { id } = body
      if (!id) return json({ error: 'id обязателен' }, 400)
      const { data: paymentRow, error: paymentFetchError } = await supabase
        .from('staff_salary_payments')
        .select('id, staff_id, pay_date, slot, amount')
        .eq('id', id)
        .maybeSingle()
      if (paymentFetchError) throw paymentFetchError
      if (!paymentRow?.id) return json({ error: 'Выплата не найдена' }, 404)
      if (staffOutOfScope((paymentRow as any).staff_id)) return json({ error: 'forbidden' }, 403)

      const monthRange = monthRangeFromDate(String(paymentRow.pay_date || ''))
      if (!monthRange) return json({ error: 'Некорректная дата выплаты' }, 400)

      const sourceId = `staff:${String(paymentRow.staff_id)}:month:${monthRange.monthKey}:slot:${String(paymentRow.slot || '')}`

      const { data: exactExpenseRows, error: exactExpenseFetchError } = await supabase
        .from('expenses')
        .select('id')
        .eq('source_type', 'salary_payment')
        .eq('source_id', sourceId)
      if (exactExpenseFetchError) throw exactExpenseFetchError

      let expenseIdsToDelete = (exactExpenseRows || []).map((row: any) => String(row.id)).filter(Boolean)

      // Fallback for legacy rows where source_id may differ:
      // use same staff/month prefix + payment date and pick by matching total amount.
      if (expenseIdsToDelete.length === 0) {
        const sourcePrefix = `staff:${String(paymentRow.staff_id)}:month:${monthRange.monthKey}:slot:`
        const expectedTotal = Math.round(Number(paymentRow.amount || 0))
        const { data: fallbackRows, error: fallbackFetchError } = await supabase
          .from('expenses')
          .select('id, cash_amount, kaspi_amount, source_id')
          .eq('source_type', 'salary_payment')
          .eq('date', String(paymentRow.pay_date || ''))
          .like('source_id', `${sourcePrefix}%`)
        if (fallbackFetchError) throw fallbackFetchError

        expenseIdsToDelete = (fallbackRows || [])
          .filter((row: any) => Math.round(Number(row.cash_amount || 0) + Number(row.kaspi_amount || 0)) === expectedTotal)
          .map((row: any) => String(row.id))
          .filter(Boolean)
      }

      if (expenseIdsToDelete.length > 0) {
        const { error: expensesDeleteError } = await supabase
          .from('expenses')
          .delete()
          .in('id', expenseIdsToDelete)
        if (expensesDeleteError) throw expensesDeleteError
      }

      const { data: restoredAdjustments, error: restoreAdjustmentsError } = await supabase
        .from('staff_adjustments')
        .update({
          status: 'active',
          closed_by_payment_id: null,
          closed_at: null,
        })
        .eq('closed_by_payment_id', id)
        .select('id')
      if (restoreAdjustmentsError) throw restoreAdjustmentsError

      const { data: voidedOverpayments, error: voidOverpaymentsError } = await supabase
        .from('staff_adjustments')
        .update({
          status: 'voided',
          closed_by_payment_id: null,
          closed_at: null,
        })
        .eq('source_payment_id', id)
        .select('id')
      if (voidOverpaymentsError) throw voidOverpaymentsError

      const { error: paymentDeleteError } = await supabase.from('staff_salary_payments').delete().eq('id', id)
      if (paymentDeleteError) throw paymentDeleteError

      await writeAuditLog(supabase, {
        entityType: 'staff-payment',
        entityId: String(id),
        action: 'delete',
        payload: {
          source_id: sourceId,
          deleted_expense_ids: expenseIdsToDelete,
          restored_adjustment_ids: (restoredAdjustments || []).map((row: any) => String(row.id)),
          voided_overpayment_ids: (voidedOverpayments || []).map((row: any) => String(row.id)),
        },
      })
      return json({
        ok: true,
        deleted_payment_id: id,
        deleted_expense_source_id: sourceId,
        deleted_expense_count: expenseIdsToDelete.length,
        restored_adjustment_count: restoredAdjustments?.length || 0,
        voided_overpayment_count: voidedOverpayments?.length || 0,
      })
    }

    // ── Update staff salary / extra day config ──────────────────────────────
    if (action === 'updateStaffSalary') {
      const { staff_id, monthly_salary, extra_day_company_code, extra_day_shift_type } = body
      if (!staff_id) return json({ error: 'staff_id обязателен' }, 400)
      if (staffOutOfScope(staff_id)) return json({ error: 'forbidden' }, 403)
      const updates: Record<string, unknown> = {}
      if (monthly_salary !== undefined) updates.monthly_salary = Math.round(monthly_salary)
      if (extra_day_company_code !== undefined) updates.extra_day_company_code = extra_day_company_code || null
      if (extra_day_shift_type !== undefined) updates.extra_day_shift_type = extra_day_shift_type || 'day'
      const { error } = await supabase.from('staff').update(updates).eq('id', staff_id)
      if (error) throw error
      return json({ ok: true })
    }

    return json({ error: 'unsupported action' }, 400)
  } catch (e: any) {
    return json({ error: e?.message || 'Error' }, 500)
  }
}
