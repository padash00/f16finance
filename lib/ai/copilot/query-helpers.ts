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
