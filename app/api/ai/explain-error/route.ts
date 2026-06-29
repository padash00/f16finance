import { NextResponse } from 'next/server'

import { generateAiText, type AiMessage } from '@/lib/ai/provider'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'
import { getRequestAccessContext } from '@/lib/server/request-auth'

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canView(access: any) {
  return access?.isSuperAdmin || access?.staffRole === 'owner' || access?.staffRole === 'manager'
}

// Объясняет техническую ошибку простым языком для владельца (не разработчика).
export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canView(access)) return json({ error: 'forbidden' }, 403)

    const ip = getClientIp(request)
    const rl = checkRateLimit(`ai-explain-error:${access.user?.id || ip}`, 20, 60_000)
    if (!rl.allowed) return json({ error: 'too-many-requests' }, 429)

    const body = await request.json().catch(() => ({}))
    const title = String(body?.title || '').slice(0, 500)
    const area = String(body?.area || '').slice(0, 300)
    const message = String(body?.message || '').slice(0, 1500)
    const action = String(body?.action || '').slice(0, 200)
    const entityType = String(body?.entityType || '').slice(0, 200)

    if (!title && !message) return json({ error: 'no-error-data' }, 400)

    const systemPrompt = [
      'Ты — помощник владельца бизнеса (сеть игровых клубов), который НЕ программист.',
      'Тебе дают техническую ошибку из системы. Объясни её ПРОСТЫМ русским языком, без жаргона.',
      'Строго по структуре, коротко (всего 4–6 предложений):',
      '1. **Что случилось** — простыми словами, что пошло не так.',
      '2. **Насколько серьёзно** — затронуты ли деньги/данные клиентов, или это мелочь.',
      '3. **Из-за чего** — вероятная причина (ошибка в данных или в коде).',
      '4. **Что делать** — что сделать владельцу (например «передать разработчику», «исправить ввод», «не критично, можно игнорировать»).',
      'Не выдумывай детали, которых нет. Если ошибка явно техническая (нужен разработчик) — так и скажи. Без кода в ответе.',
    ].join('\n')

    const userPrompt = [
      `Заголовок: ${title || '—'}`,
      area ? `Где произошло: ${area}` : '',
      action ? `Действие: ${action}` : '',
      entityType ? `Тип: ${entityType}` : '',
      message ? `Техническое сообщение: ${message}` : '',
    ].filter(Boolean).join('\n')

    const messages: AiMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]

    const result = await generateAiText({ model: OPENAI_MODEL, maxTokens: 700, messages })
    const explanation = String(result.text || '').trim()
    if (!explanation) return json({ error: 'empty-response' }, 502)

    return json({ ok: true, explanation }, 200)
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
