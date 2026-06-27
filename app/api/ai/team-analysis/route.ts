import { NextResponse } from 'next/server'

import { logAiUsageSafe } from '@/lib/ai/usage-tracker'
import { generateAiText, type AiMessage } from '@/lib/ai/provider'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { resolveCompanyScope, listOrganizationOperatorIds } from '@/lib/server/organizations'

// AI Разбор команды — HR-аналитик клуба.
// Точные цифры по каждому оператору (смены, начислено/к выплате, бонусы, штрафы, долги, выручка/час)
// считаются КОДОМ. AI получает готовые агрегаты и даёт разбор: звёзды / проседающие /
// справедливость оплаты / кого повысить / 2-3 действия.

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}
function todayISO() {
  const now = new Date()
  const t = now.getTime() - now.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}
function addDaysISO(iso: string, diff: number) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1)
  dt.setDate(dt.getDate() + diff)
  const t = dt.getTime() - dt.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}
const n = (v: any) => Number(v || 0)
const incomeOf = (r: any) => n(r.cash_amount) + n(r.kaspi_amount) + n(r.online_amount) + n(r.card_amount)
const r0 = (v: number) => Math.round(v)
const r1 = (v: number) => Math.round(v * 10) / 10

function parseJsonLoose(text: string): any {
  const tryParse = (s: string) => {
    try { return JSON.parse(s) } catch { return null }
  }
  const direct = tryParse(text)
  if (direct) return direct
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const c = tryParse(cleaned)
  if (c) return c
  const m = cleaned.match(/\{[\s\S]*\}/)
  if (m) return tryParse(m[0])
  return null
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    // canView: суперадмин ИЛИ сотрудник админ-команды
    if (!access.isSuperAdmin && !access.staffMember) return json({ error: 'forbidden' }, 403)

    const ip = getClientIp(request)
    const rl = checkRateLimit(`ai-team:${access.user?.id || ip}`, 15, 60_000)
    if (!rl.allowed) return json({ error: 'too-many-requests' }, 429)
    if (!hasAdminSupabaseCredentials()) return json({ error: 'supabase-unavailable' }, 500)

    const url = new URL(request.url)
    const requestedCompanyId = (url.searchParams.get('company_id') || '').trim() || null
    const daysParam = Number(url.searchParams.get('days'))
    const days = [7, 14, 30, 60, 90].includes(daysParam) ? daysParam : 30

    // Свой период: from/to ('YYYY-MM-DD'). Если ОБА валидны — используем их вместо last-N-days.
    const isoRe = /^\d{4}-\d{2}-\d{2}$/
    const fromParam = (url.searchParams.get('from') || '').trim()
    const toParam = (url.searchParams.get('to') || '').trim()
    const customRange = isoRe.test(fromParam) && isoRe.test(toParam)

    let dateFrom: string
    let dateTo: string
    if (customRange) {
      // нормализуем порядок на случай from > to
      dateFrom = fromParam <= toParam ? fromParam : toParam
      dateTo = fromParam <= toParam ? toParam : fromParam
    } else {
      dateTo = todayISO()
      dateFrom = addDaysISO(dateTo, -(days - 1))
    }

    const supabase = createAdminSupabaseClient()

    // Скоуп по орг. requestedCompanyId должен входить в allowedCompanyIds, иначе бросит / 403.
    let scope
    try {
      scope = await resolveCompanyScope({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        requestedCompanyId,
      })
    } catch (e: any) {
      if (String(e?.message || '') === 'company-out-of-scope') return json({ error: 'forbidden' }, 403)
      throw e
    }
    const allowedCompanyIds = scope.allowedCompanyIds // null = суперадмин (все)
    const companyFilter = requestedCompanyId ? [requestedCompanyId] : allowedCompanyIds

    // Скоуп по операторам организации.
    const allowedOperatorIds = await listOrganizationOperatorIds({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    // 1) Активные операторы (не админ-команда).
    let operatorsQ = supabase
      .from('operators')
      .select('id, name, short_name, is_active')
      .eq('is_active', true)
      .order('name')
    if (allowedOperatorIds) {
      if (allowedOperatorIds.length === 0) {
        return json({ ok: true, metrics: { operators: [] }, insights: [], summary: 'Нет операторов в организации.' })
      }
      operatorsQ = operatorsQ.in('id', allowedOperatorIds)
    }

    const { data: operatorsRaw, error: operatorsError } = await operatorsQ
    if (operatorsError) throw operatorsError
    const operators = (operatorsRaw || []) as any[]
    const operatorIds = operators.map((o) => String(o.id))
    if (operatorIds.length === 0) {
      return json({ ok: true, metrics: { operators: [] }, insights: [], summary: 'Нет активных операторов.' })
    }

    // 2) Доходы (смены/выручка) за период по операторам.
    let incomesQ = supabase
      .from('incomes')
      .select('operator_id, company_id, date, cash_amount, kaspi_amount, online_amount, card_amount')
      .in('operator_id', operatorIds)
      .gte('date', dateFrom)
      .lte('date', dateTo)
    if (companyFilter) incomesQ = incomesQ.in('company_id', companyFilter)

    // 3) Зарплатные недели (gross/net/paid/remaining) за период.
    let weeksQ = supabase
      .from('operator_salary_weeks')
      .select('operator_id, week_start, gross_amount, bonus_amount, fine_amount, debt_amount, advance_amount, net_amount, paid_amount, remaining_amount')
      .in('operator_id', operatorIds)
      .gte('week_start', dateFrom)
      .lte('week_start', dateTo)

    // 4) Корректировки (bonus / fine / advance) за период.
    let adjQ = supabase
      .from('operator_salary_adjustments')
      .select('operator_id, company_id, amount, kind, status')
      .in('operator_id', operatorIds)
      .gte('date', dateFrom)
      .lte('date', dateTo)
    if (companyFilter) adjQ = adjQ.in('company_id', companyFilter)

    // 5) Активные долги (текущие, без даты — общий хвост).
    let debtsQ = supabase
      .from('debts')
      .select('operator_id, company_id, amount, status')
      .in('operator_id', operatorIds)
      .eq('status', 'active')
    if (companyFilter) debtsQ = debtsQ.in('company_id', companyFilter)

    const [incomesR, weeksR, adjR, debtsR] = await Promise.all([incomesQ, weeksQ, adjQ, debtsQ])
    if (incomesR.error) throw incomesR.error
    if (weeksR.error) throw weeksR.error
    if (adjR.error) throw adjR.error
    if (debtsR.error) throw debtsR.error

    type Agg = {
      id: string
      name: string
      shifts: number
      turnover: number
      gross: number
      net: number
      paid: number
      remaining: number
      bonus: number
      fine: number
      debt: number
    }
    const byOperator = new Map<string, Agg>()
    for (const o of operators) {
      byOperator.set(String(o.id), {
        id: String(o.id),
        name: o.short_name || o.name || 'Без имени',
        shifts: 0,
        turnover: 0,
        gross: 0,
        net: 0,
        paid: 0,
        remaining: 0,
        bonus: 0,
        fine: 0,
        debt: 0,
      })
    }

    // incomes: 1 строка = 1 смена (как в admin/operators).
    for (const row of (incomesR.data || []) as any[]) {
      const a = byOperator.get(String(row.operator_id))
      if (!a) continue
      a.shifts += 1
      a.turnover += incomeOf(row)
    }

    // salary weeks: начислено / к выплате / выплачено / остаток.
    for (const row of (weeksR.data || []) as any[]) {
      const a = byOperator.get(String(row.operator_id))
      if (!a) continue
      a.gross += n(row.gross_amount)
      a.net += n(row.net_amount)
      a.paid += n(row.paid_amount)
      a.remaining += n(row.remaining_amount)
    }

    // adjustments: bonus / fine (advance — не штраф, в долю не считаем отдельно).
    for (const row of (adjR.data || []) as any[]) {
      if (String(row.status || 'active') !== 'active') continue
      const a = byOperator.get(String(row.operator_id))
      if (!a) continue
      const kind = String(row.kind || '')
      if (kind === 'bonus') a.bonus += n(row.amount)
      else if (kind === 'fine') a.fine += n(row.amount)
    }

    // debts: активные долги.
    for (const row of (debtsR.data || []) as any[]) {
      const a = byOperator.get(String(row.operator_id))
      if (!a) continue
      a.debt += n(row.amount)
    }

    // Готовые метрики на оператора (только те, у кого есть активность за период).
    const operatorMetrics = Array.from(byOperator.values())
      .map((a) => ({
        id: a.id,
        name: a.name,
        shifts: a.shifts,
        turnover: r0(a.turnover),
        revenuePerShift: a.shifts > 0 ? r0(a.turnover / a.shifts) : 0,
        gross: r0(a.gross),
        net: r0(a.net),
        paid: r0(a.paid),
        remaining: r0(a.remaining),
        bonus: r0(a.bonus),
        fine: r0(a.fine),
        debt: r0(a.debt),
        // эффективность: выручка на 1 ₸ зарплаты (чем выше — тем выгоднее оператор)
        revenuePerSalary: a.net > 0 ? r1(a.turnover / a.net) : 0,
      }))
      .filter((o) => o.shifts > 0 || o.gross > 0 || o.bonus > 0 || o.fine > 0 || o.debt > 0)
      .sort((x, y) => y.turnover - x.turnover)

    // Агрегаты для AI и подзаголовков.
    const active = operatorMetrics.filter((o) => o.shifts > 0)
    const nets = active.map((o) => o.net).filter((v) => v > 0)
    const minNet = nets.length ? Math.min(...nets) : 0
    const maxNet = nets.length ? Math.max(...nets) : 0
    const totalTurnover = operatorMetrics.reduce((s, o) => s + o.turnover, 0)
    const totalNet = operatorMetrics.reduce((s, o) => s + o.net, 0)
    const avgRevenuePerShift = active.length
      ? r0(active.reduce((s, o) => s + o.revenuePerShift, 0) / active.length)
      : 0

    const aggregates = {
      days: customRange ? null : days,
      customRange,
      dateFrom,
      dateTo,
      operatorsCount: operatorMetrics.length,
      activeCount: active.length,
      totalTurnover: r0(totalTurnover),
      totalNet: r0(totalNet),
      avgRevenuePerShift,
      salarySpread: { minNet: r0(minNet), maxNet: r0(maxNet), ratio: minNet > 0 ? r1(maxNet / minNet) : 0 },
      topByRevenue: [...operatorMetrics].slice(0, 3).map((o) => ({ name: o.name, turnover: o.turnover, revenuePerShift: o.revenuePerShift })),
      topByEfficiency: [...operatorMetrics].filter((o) => o.revenuePerSalary > 0).sort((a, b) => b.revenuePerSalary - a.revenuePerSalary).slice(0, 3).map((o) => ({ name: o.name, revenuePerSalary: o.revenuePerSalary })),
      withFines: operatorMetrics.filter((o) => o.fine > 0).map((o) => ({ name: o.name, fine: o.fine })),
      withDebts: operatorMetrics.filter((o) => o.debt > 0).map((o) => ({ name: o.name, debt: o.debt })),
      lowShifts: active.filter((o) => o.shifts <= 3).map((o) => ({ name: o.name, shifts: o.shifts })),
    }

    const metrics = { operators: operatorMetrics, aggregates }

    // Без AI-ключа — мягко вернём цифры без инсайтов.
    if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
      return json({ ok: true, metrics, insights: [], summary: 'AI-ключ не настроен — показаны только цифры.' })
    }

    const systemPrompt = [
      'Ты — HR-аналитик игрового клуба / точки продаж. По готовым данным команды дай разбор для собственника.',
      'Тебе дают УЖЕ ПОСЧИТАННЫЕ цифры по каждому оператору за период (JSON, факт). НЕ выдумывай цифры и имена — бери только из данных.',
      '',
      'Разбери: 1) кто звёзды (отметь по имени — высокая выручка/смену и эффективность); 2) кто проседает (штрафы, мало смен, долги); 3) справедлива ли оплата (разброс зарплат salarySpread — большой разрыв при схожих результатах = несправедливо); 4) кого повысить/научить; 5) дай 2-3 конкретных действия.',
      'По-русски, по делу, без воды. Деньги — целые ₸. Имена бери ровно как в данных.',
      '',
      'Верни СТРОГО валидный JSON без markdown:',
      '{',
      '"insights": [{"verdict": "короткий вывод (можно с именем)", "reason": "причина с цифрами из данных", "action": "что сделать", "severity": "high|medium|low"}],',
      '"summary": "одна фраза — итог по команде"',
      '}',
      'Правила: 4-7 инсайтов. severity: high — проблема (штрафы/долги/несправедливость), medium — улучшение/обучение, low — позитив/звезда. Каждый reason — с конкретными цифрами или именами из данных.',
    ].join('\n')

    const messages: AiMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Данные команды за период ${dateFrom} — ${dateTo}:\n\n${JSON.stringify(metrics)}\n\nСделай разбор команды в JSON по структуре.` },
    ]

    let insights: any[] = []
    let summary = ''
    try {
      const result = await generateAiText({ model: OPENAI_MODEL, maxTokens: 4000, messages })
      await logAiUsageSafe(access.supabase, {
        userId: access.user?.id || null,
        endpoint: '/api/ai/team-analysis',
        provider: result.provider,
        model: result.model,
        usage: result.usage,
      })
      const parsed = parseJsonLoose(result.text)
      if (parsed && typeof parsed === 'object') {
        insights = Array.isArray(parsed.insights) ? parsed.insights : []
        summary = typeof parsed.summary === 'string' ? parsed.summary : ''
      }
    } catch {
      // AI недоступен — цифры всё равно отдаём.
      insights = []
      summary = ''
    }

    return json({ ok: true, metrics, insights, summary })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
