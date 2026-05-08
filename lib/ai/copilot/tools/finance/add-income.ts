/**
 * AI tool: добавить доход (запись выручки за смену).
 * Capability: income.create
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const addIncomeTool: CopilotTool = {
  name: 'add_income',
  category: 'finance',
  description: 'Добавить запись о выручке',
  requiredCapability: 'income.create',
  severity: 'medium',
  params: [
    {
      name: 'company_id',
      label: 'На какой точке',
      type: 'select',
      required: true,
      description: 'ID компании',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('companies').select('id, name, code').order('name')
        return (data || []).map((c: any) => ({ value: c.id, label: c.name + (c.code ? ` (${c.code})` : '') }))
      },
    },
    {
      name: 'shift',
      label: 'Какая смена',
      type: 'select',
      required: true,
      description: 'Тип смены: день или ночь',
      getOptions: async () => [
        { value: 'day', label: '☀️ Дневная' },
        { value: 'night', label: '🌙 Ночная' },
      ],
    },
    {
      name: 'cash_amount',
      label: 'Наличные (₸)',
      type: 'number',
      required: false,
      description: 'Сумма наличных. Если не было — 0',
    },
    {
      name: 'kaspi_amount',
      label: 'Безналичный (₸)',
      type: 'number',
      required: false,
      description: 'Сумма по Безналичный',
    },
    {
      name: 'card_amount',
      label: 'Карта (₸)',
      type: 'number',
      required: false,
      description: 'Сумма по банковской карте',
    },
    {
      name: 'online_amount',
      label: 'Онлайн (₸)',
      type: 'number',
      required: false,
      description: 'Сумма онлайн-платежей',
    },
  ],
  handler: async (input, ctx) => {
    const companyId = String(input.company_id || '')
    const shift = String(input.shift || 'day') as 'day' | 'night'
    const cash = Number(input.cash_amount || 0)
    const kaspi = Number(input.kaspi_amount || 0)
    const card = Number(input.card_amount || 0)
    const online = Number(input.online_amount || 0)

    if (!companyId) return { ok: false, message: 'Не указана точка.' }
    const total = cash + kaspi + card + online
    if (total <= 0) return { ok: false, message: 'Сумма равна нулю — нечего записывать.' }

    const today = todayISO()
    const { data, error } = await ctx.supabase
      .from('incomes')
      .insert([
        { date: today, company_id: companyId, shift, cash_amount: cash, kaspi_amount: kaspi, card_amount: card, online_amount: online },
      ])
      .select('id')
      .single()
    if (error) return { ok: false, message: `Не удалось создать: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'income',
        entityId: data?.id || 'unknown',
        action: 'create',
        payload: { company_id: companyId, shift, cash, kaspi, card, online, total, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return {
      ok: true,
      message: `Выручка ${total.toLocaleString('ru-RU')} ₸ записана (смена ${shift === 'day' ? 'день' : 'ночь'}).`,
      data: { incomeId: data?.id },
    }
  },
}
