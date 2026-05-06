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

    // Проверим что нет такой категории
    const { data: existing } = await ctx.supabase.from('expense_categories').select('id').eq('name', name).maybeSingle()
    if (existing) return { ok: false, message: `Категория "${name}" уже существует.` }

    const { data, error } = await ctx.supabase
      .from('expense_categories')
      .insert([{ name, kind }])
      .select('id')
      .single()
    if (error) return { ok: false, message: `Не удалось создать: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'expense-category',
        entityId: data?.id || 'unknown',
        action: 'create',
        payload: { name, kind, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `✅ Категория "${name}" создана.` }
  },
}
