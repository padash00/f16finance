import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { writeAuditLog } from '@/lib/server/audit'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function getSalarySlotRange(payDate: string, slot: 'first' | 'second' | string) {
  const [yearRaw, monthRaw] = String(payDate || '').split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null
  }
  const mm = String(month).padStart(2, '0')
  if (slot === 'first') {
    return { from: `${year}-${mm}-01`, to: `${year}-${mm}-15` }
  }
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return { from: `${year}-${mm}-16`, to: `${year}-${mm}-${String(endDay).padStart(2, '0')}` }
}

function normalizePersonName(value: string | null | undefined) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
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
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)

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
        .select('id, operator_id, amount, status, week_start, comment, client_name')
        .eq('status', 'active')
        .not('operator_id', 'is', null),
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
      const nameKey = normalizePersonName((row as any).full_name || (row as any).short_name || '')
      if (nameKey) staffByName.set(nameKey, staffId)
    }

    const adminOps = (adminOpsRes.data ?? []) as any[]
    const canonicalStaffIdByOperatorId = new Map<string, string>()
    for (const op of adminOps) {
      const opId = String(op.id)
      const opTelegram = String(op.telegram_chat_id || '').trim()
      const opNameKey = normalizePersonName(op.name || op.short_name || '')
      const matchedStaffId =
        (opTelegram && staffByTelegram.get(opTelegram)) ||
        (opNameKey && staffByName.get(opNameKey)) ||
        null
      canonicalStaffIdByOperatorId.set(opId, matchedStaffId || opId)
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
      .filter((row) => row.operator_id && adminOperatorIdSet.has(String(row.operator_id)))
      .map((row) => ({
        id: `operator-debt:${String(row.id)}`,
        staff_id: canonicalStaffIdByOperatorId.get(String(row.operator_id)) || String(row.operator_id),
        kind: 'debt',
        amount: Number(row.amount || 0),
        date: String(row.week_start || new Date().toISOString().slice(0, 10)),
        comment: row.comment || row.client_name || 'Долг из операторской программы',
        status: String(row.status || 'active'),
      }))

    return json({
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
      const { staff_id, kind, amount, date, comment } = body
      if (!staff_id || !kind || !amount) return json({ error: 'staff_id, kind, amount обязательны' }, 400)
      if (!['debt', 'fine', 'bonus', 'advance'].includes(kind)) return json({ error: 'Неверный kind' }, 400)
      if (amount <= 0) return json({ error: 'Сумма должна быть > 0' }, 400)

      const { data, error } = await supabase
        .from('staff_adjustments')
        .insert({ staff_id, kind, amount: Math.round(amount), date: date || new Date().toISOString().slice(0, 10), comment: comment?.trim() || null, status: 'active' })
        .select()
        .single()

      if (error) throw error
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
      const { staff_id, pay_date, slot, cash_amount, kaspi_amount, comment } = body
      if (!staff_id || !pay_date) return json({ error: 'staff_id и pay_date обязательны' }, 400)
      const total = Math.round((cash_amount || 0) + (kaspi_amount || 0))
      if (total <= 0) return json({ error: 'Сумма выплаты должна быть > 0' }, 400)
      const normalizedSlot = (slot || 'other') as 'first' | 'second' | string
      const slotRange = getSalarySlotRange(pay_date, normalizedSlot)
      if (!slotRange) return json({ error: 'Некорректная дата выплаты' }, 400)

      // Get staff name for expense comment
      const { data: staffMember } = await supabase.from('staff').select('full_name').eq('id', staff_id).single()
      const slotLabel = slot === 'first' ? '1–15' : slot === 'second' ? '16–конец месяца' : ''
      const payDate = new Date(pay_date)
      const monthLabel = payDate.toLocaleString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' })

      // 1. Try to create expense record (optional — expenses table may require company_id)
      const expenseComment = `Зарплата: ${staffMember?.full_name || 'сотрудник'}${slotLabel ? ` (${slotLabel} ${monthLabel})` : ''}`
      let expenseId: string | null = null
      try {
        const { data: expense } = await supabase
          .from('expenses')
          .insert({
            date: pay_date,
            category: 'Зарплата персонала',
            cash_amount: Math.round(cash_amount || 0) || null,
            kaspi_amount: Math.round(kaspi_amount || 0) || null,
            comment: expenseComment,
          })
          .select('id')
          .single()
        expenseId = expense?.id ?? null
      } catch {}

      // 2. Create salary payment record
      const { data: payment, error: payErr } = await supabase
        .from('staff_salary_payments')
        .insert({
          staff_id,
          pay_date,
          slot: slot || 'other',
          amount: total,
          comment: comment?.trim() || null,
        })
        .select()
        .single()

      if (payErr) throw payErr

      // 3. Mark active adjustments as paid for selected slot.
      // For second slot we include carry-over unpaid adjustments (<= slot end),
      // so if payout was skipped on 15th and paid later, debts still accumulate.
      let adjustmentsQuery = supabase
        .from('staff_adjustments')
        .update({ status: 'paid' })
        .eq('staff_id', staff_id)
        .eq('status', 'active')
        .lte('date', slotRange.to)

      if (normalizedSlot === 'first') {
        adjustmentsQuery = adjustmentsQuery.gte('date', slotRange.from)
      } else if (normalizedSlot === 'second') {
        adjustmentsQuery = adjustmentsQuery.gte('date', `${slotRange.to.slice(0, 7)}-01`)
      }

      await adjustmentsQuery

      await writeAuditLog(supabase, { entityType: 'staff-payment', entityId: String(payment.id), action: 'create', payload: { staff_id, total, pay_date, slot, expense_id: expenseId } })
      return json({ ok: true, payment, expense_id: expenseId })
    }

    // ── Delete payment ──────────────────────────────────────────────────────
    if (action === 'deletePayment') {
      const { id } = body
      if (!id) return json({ error: 'id обязателен' }, 400)
      const { error } = await supabase.from('staff_salary_payments').delete().eq('id', id)
      if (error) throw error
      return json({ ok: true })
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
