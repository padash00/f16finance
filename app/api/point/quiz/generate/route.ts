/**
 * Генерация квиза для оператора по знаниям.
 * Выбирает случайные подтверждённые статьи и генерирует 5 вопросов через GPT.
 *
 * Auth: x-point-device-token + x-point-operator-id
 */

import { NextResponse } from 'next/server'

import { requirePointDevice } from '@/lib/server/point-devices'
import { logAiUsageSafe } from '@/lib/ai/usage-tracker'

const OPENAI_MODEL = process.env.OPENAI_QUIZ_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini'
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type QuizQuestion = {
  article_id: string
  q: string
  choices: string[]
  correct: number
}

export async function POST(request: Request) {
  const point = await requirePointDevice(request)
  if ('response' in point) return point.response
  const { supabase, device } = point

  const operatorId = request.headers.get('x-point-operator-id')
  if (!operatorId) return json({ error: 'operator-id-required' }, 400)

  // Изоляция: оператор обязан быть привязан к компании устройства.
  const { data: assignment } = await supabase
    .from('operator_company_assignments')
    .select('id')
    .eq('operator_id', operatorId)
    .eq('company_id', device.company_id)
    .eq('is_active', true)
    .maybeSingle()
  if (!assignment) return json({ error: 'operator-not-in-company' }, 403)

  // Резолвим staff_id из operator_id
  const { data: link } = await supabase
    .from('operator_staff_links')
    .select('staff_id')
    .eq('operator_id', operatorId)
    .maybeSingle()
  const staffId = link?.staff_id || null

  // Берём 5 случайных подтверждённых статей доступных оператору
  const { data: articles, error: articlesError } = await supabase
    .from('knowledge_articles')
    .select('id, title, content')
    .eq('is_published', true)
    .or(`company_id.is.null,company_id.eq.${device.company_id}`)
    .limit(50)

  if (articlesError) return json({ error: 'articles-load-failed', detail: articlesError.message }, 500)
  if (!articles || articles.length < 3) {
    return json({ error: 'not-enough-articles', detail: 'Нужно минимум 3 статьи в базе знаний' }, 400)
  }

  // Случайные 5 статей (или меньше если их мало)
  const shuffled = [...articles].sort(() => Math.random() - 0.5)
  const selected = shuffled.slice(0, Math.min(5, articles.length))

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return json({ error: 'openai-not-configured' }, 503)

  const systemPrompt = [
    'Ты — преподаватель который составляет тесты для операторов игрового клуба.',
    'Твоя задача — на основе статьи сформулировать ОДИН вопрос с 4 вариантами ответа.',
    'Один правильный, три похожих но неверных. Вопрос должен проверять понимание сути.',
    '',
    'Формат ответа — строго JSON:',
    '{ "q": "Вопрос?", "choices": ["A", "B", "C", "D"], "correct": 0 }',
    'correct — индекс правильного варианта (0..3).',
  ].join('\n')

  const questions: QuizQuestion[] = []
  for (const article of selected) {
    try {
      const userMsg = `Статья «${article.title}»:\n\n${String(article.content || '').slice(0, 800)}\n\nСоставь вопрос на понимание этой статьи.`

      const res = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          ...(OPENAI_MODEL.startsWith('gpt-5') ? { reasoning_effort: 'low' } : { temperature: 0.7 }),
          max_completion_tokens: 400,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMsg },
          ],
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) continue

      const raw = data?.choices?.[0]?.message?.content || '{}'
      const parsed = JSON.parse(raw)

      if (typeof parsed.q !== 'string' || !Array.isArray(parsed.choices) || parsed.choices.length !== 4 || typeof parsed.correct !== 'number') {
        continue
      }

      questions.push({
        article_id: String(article.id),
        q: parsed.q,
        choices: parsed.choices.map((c: any) => String(c)),
        correct: Math.max(0, Math.min(3, parsed.correct)),
      })
    } catch {
      // skip article on error
    }
  }

  if (questions.length === 0) {
    return json({ error: 'quiz-generation-failed' }, 500)
  }

  // Сохраняем attempt в БД
  const { data: attempt, error: insertError } = await supabase
    .from('knowledge_quiz_attempts')
    .insert([{
      staff_id: staffId,
      operator_id: operatorId,
      questions,
      total_questions: questions.length,
      status: 'in_progress',
      started_at: new Date().toISOString(),
    }])
    .select('id')
    .single()

  if (insertError) return json({ error: 'attempt-save-failed', detail: insertError.message }, 500)

  await logAiUsageSafe(supabase, {
    userId: null,
    endpoint: '/api/point/quiz/generate',
    model: OPENAI_MODEL,
    payload: { operatorId, questions: questions.length, source: 'point' },
  })

  return json({
    ok: true,
    data: {
      attempt_id: attempt.id,
      questions: questions.map((q, i) => ({
        index: i,
        q: q.q,
        choices: q.choices,
        // НЕ возвращаем correct — клиент должен прислать ответы
      })),
    },
  })
}
