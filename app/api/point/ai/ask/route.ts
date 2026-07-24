import { NextResponse } from 'next/server'

import { generateAiText } from '@/lib/ai/provider'
import { requirePointDevice } from '@/lib/server/point-devices'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'

const OPENAI_MODEL = process.env.OPENAI_AI_HELPER_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type Body = {
  prompt?: string | null
  staff_id?: string | null
}

type ArticleHit = {
  id: string
  title: string
  slug: string
  summary: string | null
  content: string
  severity: string
}

function pickArticles(query: string, articles: ArticleHit[]): ArticleHit[] {
  if (!query.trim()) return articles.slice(0, 5)
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3)
  if (tokens.length === 0) return articles.slice(0, 5)
  const scored = articles.map((article) => {
    const haystack = `${article.title} ${article.summary || ''} ${article.content}`.toLowerCase()
    let score = 0
    for (const t of tokens) {
      if (haystack.includes(t)) score += 1
      if (article.title.toLowerCase().includes(t)) score += 2
    }
    if (article.severity === 'critical') score += 1
    return { article, score }
  })
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.article)
}

function trimContent(text: string, max = 700): string {
  if (text.length <= max) return text
  return text.slice(0, max) + '…'
}

export async function POST(request: Request) {
  const ip = getClientIp(request)
  const rl = checkRateLimit(`point-ai-ask:${ip}`, 20, 60_000)
  if (!rl.allowed) {
    return json({ error: 'too-many-requests' }, 429)
  }

  const point = await requirePointDevice(request)
  if ('response' in point) return point.response
  const { supabase, device } = point

  const body = (await request.json().catch(() => ({}))) as Body
  const prompt = (body.prompt || '').trim()
  if (!prompt) return json({ error: 'prompt-required' }, 400)
  if (prompt.length > 1500) return json({ error: 'prompt-too-long' }, 400)

  // Контекст: статьи знаний для оператора + текущая открытая смена.
  const [articlesRes, shiftRes] = await Promise.all([
    supabase
      .from('knowledge_articles')
      .select('id, title, slug, summary, content, severity, audience, is_published, company_id')
      .eq('is_published', true)
      .eq('organization_id', device.company?.organization_id || '00000000-0000-0000-0000-000000000000')
      .or(`company_id.is.null,company_id.eq.${device.company_id}`)
      .limit(200),
    supabase
      .from('point_shifts')
      .select('id, status, opened_at, opening_cash, totals_json, operator_id')
      .eq('company_id', device.company_id)
      .eq('status', 'open')
      .maybeSingle(),
  ])

  const articles = ((articlesRes.data || []) as any[]).filter((a) => {
    const audience = (a.audience || []) as string[]
    return audience.length === 0 || audience.includes('operator')
  }) as ArticleHit[]

  const relevant = pickArticles(prompt, articles)
  const shift = shiftRes.data as any | null

  if (!process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
    return json({ error: 'ai-not-configured' }, 503)
  }

  const articlesContext = relevant.length
    ? relevant
        .map(
          (a, idx) =>
            `[${idx + 1}] ${a.title} (severity: ${a.severity})\nslug: ${a.slug}\n${trimContent(
              a.summary || a.content || '',
              900,
            )}`,
        )
        .join('\n\n')
    : 'Нет подходящих статей в базе знаний.'

  const shiftContext = shift
    ? `Открытая смена: opened_at=${shift.opened_at}, opening_cash=${shift.opening_cash}, totals=${JSON.stringify(shift.totals_json || {})}`
    : 'Открытой смены сейчас нет.'

  const systemPrompt = [
    'Ты — помощник оператора игрового клуба Orda.',
    'Отвечай кратко (3-6 предложений), на русском.',
    'Используй ТОЛЬКО факты из контекста статей. Если ответа в статьях нет — честно скажи "не знаю, обратись к менеджеру".',
    'В конце ответа ставь блок "Ссылки:" со списком slug статей которые ты использовал.',
  ].join(' ')

  const userMessage = [
    `Вопрос оператора: ${prompt}`,
    '',
    `Контекст смены: ${shiftContext}`,
    '',
    'Статьи базы знаний:',
    articlesContext,
  ].join('\n')

  let aiText = ''
  try {
    const result = await generateAiText({
      model: OPENAI_MODEL,
      temperature: 0.2,
      maxTokens: 600,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    })
    aiText = result.text
  } catch (e: any) {
    return json({ error: 'ai-network-failed', detail: e?.message || String(e) }, 502)
  }

  return json({
    ok: true,
    data: {
      answer: aiText,
      articles: relevant.map((a) => ({ id: a.id, title: a.title, slug: a.slug, severity: a.severity })),
      shift_id: shift?.id || null,
    },
  })
}
