import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { writeAuditLog } from '@/lib/server/audit'

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

// Only super_admin and owner can access staff salary
async function checkAccess(req: Request) {
  const access = await getRequestAccessContext(req)
  if ('response' in access) return { error: access.response }
  if (!access.isSuperAdmin) {
    // Check if user is owner via staff table
    const supabase = createAdminSupabaseClient()
    const { data: { user } } = await createAdminSupabaseClient().auth.admin.listUsers()
      .then(() => ({ data: { user: null } })).catch(() => ({ data: { user: null } }))
    // Simplified: allow isSuperAdmin only for now
    return { error: json({ error: 'forbidden' }, 403) }
  }
  return { access }
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const canView = access.isSuperAdmin || access.staffRole === 'owner' || access.staffRole === 'manager'
    if (!canView) return json({ error: 'forbidden' }, 403)

    const supabase = createAdminSupabaseClient()

    const [staffRes, adjRes, paymentsRes, rulesRes, adminOpsRes, adminOpDebtsRes] = await Promise.all([
      supabase
        .from('staff')
        .select('id, full_name, short_name, role, monthly_salary, extra_day_company_code, extra_day_shift_type, telegram_chat_id, is_active')
        .eq('is_active', true)
        .order('full_name'),
      supabase
        .from('staff_adjustments')
        .select('id, staff_id, kind, amount, date, comment, status, created_at')
        .order('created_at', { ascending: false }),
      supabase
        .from('staff_salary_payments')
        .select('id, staff_id, pay_date, slot, amount, comment, created_at')
        .order('pay_date', { ascending: false })
        .limit(200),
      supabase
        .from('operator_salary_rules')
        .select('company_code, shift_type, base_per_shift')
        .eq('is_active', true),
      supabase
        .from('operators')
        .select('id, name, short_name, role, telegram_chat_id, is_active, is_admin_staff')
        .eq('is_active', true)
        .eq('is_admin_staff', true)
        .order('name'),
      supabase
        .from('debts')
        .select('id, operator_id, amount, status, week_start, comment, client_name, created_at')
        .eq('status', 'active'),
    ])

    if (staffRes.error) throw staffRes.error
    if (adjRes.error) throw adjRes.error
    if (paymentsRes.error) throw paymentsRes.error
    if (rulesRes.error) throw rulesRes.error
    if (adminOpsRes.error) throw adminOpsRes.error
    if (adminOpDebtsRes.error) throw adminOpDebtsRes.error

    const baseStaff = (staffRes.data ?? []).map((row: any) => ({
      ...row,
      source_type: 'staff',
    }))
    const staffIdSet = new Set(baseStaff.map((row: any) => String(row.id)))
    const staffByTelegram = new Map<string, string>()
    const staffByName = new Map<string, string>()
    for (const row of baseStaff) {
      const staffId = String((row as any).id)
      const telegram = String((row as any).telegram_chat_id || '').trim()
      if (telegram) staffByTelegram.set(telegram, staffId)
      const fullNameKey = normalizePersonName((row as any).full_name || '')
      const shortNameKey = normalizePersonName((row as any).short_name || '')
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

    const adminOperatorIdSet = new Set(adminOps.map((op) => String(op.id)))
    const syntheticDebtAdjustments = ((adminOpDebtsRes.data ?? []) as any[])
      .map((row) => {
        const operatorId = row.operator_id ? String(row.operator_id) : null
        if (operatorId && adminOperatorIdSet.has(operatorId)) {
          return {
            id: `operator-debt:${String(row.id)}`,
            staff_id: canonicalStaffIdByOperatorId.get(operatorId) || operatorId,
            kind: 'debt',
            amount: Number(row.amount || 0),
            date: String(row.week_start || new Date().toISOString().slice(0, 10)),
            created_at: row.created_at ? String(row.created_at) : null,
            comment: row.comment || row.client_name || 'Долг из операторской программы',
            status: String(row.status || 'active'),
          }
        }

        // Debts created for staff/owners from point app come as operator_id = null + client_name.
        const clientNameKey = normalizePersonName(row.client_name || '')
        const matchedStaffId = clientNameKey
          ? staffByName.get(clientNameKey) || canonicalByAdminOpName.get(clientNameKey) || null
          : null
        if (matchedStaffId) {
          return {
            id: `operator-debt:${String(row.id)}`,
            staff_id: matchedStaffId,
            kind: 'debt',
            amount: Number(row.amount || 0),
            date: String(row.week_start || new Date().toISOString().slice(0, 10)),
            created_at: row.created_at ? String(row.created_at) : null,
            comment: row.comment || row.client_name || 'Долг из операторской программы',
            status: String(row.status || 'active'),
          }
        }
        return null
      })
      .filter(Boolean)

    return json({
      can_edit: access.isSuperAdmin,
      staff: [...baseStaff, ...virtualStaffFromOperators],
      adjustments: [...(adjRes.data ?? []), ...syntheticDebtAdjustments],
      payments: paymentsRes.data ?? [],
      salaryRules: rulesRes.data ?? [],
    })
  } catch (e: any) {
    return json({ error: e?.message || 'Error' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)

    const supabase = createAdminSupabaseClient()
    const body = await req.json().catch(() => null)
    const action = body?.action

    // ── Add adjustment (debt / fine / bonus / advance) ──────────────────────
    if (action === 'addAdjustment') {
      const { staff_id, kind, amount, date, comment, company_id } = body
      if (!staff_id || !kind || !amount) return json({ error: 'staff_id, kind, amount обязательны' }, 400)
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
      const { error } = await supabase.from('staff_adjustments').update({ status: 'voided' }).eq('id', id)
      if (error) throw error
      return json({ ok: true })
    }

    // ── Add extra day (manager shift bonus) ─────────────────────────────────
    if (action === 'addExtraDay') {
      const { staff_id, date, custom_amount } = body
      if (!staff_id) return json({ error: 'staff_id обязателен' }, 400)

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
      const { staff_id, pay_date, slot, cash_amount, kaspi_amount, comment, company_id } = body
      if (!staff_id || !pay_date) return json({ error: 'staff_id и pay_date обязательны' }, 400)
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
      const { data: staffMember } = await supabase.from('staff').select('full_name').eq('id', staff_id).single()
      const slotLabel = normalizedSlot === 'first' ? '1–15' : normalizedSlot === 'second' ? '16–конец месяца' : ''
      const payDate = new Date(pay_date)
      const monthLabel = payDate.toLocaleString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' })

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

      // 1. Create expense record (required for consistency with salary expenses flow)
      const expenseComment = `Зарплата: ${staffMember?.full_name || 'сотрудник'}${slotLabel ? ` (${slotLabel} ${monthLabel})` : ''}`
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
        .select('id, date, created_at')
        .eq('staff_id', staff_id)
        .eq('status', 'active')
        .lte('date', pay_date)
      if (adjFetchError) throw adjFetchError

      const idsToClose = (candidateAdjustments || [])
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
        .map((row: any) => String(row.id))

      if (idsToClose.length > 0) {
        const { error: adjPayError } = await supabase
          .from('staff_adjustments')
          .update({ status: 'paid' })
          .in('id', idsToClose)
        if (adjPayError) throw adjPayError
      }

      await writeAuditLog(supabase, { entityType: 'staff-payment', entityId: String(payment.id), action: 'create', payload: { staff_id, total, pay_date, slot, expense_id: expenseId } })
      return json({ ok: true, payment, expense_id: expenseId })
    }

    // ── Delete payment ──────────────────────────────────────────────────────
    if (action === 'deletePayment') {
      const { id } = body
      if (!id) return json({ error: 'id обязателен' }, 400)
      const { data: paymentRow, error: paymentFetchError } = await supabase
        .from('staff_salary_payments')
        .select('id, staff_id, pay_date, slot')
        .eq('id', id)
        .maybeSingle()
      if (paymentFetchError) throw paymentFetchError
      if (!paymentRow?.id) return json({ error: 'Выплата не найдена' }, 404)

      const monthRange = monthRangeFromDate(String(paymentRow.pay_date || ''))
      if (!monthRange) return json({ error: 'Некорректная дата выплаты' }, 400)

      const sourceId = `staff:${String(paymentRow.staff_id)}:month:${monthRange.monthKey}:slot:${String(paymentRow.slot || '')}`

      const { error: expensesDeleteError } = await supabase
        .from('expenses')
        .delete()
        .eq('source_type', 'salary_payment')
        .eq('source_id', sourceId)
      if (expensesDeleteError) throw expensesDeleteError

      const { error: paymentDeleteError } = await supabase.from('staff_salary_payments').delete().eq('id', id)
      if (paymentDeleteError) throw paymentDeleteError

      await writeAuditLog(supabase, {
        entityType: 'staff-payment',
        entityId: String(id),
        action: 'delete',
        payload: { source_id: sourceId },
      })
      return json({ ok: true, deleted_payment_id: id, deleted_expense_source_id: sourceId })
    }

    // ── Update staff salary / extra day config ──────────────────────────────
    if (action === 'updateStaffSalary') {
      const { staff_id, monthly_salary, extra_day_company_code, extra_day_shift_type } = body
      if (!staff_id) return json({ error: 'staff_id обязателен' }, 400)
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
