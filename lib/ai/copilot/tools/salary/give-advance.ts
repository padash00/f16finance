/**
 * Pilot AI tool: выдать аванс оператору.
 *
 * Capability: salary.create_advance
 *
 * Параметры:
 *  - operator_id (select) — из активных операторов
 *  - amount (number) — сумма
 *  - company_id (select) — из доступных точек
 *  - cash_or_kaspi (select) — наличные или Kaspi (по умолчанию наличные)
 *  - comment (string, optional)
 *
 * После выполнения создаёт expense с категорией "Аванс" и
 * adjustment типа "advance" — это полностью повторяет UI-флоу.
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

function todayISO(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function weekStartISO(date: string): string {
  // ISO-неделя: понедельник
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1)
  const day = dt.getDay() === 0 ? 7 : dt.getDay()
  dt.setDate(dt.getDate() - (day - 1))
  const yy = dt.getFullYear()
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const dd = String(dt.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

export const giveAdvanceTool: CopilotTool = {
  name: 'give_advance',
  category: 'salary',
  description: 'Выдать аванс оператору',
  requiredCapability: 'salary.create_advance',
  severity: 'high',
  params: [
    {
      name: 'operator_id',
      label: 'Кому выдаём',
      type: 'select',
      required: true,
      description: 'ID оператора. Если пользователь сказал имя — найди в списке операторов и подставь ID.',
      extractHint: 'Айгерим, Алима',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase
          .from('operators')
          .select('id, name, short_name')
          .eq('is_active', true)
          .order('name')
        return (data || []).map((op: any) => ({
          value: op.id,
          label: op.short_name || op.name,
        }))
      },
    },
    {
      name: 'company_id',
      label: 'На какой точке',
      type: 'select',
      required: true,
      description: 'ID компании/точки',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase
          .from('companies')
          .select('id, name, code')
          .order('name')
        return (data || []).map((c: any) => ({
          value: c.id,
          label: c.name + (c.code ? ` (${c.code})` : ''),
        }))
      },
    },
    {
      name: 'amount',
      label: 'Сумма аванса (₸)',
      type: 'number',
      required: true,
      description: 'Сумма аванса в тенге, целое число',
      extractHint: '50000',
    },
    {
      name: 'payment_method',
      label: 'Способ оплаты',
      type: 'select',
      required: true,
      description: 'Наличные или Kaspi',
      getOptions: async () => [
        { value: 'cash', label: '💵 Наличные' },
        { value: 'kaspi', label: '💳 Kaspi' },
      ],
    },
    {
      name: 'comment',
      label: 'Комментарий',
      type: 'string',
      required: false,
      description: 'Опциональный комментарий к авансу',
    },
  ],
  handler: async (input, ctx) => {
    const operatorId = String(input.operator_id || '')
    const companyId = String(input.company_id || '')
    const amount = Number(input.amount || 0)
    const method = String(input.payment_method || 'cash')
    const comment = String(input.comment || '').trim()

    if (!operatorId || !companyId || amount <= 0) {
      return { ok: false, message: 'Не хватает данных (оператор, точка, сумма).' }
    }

    const today = todayISO()
    const weekStart = weekStartISO(today)

    const cashAmount = method === 'cash' ? amount : 0
    const kaspiAmount = method === 'kaspi' ? amount : 0

    // Получим имена для красивого audit
    const [{ data: opRow }, { data: compRow }] = await Promise.all([
      ctx.supabase.from('operators').select('id, name, short_name').eq('id', operatorId).single(),
      ctx.supabase.from('companies').select('id, name').eq('id', companyId).single(),
    ])
    const operatorName = opRow?.short_name || opRow?.name || operatorId
    const companyName = compRow?.name || companyId

    // 1. Создаём expense (категория "Аванс")
    const { data: expense, error: expErr } = await ctx.supabase
      .from('expenses')
      .insert([
        {
          date: today,
          company_id: companyId,
          operator_id: operatorId,
          category: 'Аванс',
          cash_amount: cashAmount,
          kaspi_amount: kaspiAmount,
          comment: comment || `Аванс через AI Copilot за неделю ${weekStart}`,
          status: 'approved',
        },
      ])
      .select('id')
      .single()
    if (expErr) {
      return { ok: false, message: `Не удалось создать расход: ${expErr.message}` }
    }

    // 2. Получаем/создаём salary_week_id чтобы аванс был виден в недельной разбивке /salary.
    // Используем минимальный INSERT — без расчёта итогов (это сделает страница /salary
    // при первом открытии через ensureSalaryWeekSnapshot).
    let salaryWeekId: string | null = null
    {
      const { data: existing } = await ctx.supabase
        .from('operator_salary_weeks')
        .select('id')
        .eq('operator_id', operatorId)
        .eq('week_start', weekStart)
        .maybeSingle()
      if (existing?.id) {
        salaryWeekId = String(existing.id)
      } else {
        const weekEndDate = new Date(weekStart + 'T00:00:00')
        weekEndDate.setDate(weekEndDate.getDate() + 6)
        const weekEndISOStr = `${weekEndDate.getFullYear()}-${String(weekEndDate.getMonth() + 1).padStart(2, '0')}-${String(weekEndDate.getDate()).padStart(2, '0')}`
        const { data: newWeek } = await ctx.supabase
          .from('operator_salary_weeks')
          .insert([{ operator_id: operatorId, week_start: weekStart, week_end: weekEndISOStr, status: 'draft' }])
          .select('id')
          .single()
        salaryWeekId = newWeek?.id ? String(newWeek.id) : null
      }
    }

    // 3. Создаём adjustment типа advance с привязкой к неделе.
    const { error: adjErr } = await ctx.supabase
      .from('operator_salary_adjustments')
      .insert([
        {
          operator_id: operatorId,
          date: today,
          amount: amount,
          kind: 'advance',
          comment: comment || `Аванс через AI Copilot за неделю ${weekStart}`,
          company_id: companyId,
          salary_week_id: salaryWeekId,
          linked_expense_id: expense?.id ? String(expense.id) : null,
          source_type: 'salary_advance',
          status: 'active',
        },
      ])
    if (adjErr) {
      if (expense?.id) {
        await ctx.supabase.from('expenses').delete().eq('id', expense.id)
      }
      return { ok: false, message: `Не удалось создать корректировку: ${adjErr.message}` }
    }

    // Audit log
    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'salary-advance',
        entityId: expense?.id || 'unknown',
        action: 'create',
        payload: {
          operator_id: operatorId,
          operator_name: operatorName,
          company_id: companyId,
          company_name: companyName,
          amount,
          payment_method: method,
          source: ctx.source,
          via: 'copilot',
        },
      })
    } catch {}

    return {
      ok: true,
      message: `Аванс ${amount.toLocaleString('ru-RU')} ₸ выдан ${operatorName} на точке ${companyName}.`,
      data: { expenseId: expense?.id, operatorName, amount },
      followUps: [
        { label: '👁 Открыть зарплату', action: `open:/salary` },
      ],
    }
  },
}
