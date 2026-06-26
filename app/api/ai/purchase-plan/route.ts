import { NextResponse } from 'next/server'

import { generateAiText, type AiMessage } from '@/lib/ai/provider'
import { logAiUsageSafe } from '@/lib/ai/usage-tracker'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { computePurchasePlan } from '@/lib/server/purchase-plan'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canView(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || !!access.staffRole
}

const fmtMoney = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canView(access)) return json({ error: 'forbidden' }, 403)

    const body = await request.json().catch(() => ({}))
    const companyId = String(body?.company_id || '').trim()
    if (!companyId) return json({ error: 'company_id обязателен' }, 400)

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    if (companyScope.allowedCompanyIds && !companyScope.allowedCompanyIds.includes(companyId)) {
      return json({ error: 'forbidden' }, 403)
    }

    if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
      // Мягкий ответ — без AI ключа фича просто недоступна.
      return json({ ok: false, error: 'ai-unavailable' })
    }

    const ip = getClientIp(request)
    const rl = checkRateLimit(`ai-purchase-plan:${access.user?.id || ip}`, 15, 60_000)
    if (!rl.allowed) return json({ error: 'too-many-requests' }, 429)

    if (!hasAdminSupabaseCredentials()) return json({ error: 'supabase-unavailable' }, 500)
    const supabase = createAdminSupabaseClient()

    const plan = await computePurchasePlan(supabase, companyId)

    // Топ-позиции по сумме закупа (срез для промпта).
    const allLines = plan.bySupplier.flatMap((g) =>
      g.items.map((it) => ({ ...it, supplier: g.supplier })),
    )
    const topByAmount = [...allLines].sort((a, b) => b.amount - a.amount).slice(0, 12)
    const topByTrend = [...allLines]
      .filter((it) => it.trendPct >= 25)
      .sort((a, b) => b.trendPct - a.trendPct)
      .slice(0, 6)

    const weeklyRevenue = plan.revenue4wPerWeek
    const sharePct = weeklyRevenue > 0 ? Math.round((plan.total / weeklyRevenue) * 100) : null

    const computed = {
      weekStart: plan.weekStart,
      total: Math.round(plan.total),
      suppliers: plan.bySupplier.length,
      positions: allLines.length,
      revenueLast7Days: Math.round(weeklyRevenue),
      planSharePctOfWeekRevenue: sharePct,
      bySupplierTotals: plan.bySupplier.map((g) => ({ supplier: g.supplier, total: Math.round(g.total), positions: g.items.length })),
      topByAmount: topByAmount.map((it) => ({
        name: it.name,
        supplier: it.supplier,
        weeklyDemand: it.weeklyDemand,
        stock: it.stock,
        order: it.order,
        unitCost: Math.round(it.unitCost),
        amount: Math.round(it.amount),
        trendPct: it.trendPct,
      })),
      rising: topByTrend.map((it) => ({ name: it.name, trendPct: it.trendPct, order: it.order })),
    }

    const systemPrompt = [
      'Ты — закупщик-аналитик торговой точки в системе Orda. Цель — чтобы не было дефицита ходовых товаров и одновременно не замораживать деньги на складе.',
      'Тебе дают УЖЕ ПОСЧИТАННЫЙ план закупа на следующую неделю (запас на 2 недели). Цифры точные — НЕ пересчитывай их.',
      'Дай КОРОТКИЙ вердикт для владельца (5–8 предложений, простой язык, без воды):',
      '1) Общий итог закупа в ₸ и доля от выручки последней недели (если дана) — норма это или много.',
      '2) Что брать в первую очередь (1–3 позиции с растущим спросом или большой суммой).',
      '3) Где можно сэкономить / не брать лишнего (если видно по данным).',
      '4) Один практический совет.',
      'Деньги — целые ₸ с разделителями. Не выдумывай товары и числа, которых нет в данных. Только русский язык. Без markdown-заголовков, обычный текст.',
    ].join('\n')

    const messages: AiMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content:
          `План закупа на неделю с ${plan.weekStart}. Итог: ${fmtMoney(plan.total)}` +
          (sharePct != null ? ` (≈${sharePct}% от выручки прошлой недели ${fmtMoney(weeklyRevenue)})` : '') +
          `.\n\nДанные (JSON):\n${JSON.stringify(computed)}\n\nДай короткий вердикт.`,
      },
    ]

    try {
      const result = await generateAiText({ messages, temperature: 0.4, maxTokens: 700 })
      await logAiUsageSafe(access.supabase, {
        userId: access.user?.id || null,
        endpoint: '/api/ai/purchase-plan',
        provider: result.provider,
        model: result.model,
        usage: result.usage,
      })
      return json({ ok: true, text: result.text })
    } catch (e: any) {
      return json({ ok: false, error: e?.message || 'AI недоступен' })
    }
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
