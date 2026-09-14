import { NextResponse } from 'next/server'

import { logAiUsageSafe } from '@/lib/ai/usage-tracker'
import { generateAiText, type AiMessage } from '@/lib/ai/provider'
import { buildCfoReview, type CfoHealth } from '@/lib/analysis/cfo-review'
import { addDaysISO } from '@/lib/core/date'
import { isExtraCompany } from '@/lib/reports/extra-company'
import { splitIncomeKaspiByCalendarDay, type ReportIncomeCalendarRow } from '@/lib/reports/income-calendar-kaspi'
import { calculatePrevPeriod, isFullMonthRange, previousCalendarMonthRange } from '@/lib/reports/period'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireStaffCapability } from '@/lib/server/capabilities'
import { requireOrgFeature } from '@/lib/server/entitlements'
import { fetchAllRows, kzTodayISO } from '@/lib/server/forecast-inputs'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

// Финдиректор — разбор периода.
// Цифры считает код (lib/analysis/cfo-review) так же, как /reports: Extra по
// умолчанию исключена, безнал ночной смены перенесён на следующий день, статьи —
// из справочника своей организации. ИИ получает готовый разбор и только
// объясняет его. Запуск ИИ — отдельным запросом и по праву ai-cfo.generate.
//
// Ответ читают веб, мобильное приложение (mobile/app/(tabs)/ai.tsx) и iOS
// (apple/OrdaKit, CfoReport) — старые поля сохранены.

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function parseJsonLoose(text: string): any {
  const tryParse = (s: string) => {
    try {
      return JSON.parse(s)
    } catch {
      return null
    }
  }
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

// Оценка здоровья в старом формате ответа модели — для приложения
function healthForApps(health: CfoHealth) {
  const breakdown: Record<string, number> = {}
  for (const item of health.items) breakdown[item.key] = item.points
  return { score: health.score, band: health.band, breakdown, missing: health.missing }
}

const isISO = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

/**
 * База сравнения. Период с 1-го числа внутри одного месяца (весь месяц или
 * идущий по вчера) сравниваем с теми же днями прошлого месяца: 1–13 сентября
 * против 1–13 августа, сентябрь против всего августа. Отрезок той же длины
 * тут врёт — для сентября это 2–31 августа. Остальное — такой же отрезок
 * сразу перед выбранным.
 */
function previousPeriod(dateFrom: string, dateTo: string): { prevFrom: string; prevTo: string } {
  if (dateFrom.endsWith('-01') && dateFrom.slice(0, 7) === dateTo.slice(0, 7)) {
    const prev = previousCalendarMonthRange(dateFrom)
    const fullMonth = isFullMonthRange(dateFrom, dateTo)
    const day = Number(dateTo.slice(8, 10))
    const prevLastDay = Number(prev.to.slice(8, 10))
    const prevTo = fullMonth ? prev.to : `${prev.from.slice(0, 8)}${String(Math.min(day, prevLastDay)).padStart(2, '0')}`
    return { prevFrom: prev.from, prevTo }
  }
  const { prevFrom, prevTo } = calculatePrevPeriod(dateFrom, dateTo)
  return { prevFrom, prevTo }
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin && !access.staffMember) return json({ error: 'forbidden' }, 403)

    const denied = await requireStaffCapability(access, 'ai-cfo.view')
    if (denied) return denied

    // Платная фича: при ENTITLEMENTS_ENFORCE=true вернёт 402, если не куплена.
    const gate = await requireOrgFeature(access, 'ai.cfo')
    if (gate) return gate

    const ip = getClientIp(request)
    const rl = checkRateLimit(`ai-cfo:${access.user?.id || ip}`, 15, 60_000)
    if (!rl.allowed) return json({ error: 'too-many-requests' }, 429)
    if (!hasAdminSupabaseCredentials()) return json({ error: 'supabase-unavailable' }, 500)

    const body = await request.json().catch(() => ({}))

    // ── Период. Сегодняшние отчёты смен ещё не внесены — период кончается вчера ──
    const yesterday = addDaysISO(kzTodayISO(), -1)
    let dateFrom: string
    let dateTo: string
    if (isISO(body?.dateFrom) && isISO(body?.dateTo) && body.dateFrom <= body.dateTo) {
      dateFrom = body.dateFrom
      dateTo = body.dateTo < yesterday ? body.dateTo : yesterday
      if (dateFrom > dateTo) dateFrom = dateTo
    } else {
      const presetDays = [7, 30, 90, 365].includes(Number(body?.days)) ? Number(body.days) : 90
      dateTo = isISO(body?.dateTo) && body.dateTo < yesterday ? body.dateTo : yesterday
      dateFrom = addDaysISO(dateTo, -(presetDays - 1))
    }
    const { prevFrom, prevTo } = previousPeriod(dateFrom, dateTo)
    const days = Math.round((Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86_400_000) + 1

    const supabase = createAdminSupabaseClient()
    const scope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    if (scope.allowedCompanyIds && scope.allowedCompanyIds.length === 0) return json({ error: 'no-companies' }, 200)

    const companyId = typeof body?.company_id === 'string' && body.company_id ? String(body.company_id) : null
    if (companyId && scope.allowedCompanyIds && !scope.allowedCompanyIds.includes(companyId)) {
      return json({ error: 'forbidden' }, 403)
    }
    const includeExtra = body?.include_extra === true || body?.include_extra === '1'

    let companiesQ = supabase.from('companies').select('id, name, code')
    if (scope.allowedCompanyIds) companiesQ = companiesQ.in('id', scope.allowedCompanyIds)
    const { data: companyRows, error: companiesError } = await companiesQ
    if (companiesError) throw companiesError
    const allCompanies = ((companyRows || []) as Array<{ id: string; name: string | null; code: string | null }>).map((c) => ({
      id: String(c.id),
      name: String(c.name || c.code || '—'),
      code: c.code,
    }))
    const extraIds = new Set(allCompanies.filter(isExtraCompany).map((c) => c.id))
    // Как в /reports: Extra не входит в «все точки», если её не включили явно
    const excluded = (id: string) => (companyId ? id !== companyId : !includeExtra && extraIds.has(id))
    const companies = allCompanies.filter((c) => !excluded(c.id))
    const scopeIds = companyId ? [companyId] : scope.allowedCompanyIds

    // Справочник статей — только своей организации: чужая статья с тем же
    // названием перетёрла бы группу (как в /reports и ОПиУ)
    const orgId = access.activeOrganization?.id || null
    let categoriesQuery: any = supabase.from('expense_categories').select('name, accounting_group')
    if (!access.isSuperAdmin) categoriesQuery = categoriesQuery.eq('organization_id', orgId || '00000000-0000-0000-0000-000000000000')
    else if (orgId) categoriesQuery = categoriesQuery.eq('organization_id', orgId)

    const [incomeRows, expenseRows, categoriesRes] = await Promise.all([
      // День до начала: ночная смена переносит часть безнала за полночь
      fetchAllRows<ReportIncomeCalendarRow>(() => {
        let q = supabase
          .from('incomes')
          .select('id, date, company_id, shift, zone, cash_amount, kaspi_amount, kaspi_before_midnight, online_amount, card_amount')
          .gte('date', addDaysISO(prevFrom, -1))
          .lte('date', dateTo)
          .order('date', { ascending: true })
          .order('id', { ascending: true })
        if (scopeIds) q = q.in('company_id', scopeIds)
        return q
      }),
      fetchAllRows<any>(() => {
        let q = supabase
          .from('expenses')
          .select('id, date, company_id, category, cash_amount, kaspi_amount')
          .gte('date', prevFrom)
          .lte('date', dateTo)
          .order('date', { ascending: true })
          .order('id', { ascending: true })
        if (scopeIds) q = q.in('company_id', scopeIds)
        return q
      }),
      categoriesQuery,
    ])

    const categoryGroups: Record<string, string | null> = {}
    for (const row of ((categoriesRes as any)?.data || []) as Array<{ name: string | null; accounting_group: string | null }>) {
      const key = String(row.name || '').trim().toLowerCase()
      if (key) categoryGroups[key] = row.accounting_group ?? null
    }

    const review = buildCfoReview({
      incomes: (splitIncomeKaspiByCalendarDay(incomeRows) as any[]).filter((r) => !excluded(String(r.company_id))),
      expenses: expenseRows.filter((r) => !excluded(String(r.company_id))),
      categoryGroups,
      companies,
      current: { from: dateFrom, to: dateTo },
      previous: { from: prevFrom, to: prevTo },
    })

    const computed = {
      days,
      dateFrom,
      dateTo,
      prevFrom,
      prevTo,
      companyId,
      includeExtra,
      hasExtra: extraIds.size > 0,
      // Мобильное приложение читает итоги с верхнего уровня
      revenue: review.executive.revenue,
      expense: review.executive.expenses,
      profit: review.executive.profit,
      ...review,
    }

    // ── ИИ: только по явному запросу (веб грузит цифры с ai:false) и по праву ──
    const wantsAi = body?.ai !== false
    let ai: any = null
    if (wantsAi) {
      const generateDenied = await requireStaffCapability(access, 'ai-cfo.generate')
      if (generateDenied) {
        ai = { error: 'Нет права запускать разбор ИИ' }
      } else if (review.executive.revenue === 0 && review.executive.expenses === 0) {
        ai = { error: 'За период нет доходов и расходов — разбирать нечего' }
      } else {
        ai = await runAi(access, computed)
      }
    }

    return json({ ok: true, ...computed, ai })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/ai/cfo.POST', message: error?.message || 'ai cfo error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

async function runAi(access: any, computed: any) {
  const systemPrompt = [
    'Ты — финансовый директор собственника игрового клуба и магазина. Цель — рост чистой прибыли и конкретные действия.',
    '',
    'Тебе дают УЖЕ ПОСЧИТАННЫЙ разбор периода (JSON). Цифры в нём точные — не пересчитывай и не спорь с ними.',
    '- bridge — почему прибыль изменилась к прошлому периоду: строки с effect (+ добавило прибыль, − отняло). Сумма effect = изменение прибыли.',
    '- companies — точки, profitDelta — вклад точки в изменение прибыли.',
    '- costStructure — постоянные/переменные, breakevenRevenue (выручка безубыточности), safetyMarginPct (запас прочности), oneOffExpenses (разовые и оборудование), profitDistribution (выплаты партнёрам — не расход бизнеса).',
    '- fotShare — зарплаты в % выручки. health — оценка здоровья (посчитана, не меняй). dataQuality.gaps — точки с недовнесёнными отчётами.',
    '',
    'ГЛАВНОЕ ПРАВИЛО ДЕНЕГ: любая сумма в ответе — либо число из JSON, либо простой расчёт из чисел JSON, и тогда расчёт пишется рядом («360 000 − 300 000 = 60 000 ₸»). Никаких «≈150 000 ₸/мес» без расчёта. Нечем посчитать — пиши без суммы и помечай ГИПОТЕЗА с тем, что проверить.',
    'Если dataQuality.percent < 80 — начни state с предупреждения, какие точки недовнесли отчёты, и не делай уверенных выводов по ним.',
    'Статусы: ФАКТ — прямо из данных; ОЦЕНКА — расчёт на явном допущении; ГИПОТЕЗА — данных не хватает.',
    'Язык: для собственника, простыми словами, без англицизмов (не «EBITDA», не «CAPEX» — «разовые покупки оборудования»). Без воды.',
    '',
    'Верни СТРОГО валидный JSON без markdown и без тегов в тексте:',
    '{',
    '"state": "2-3 предложения: что с прибылью и главная причина из bridge",',
    '"changes": [{"text": "что изменилось, с цифрами из bridge", "status": "ФАКТ|ОЦЕНКА|ГИПОТЕЗА"}],',
    '"rootCauses": [{"text": "почему — причина за строкой bridge и что проверить", "status": "..."}],',
    '"risks": [{"risk": "...", "probability": "Высокая|Средняя|Низкая", "impact": "Высокое|Среднее|Низкое", "level": "critical|high|medium|low"}],',
    '"losses": [{"text": "где утекают деньги", "amount": "сумма из данных или пусто", "status": "..."}],',
    '"missedProfit": [{"text": "что недозарабатываем", "potential": "только с расчётом, иначе пусто", "status": "..."}],',
    '"opportunities": [{"title": "...", "action": "что сделать", "effect": "только с расчётом, иначе пусто", "status": "..."}],',
    '"actionPlan": {"today": ["..."], "week": ["..."], "month": ["..."]},',
    '"summary": {"where_losing": "...", "where_earn": "...", "main_risk": "...", "main_opportunity": "...", "extra_profit": "сумма с расчётом или пусто", "three_actions": ["...","...","..."]}',
    '}',
    'Объём: 3-5 изменений, 2-4 причины, 2-4 риска, до 3 потерь, до 3 упущенных, 2-4 возможности. Русский.',
  ].join('\n')

  const messages: AiMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Разбор за ${computed.dateFrom} — ${computed.dateTo} против ${computed.prevFrom} — ${computed.prevTo}:\n\n${JSON.stringify(computed)}`,
    },
  ]

  try {
    const result = await generateAiText({ model: OPENAI_MODEL, maxTokens: 8000, messages })
    await logAiUsageSafe(access.supabase, {
      userId: access.user?.id || null,
      endpoint: '/api/ai/cfo',
      provider: result.provider,
      model: result.model,
      usage: result.usage,
    })
    const ai = parseJsonLoose(result.text)
    if (!ai || typeof ai !== 'object' || (!ai.state && !ai.summary && !ai.changes)) {
      return { error: 'Ответ ИИ не распознан. Цифры посчитаны верно — попробуйте ещё раз.' }
    }
    // Оценка здоровья — формула кода, а не мнение модели; прогноз живёт в /analysis
    ai.healthScore = healthForApps(computed.health)
    ai.forecast = null
    ai.scenarios = []
    return ai
  } catch (e: any) {
    return { error: e?.message || 'ИИ недоступен' }
  }
}
