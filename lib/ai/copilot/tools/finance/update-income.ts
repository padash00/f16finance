/**
 * AI tool: изменить существующий доход (суммы по способам оплаты).
 * Capability: income.edit
 *
 * Меняем только переданные поля cash/kaspi/card/online у записи `incomes`.
 * Скоупим по company_id своей организации.
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'
import { scopedCompanyIds, resolveCompanyNames } from '../../query-helpers'

export const updateIncomeTool: CopilotTool = {
  name: 'update_income',
  category: 'finance',
  description: 'Изменить доход (суммы наличные/Безналичный/карта/онлайн)',
  requiredCapability: 'income.edit',
  severity: 'high',
  params: [
    {
      name: 'income_id',
      label: 'Какой доход',
      type: 'select',
      required: true,
      description: 'Запись дохода из последних',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase
          .from('incomes')
          .select('id, date, shift, cash_amount, kaspi_amount, card_amount, online_amount, company_id')
          .order('date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(100)
        const rows = (data || []) as any[]
        const companyMap = await resolveCompanyNames(ctx.supabase, rows)
        return rows.map((e) => {
          const sum =
            Number(e.cash_amount || 0) + Number(e.kaspi_amount || 0) + Number(e.card_amount || 0) + Number(e.online_amount || 0)
          const co = companyMap.get(String(e.company_id)) || ''
          const shift = e.shift === 'night' ? 'ночь' : 'день'
          return { value: String(e.id), label: `${e.date} · ${co} · ${shift} · ${sum.toLocaleString('ru-RU')} ₸` }
        })
      },
    },
    { name: 'new_cash_amount', label: 'Наличные (₸)', type: 'number', required: false, description: 'Новая сумма наличных. Пусто — не меняется.' },
    { name: 'new_kaspi_amount', label: 'Безналичный (₸)', type: 'number', required: false, description: 'Новая сумма безналичных. Пусто — не меняется.' },
    { name: 'new_card_amount', label: 'Карта (₸)', type: 'number', required: false, description: 'Новая сумма по карте. Пусто — не меняется.' },
    { name: 'new_online_amount', label: 'Онлайн (₸)', type: 'number', required: false, description: 'Новая сумма онлайн. Пусто — не меняется.' },
  ],
  handler: async (input, ctx) => {
    const incomeId = String(input.income_id || '')
    if (!incomeId) return { ok: false, message: 'Не выбран доход.' }

    const updates: Record<string, number> = {}
    if (input.new_cash_amount != null && String(input.new_cash_amount).trim() !== '') updates.cash_amount = Number(input.new_cash_amount)
    if (input.new_kaspi_amount != null && String(input.new_kaspi_amount).trim() !== '') updates.kaspi_amount = Number(input.new_kaspi_amount)
    if (input.new_card_amount != null && String(input.new_card_amount).trim() !== '') updates.card_amount = Number(input.new_card_amount)
    if (input.new_online_amount != null && String(input.new_online_amount).trim() !== '') updates.online_amount = Number(input.new_online_amount)

    if (Object.keys(updates).length === 0) {
      return { ok: false, message: 'Нечего менять — укажи хотя бы одну сумму.' }
    }
    for (const [k, v] of Object.entries(updates)) {
      if (!Number.isFinite(v) || v < 0) return { ok: false, message: `Некорректная сумма для ${k}.` }
    }

    const { data: existing, error: getErr } = await ctx.supabase
      .from('incomes')
      .select('id, cash_amount, kaspi_amount, card_amount, online_amount, company_id')
      .eq('id', incomeId)
      .single()
    if (getErr || !existing) return { ok: false, message: 'Доход не найден.' }

    // Мультитенантная изоляция: менять можно только доход своей организации.
    const ids = await scopedCompanyIds(ctx)
    if (ids && existing.company_id && !ids.includes(String(existing.company_id))) {
      return { ok: false, message: 'Доход не найден.' }
    }

    const { error } = await ctx.supabase.from('incomes').update(updates).eq('id', incomeId)
    if (error) return { ok: false, message: `Не удалось обновить: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'income',
        entityId: incomeId,
        action: 'update',
        payload: { previous: existing, next: updates, via: 'copilot', source: ctx.source },
      })
    } catch {}

    const newTotal =
      (updates.cash_amount ?? Number(existing.cash_amount || 0)) +
      (updates.kaspi_amount ?? Number(existing.kaspi_amount || 0)) +
      (updates.card_amount ?? Number(existing.card_amount || 0)) +
      (updates.online_amount ?? Number(existing.online_amount || 0))

    return { ok: true, message: `✅ Доход обновлён. Новый итог: ${Math.round(newTotal).toLocaleString('ru-RU')} ₸.` }
  },
}
