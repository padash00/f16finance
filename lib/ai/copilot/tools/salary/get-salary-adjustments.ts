/**
 * AI tool: корректировки зарплаты за период (авансы/штрафы/бонусы/долги) с деталями.
 * «покажи корректировки по зарплате», «какие авансы выдавали», «штрафы за неделю».
 * Capability: salary.view (read). Источник: operator_salary_adjustments.
 */

import type { CopilotTool } from '../../types'
import { scopedOperatorIds } from '../../query-helpers'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function addDaysISO(iso: string, diff: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1)
  dt.setDate(dt.getDate() + diff)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}
const money = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'
const KIND_LABEL: Record<string, string> = { fine: '⚠ Штраф', bonus: '🎁 Бонус', advance: '💵 Аванс', debt: '📉 Долг' }

export const getSalaryAdjustmentsTool: CopilotTool = {
  name: 'get_salary_adjustments',
  category: 'salary',
  description: 'Корректировки зарплаты за период (авансы, штрафы, бонусы, долги) — кто, сколько, за что. Вызывай на «покажи корректировки по зарплате / какие авансы / штрафы за период». Поддерживает точные даты from/to и фильтр по виду/оператору.',
  requiredCapability: 'salary.view',
  severity: 'low',
  params: [
    {
      name: 'period', label: 'Период', type: 'select', required: false,
      description: 'Готовый период (по умолчанию месяц). ИЛИ точные даты from/to.',
      getOptions: async () => [
        { value: 'today', label: 'Сегодня' }, { value: 'week', label: 'Неделя' },
        { value: 'month', label: 'Месяц' }, { value: 'all', label: 'Всё время' },
      ],
    },
    { name: 'from', label: 'С даты', type: 'string', required: false, description: 'Начало YYYY-MM-DD (произвольный диапазон).' },
    { name: 'to', label: 'По дату', type: 'string', required: false, description: 'Конец YYYY-MM-DD.' },
    {
      name: 'kind', label: 'Вид', type: 'select', required: false,
      description: 'Фильтр по виду корректировки.',
      getOptions: async () => [
        { value: 'advance', label: '💵 Авансы' }, { value: 'fine', label: '⚠ Штрафы' },
        { value: 'bonus', label: '🎁 Бонусы' }, { value: 'debt', label: '📉 Долги' },
      ],
    },
    {
      name: 'operator_id', label: 'Оператор', type: 'select', required: false,
      description: 'Фильтр по оператору.',
      getOptions: async (ctx) => {
        let q = ctx.supabase.from('operators').select('id, name, short_name').eq('is_active', true).order('name')
        const ids = await scopedOperatorIds(ctx)
        if (ids) q = q.in('id', ids)
        const { data } = await q
        return (data || []).map((o: any) => ({ value: o.id, label: o.short_name || o.name }))
      },
    },
  ],
  handler: async (input, ctx) => {
    const period = String(input.period || 'month')
    const kind = String(input.kind || '')
    const operatorId = String(input.operator_id || '')
    const today = todayISO()
    const reIso = /^\d{4}-\d{2}-\d{2}$/
    const inFrom = String(input.from || '').trim()
    const inTo = String(input.to || '').trim()

    let from: string | null = null
    let to: string | null = today
    if (reIso.test(inFrom) && reIso.test(inTo)) { from = inFrom; to = inTo }
    else if (period === 'today') from = today
    else if (period === 'week') from = addDaysISO(today, -6)
    else if (period === 'all') { from = null; to = null }
    else from = addDaysISO(today, -29) // month

    let q = ctx.supabase
      .from('operator_salary_adjustments')
      .select('date, kind, amount, comment, status, operator_id')
      .order('date', { ascending: false }).range(0, 9999)
    if (from) q = q.gte('date', from)
    if (to) q = q.lte('date', to)
    if (kind) q = q.eq('kind', kind)
    if (operatorId) q = q.eq('operator_id', operatorId)
    const allowedOpIds = await scopedOperatorIds(ctx)
    if (allowedOpIds) q = q.in('operator_id', allowedOpIds)

    const { data, error } = await q
    if (error) return { ok: false, message: `Ошибка: ${error.message}` }

    // Активные (не отменённые)
    const rows = (data || []).filter((a: any) => a.status !== 'voided')
    if (rows.length === 0) return { ok: true, message: 'Корректировок зарплаты за период нет.', data: { adjustments: [], totals: {} } }

    // Имена операторов
    const opIds = Array.from(new Set(rows.map((a: any) => a.operator_id).filter(Boolean)))
    const opMap = new Map<string, string>()
    if (opIds.length) {
      const { data: ops } = await ctx.supabase.from('operators').select('id, name, short_name').in('id', opIds)
      for (const o of ops || []) opMap.set(String(o.id), (o as any).short_name || (o as any).name)
    }

    const totals: Record<string, number> = {}
    for (const a of rows) totals[a.kind] = (totals[a.kind] || 0) + Number(a.amount || 0)

    const fromLabel = from ? (from === to ? from : `${from} — ${to}`) : 'всё время'
    const totalLine = Object.entries(totals)
      .map(([k, v]) => `${KIND_LABEL[k] || k}: ${money(v)}`).join(' · ')

    const lines = rows.slice(0, 25).map((a: any) =>
      `${a.date} · ${KIND_LABEL[a.kind] || a.kind} · ${money(Number(a.amount || 0))} · ${opMap.get(String(a.operator_id)) || '—'}${a.comment ? ` (${a.comment})` : ''}`)

    return {
      ok: true,
      message: `Корректировки зарплаты за ${fromLabel} (${rows.length}):\nИтого: ${totalLine}\n\n` + lines.join('\n') + (rows.length > 25 ? `\n… и ещё ${rows.length - 25}` : ''),
      data: {
        count: rows.length, totals,
        adjustments: rows.slice(0, 50).map((a: any) => ({ date: a.date, kind: a.kind, amount: Number(a.amount || 0), operator: opMap.get(String(a.operator_id)) || null, comment: a.comment })),
      },
    }
  },
}
