import { NextResponse } from 'next/server'

import { logAiUsageSafe } from '@/lib/ai/usage-tracker'
import { generateAiText, type AiMessage } from '@/lib/ai/provider'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { computeBusinessIntelligence } from '@/lib/server/business-intelligence'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { requireAddon } from '@/lib/server/entitlements'
import { requireCapability } from '@/lib/server/capabilities'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canView(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || !!access.staffRole
}

const m = (v: number) => `${Math.round(v || 0).toLocaleString('ru-RU')}₸`

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const addonDenied = await requireAddon(access, 'addon.ai')
    if (addonDenied) return addonDenied
    if (!canView(access)) return json({ error: 'forbidden' }, 403)
    // То же право, что у самих данных страницы: ИИ пересказывает их целиком
    const denied = await requireCapability(access, 'analytics.view')
    if (denied) return denied as any

    const ip = getClientIp(request)
    const rl = checkRateLimit(`ai-business-intelligence:${access.user?.id || ip}`, 15, 60_000)
    if (!rl.allowed) return json({ error: 'too-many-requests' }, 429)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const body = (await request.json().catch(() => ({}))) as { company_id?: string | null; days?: number | null; from?: string | null; to?: string | null }
    const companyId = String(body?.company_id || '').trim() || null
    if (companyId && companyScope.allowedCompanyIds && !companyScope.allowedCompanyIds.includes(companyId)) {
      return json({ error: 'forbidden' }, 403)
    }
    const days = Number(body?.days) || null
    // Произвольный период (мягкая валидация формата; движок проверит окончательно).
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
    const fromRaw = String(body?.from || '').trim()
    const toRaw = String(body?.to || '').trim()
    const from = DATE_RE.test(fromRaw) ? fromRaw : null
    const to = DATE_RE.test(toRaw) ? toRaw : null

    const data = await computeBusinessIntelligence(supabase, {
      organizationId: access.activeOrganization?.id || null,
      allowedCompanyIds: companyScope.allowedCompanyIds,
      isSuperAdmin: access.isSuperAdmin,
      companyId,
      days,
      from,
      to,
    })

    // Нет ключа AI — мягко.
    if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
      return json({ ok: false })
    }

    // ── Компактная сводка разделов страницы для промпта ───────────────────────
    const lines: string[] = [`Период: ${data.anomalies.from} — ${data.anomalies.to}.`]

    if (data.restock.lines.length) {
      lines.push(
        `Заказать (план закупа на 2 недели): ${data.restock.itemsCount} товаров на ${m(data.restock.totalAmount)}; кончатся за 3 дня: ${data.restock.urgentCount}. ` +
          data.restock.lines
            .slice(0, 8)
            .map((l) => `${l.name} (${l.company}; остаток ${l.stock}, ${l.daysLeft === 0 ? 'уже нет' : `хватит на ${l.daysLeft} дн`}; взять ${l.order} шт на ${m(l.amount)})`)
            .join('; '),
      )
    } else if (data.hasStore) {
      lines.push('Заказывать ничего не нужно: всего хватает на 2 недели.')
    }

    if (data.idleStock.noSalesCount) {
      lines.push(
        `Без единой продажи за период: ${data.idleStock.noSalesCount} товаров, заморожено ${m(data.idleStock.noSalesValue)}: ` +
          data.idleStock.noSales.slice(0, 6).map((r) => `${r.name} (${m(r.value)})`).join('; '),
      )
    }
    if (data.idleStock.overstock.length) {
      lines.push(
        `Затоварено (запаса больше чем на 4 недели) на ${m(data.idleStock.overstockValue)}: ` +
          data.idleStock.overstock.slice(0, 5).map((r) => `${r.name} (хватит на ${r.weeksLeft} нед)`).join('; '),
      )
    }

    if (data.anomalies.anomalies.length) {
      lines.push(
        `Странные дни выручки (сравнение с обычным днём той же недели): ` +
          data.anomalies.anomalies
            .slice(0, 5)
            .map((a) => `${a.company} ${a.date}: ${m(a.revenue)} при обычных ${m(a.expected)} (${a.deviation > 0 ? '+' : ''}${Math.round(a.deviation * 100)}%)`)
            .join('; '),
      )
    }

    if (data.cashierRisk.available && data.cashierRisk.rows.length) {
      lines.push(
        `Недостачи по ревизиям (${data.cashierRisk.actsAnalyzed} ревизий, всего ${m(data.cashierRisk.totalShortage)}): ` +
          data.cashierRisk.rows
            .filter((r) => r.shortageAmount > 0)
            .slice(0, 5)
            .map((r) => `${r.cashier} — ${m(r.shortageAmount)}, недостача в ${r.shortfallEvents} из ${r.totalEvents} ревизий`)
            .join('; '),
      )
    }

    if (data.rfm.atRisk.length) {
      lines.push(
        `Постоянные клиенты, которые давно не приходили: ` +
          data.rfm.atRisk.slice(0, 5).map((c) => `${c.name} (потратил ${m(c.monetary)}, не был ${c.recencyDays >= 9999 ? 'давно' : `${c.recencyDays} дн`})`).join('; '),
      )
    }

    const systemPrompt =
      'Ты опытный управляющий игрового клуба и магазина. По данным дай 3-5 КОНКРЕТНЫХ действий на сегодня в порядке важности: что заказать, что распродать или не брать, какой день выручки проверить, с кем из сотрудников разобраться по недостачам, кого из клиентов вернуть. Каждое действие — одна короткая строка с названием и цифрой. По-русски, простыми словами, без терминов. Не выдумывай — бери только из данных. Верни просто список строк, без нумерации и заголовков.'

    const messages: AiMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: lines.join('\n') },
    ]

    let actions: string[] = []
    try {
      const result = await generateAiText({ messages, maxTokens: 3000 })
      actions = String(result.text || '')
        .split('\n')
        .map((s) => s.replace(/^\s*(?:\d+[.)]|[-•*👉▶►])\s*/, '').trim())
        .filter((s) => s.length > 0)
      await logAiUsageSafe(access.supabase, {
        userId: access.user?.id || null,
        endpoint: '/api/ai/business-intelligence',
        provider: result.provider,
        model: result.model,
        usage: result.usage,
      })
    } catch {
      return json({ ok: false })
    }

    if (actions.length === 0) return json({ ok: false })

    return json({ ok: true, actions: actions.slice(0, 6) })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/ai/business-intelligence.POST',
      message: error?.message || 'BI insights POST error',
    })
    return json({ ok: false, error: error?.message || 'Не удалось построить сводку' }, 500)
  }
}
