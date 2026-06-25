/**
 * Утилиты для запросов внутри Copilot tools.
 *
 * PostgREST embed (`company:companies!company_id(name)`) бывает падает на
 * schema cache rotation — запрос возвращает [] без явной ошибки. Используем
 * 2 отдельных запроса вместо JOIN для надёжности.
 */

// ─────────────────────────────────────────────────────────────────────────
// Период: единая логика для всех инструментов. Пресет ИЛИ точные даты from/to.
// ─────────────────────────────────────────────────────────────────────────
export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function addDaysISO(iso: string, diff: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1)
  dt.setDate(dt.getDate() + diff)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/**
 * Разрешает период запроса. Приоритет — точные даты from/to (YYYY-MM-DD), иначе
 * пресет period. Возвращает { from, to (включительно, null = без границы), label }.
 * Используй ВЕЗДЕ в data-инструментах, чтобы «за 15-21 июня» работало одинаково.
 */
export function resolveDateRange(
  input: Record<string, unknown>,
  opts?: { defaultPeriod?: string },
): { from: string | null; to: string | null; label: string } {
  const today = todayISO()
  const reIso = /^\d{4}-\d{2}-\d{2}$/
  const inFrom = String(input.from || '').trim()
  const inTo = String(input.to || '').trim()
  if (reIso.test(inFrom) && reIso.test(inTo)) {
    return { from: inFrom, to: inTo, label: inFrom === inTo ? inFrom : `${inFrom} — ${inTo}` }
  }
  const period = String(input.period || opts?.defaultPeriod || 'today')
  switch (period) {
    case 'all': return { from: null, to: null, label: 'всё время' }
    case 'yesterday': { const d = addDaysISO(today, -1); return { from: d, to: d, label: 'вчера' } }
    case 'week': return { from: addDaysISO(today, -6), to: today, label: 'неделя' }
    case 'month': return { from: addDaysISO(today, -29), to: today, label: 'месяц' }
    case 'quarter': return { from: addDaysISO(today, -89), to: today, label: 'квартал' }
    case 'year': return { from: addDaysISO(today, -364), to: today, label: 'год' }
    default: return { from: today, to: today, label: 'сегодня' }
  }
}

/**
 * Готовые параметры периода для инструмента (period + from + to).
 * Раскладывай в params: `...dateRangeParams()`.
 */
export function dateRangeParams(): any[] {
  return [
    {
      name: 'period', label: 'Период', type: 'select', required: false,
      description: 'Готовый период. ИЛИ используй точные даты from/to для конкретного диапазона.',
      getOptions: async () => [
        { value: 'today', label: 'Сегодня' }, { value: 'yesterday', label: 'Вчера' },
        { value: 'week', label: 'Неделя' }, { value: 'month', label: 'Месяц' },
        { value: 'quarter', label: 'Квартал' }, { value: 'year', label: 'Год' }, { value: 'all', label: 'Всё время' },
      ],
    },
    { name: 'from', label: 'С даты', type: 'string', required: false, description: 'Начало периода YYYY-MM-DD (произвольный диапазон, напр. «за 15-21 июня»).' },
    { name: 'to', label: 'По дату', type: 'string', required: false, description: 'Конец периода YYYY-MM-DD.' },
  ]
}

export async function resolveCompanyNames(
  supabase: any,
  rows: Array<{ company_id?: string | null }>,
): Promise<Map<string, string>> {
  const ids = Array.from(new Set(rows.map((r) => r.company_id).filter(Boolean))) as string[]
  const map = new Map<string, string>()
  if (ids.length === 0) return map
  const { data } = await supabase.from('companies').select('id, name').in('id', ids)
  for (const c of (data || []) as any[]) map.set(String(c.id), c.name || '')
  return map
}

/**
 * ID компаний активной организации пользователя.
 * Возвращает null = без ограничения (супер-админ или нет активной организации) —
 * вызывающий тогда не фильтрует. Иначе массив id для `.in('company_id', ids)`.
 * Это основа мультитенантной изоляции копилота: данные одного владельца
 * не должны утекать другому.
 */
export async function scopedCompanyIds(
  ctx: { supabase: any; organizationId?: string | null; isSuperAdmin?: boolean },
): Promise<string[] | null> {
  if (!ctx.organizationId) return null
  const { data } = await ctx.supabase
    .from('companies')
    .select('id')
    .eq('organization_id', ctx.organizationId)
  return (data || []).map((c: any) => String(c.id))
}

/**
 * Сырые строки компаний своей организации (id, name, code), отсортированы по имени.
 * Для выпадашек, где нужен кастомный формат метки — заменяет прямой
 * `from('companies').select('id, name, code').order('name')`.
 */
export async function scopedCompanyRows(
  ctx: { supabase: any; organizationId?: string | null },
): Promise<Array<{ id: string; name: string; code: string | null }>> {
  let q = ctx.supabase.from('companies').select('id, name, code').order('name')
  if (ctx.organizationId) q = q.eq('organization_id', ctx.organizationId)
  const { data } = await q
  return (data || []) as Array<{ id: string; name: string; code: string | null }>
}

/**
 * Опции выпадашки «Точка» для copilot-инструментов — только компании своей
 * организации. allLabel (если задан) добавляет первую опцию «Все точки».
 */
export async function companyOptions(
  ctx: { supabase: any; organizationId?: string | null },
  opts?: { allLabel?: string },
): Promise<Array<{ value: string; label: string }>> {
  let q = ctx.supabase.from('companies').select('id, name, code').order('name')
  if (ctx.organizationId) q = q.eq('organization_id', ctx.organizationId)
  const { data } = await q
  const list = (data || []).map((c: any) => ({
    value: String(c.id),
    label: c.name + (c.code ? ` (${c.code})` : ''),
  }))
  return opts?.allLabel ? [{ value: '', label: opts.allLabel }, ...list] : list
}

/**
 * ID операторов своей организации (через operator_company_assignments → companies).
 * null = без ограничения (супер-админ / нет организации).
 */
export async function scopedOperatorIds(
  ctx: { supabase: any; organizationId?: string | null },
): Promise<string[] | null> {
  const companyIds = await scopedCompanyIds(ctx)
  if (!companyIds) return null
  const { data } = await ctx.supabase
    .from('operator_company_assignments')
    .select('operator_id')
    .in('company_id', companyIds)
  return Array.from(new Set((data || []).map((a: any) => String(a.operator_id))))
}

/**
 * Активные операторы своей организации (id, name, short_name), по имени.
 * Заменяет прямой `from('operators').select(...).eq('is_active', true).order('name')`.
 */
export async function scopedOperatorRows(
  ctx: { supabase: any; organizationId?: string | null },
): Promise<Array<{ id: string; name: string; short_name: string | null }>> {
  let q = ctx.supabase.from('operators').select('id, name, short_name').eq('is_active', true).order('name')
  const ids = await scopedOperatorIds(ctx)
  if (ids) q = q.in('id', ids)
  const { data } = await q
  return (data || []) as Array<{ id: string; name: string; short_name: string | null }>
}

export async function resolveOperatorNames(
  supabase: any,
  rows: Array<{ operator_id?: string | null }>,
): Promise<Map<string, string>> {
  const ids = Array.from(new Set(rows.map((r) => r.operator_id).filter(Boolean))) as string[]
  const map = new Map<string, string>()
  if (ids.length === 0) return map
  const { data } = await supabase.from('operators').select('id, name, short_name').in('id', ids)
  for (const o of (data || []) as any[]) map.set(String(o.id), o.short_name || o.name || '')
  return map
}
