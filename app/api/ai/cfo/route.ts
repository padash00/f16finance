import { NextResponse } from 'next/server'

import { logAiUsageSafe } from '@/lib/ai/usage-tracker'
import { generateAiText, type AiMessage } from '@/lib/ai/provider'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { resolveCompanyScope } from '@/lib/server/organizations'

// AI CFO — виртуальный финансовый директор.
// Точные цифры (выручка/расходы/прибыль/маржа по компаниям + дельты к прошлому периоду) считаются КОДОМ.
// AI получает готовые цифры и даёт АНАЛИЗ: причины, проблемы, возможности, рекомендации, прогноз.

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
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
function daysBetweenISO(from: string, to: string) {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const a = Date.UTC(fy, (fm || 1) - 1, fd || 1)
  const b = Date.UTC(ty, (tm || 1) - 1, td || 1)
  return Math.round((b - a) / 86_400_000) + 1
}
const n = (v: any) => Number(v || 0)
const incomeOf = (r: any) => n(r.cash_amount) + n(r.kaspi_amount) + n(r.online_amount) + n(r.card_amount)
const expenseOf = (r: any) => n(r.cash_amount) + n(r.kaspi_amount)
const pct = (cur: number, prev: number) => (!prev ? (cur ? 100 : 0) : ((cur - prev) / Math.abs(prev)) * 100)
const r0 = (v: number) => Math.round(v)
const r1 = (v: number) => Math.round(v * 10) / 10

function parseJsonLoose(text: string): any {
  const tryParse = (s: string) => { try { return JSON.parse(s) } catch { return null } }
  const direct = tryParse(text)
  if (direct) return direct
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const c = tryParse(cleaned)
  if (c) return c
  const s = cleaned.indexOf('{')
  const e = cleaned.lastIndexOf('}')
  if (s >= 0 && e > s) return tryParse(cleaned.slice(s, e + 1))
  return null
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin && !access.staffMember) return json({ error: 'forbidden' }, 403)

    const ip = getClientIp(request)
    const rl = checkRateLimit(`ai-cfo:${access.user?.id || ip}`, 15, 60_000)
    if (!rl.allowed) return json({ error: 'too-many-requests' }, 429)
    if (!hasAdminSupabaseCredentials()) return json({ error: 'supabase-unavailable' }, 500)

    const body = await request.json().catch(() => ({}))
    const isISO = (s: any) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

    let dateFrom: string
    let dateTo: string
    let days: number
    if (isISO(body?.dateFrom) && isISO(body?.dateTo) && body.dateFrom <= body.dateTo) {
      // Явный период: конкретный месяц или произвольный диапазон
      dateFrom = body.dateFrom
      dateTo = body.dateTo
      days = daysBetweenISO(dateFrom, dateTo)
    } else {
      // Пресет: последние N дней
      days = [7, 30, 90, 365].includes(Number(body?.days)) ? Number(body.days) : 90
      dateTo = body?.dateTo && isISO(body.dateTo) ? body.dateTo : todayISO()
      dateFrom = addDaysISO(dateTo, -(days - 1))
    }
    // Предыдущий период такой же длины — непосредственно перед текущим
    const prevTo = addDaysISO(dateFrom, -1)
    const prevFrom = addDaysISO(prevTo, -(days - 1))

    const supabase = createAdminSupabaseClient()
    const scope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    let companiesQ = supabase.from('companies').select('id, name, code')
    if (scope.allowedCompanyIds) {
      if (scope.allowedCompanyIds.length === 0) return json({ error: 'no-companies' }, 200)
      companiesQ = companiesQ.in('id', scope.allowedCompanyIds)
    }
    let incQ = supabase.from('incomes').select('date, company_id, cash_amount, kaspi_amount, online_amount, card_amount').gte('date', prevFrom).lte('date', dateTo).range(0, 9999)
    let expQ = supabase.from('expenses').select('date, company_id, category, cash_amount, kaspi_amount').gte('date', prevFrom).lte('date', dateTo).range(0, 9999)
    if (scope.allowedCompanyIds) {
      incQ = incQ.in('company_id', scope.allowedCompanyIds)
      expQ = expQ.in('company_id', scope.allowedCompanyIds)
    }

    const [companiesR, incR, expR] = await Promise.all([companiesQ, incQ, expQ])
    if (companiesR.error) throw companiesR.error
    if (incR.error) throw incR.error
    if (expR.error) throw expR.error

    const companies = (companiesR.data || []) as any[]
    const nameById = new Map(companies.map((c) => [String(c.id), c.name || c.code || '—']))

    // Агрегация по компаниям (текущий/прошлый) + категории расходов
    type Agg = { revCur: number; revPrev: number; expCur: number; expPrev: number }
    const byCompany = new Map<string, Agg>()
    const ensure = (id: string) => {
      if (!byCompany.has(id)) byCompany.set(id, { revCur: 0, revPrev: 0, expCur: 0, expPrev: 0 })
      return byCompany.get(id)!
    }
    let revCur = 0, revPrev = 0, expCur = 0, expPrev = 0
    const catCur = new Map<string, number>()
    const catPrev = new Map<string, number>()

    for (const row of incR.data || []) {
      const v = incomeOf(row)
      if (!v) continue
      const cur = String(row.date) >= dateFrom
      const a = ensure(String(row.company_id))
      if (cur) { a.revCur += v; revCur += v } else { a.revPrev += v; revPrev += v }
    }
    for (const row of expR.data || []) {
      const v = expenseOf(row)
      if (!v) continue
      const cur = String(row.date) >= dateFrom
      const a = ensure(String(row.company_id))
      const cat = String(row.category || 'Прочее')
      if (cur) { a.expCur += v; expCur += v; catCur.set(cat, (catCur.get(cat) || 0) + v) }
      else { a.expPrev += v; expPrev += v; catPrev.set(cat, (catPrev.get(cat) || 0) + v) }
    }

    const profitCur = revCur - expCur
    const profitPrev = revPrev - expPrev
    const marginCur = revCur ? (profitCur / revCur) * 100 : 0
    const marginPrev = revPrev ? (profitPrev / revPrev) * 100 : 0

    const executive = {
      revenue: r0(revCur), revenueDeltaPct: r1(pct(revCur, revPrev)),
      expenses: r0(expCur), expensesDeltaPct: r1(pct(expCur, expPrev)),
      profit: r0(profitCur), profitDeltaPct: r1(pct(profitCur, profitPrev)),
      margin: r1(marginCur), marginDeltaPp: r1(marginCur - marginPrev),
      cashflow: r0(profitCur),
    }

    const companyRows = Array.from(byCompany.entries()).map(([id, a]) => {
      const profit = a.revCur - a.expCur
      const margin = a.revCur ? (profit / a.revCur) * 100 : 0
      return {
        name: nameById.get(id) || '—',
        revenue: r0(a.revCur), expenses: r0(a.expCur), profit: r0(profit), margin: r1(margin),
        profitShare: r1(profitCur ? (profit / profitCur) * 100 : 0),
        revenueDeltaPct: r1(pct(a.revCur, a.revPrev)),
        profitDeltaPct: r1(pct(profit, a.revPrev - a.expPrev)),
      }
    }).sort((x, y) => y.profit - x.profit)

    const ranking = companyRows.length
      ? {
          profitLeader: companyRows[0]?.name || null,
          worst: companyRows[companyRows.length - 1]?.name || null,
          efficiencyLeader: [...companyRows].filter((c) => c.revenue > 0).sort((a, b) => b.margin - a.margin)[0]?.name || null,
          growthLeader: [...companyRows].sort((a, b) => b.profitDeltaPct - a.profitDeltaPct)[0]?.name || null,
        }
      : null

    const changes = Array.from(catCur.entries())
      .map(([cat, cur]) => ({ label: cat, current: r0(cur), prev: r0(catPrev.get(cat) || 0), deltaPct: r1(pct(cur, catPrev.get(cat) || 0)) }))
      .sort((a, b) => Math.abs(b.current - b.prev) - Math.abs(a.current - a.prev))
      .slice(0, 8)

    const computed = { days, dateFrom, dateTo, prevFrom, prevTo, executive, companies: companyRows, ranking, expenseChanges: changes }

    // ---- AI анализ ----
    const systemPrompt = [
      'Ты — AI-CFO (виртуальный финансовый директор) с 30-летним опытом. Мыслишь как собственник. Цель — рост ЧИСТОЙ ПРИБЫЛИ.',
      'Тебе дают УЖЕ ПОСЧИТАННЫЕ точные цифры (JSON). НЕ пересчитывай и НЕ выдумывай числа — используй данные как есть.',
      'Твоя работа — АНАЛИЗ: причины, проблемы, возможности заработать, рекомендации, прогноз, риски.',
      'Верни СТРОГО валидный JSON без markdown:',
      '{',
      '"summary": "2-4 предложения: сколько заработано, главный источник прибыли, главная проблема, потенциал роста, уровень риска",',
      '"problems": [{"title": "...", "cause": "...", "impact": "потери денег/последствие", "severity": "high|medium|low"}],',
      '"opportunities": [{"title": "...", "action": "что сделать", "profit": "оценка прибыли ₸", "effort": "low|medium|high"}],',
      '"recommendations": [{"title": "...", "expected": "ожидаемый результат", "priority": "high|medium|low"}],',
      '"forecast": {"trend": "positive|neutral|negative", "text": "прогноз прибыли на 30 дней при текущем тренде", "warning": "предупреждение или null"},',
      '"answers": {"where_losing": "где теряем деньги", "where_earn": "где заработать больше", "three_actions": ["...","...","..."], "best_company": "...", "worst_company": "...", "extra_profit": "сколько прибыли можно добавить ₸", "main_risk": "главный риск"}',
      '}',
      'Правила: 3-6 проблем, 3-6 возможностей, 3-5 рекомендаций. Конкретика и цифры из данных. Русский язык. Если данных мало — честно скажи в summary.',
    ].join('\n')

    const messages: AiMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Посчитанные финансы за ${days} дней (${dateFrom} — ${dateTo}), сравнение с предыдущими ${days} днями:\n\n${JSON.stringify(computed)}\n\nДай разбор в JSON.` },
    ]

    let ai: any = null
    try {
      const result = await generateAiText({ model: OPENAI_MODEL, maxTokens: 2500, messages })
      await logAiUsageSafe(access.supabase, { userId: access.user?.id || null, endpoint: '/api/ai/cfo', provider: result.provider, model: result.model, usage: result.usage })
      ai = parseJsonLoose(result.text)
      if (!ai) ai = { summary: result.text, problems: [], opportunities: [], recommendations: [], forecast: null, answers: null }
    } catch (e: any) {
      ai = { error: e?.message || 'AI недоступен', summary: '', problems: [], opportunities: [], recommendations: [], forecast: null, answers: null }
    }

    return json({ ok: true, ...computed, ai })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
