import { NextResponse } from 'next/server'

import { generateAiText, type AiMessage } from '@/lib/ai/provider'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { resolveCompanyScope } from '@/lib/server/organizations'

// AI Разбор расходов: код считает точные цифры по категориям (текущий vs предыдущий
// период), а AI даёт разбор — где утекают деньги, что выросло аномально, что урезать.

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
const n = (v: any) => Number(v || 0)
const expenseOf = (r: any) => n(r.cash_amount) + n(r.kaspi_amount)
const pct = (cur: number, prev: number) => (!prev ? (cur ? 100 : 0) : ((cur - prev) / Math.abs(prev)) * 100)
const r0 = (v: number) => Math.round(v)
const r1 = (v: number) => Math.round(v * 10) / 10

type Insight = { verdict: string; reason: string; action: string; severity: 'high' | 'medium' | 'low' }

function canView(access: any) {
  return Boolean(access?.isSuperAdmin || access?.staffMember || access?.staffRole)
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canView(access)) return json({ error: 'forbidden' }, 403)

    const ip = getClientIp(request)
    const rl = checkRateLimit(`ai-expense-analysis:${access.user?.id || ip}`, 15, 60_000)
    if (!rl.allowed) return json({ error: 'too-many-requests' }, 429)
    if (!hasAdminSupabaseCredentials()) return json({ error: 'supabase-unavailable' }, 500)

    const url = new URL(request.url)
    const companyParam = url.searchParams.get('company_id')
    const fromParam = url.searchParams.get('from')
    const toParam = url.searchParams.get('to')

    const isISODate = (s: string | null): s is string => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s))

    let days: number
    let dateFrom: string
    let dateTo: string

    // Свой период: если заданы обе даты (валидны и from <= to) — берём их как текущий период.
    if (isISODate(fromParam) && isISODate(toParam) && fromParam <= toParam) {
      dateFrom = fromParam
      dateTo = toParam
      // Длина периода в днях (включительно): кол-во дней от from до to.
      const [fy, fm, fd] = dateFrom.split('-').map(Number)
      const [ty, tm, td] = dateTo.split('-').map(Number)
      const msPerDay = 86_400_000
      const diffDays = Math.round((Date.UTC(ty, (tm || 1) - 1, td || 1) - Date.UTC(fy, (fm || 1) - 1, fd || 1)) / msPerDay)
      days = Math.max(1, diffDays + 1)
    } else {
      const daysRaw = Number(url.searchParams.get('days'))
      days = [30, 90, 180, 365].includes(daysRaw) ? daysRaw : 90
      dateTo = todayISO()
      dateFrom = addDaysISO(dateTo, -(days - 1))
    }

    // Предыдущий период такой же длины — непосредственно перед dateFrom.
    const prevTo = addDaysISO(dateFrom, -1)
    const prevFrom = addDaysISO(prevTo, -(days - 1))

    const supabase = createAdminSupabaseClient()
    const scope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    // Скоуп по орг: company_id из запроса обязан быть в allowedCompanyIds (если не superadmin).
    let companyFilter: string[] | null = null // null = не фильтровать по конкретной точке
    if (companyParam) {
      if (scope.allowedCompanyIds && !scope.allowedCompanyIds.includes(companyParam)) {
        return json({ error: 'forbidden' }, 403)
      }
      companyFilter = [companyParam]
    } else if (scope.allowedCompanyIds) {
      if (scope.allowedCompanyIds.length === 0) {
        return json({ ok: true, metrics: { categories: [], total: 0, totalPrevPct: 0 }, insights: [], summary: '' }, 200)
      }
      companyFilter = scope.allowedCompanyIds
    }

    // Полная постраничная выборка (расходов много — мелкие траты).
    const PAGE = 1000
    const expenseRows: any[] = []
    let from = 0
    for (;;) {
      let q = supabase
        .from('expenses')
        .select('id, date, company_id, category, cash_amount, kaspi_amount')
        .gte('date', prevFrom)
        .lte('date', dateTo)
        .order('date', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
      if (companyFilter) q = q.in('company_id', companyFilter)
      const { data, error } = await q
      if (error) throw error
      const batch = data || []
      expenseRows.push(...batch)
      if (batch.length < PAGE) break
      from += PAGE
    }

    // Агрегация по категориям: текущий / предыдущий период.
    const catCur = new Map<string, number>()
    const catPrev = new Map<string, number>()
    let total = 0
    let totalPrev = 0
    for (const row of expenseRows) {
      const v = expenseOf(row)
      if (!v) continue
      const cat = String(row.category || 'Прочее')
      const isCur = String(row.date) >= dateFrom
      if (isCur) {
        catCur.set(cat, (catCur.get(cat) || 0) + v)
        total += v
      } else {
        catPrev.set(cat, (catPrev.get(cat) || 0) + v)
        totalPrev += v
      }
    }

    const allCats = new Set<string>([...catCur.keys(), ...catPrev.keys()])
    const categories = Array.from(allCats)
      .map((cat) => {
        const cur = catCur.get(cat) || 0
        const prev = catPrev.get(cat) || 0
        return {
          category: cat,
          amount: r0(cur),
          prev: r0(prev),
          sharePct: r1(total ? (cur / total) * 100 : 0),
          changePct: r1(pct(cur, prev)),
        }
      })
      .filter((c) => c.amount > 0 || c.prev > 0)
      .sort((a, b) => b.amount - a.amount)

    const totalPrevPct = r1(pct(total, totalPrev))

    // Топ-категории (по текущей сумме) и аномалии (резкий рост, заметные суммы).
    const topCategories = categories.filter((c) => c.amount > 0).slice(0, 8)
    const anomalies = categories
      .filter((c) => c.amount >= 1000 && c.changePct >= 40 && c.amount - c.prev > 0)
      .sort((a, b) => b.amount - b.prev - (a.amount - a.prev))
      .slice(0, 6)
      .map((c) => ({ category: c.category, amount: c.amount, prev: c.prev, changePct: c.changePct, deltaAbs: r0(c.amount - c.prev) }))

    const metrics = { categories, total: r0(total), totalPrevPct }

    // Без AI-ключа — мягко вернём метрики без insights.
    if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
      return json({ ok: true, metrics, insights: [], summary: '' }, 200)
    }

    const compact = {
      days,
      dateFrom,
      dateTo,
      total: r0(total),
      totalPrev: r0(totalPrev),
      totalChangePct: totalPrevPct,
      topCategories: topCategories.map((c) => ({ name: c.category, amount: c.amount, prev: c.prev, sharePct: c.sharePct, changePct: c.changePct })),
      anomalies,
    }

    const systemPrompt =
      'Ты финансовый аналитик. По расходам клуба дай разбор: 1) где утекают деньги (топ-категории), 2) что выросло аномально, 3) что можно урезать, 4) 2-3 конкретных действия. По-русски, по делу. Верни СТРОГО JSON: {"insights":[{"verdict":"...","reason":"...","action":"...","severity":"high|medium|low"}], "summary":"одна фраза"}'

    const messages: AiMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Расходы за ${days} дней (${dateFrom} — ${dateTo}) против предыдущего такого же периода. Цифры точные, посчитаны кодом:\n\n${JSON.stringify(compact)}\n\nДай разбор в JSON.`,
      },
    ]

    let insights: Insight[] = []
    let summary = ''
    try {
      const result = await generateAiText({ model: OPENAI_MODEL, maxTokens: 1500, messages })
      const match = String(result.text || '').match(/\{[\s\S]*\}/)
      if (match) {
        const parsed = JSON.parse(match[0])
        if (Array.isArray(parsed?.insights)) {
          insights = parsed.insights
            .filter((x: any) => x && (x.verdict || x.action))
            .map((x: any) => ({
              verdict: String(x.verdict || ''),
              reason: String(x.reason || ''),
              action: String(x.action || ''),
              severity: ['high', 'medium', 'low'].includes(x.severity) ? x.severity : 'medium',
            }))
        }
        if (typeof parsed?.summary === 'string') summary = parsed.summary
      }
    } catch {
      // AI недоступен — отдаём метрики без insights.
    }

    return json({ ok: true, metrics, insights, summary }, 200)
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
