import { NextResponse } from 'next/server'

import { logAiUsageSafe } from '@/lib/ai/usage-tracker'
import { generateAiText, type AiMessage } from '@/lib/ai/provider'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { computeStoreInsights } from '@/lib/server/store-insights'

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageStore(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || !!access.staffRole
}

// Компактный текстовый дайджест бакета для промпта (без сырых дампов).
function digestProducts(rows: Array<{ name: string; [k: string]: any }>, fmt: (r: any) => string, limit = 8) {
  return rows.slice(0, limit).map((r) => `${r.name}: ${fmt(r)}`).join('; ')
}
const m = (v: number) => `${Math.round(v || 0).toLocaleString('ru-RU')}₸`

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)

    const ip = getClientIp(request)
    const rl = checkRateLimit(`ai-store-insights:${access.user?.id || ip}`, 15, 60_000)
    if (!rl.allowed) return json({ error: 'too-many-requests' }, 429)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const scope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const url = new URL(request.url)
    const days = [7, 30, 90].includes(Number(url.searchParams.get('days')))
      ? Number(url.searchParams.get('days'))
      : 30

    const metrics = await computeStoreInsights(supabase as any, {
      organizationId: access.activeOrganization?.id || null,
      allowedCompanyIds: scope.allowedCompanyIds,
      isSuperAdmin: access.isSuperAdmin,
      days,
    })

    // Нет ключа AI — мягко вернём цифры без вердикта.
    if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
      return json({ ok: true, metrics, aiText: null })
    }

    // Компактный промпт: только итоги + топы по бакетам.
    const t = metrics.totals
    const lines: string[] = [
      `Период: ${metrics.days} дней.`,
      `Итоги: выручка ${m(t.totalRevenue)}, валовая прибыль ${m(t.totalProfit)}, заморожено в мёртвом грузе ${m(t.deadStockValue)} (${t.skuDead} позиций), потери (списания/инвентаризация) ${m(t.lossesValue)}.`,
      '',
      `ТОП по прибыли: ${digestProducts(metrics.topProfit, (r) => `прибыль ${m(r.profit)}, маржа ${r.marginPct}%, продано ${r.soldQty}`)}`,
      '',
      `МЁРТВЫЙ ГРУЗ (есть остаток, 0 продаж): ${
        metrics.deadStock.length
          ? digestProducts(metrics.deadStock, (r) => `${m(r.stockValue)} заморожено (${r.stock} шт)`)
          : 'нет'
      }`,
      '',
      `МЕДЛЕННЫЕ + НИЗКАЯ МАРЖА: ${
        metrics.slowLowMargin.length
          ? digestProducts(metrics.slowLowMargin, (r) => `маржа ${r.marginPct}%, ${r.velocityPerWeek}/нед`)
          : 'нет'
      }`,
      '',
      `РАСТУТ: ${metrics.trending.rising.length ? digestProducts(metrics.trending.rising, (r) => `+${r.trendPct}%`) : 'нет'}`,
      `ПАДАЮТ: ${metrics.trending.falling.length ? digestProducts(metrics.trending.falling, (r) => `${r.trendPct}%`) : 'нет'}`,
      '',
      `ПОТЕРИ: ${
        metrics.losses.rows.length
          ? digestProducts(metrics.losses.rows, (r) => `${m(r.lossValue)} (${r.qty} шт)`)
          : 'нет'
      }`,
    ]

    const systemPrompt =
      'Ты опытный товаровед-аналитик. По данным дай КОРОТКИЙ разбор: 1) что приносит деньги (1-2 фразы), 2) мёртвый груз — сколько ₸ заморожено и что распродать, 3) потери/аномалии, 4) 2-3 конкретных действия. По-русски, по делу, без воды. Не выдумывай цифры — бери только из данных. Деньги — целые ₸.'

    const messages: AiMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: lines.join('\n') },
    ]

    let aiText: string | null = null
    try {
      const result = await generateAiText({ messages, maxTokens: 1200 })
      aiText = result.text
      await logAiUsageSafe(access.supabase, {
        userId: access.user?.id || null,
        endpoint: '/api/ai/store-insights',
        provider: result.provider,
        model: result.model,
        usage: result.usage,
      })
    } catch {
      aiText = null
    }

    return json({ ok: true, metrics, aiText })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/ai/store-insights.GET',
      message: error?.message || 'Store insights GET error',
    })
    return json({ error: error?.message || 'Не удалось построить разбор магазина' }, 500)
  }
}
