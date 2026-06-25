/**
 * AI tool: уволить оператора.
 * Capability: hr.dismiss
 *
 * Зеркалит логику app/api/admin/hr/dismiss/route.ts (ветка operator):
 * is_active=false + dismissed_at/dismissal_date/dismissal_type/dismissal_reason,
 * деактивация привязок к точкам. Скоупим по своей организации.
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'
import { scopedOperatorIds, scopedOperatorRows } from '../../query-helpers'

const DISMISSAL_TYPES = ['voluntary', 'mutual_agreement', 'cause', 'contract_end', 'other']
const DISMISSAL_TYPE_LABELS: Record<string, string> = {
  voluntary: 'По собственному желанию',
  mutual_agreement: 'По соглашению сторон',
  cause: 'По статье',
  contract_end: 'Истёк срок договора',
  other: 'Другое',
}

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const dismissEmployeeTool: CopilotTool = {
  name: 'dismiss_employee',
  category: 'team',
  description: 'Уволить оператора (деактивация + причина увольнения)',
  requiredCapability: 'hr.dismiss',
  severity: 'high',
  params: [
    {
      name: 'operator_id',
      label: 'Кого увольняем',
      type: 'select',
      required: true,
      description: 'Оператор для увольнения. Если назвали имя — найди в списке.',
      extractHint: 'Айгерим, Алима',
      getOptions: async (ctx) => {
        const data = await scopedOperatorRows(ctx)
        return (data || []).map((op: any) => ({ value: op.id, label: op.short_name || op.name }))
      },
    },
    {
      name: 'reason',
      label: 'Причина увольнения',
      type: 'string',
      required: true,
      description: 'Причина (минимум 5 символов)',
    },
    {
      name: 'dismissal_type',
      label: 'Тип увольнения',
      type: 'select',
      required: false,
      description: 'Тип расторжения (по умолчанию «Другое»)',
      getOptions: async () => DISMISSAL_TYPES.map((t) => ({ value: t, label: DISMISSAL_TYPE_LABELS[t] })),
    },
  ],
  handler: async (input, ctx) => {
    const operatorId = String(input.operator_id || '')
    const reason = String(input.reason || '').trim()
    const dismissalType = DISMISSAL_TYPES.includes(String(input.dismissal_type)) ? String(input.dismissal_type) : 'other'

    if (!operatorId) return { ok: false, message: 'Не выбран оператор.' }
    if (reason.length < 5) return { ok: false, message: 'Причина увольнения обязательна (минимум 5 символов).' }

    // Мультитенантная изоляция: увольнять можно только оператора своей организации.
    const allowed = await scopedOperatorIds(ctx)
    if (allowed && !allowed.includes(operatorId)) return { ok: false, message: 'Оператор не найден.' }

    const { data: opRow } = await ctx.supabase
      .from('operators')
      .select('id, name, is_active')
      .eq('id', operatorId)
      .maybeSingle()
    if (!opRow) return { ok: false, message: 'Оператор не найден.' }
    if (opRow.is_active === false) return { ok: false, message: `${opRow.name || 'Оператор'} уже уволен.` }

    const nowISO = new Date().toISOString()
    const dismissalDate = todayISO()

    const { error } = await ctx.supabase
      .from('operators')
      .update({
        is_active: false,
        dismissed_at: nowISO,
        dismissal_date: dismissalDate,
        dismissal_type: dismissalType,
        dismissal_reason: reason,
      })
      .eq('id', operatorId)
    if (error) return { ok: false, message: `Не удалось уволить: ${error.message}` }

    // Деактивируем привязки к точкам (как в hr/dismiss).
    await ctx.supabase
      .from('operator_company_assignments')
      .update({ is_active: false })
      .eq('operator_id', operatorId)

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'operator',
        entityId: operatorId,
        action: 'dismiss',
        payload: {
          name: opRow.name,
          reason,
          dismissal_date: dismissalDate,
          dismissal_type: dismissalType,
          via: 'copilot',
          source: ctx.source,
        },
      })
    } catch {}

    return {
      ok: true,
      message: `🚫 ${opRow.name || 'Оператор'} уволен (${DISMISSAL_TYPE_LABELS[dismissalType]}). Причина: ${reason}`,
      data: { operatorId },
    }
  },
}
