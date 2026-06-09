import { NextResponse } from 'next/server'

import { logAiUsageSafe } from '@/lib/ai/usage-tracker'
import { generateAiText, type AiMessage } from '@/lib/ai/provider'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'
import { getAnalysisServerSnapshot, getReportsServerSnapshot, getCashFlowServerSnapshot } from '@/lib/ai/server-snapshots'

// AI CFO: финансовый разбор за период — структурированные карточки (вывод → причина → рекомендация).
// Read-only: читает снапшоты и зовёт generateAiText. Переиспользует инфраструктуру weekly-report.

const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'

export const dynamic = 'force-dynamic'

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

function parseJsonLoose(text: string): any {
  const tryParse = (s: string) => { try { return JSON.parse(s) } catch { return null } }
  const direct = tryParse(text)
  if (direct) return direct
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const cleanedParsed = tryParse(cleaned)
  if (cleanedParsed) return cleanedParsed
  const s = cleaned.indexOf('{')
  const e = cleaned.lastIndexOf('}')
  if (s >= 0 && e > s) return tryParse(cleaned.slice(s, e + 1))
  return null
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin && !access.staffMember) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const ip = getClientIp(request)
    const rl = checkRateLimit(`ai-cfo:${access.user?.id || ip}`, 20, 60_000)
    if (!rl.allowed) return NextResponse.json({ error: 'too-many-requests' }, { status: 429 })

    const body = await request.json().catch(() => ({}))
    const dateTo = body.dateTo || todayISO()
    const dateFrom = body.dateFrom || addDaysISO(dateTo, -29)

    const [analysisSnap, reportsSnap, cashflowSnap] = await Promise.all([
      getAnalysisServerSnapshot(access.supabase, { dateFrom, dateTo }),
      getReportsServerSnapshot(access.supabase, { dateFrom, dateTo }),
      getCashFlowServerSnapshot(access.supabase, { dateFrom, dateTo }),
    ])
    const dataContext = [snapshotToText(analysisSnap), snapshotToText(reportsSnap), snapshotToText(cashflowSnap)].join('\n\n')

    const systemPrompt = [
      'Ты — финансовый директор (CFO) для владельца бизнеса. Проанализируй данные за период и верни СТРОГО валидный JSON, без пояснений и markdown.',
      'Формат:',
      '{"summary": "1-2 предложения общий вывод", "headline_metric": {"label": "...", "value": "..."}, "cards": [{"severity": "good|warn|risk", "title": "...", "finding": "...", "root_cause": "...", "recommendation": "..."}]}',
      'Правила:',
      '- 3–6 карточек, отсортированы от важного к второстепенному.',
      '- В "finding" обязательно конкретные ЦИФРЫ из данных (суммы, %, динамика).',
      '- "root_cause" — вероятная причина. "recommendation" — одно конкретное действие.',
      '- severity: good (хорошо), warn (внимание), risk (риск/убыток).',
      '- Опирайся ТОЛЬКО на данные ниже, не выдумывай. Русский язык.',
    ].join('\n')

    const messages: AiMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Данные за период ${dateFrom} — ${dateTo}:\n\n${dataContext}\n\nДай финансовый разбор в JSON.` },
    ]

    const result = await generateAiText({ model: OPENAI_MODEL, maxTokens: 1800, messages })
    await logAiUsageSafe(access.supabase, {
      userId: access.user?.id || null,
      endpoint: '/api/ai/cfo',
      provider: result.provider,
      model: result.model,
      usage: result.usage,
    })

    const parsed = parseJsonLoose(result.text)
    if (!parsed || !Array.isArray(parsed.cards)) {
      return NextResponse.json({
        ok: true,
        dateFrom,
        dateTo,
        digest: { summary: result.text || '', headline_metric: null, cards: [] },
      })
    }

    return NextResponse.json({ ok: true, dateFrom, dateTo, digest: parsed })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
