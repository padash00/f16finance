/**
 * AI tool: добавить расход.
 * Capability: expenses.create
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const addExpenseTool: CopilotTool = {
  name: 'add_expense',
  category: 'finance',
  description: 'Добавить расход',
  requiredCapability: 'expenses.create',
  severity: 'medium',
  params: [
    {
      name: 'amount',
      label: 'Сумма (₸)',
      type: 'number',
      required: true,
      description: 'Сумма расхода в тенге',
      extractHint: '8500',
    },
    {
      name: 'company_id',
      label: 'На какой точке',
      type: 'select',
      required: true,
      description: 'ID компании/точки',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('companies').select('id, name, code').order('name')
        return (data || []).map((c: any) => ({
          value: c.id,
          label: c.name + (c.code ? ` (${c.code})` : ''),
        }))
      },
    },
    {
      name: 'category',
      label: 'Категория',
      type: 'select',
      required: true,
      description: 'Категория расхода',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('expense_categories').select('id, name').order('name').limit(20)
        return (data || []).map((c: any) => ({ value: c.name, label: c.name }))
      },
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
      description: 'Опциональный комментарий к расходу',
      extractHint: 'за курьера',
    },
  ],
  handler: async (input, ctx) => {
    const amount = Number(input.amount || 0)
    const companyId = String(input.company_id || '')
    const category = String(input.category || '')
    const method = String(input.payment_method || 'cash')
    const comment = String(input.comment || '').trim()

    if (amount <= 0 || !companyId || !category) {
      return { ok: false, message: 'Не хватает данных (сумма, точка, категория).' }
    }

    const today = todayISO()
    const cashAmount = method === 'cash' ? amount : 0
    const kaspiAmount = method === 'kaspi' ? amount : 0

    const { data, error } = await ctx.supabase
      .from('expenses')
      .insert([
        {
          date: today,
          company_id: companyId,
          category,
          cash_amount: cashAmount,
          kaspi_amount: kaspiAmount,
          comment: comment || null,
          status: 'approved',
        },
      ])
      .select('id')
      .single()
    if (error) return { ok: false, message: `Не удалось создать: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'expense',
        entityId: data?.id || 'unknown',
        action: 'create',
        payload: { amount, company_id: companyId, category, method, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return {
      ok: true,
      message: `Расход ${amount.toLocaleString('ru-RU')} ₸ (${category}) создан.`,
      data: { expenseId: data?.id },
    }
  },
}
