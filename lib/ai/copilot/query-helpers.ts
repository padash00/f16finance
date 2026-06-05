/**
 * Утилиты для запросов внутри Copilot tools.
 *
 * PostgREST embed (`company:companies!company_id(name)`) бывает падает на
 * schema cache rotation — запрос возвращает [] без явной ошибки. Используем
 * 2 отдельных запроса вместо JOIN для надёжности.
 */

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
