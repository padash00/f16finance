import { NextResponse } from 'next/server'

import { logAiUsageSafe } from '@/lib/ai/usage-tracker'
import { requireCapability } from '@/lib/server/capabilities'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Fail-closed проверка принадлежности точки организации вызывающего.
 * ПОЧЕМУ отдельно: resolveCompanyScope({ requestedCompanyId }) бросает
 * 'company-out-of-scope' только когда организация ЕСТЬ. У пользователя без
 * активной орг он молча возвращает { allowedCompanyIds: [] } — и «проверка одним
 * await» пропускала чужой company_id. Здесь сверяем результат явно:
 * null (суперадмин без орг) = можно всё, [] = нельзя ничего.
 */
async function assertCompanyInScope(
  access: { activeOrganization?: { id?: string | null } | null; isSuperAdmin: boolean },
  companyId: string | null | undefined,
) {
  const scope = await resolveCompanyScope({
    activeOrganizationId: access.activeOrganization?.id || null,
    isSuperAdmin: access.isSuperAdmin,
  })
  if (scope.allowedCompanyIds === null) return
  if (!companyId || !scope.allowedCompanyIds.includes(String(companyId))) {
    throw new Error('company-out-of-scope')
  }
}


function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type Body = {
  company_id?: string
  item_name?: string
  comment?: string
}

type AiHintPayload = {
  recommended_category: string
  alternatives: string[]
  reason: string
  questions: string[]
}

function parseHintPayload(rawText: string): AiHintPayload | null {
  const text = rawText.trim()
  if (!text) return null
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim()
  try {
    const parsed = JSON.parse(cleaned) as Partial<AiHintPayload>
    const recommended = String(parsed.recommended_category || '').trim()
    const reason = String(parsed.reason || '').trim()
    const alternatives = Array.isArray(parsed.alternatives)
      ? parsed.alternatives.map((v) => String(v || '').trim()).filter(Boolean).slice(0, 3)
      : []
    const questions = Array.isArray(parsed.questions)
      ? parsed.questions.map((v) => String(v || '').trim()).filter(Boolean).slice(0, 3)
      : []
    if (!recommended || !reason) return null
    return {
      recommended_category: recommended,
      alternatives,
      reason,
      questions,
    }
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const ip = getClientIp(req)
    const rl = checkRateLimit(`ai-expense-category-hint:${access.user?.id || ip}`, 30, 60_000)
    if (!rl.allowed) return json({ error: 'too-many-requests' }, 429)

    const denied = await requireCapability(access, 'expenses.create')
    if (denied) return denied as any

    // Capability checks выше уже отсеивают; здесь — любой staff
    const canUse = access.isSuperAdmin || !!access.staffRole
    if (!canUse) return json({ error: 'forbidden' }, 403)

    const body = (await req.json().catch(() => null)) as Body | null
    const companyId = String(body?.company_id || '').trim()
    const itemName = String(body?.item_name || '').trim()
    const comment = String(body?.comment || '').trim()
    if (!companyId) return json({ error: 'company_id обязателен' }, 400)
    const hasItemName = itemName.length >= 3
    const hasComment = comment.length >= 10
    if (!hasItemName && !hasComment) {
      return json({ error: 'Напишите в "Краткое название" (>=3) или в "Комментарий" (>=10).' }, 400)
    }

    await assertCompanyInScope(access, companyId)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : createRequestSupabaseClient(req)
    // Изоляция: справочник категорий тенантный — без фильтра названия категорий
    // чужих организаций уходили в промпт AI и возвращались клиенту как подсказка.
    // NEVER-pattern: не-супер без орг → нулевой uuid → пустой список (400 ниже).
    const categoryScopeOrg =
      access.activeOrganization?.id || (access.isSuperAdmin ? null : '00000000-0000-0000-0000-000000000000')
    let categoriesQuery: any = supabase.from('expense_categories').select('name, accounting_group').order('name')
    if (categoryScopeOrg) categoriesQuery = categoriesQuery.eq('organization_id', categoryScopeOrg)
    const [categoriesRes, companyRes] = await Promise.all([
      categoriesQuery,
      supabase.from('companies').select('name').eq('id', companyId).maybeSingle(),
    ])
    if (categoriesRes.error) throw categoriesRes.error

    const categories = ((categoriesRes.data || []) as any[]).map((c: any) => ({
      name: String(c.name || '').trim(),
      group: String(c.accounting_group || 'operating').trim(),
    })).filter((c) => c.name)
    if (categories.length === 0) return json({ error: 'Список категорий пуст.' }, 400)

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return json({ error: 'OPENAI_API_KEY не настроен.' }, 500)

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
    const companyName = String(companyRes.data?.name || companyId)
    const systemPrompt = [
      'Ты помощник по категоризации расходов в системе Orda.',
      'Выбирай категорию ТОЛЬКО из переданного списка.',
      'Учитывай: что купили, комментарий и точку.',
      'Верни только JSON без текста вне JSON:',
      '{"recommended_category":"...", "alternatives":["..."], "reason":"...", "questions":["..."]}',
      'alternatives максимум 3, questions максимум 3.',
    ].join('\n')

    const categoriesBlock = categories.map((c) => `- ${c.name} [group=${c.group}]`).join('\n')
    const userPrompt = [
      `Точка: ${companyName}`,
      `Что купили: ${itemName || '(не указано)'}`,
      `Комментарий: ${comment || '(не указано)'}`,
      '',
      'Категории:',
      categoriesBlock,
    ].join('\n')

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        ...(model.startsWith('gpt-5') ? { reasoning_effort: 'low' } : { temperature: 0.2 }),
        max_completion_tokens: 500,
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
        endpoint: '/api/admin/expenses/ai-category-hint',
        model,
        status: 'error',
        error: openaiJson?.error?.message || `OpenAI error (${openaiRes.status})`,
      })
      return json({ error: openaiJson?.error?.message || `OpenAI error (${openaiRes.status})` }, 500)
    }

    const rawText = String(openaiJson?.choices?.[0]?.message?.content || '').trim()
    const parsed = parseHintPayload(rawText)
    if (!parsed) return json({ error: 'ИИ вернул некорректный формат подсказки.' }, 500)

    await logAiUsageSafe(access.supabase, {
      userId: access.user?.id || null,
      endpoint: '/api/admin/expenses/ai-category-hint',
      model,
      usage: openaiJson?.usage,
    })

    const validNames = new Set(categories.map((c) => c.name.toLowerCase()))
    const recommended = categories.find((c) => c.name.toLowerCase() === parsed.recommended_category.toLowerCase())?.name || ''
    const alternatives = parsed.alternatives
      .map((name) => categories.find((c) => c.name.toLowerCase() === name.toLowerCase())?.name || '')
      .filter(Boolean)
      .slice(0, 3)

    if (!recommended || !validNames.has(recommended.toLowerCase())) {
      return json({ error: 'ИИ не выбрал категорию из существующего списка.' }, 400)
    }

    return json({
      ok: true,
      data: {
        recommended_category: recommended,
        alternatives,
        reason: parsed.reason,
        questions: parsed.questions,
      },
    })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось получить AI-подсказку.' }, 500)
  }
}
