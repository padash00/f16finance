import { NextResponse } from 'next/server'

import { getRequestAccessContext } from '@/lib/server/request-auth'
import { getAnalysisServerSnapshot, getReportsServerSnapshot, getCashFlowServerSnapshot } from '@/lib/ai/server-snapshots'

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

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

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const body = await request.json().catch(() => ({}))
    const dateTo = body.dateTo || todayISO()
    const dateFrom = body.dateFrom || addDaysISO(dateTo, -6)

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'OPENAI_API_KEY не настроен на сервере.' }, { status: 500 })
    }

    const [analysisSnap, reportsSnap, cashflowSnap] = await Promise.all([
      getAnalysisServerSnapshot(access.supabase, { dateFrom, dateTo }),
      getReportsServerSnapshot(access.supabase, { dateFrom, dateTo }),
      getCashFlowServerSnapshot(access.supabase, { dateFrom, dateTo }),
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

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: 1500,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `Данные за период ${dateFrom} — ${dateTo}:\n\n${dataContext}\n\nСоставь полный еженедельный отчёт.`,
          },
        ],
      }),
    })

    const json = await response.json().catch(() => null)
    if (!response.ok || json?.error) {
      return NextResponse.json({ error: json?.error?.message || `OpenAI API error (${response.status})` }, { status: 500 })
    }

    const text = json?.choices?.[0]?.message?.content?.trim() || ''
    if (!text) return NextResponse.json({ error: 'ИИ не вернул отчёт.' }, { status: 500 })

    return NextResponse.json({ text, dateFrom, dateTo })
  } catch (error) {
    console.error('POST /api/ai/weekly-report failed:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Ошибка генерации отчёта.' }, { status: 500 })
  }
}
