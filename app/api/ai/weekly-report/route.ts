import { NextResponse } from 'next/server'

import { logAiUsageSafe } from '@/lib/ai/usage-tracker'
import { generateAiText, streamAiText, type AiMessage } from '@/lib/ai/provider'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'
import { getAnalysisServerSnapshot, getReportsServerSnapshot, getCashFlowServerSnapshot } from '@/lib/ai/server-snapshots'

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'

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

function snapshotToText(snapshot: { title: string; summary: string[]; sections: Array<{ title: string; metrics?: Array<{ label: string; value: string | number | boolean }>; bullets?: string[] }> }) {
  const lines = [`=== ${snapshot.title} ===`, ...snapshot.summary]
  for (const section of snapshot.sections) {
    lines.push(`\n[${section.title}]`)
    for (const m of section.metrics ?? []) lines.push(`  ${m.label}: ${m.value}`)
    for (const b of section.bullets ?? []) lines.push(`  • ${b}`)
  }
  return lines.join('\n')
}

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const ip = getClientIp(request)
    const rl = checkRateLimit(`ai-weekly-report:${access.user?.id || ip}`, 30, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'too-many-requests' }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const dateTo = body.dateTo || todayISO()
    const dateFrom = body.dateFrom || addDaysISO(dateTo, -6)

    // Изоляция арендатора: срезы ограничиваем компаниями вызывающего.
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const scope = { allowedCompanyIds: companyScope.allowedCompanyIds }

    const [analysisSnap, reportsSnap, cashflowSnap] = await Promise.all([
      getAnalysisServerSnapshot(access.supabase, { dateFrom, dateTo }, scope),
      getReportsServerSnapshot(access.supabase, { dateFrom, dateTo }, scope),
      getCashFlowServerSnapshot(access.supabase, { dateFrom, dateTo }, scope),
    ])

    const dataContext = [snapshotToText(analysisSnap), snapshotToText(reportsSnap), snapshotToText(cashflowSnap)].join('\n\n')

    const systemPrompt = [
      'Ты — старший финансовый аналитик системы Orda Control.',
      'Составь профессиональный еженедельный финансовый отчёт на русском языке.',
      '',
      'СТРУКТУРА ОТЧЁТА (используй именно эти разделы с заголовками):',
      '## Итоги недели',
      '## Ключевые метрики',
      '## Что сработало хорошо',
      '## Риски и проблемы',
      '## Рекомендации на следующую неделю',
      '',
      'ПРАВИЛА:',
      '- Используй **жирный** для цифр и ключевых выводов',
      '- Каждый раздел — 2–4 конкретных пункта с цифрами из данных',
      '- Тон деловой, без воды и общих фраз',
      '- Опирайся только на данные ниже — не выдумывай',
      '- В конце добавь одну главную метрику которую нужно улучшить на следующей неделе',
    ].join('\n')

    const aiPayload: { model: string; maxTokens: number; messages: AiMessage[] } = {
      model: OPENAI_MODEL,
      maxTokens: 1500,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Данные за период ${dateFrom} — ${dateTo}:\n\n${dataContext}\n\nСоставь полный еженедельный отчёт.`,
        },
      ],
    }

    if (body.stream === true) {
      const encoder = new TextEncoder()
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            controller.enqueue(encoder.encode(sse('meta', { dateFrom, dateTo })))
            const result = await streamAiText({
              ...aiPayload,
              onDelta: (text) => controller.enqueue(encoder.encode(sse('delta', { text }))),
            })
            await logAiUsageSafe(access.supabase, {
              userId: access.user?.id || null,
              endpoint: '/api/ai/weekly-report',
              provider: result.provider,
              model: result.model,
              usage: result.usage,
            })
            controller.enqueue(encoder.encode(sse('done', { ok: true, provider: result.provider, model: result.model })))
            controller.close()
          } catch (error) {
            await logAiUsageSafe(access.supabase, {
              userId: access.user?.id || null,
              endpoint: '/api/ai/weekly-report',
              model: OPENAI_MODEL,
              status: 'error',
              error: error instanceof Error ? error.message : String(error),
            })
            controller.enqueue(encoder.encode(sse('error', { error: error instanceof Error ? error.message : String(error) })))
            controller.close()
          }
        },
      })

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store, no-transform',
          Connection: 'keep-alive',
        },
      })
    }

    const result = await generateAiText(aiPayload).catch(async (error) => {
      await logAiUsageSafe(access.supabase, {
        userId: access.user?.id || null,
        endpoint: '/api/ai/weekly-report',
        model: OPENAI_MODEL,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    })

    const text = result.text.trim()
    if (!text) return NextResponse.json({ error: 'ИИ не вернул отчёт.' }, { status: 500 })

    await logAiUsageSafe(access.supabase, {
      userId: access.user?.id || null,
      endpoint: '/api/ai/weekly-report',
      provider: result.provider,
      model: result.model,
      usage: result.usage,
    })

    return NextResponse.json({ text, dateFrom, dateTo })
  } catch (error) {
    console.error('POST /api/ai/weekly-report failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Ошибка генерации отчёта.' }, { status: 500 })
  }
}
