/**
 * AI tool: добавить категорию расходов.
 * Capability: categories.create
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const addCategoryTool: CopilotTool = {
  name: 'add_expense_category',
  category: 'finance',
  description: 'Добавить новую категорию расходов',
  requiredCapability: 'categories.create',
  severity: 'medium',
  params: [
    {
      name: 'name',
      label: 'Название',
      type: 'string',
      required: true,
      description: 'Название категории',
      extractHint: 'Доставка',
    },
    {
      name: 'kind',
      label: 'Тип',
      type: 'select',
      required: false,
      description: 'Группа категории (опционально)',
      getOptions: async () => [
        { value: 'operational', label: 'Операционные' },
        { value: 'salary', label: 'Зарплата' },
        { value: 'tax', label: 'Налоги' },
        { value: 'other', label: 'Прочее' },
      ],
    },
  ],
  handler: async (input, ctx) => {
    const name = String(input.name || '').trim()
    const kind = String(input.kind || 'operational')
    if (!name) return { ok: false, message: 'Название обязательно.' }

    // Категория без organization_id общая для всей базы: чужая организация
    // увидит её в своих списках расходов.
    if (!ctx.organizationId && !ctx.isSuperAdmin) {
      return { ok: false, message: 'Нет активной организации — категорию создать нельзя.' }
    }

    // Проверка дубля тоже в рамках своей организации: глобальная проверка
    // раскрывала бы названия категорий других клиентов (и мешала создать своё).
    let existingQ = ctx.supabase.from('expense_categories').select('id').eq('name', name)
    existingQ = ctx.organizationId
      ? existingQ.eq('organization_id', ctx.organizationId)
      : existingQ.is('organization_id', null)
    const { data: existing } = await existingQ.maybeSingle()
    if (existing) return { ok: false, message: `Категория "${name}" уже существует.` }

    const { data, error } = await ctx.supabase
      .from('expense_categories')
      .insert([{ name, kind, organization_id: ctx.organizationId || null }])
      .select('id')
      .single()
    if (error) return { ok: false, message: `Не удалось создать: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        // Тегируем событие организацией: иначе запись уходит в «общий» пул
        // audit_log и её читают копилоты других клиентов.
        organizationId: ctx.organizationId || null,
        entityType: 'expense-category',
        entityId: data?.id || 'unknown',
        action: 'create',
        payload: { name, kind, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `✅ Категория "${name}" создана.` }
  },
}
