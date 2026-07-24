import { NextResponse } from 'next/server'

import { FINANCIAL_GROUP_OPTIONS, inferFinancialGroup, getFinancialGroupLabel, type FinancialGroup } from '@/lib/core/financial-groups'
import { logAiUsageSafe } from '@/lib/ai/usage-tracker'
import { requireCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'

// AI-подсказка финансовой группы (accounting_group) по названию категории.
// Ловит то, что эвристика по ключевым словам не понимает (бренды, товары —
// напр. «Coca-Cola» → COGS). Фолбэк на inferFinancialGroup, если AI недоступен.

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

const VALID = new Set(FINANCIAL_GROUP_OPTIONS.map((o) => o.value))

function fallback(name: string, note: string) {
  const group = inferFinancialGroup(name)
  return json({ ok: true, data: { group, label: getFinancialGroupLabel(group), reason: note, ai: false } })
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const denied = await requireCapability(access, 'categories.create')
    if (denied) return denied as any

    const ip = getClientIp(req)
    const rl = checkRateLimit(`ai-category-group-hint:${access.user?.id || ip}`, 30, 60_000)
    if (!rl.allowed) return json({ error: 'too-many-requests' }, 429)

    const body = (await req.json().catch(() => null)) as { name?: string } | null
    const name = String(body?.name || '').trim()
    if (name.length < 2) return json({ error: 'Введите название категории (мин. 2 символа).' }, 400)

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return fallback(name, 'AI не настроен — подобрано по ключевым словам.')

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
    const groupsBlock = FINANCIAL_GROUP_OPTIONS.map((o) => `- ${o.value} — ${o.label}: ${o.description}`).join('\n')
    const systemPrompt = [
      'Ты бухгалтер-классификатор в системе Orda (учёт клуба/магазина/общепита в Казахстане).',
      'По названию статьи расхода определи ОДНУ финансовую группу P&L из списка.',
      'Товары для перепродажи, напитки, продукты, сырьё (в т.ч. бренды — Coca-Cola, Red Bull, Lays) → cogs.',
      'Верни ТОЛЬКО JSON без текста вокруг: {"group":"<value из списка>","reason":"1 короткое предложение почему"}.',
    ].join('\n')
    const userPrompt = `Статья расхода: "${name}"\n\nГруппы:\n${groupsBlock}`

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        ...(model.startsWith('gpt-5') ? { reasoning_effort: 'low' } : { temperature: 0.1 }),
        max_completion_tokens: 300,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    })
    const openaiJson = await openaiRes.json().catch(() => null)
    if (!openaiRes.ok || openaiJson?.error) {
      await logAiUsageSafe(access.supabase, {
        userId: access.user?.id || null,
        endpoint: '/api/admin/categories/ai-group-hint',
        model,
        status: 'error',
        error: openaiJson?.error?.message || `OpenAI error (${openaiRes.status})`,
      })
      return fallback(name, 'AI недоступен — подобрано по ключевым словам.')
    }

    await logAiUsageSafe(access.supabase, {
      userId: access.user?.id || null,
      endpoint: '/api/admin/categories/ai-group-hint',
      model,
      usage: openaiJson?.usage,
    })

    const rawText = String(openaiJson?.choices?.[0]?.message?.content || '').trim()
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim()
    let group: FinancialGroup | null = null
    let reason = ''
    try {
      const parsed = JSON.parse(cleaned) as { group?: string; reason?: string }
      const g = String(parsed.group || '').trim()
      if (VALID.has(g as FinancialGroup)) group = g as FinancialGroup
      reason = String(parsed.reason || '').trim()
    } catch {
      /* fallback ниже */
    }

    if (!group) return fallback(name, 'AI вернул неизвестную группу — подобрано по ключевым словам.')

    return json({ ok: true, data: { group, label: getFinancialGroupLabel(group), reason: reason || 'Определено ИИ.', ai: true } })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось получить подсказку.' }, 500)
  }
}
