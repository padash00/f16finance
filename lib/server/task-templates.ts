import 'server-only'

// Создание задачи из шаблона task_templates: общий код для ручного
// «Создать сейчас» (/api/admin/tasks) и утреннего крона recurring-tasks.

const KZ_OFFSET = 5 * 3600_000

export function kzTodayISO(): string {
  const d = new Date(Date.now() + KZ_OFFSET)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** День недели в Казахстане: 1=Пн … 7=Вс */
export function kzWeekday(): number {
  const day = new Date(Date.now() + KZ_OFFSET).getUTCDay()
  return day === 0 ? 7 : day
}

export type TaskTemplateRow = {
  id: string
  company_id: string | null
  title: string
  description: string | null
  checklist: unknown
  priority: string
  operator_id: string | null
  staff_id: string | null
  due_in_days: number | null
  recurrence_days: number[] | null
  is_active: boolean
  created_by: string | null
  last_spawned_on: string | null
}

function addDaysISO(dateISO: string, days: number): string {
  const base = Date.UTC(
    Number(dateISO.slice(0, 4)),
    Number(dateISO.slice(5, 7)) - 1,
    Number(dateISO.slice(8, 10)),
  )
  const d = new Date(base + days * 86_400_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

export function templateChecklistItems(checklist: unknown): Array<{ id: string; text: string; done: boolean }> {
  if (!Array.isArray(checklist)) return []
  return checklist
    .map((item) => (typeof item === 'string' ? item : String((item as any)?.text || '')))
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({
      id: globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2),
      text,
      done: false,
    }))
}

/**
 * Создаёт задачу из шаблона. createdBy — staff.id инициатора (для ручного
 * запуска) или created_by шаблона (для крона). Возвращает созданную строку.
 */
export async function spawnTaskFromTemplate(
  supabase: any,
  template: TaskTemplateRow,
  createdBy: string | null,
): Promise<any> {
  const today = kzTodayISO()
  const dueDate =
    template.due_in_days === null || template.due_in_days === undefined
      ? null
      : addDaysISO(today, Math.max(0, Number(template.due_in_days)))

  const basePayload: Record<string, unknown> = {
    title: template.title,
    description: template.description || null,
    priority: template.priority || 'medium',
    status: 'todo',
    operator_id: template.operator_id || null,
    staff_id: template.operator_id ? null : template.staff_id || null,
    company_id: template.company_id || null,
    due_date: dueDate,
    tags: [],
    checklist: templateChecklistItems(template.checklist),
  }
  if (createdBy) basePayload.created_by = createdBy

  let lastError: any = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: maxRow, error: maxError } = await supabase
      .from('tasks')
      .select('task_number')
      .order('task_number', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (maxError) throw maxError

    const insertPayload: Record<string, unknown> = { ...basePayload, task_number: Number(maxRow?.task_number || 0) + 1 }
    const { data, error } = await supabase.from('tasks').insert([insertPayload]).select('*').single()
    if (!error) return data

    lastError = error
    const message = String(error?.message || '').toLowerCase()
    if (error?.code === '23505' || message.includes('duplicate')) continue
    if (String(error?.message || '').includes('tasks_created_by_fkey')) {
      const { created_by, ...withoutCreator } = insertPayload
      const retry = await supabase.from('tasks').insert([withoutCreator]).select('*').single()
      if (!retry.error) return retry.data
      lastError = retry.error
    }
    break
  }

  throw lastError || new Error('Не удалось создать задачу из шаблона')
}
