/**
 * AI tool: зарегистрировать инцидент/нарушение по сотруднику.
 * Capability: incidents.create
 *
 * Использует ту же SQL-функцию `incidents_create`, что и веб-портал
 * (app/api/admin/incidents/route.ts POST), чтобы повторить весь флоу
 * (привязка к смене, суммы из статьи и т.п.).
 *
 * Примечание: incidents ссылаются на `subject_staff_id` (таблица staff),
 * поэтому субъект выбирается из сотрудников (staff) организации, а не из
 * операторов. Точка (company_id) обязательна для RPC.
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'
import { companyOptions, scopedCompanyIds } from '../../query-helpers'

export const createIncidentTool: CopilotTool = {
  name: 'create_incident',
  category: 'team',
  description: 'Зарегистрировать инцидент/нарушение по сотруднику',
  requiredCapability: 'incidents.create',
  severity: 'medium',
  params: [
    {
      name: 'company_id',
      label: 'На какой точке',
      type: 'select',
      required: true,
      description: 'Точка, к которой относится инцидент',
      getOptions: async (ctx) => companyOptions(ctx),
    },
    {
      name: 'subject_staff_id',
      label: 'По кому инцидент',
      type: 'select',
      required: false,
      description: 'Сотрудник-субъект инцидента (если указан). Если назвали имя — найди в списке.',
      getOptions: async (ctx) => {
        let q = ctx.supabase.from('staff').select('id, full_name, short_name, organization_id').eq('is_active', true).order('full_name')
        if (ctx.organizationId) q = q.eq('organization_id', ctx.organizationId)
        const { data } = await q
        return (data || []).map((s: any) => ({ value: s.id, label: s.full_name || s.short_name || s.id }))
      },
    },
    {
      name: 'kind',
      label: 'Тип',
      type: 'select',
      required: true,
      description: 'Тип записи',
      getOptions: async () => [
        { value: 'violation', label: '⚠️ Нарушение' },
        { value: 'bonus', label: '⭐ Поощрение' },
        { value: 'note', label: '📝 Заметка' },
      ],
    },
    {
      name: 'severity',
      label: 'Важность',
      type: 'select',
      required: false,
      description: 'Важность инцидента',
      getOptions: async () => [
        { value: 'low', label: 'Низкая' },
        { value: 'normal', label: 'Обычная' },
        { value: 'high', label: 'Высокая' },
        { value: 'critical', label: 'Критическая' },
      ],
    },
    {
      name: 'description',
      label: 'Описание',
      type: 'string',
      required: true,
      description: 'Суть инцидента (станет заголовком и описанием)',
    },
  ],
  handler: async (input, ctx) => {
    const companyId = String(input.company_id || '')
    const subjectStaffId = String(input.subject_staff_id || '').trim() || null
    const kind = ['violation', 'bonus', 'note'].includes(String(input.kind)) ? String(input.kind) : 'violation'
    const severity = String(input.severity || 'normal')
    const description = String(input.description || '').trim()

    if (!companyId) return { ok: false, message: 'Не указана точка.' }
    if (!description) return { ok: false, message: 'Опиши суть инцидента.' }

    // Мультитенантная изоляция: только точка своей организации.
    const ids = await scopedCompanyIds(ctx)
    if (ids && !ids.includes(companyId)) return { ok: false, message: 'Точка не найдена.' }

    const title = description.length > 120 ? description.slice(0, 117) + '...' : description

    const { data: incidentId, error } = await ctx.supabase.rpc('incidents_create', {
      p_company_id: companyId,
      p_kind: kind,
      p_title: title,
      p_description: description,
      p_subject_staff_id: subjectStaffId,
      p_reported_by: null,
      p_reported_by_user_id: ctx.userId || null,
      p_article_id: null,
      p_severity: severity,
      p_fine_amount: null,
      p_bonus_amount: null,
      p_photo_urls: [],
      p_shift_id: null,
      p_source: 'copilot',
      p_checklist_run_id: null,
      p_checklist_item_id: null,
      p_status: 'confirmed',
    })
    if (error) return { ok: false, message: `Не удалось создать инцидент: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'incident',
        entityId: String(incidentId),
        action: 'incident-created',
        payload: { kind, severity, company_id: companyId, subject_staff_id: subjectStaffId, via: 'copilot', source: ctx.source },
      })
    } catch {}

    const kindLabel = kind === 'bonus' ? 'Поощрение' : kind === 'note' ? 'Заметка' : 'Нарушение'
    return {
      ok: true,
      message: `🛡 ${kindLabel} зарегистрировано: «${title}».`,
      data: { incidentId },
      followUps: [{ label: '👁 Открыть инциденты', action: 'open:/incidents' }],
    }
  },
}
