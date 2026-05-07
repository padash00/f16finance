/**
 * AI tool: создать промокод/скидку.
 * Capability: discounts.create
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function generateCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

export const createPromoTool: CopilotTool = {
  name: 'create_promo',
  category: 'pos',
  description: 'Создать промокод / скидку',
  requiredCapability: 'discounts.create',
  severity: 'medium',
  params: [
    {
      name: 'code',
      label: 'Код промо',
      type: 'string',
      required: false,
      description: 'Если пусто — сгенерируется случайный',
      extractHint: 'PROMO2026',
    },
    {
      name: 'discount_type',
      label: 'Тип скидки',
      type: 'select',
      required: true,
      description: 'Процент или фиксированная сумма',
      getOptions: async () => [
        { value: 'percent', label: '% (процент от суммы)' },
        { value: 'fixed', label: '₸ (фиксированная сумма)' },
      ],
    },
    {
      name: 'value',
      label: 'Размер скидки',
      type: 'number',
      required: true,
      description: 'Если процент — 1..100. Если фикс — сумма в ₸',
    },
    {
      name: 'valid_until',
      label: 'Действует до (YYYY-MM-DD)',
      type: 'date',
      required: false,
      description: 'Если не указано — без срока',
    },
  ],
  handler: async (input, ctx) => {
    const codeInput = String(input.code || '').trim().toUpperCase()
    const code = codeInput || generateCode()
    const type = String(input.discount_type || 'percent')
    const value = Number(input.value || 0)
    const validUntil = String(input.valid_until || '').trim() || null
    if (value <= 0) return { ok: false, message: 'Размер скидки должен быть > 0.' }
    if (type === 'percent' && value > 100) return { ok: false, message: 'Процент не может быть больше 100.' }

    const { data, error } = await ctx.supabase
      .from('discounts')
      .insert([{
        name: `Промо ${code}`,
        type: type === 'percent' ? 'percent' : 'fixed',
        value,
        promo_code: code,
        valid_from: todayISO(),
        valid_to: validUntil,
        is_active: true,
      }])
      .select('id, promo_code')
      .single()
    if (error) return { ok: false, message: `Не удалось создать: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'discount',
        entityId: data?.id || 'unknown',
        action: 'create',
        payload: { code, type, value, valid_until: validUntil, via: 'copilot', source: ctx.source },
      })
    } catch {}

    const valueLabel = type === 'percent' ? `${value}%` : `${value.toLocaleString('ru-RU')} ₸`
    return {
      ok: true,
      message: `🎁 Промокод "${data?.promo_code}" создан: скидка ${valueLabel}${validUntil ? ` до ${validUntil}` : ''}.`,
      data: { code: data?.promo_code },
    }
  },
}
