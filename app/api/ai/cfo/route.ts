import { NextResponse } from 'next/server'

import { logAiUsageSafe } from '@/lib/ai/usage-tracker'
import { generateAiText, type AiMessage } from '@/lib/ai/provider'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { resolveFinancialGroup } from '@/lib/core/financial-groups'

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

    // Полная постраничная выборка (как reports/bundle) — БЕЗ обрезки на 10k строк.
    // У расходов записей много (мелкие траты), поэтому range(0,9999) их сильно занижал.
    const PAGE = 1000
    const fetchAll = async (table: 'incomes' | 'expenses', columns: string) => {
      const all: any[] = []
      let from = 0
      for (;;) {
        let q = supabase
          .from(table)
          .select(columns)
          .gte('date', prevFrom)
          .lte('date', dateTo)
          .order('date', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1)
        if (scope.allowedCompanyIds) q = q.in('company_id', scope.allowedCompanyIds)
        const { data, error } = await q
        if (error) throw error
        const batch = data || []
        all.push(...batch)
        if (batch.length < PAGE) break
        from += PAGE
      }
      return all
    }

    const [companiesR, catsR, incomeRows, expenseRows] = await Promise.all([
      companiesQ,
      supabase.from('expense_categories').select('name, accounting_group'),
      fetchAll('incomes', 'id, date, company_id, cash_amount, kaspi_amount, online_amount, card_amount'),
      fetchAll('expenses', 'id, date, company_id, category, cash_amount, kaspi_amount'),
    ])
    if (companiesR.error) throw companiesR.error

    const companies = (companiesR.data || []) as any[]
    const catGroup = new Map<string, string>(
      (((catsR as any)?.data || []) as any[]).map((c) => [String(c.name || '').toLowerCase(), String(c.accounting_group || '')]),
    )
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
    const salesDays = new Set<string>()
    const expenseDays = new Set<string>()
    const FOT_KEYS = ['зарплат', 'оклад', 'фот', 'преми', 'бонус', 'salary', ' зп']
    let fotCur = 0
    let varExpCur = 0, fixExpCur = 0, capexCur = 0, taxCur = 0, distCur = 0

    for (const row of incomeRows) {
      const v = incomeOf(row)
      if (!v) continue
      const cur = String(row.date) >= dateFrom
      const a = ensure(String(row.company_id))
      if (cur) { a.revCur += v; revCur += v; salesDays.add(String(row.date)) } else { a.revPrev += v; revPrev += v }
    }
    for (const row of expenseRows) {
      const v = expenseOf(row)
      if (!v) continue
      const cur = String(row.date) >= dateFrom
      const a = ensure(String(row.company_id))
      const cat = String(row.category || 'Прочее')
      if (cur) {
        a.expCur += v; expCur += v; catCur.set(cat, (catCur.get(cat) || 0) + v); expenseDays.add(String(row.date))
        const lc = cat.toLowerCase()
        if (FOT_KEYS.some((k) => lc.includes(k))) fotCur += v
        const grp = resolveFinancialGroup(cat, catGroup.get(lc) || null)
        if (grp === 'cogs' || grp === 'pos_commission') varExpCur += v
        else if (grp === 'capex') capexCur += v
        else if (grp === 'profit_distribution') distCur += v
        else if (grp === 'income_tax') taxCur += v
        else fixExpCur += v
      } else { a.expPrev += v; expPrev += v; catPrev.set(cat, (catPrev.get(cat) || 0) + v) }
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

    const salesCompleteness = days ? Math.min(100, (salesDays.size / days) * 100) : 0
    const expenseCompleteness = days ? Math.min(100, (expenseDays.size / days) * 100) : 0
    const dataQuality = {
      percent: Math.round((salesCompleteness + expenseCompleteness) / 2),
      daysInPeriod: days,
      daysWithSales: salesDays.size,
      salesCompleteness: r1(salesCompleteness),
      daysWithExpenses: expenseDays.size,
      expenseCompleteness: r1(expenseCompleteness),
    }
    const fotShare = revCur ? (fotCur / revCur) * 100 : 0
    const topRev = companyRows.length ? Math.max(...companyRows.map((c) => c.revenue)) : 0
    const concentrationPct = revCur ? r1((topRev / revCur) * 100) : 0

    // Структура затрат → безубыточность и запас прочности (постоянные/переменные = группы P&L)
    const contributionMargin = revCur - varExpCur
    const contributionRate = revCur ? contributionMargin / revCur : 0
    const breakevenRevenue = contributionRate > 0 ? fixExpCur / contributionRate : 0
    const safetyMarginPct = revCur && breakevenRevenue ? ((revCur - breakevenRevenue) / revCur) * 100 : 0
    const costStructure = {
      variableExpenses: r0(varExpCur),
      fixedExpenses: r0(fixExpCur),
      capex: r0(capexCur),
      incomeTax: r0(taxCur),
      profitDistribution: r0(distCur),
      contributionRatePct: r1(contributionRate * 100),
      breakevenRevenue: r0(breakevenRevenue),
      safetyMarginPct: r1(safetyMarginPct),
      operatingProfit: r0(revCur - varExpCur - fixExpCur),
    }

    const computed = {
      days, dateFrom, dateTo, prevFrom, prevTo,
      executive,
      fot: r0(fotCur),
      fotShare: r1(fotShare),
      concentrationPct,
      costStructure,
      companies: companyRows,
      ranking,
      expenseChanges: changes,
      dataQuality,
    }

    // ---- AI анализ (режим AUDIT) ----
    const systemPrompt = [
      'Ты — AI CFO платформы Orda Control: цифровой финансовый директор собственника. Система поддержки управленческих решений, не бухгалтер и не коуч. Цель — рост ЧИСТОЙ ПРИБЫЛИ, снижение рисков, поиск потерь и упущенной прибыли, доведение анализа до конкретного действия.',
      '',
      'ГЛАВНЫЙ ПРИНЦИП: никогда не выдумывай цифры. Каждое число — либо из данных, либо явная оценка с допущением. Честный вывод важнее впечатляющего. Если за числом нет вычисления — его не должно быть в ответе.',
      '',
      'СТАТУСЫ (помечай каждое утверждение): [ФАКТ] — из данных; [ОЦЕНКА] — расчёт на допущении (допущение указать); [ГИПОТЕЗА] — данных не хватает, не подставляй числа, скажи что проверить. Любой прогноз ≥ [ОЦЕНКА]. Деньги — целые ₸, проценты — 1 знак.',
      '',
      'ТОН: для собственника, простой язык, термины — с расшифровкой. Без воды и лозунгов. Плохие новости — прямо, но с тем, что делать.',
      '',
      'ФОРМУЛЫ (применяй к данным; чего нет — [ГИПОТЕЗА], не выдумывай): Прибыль=Выручка−Расходы; Маржа%=Прибыль/Выручка×100; Доля ФОТ%=ФОТ/Выручка (дано fotShare; ориентир услуги/клубы 15–25%, общепит 25–35%); Точка безубыточности и Запас прочности ДАНЫ в costStructure (breakevenRevenue, safetyMarginPct; постоянные fixedExpenses/переменные variableExpenses) — это [ФАКТ], используй их; costStructure.operatingProfit — операц. прибыль до CAPEX/налога, costStructure.capex — разовые вложения: ОБЪЯСНИ, почему чистая прибыль ниже операционной (разовые/инвестиц. статьи); EBITDA — амортизации нет → реальная прибыль ниже на износ [ГИПОТЕЗА]; Концентрация (дано concentrationPct) >30% = риск зависимости; деньги≠прибыль, runway только при убытке; Темп роста — дельты даны.',
      '',
      'HEALTH SCORE (0–100, это [ФАКТ] из метрик; ВСЕГДА показывай разбивку). Компоненты: Рентабельность(25): запас прочности + тренд маржи. Деньги(25): денежный поток + runway + дебиторка. Риски(20): концентрация (concentrationPct: <20%→12, 20–35%→8, 35–50%→4, >50%→0) + долг. Динамика(20): тренд выручки + тренд прибыли (по дельтам). Данные(10)=dataQuality.percent×0,1. Если компонента нет данных — ИСКЛЮЧИ его, пересчитай по доступным и укажи в "missing". Итог: ≥80 healthy, 60–79 attention, <60 problem.',
      '',
      'КАЧЕСТВО ДАННЫХ: бери dataQuality.percent. ≥90 надёжно; 70–89 есть пробелы (перечисли, ограничь выводы); <70 ненадёжно — глубокий анализ не делай.',
      '',
      'ПОТЕРИ vs УПУЩЕННАЯ ПРИБЫЛЬ — разделяй. ПОТЕРИ (деньги утекают): раздутые расходы, убыточные направления, простаивающие активы, избыточный ФОТ — сумма с расчётом, [ФАКТ] если из данных. УПУЩЕННАЯ ПРИБЫЛЬ (не захватываешь): простой мощности, низкая маржа, недопродажи — реалистичный достижимый прирост, [ОЦЕНКА]/[ГИПОТЕЗА]. НЕ раздувай упущенную прибыль.',
      '',
      'КОРНЕВОЙ АНАЛИЗ: не останавливайся на первом уровне (что→почему→корневая причина→последствие→действие). Нет причины в данных → [ГИПОТЕЗА] + что проверить.',
      'ПРОГНОЗ — полоса уверенности (НЕ выдуманный %): high ≥90 дн и стабильно; medium 30–89 дн или аномалия; low <30 дн или волатильность.',
      'ЗАПРЕЩЕНО: выдумывать цифры, гарантировать результат, выдавать гипотезу за факт, скрывать риски, раздувать эффект, число без расчёта.',
      '',
      'Тебе дают УЖЕ ПОСЧИТАННЫЕ точные цифры (JSON, [ФАКТ]). НЕ пересчитывай их. Верни СТРОГО валидный JSON без markdown (в текстах ставь статус-теги):',
      '{',
      '"state": "состояние бизнеса 2-3 предложения",',
      '"healthScore": {"score": 0-100, "band": "healthy|attention|problem", "breakdown": {"profitability": n, "money": n, "risks": n, "dynamics": n, "data": n}, "missing": ["компоненты без данных"]},',
      '"dataQuality": {"percent": n, "band": "high|medium|low", "notes": ["..."], "limitations": ["..."]},',
      '"changes": [{"text": "с цифрами", "status": "ФАКТ|ОЦЕНКА|ГИПОТЕЗА"}],',
      '"rootCauses": [{"text": "...", "status": "..."}],',
      '"risks": [{"risk": "...", "probability": "Высокая|Средняя|Низкая", "impact": "Высокое|Среднее|Низкое", "level": "critical|high|medium|low"}],',
      '"losses": [{"text": "что утекает", "amount": "сумма ₸/мес", "status": "..."}],',
      '"missedProfit": [{"text": "что недозарабатываем", "potential": "потенциал ₸/мес", "status": "..."}],',
      '"opportunities": [{"title": "...", "action": "...", "effect": "финэффект ₸/мес", "status": "..."}],',
      '"forecast": {"band": "high|medium|low", "text": "прогноз прибыли на 30 дней [ОЦЕНКА]", "warning": "или null"},',
      '"actionPlan": {"today": ["..."], "week": ["..."], "month": ["..."]},',
      '"summary": {"where_losing": "...", "where_earn": "...", "main_risk": "...", "main_opportunity": "...", "extra_profit": "₸", "three_actions": ["...","...","..."]}',
      '}',
      'Правила: 3-6 изменений, 2-4 причины, 3-5 рисков, 2-4 потери, 2-4 упущенных, 3-5 возможностей. Показывай расчёт. Конкретика и цифры. Русский.',
    ].join('\n')

    const messages: AiMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Посчитанные финансы [ФАКТ] за ${days} дней (${dateFrom} — ${dateTo}), сравнение с предыдущим периодом такой же длины:\n\n${JSON.stringify(computed)}\n\nСделай полный аудит (AUDIT) в JSON по структуре. Health Score обязателен с разбивкой.` },
    ]

    let ai: any = null
    try {
      const result = await generateAiText({ model: OPENAI_MODEL, maxTokens: 8000, messages })
      await logAiUsageSafe(access.supabase, { userId: access.user?.id || null, endpoint: '/api/ai/cfo', provider: result.provider, model: result.model, usage: result.usage })
      ai = parseJsonLoose(result.text)
      // Если AI вернул не-JSON (или обрезался) — НЕ вываливаем сырой текст на экран.
      if (!ai || typeof ai !== 'object' || (!ai.state && !ai.summary && !ai.changes)) {
        ai = { error: 'Ответ AI не распознан (возможно, слишком длинный). Цифры посчитаны верно — обновите страницу.' }
      }
    } catch (e: any) {
      ai = { error: e?.message || 'AI недоступен' }
    }

    return json({ ok: true, ...computed, ai })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
