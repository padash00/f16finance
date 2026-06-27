import { NextResponse } from 'next/server'

import { logAiUsageSafe } from '@/lib/ai/usage-tracker'
import { generateAiText, type AiMessage } from '@/lib/ai/provider'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { computeBusinessIntelligence } from '@/lib/server/business-intelligence'
import { resolveCompanyScope } from '@/lib/server/organizations'
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

const m = (v: number) => `${Math.round(v || 0).toLocaleString('ru-RU')}₸`

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canView(access)) return json({ error: 'forbidden' }, 403)

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

    // ── Компактная сводка всех секций для промпта (топ-факты) ─────────────────
    const lines: string[] = []
    lines.push(`Оценка здоровья бизнеса: ${data.healthScore.score}/100 (${data.healthScore.factors.map((f) => `${f.label} ${f.score0to100}`).join(', ')}).`)

    const below = data.safetyStock.rows.filter((r) => r.belowReorder)
    lines.push(
      below.length
        ? `Ниже точки дозаказа (нужно ЗАКАЗАТЬ): ${below.slice(0, 8).map((r) => `${r.name} (остаток ${r.stock}, дозаказ при ${r.reorderPoint})`).join('; ')}`
        : 'Все топ-товары выше точки дозаказа.',
    )

    const eoqTop = data.eoq.rows.filter((r) => r.eoq > 0).slice(0, 6)
    if (eoqTop.length) lines.push(`Оптимальный заказ EOQ: ${eoqTop.map((r) => `${r.name} ≈ ${r.eoq} шт`).join('; ')}`)

    const classA = data.abc.vital.slice(0, 6)
    if (classA.length) lines.push(`Класс A (кормильцы, ${data.abc.classes.find((c) => c.cls === 'A')?.revenueSharePct || 0}% выручки): ${classA.map((v) => `${v.name} (${m(v.revenue)})`).join('; ')}`)
    const classC = data.abc.classes.find((c) => c.cls === 'C')
    if (classC) lines.push(`Класс C (балласт): ${classC.itemCount} позиций, лишь ${classC.revenueSharePct}% выручки — кандидаты на распродажу/вывод.`)

    if (data.anomalies.anomalies.length) {
      lines.push(`Аномальные дни выручки: ${data.anomalies.anomalies.slice(0, 5).map((a) => `${a.company} ${a.date} ${m(a.revenue)} (${a.direction === 'above' ? 'выше' : 'ниже'} нормы, z=${a.z})`).join('; ')}`)
    }

    if (data.cashierRisk.available && data.cashierRisk.rows.length) {
      lines.push(`Риск недостач по кассирам: ${data.cashierRisk.rows.slice(0, 5).map((r) => `${r.cashier} ${r.posteriorPct}% (${r.shortfallEvents}/${r.totalEvents})`).join('; ')}`)
    }

    if (data.rfm.available) {
      const risky = data.rfm.customers.filter((c) => c.segment === 'В зоне риска' || c.segment === 'Потеряны').slice(0, 5)
      lines.push(`Сегменты клиентов: ${data.rfm.segments.map((s) => `${s.segment} ${s.count} (${m(s.monetary)})`).join('; ')}.`)
      if (risky.length) lines.push(`Под угрозой ухода (вернуть): ${risky.map((c) => `${c.name} (${m(c.monetary)}, не был ${c.recencyDays >= 9999 ? 'никогда' : c.recencyDays + ' дн'})`).join('; ')}`)
    }
    if (data.clv.available && data.clv.rows.length) {
      lines.push(`Самые ценные клиенты (CLV): ${data.clv.rows.slice(0, 5).map((c) => `${c.name} (${m(c.clv)})`).join('; ')}`)
    }

    const systemPrompt =
      'Ты опытный бизнес-аналитик игрового клуба. По данным формул дай 3-5 КОНКРЕТНЫХ приоритетных действий на сегодня (что заказать, что не брать/распродать, на кого из кассиров смотреть, кого из клиентов вернуть). Каждое действие — одна короткая строка с конкретикой (название товара/кассира/клиента и цифра). По-русски, по делу, без воды. Не выдумывай — бери только из данных. Верни просто список строк, без нумерации и заголовков.'

    const messages: AiMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: lines.join('\n') },
    ]

    let actions: string[] = []
    try {
      const result = await generateAiText({ messages, maxTokens: 400 })
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
