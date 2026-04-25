import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

const OPENAI_MODEL = process.env.OPENAI_QUIZ_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini'
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManage(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || ['owner', 'manager'].includes(access.staffRole)
}

type Body = {
  staff_id?: string | null
  question_count?: number | null
  topic?: string | null
}

type QuizQuestion = {
  article_id: string
  q: string
  choices: string[]
  correct: number
}

function trimContent(text: string, max = 600): string {
  if (text.length <= max) return text
  return text.slice(0, max) + '…'
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManage(access)) return json({ error: 'forbidden' }, 403)

    const body = (await request.json().catch(() => ({}))) as Body
    if (!body.staff_id) return json({ error: 'staff-id-required' }, 400)
    const questionCount = Math.min(Math.max(Number(body.question_count || 5), 3), 12)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    const { data: staff } = await supabase
      .from('staff')
      .select('id, name, organization_id')
      .eq('id', body.staff_id)
      .maybeSingle()

    if (!staff) return json({ error: 'staff-not-found' }, 404)

    const orgId = (staff as any).organization_id

    let articleQuery = supabase
      .from('knowledge_articles')
      .select('id, title, content, severity')
      .eq('is_published', true)
      .order('sort_order', { ascending: true })
      .limit(20)
    if (orgId) {
      articleQuery = articleQuery.or(`organization_id.eq.${orgId},organization_id.is.null`)
    }

    const { data: articles, error: articlesError } = await articleQuery
    if (articlesError) throw articlesError

    let pool = (articles || []) as any[]
    if (body.topic && body.topic.trim()) {
      const tokens = body.topic.toLowerCase().split(/\s+/).filter((t) => t.length >= 3)
      pool = pool.filter((a) => {
        const haystack = `${a.title} ${a.content}`.toLowerCase()
        return tokens.some((t) => haystack.includes(t))
      })
    }
    if (pool.length === 0) {
      return json({ error: 'no-articles-for-quiz' }, 400)
    }

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return json({ error: 'ai-not-configured' }, 503)

    const articleBlocks = pool
      .slice(0, 12)
      .map(
        (a, idx) =>
          `[${idx + 1}] id=${a.id} title="${a.title}" severity=${a.severity}\n${trimContent(a.content || '', 700)}`,
      )
      .join('\n\n')

    const systemPrompt =
      'Ты составляешь тест для оператора игрового клуба по статьям из его базы знаний. ' +
      'Возвращай СТРОГО JSON массив объектов вида ' +
      '{"article_id":"<uuid>","q":"<вопрос>","choices":["a","b","c","d"],"correct":<index 0..3>}. ' +
      'Без markdown, без префикса/постфикса. Вопросы по-русски, лаконичные. 4 варианта в каждом.'

    const userPrompt = [
      `Сгенерируй ${questionCount} вопросов на основе статей ниже.`,
      'Выбирай только статьи из списка, в article_id ставь именно тот UUID из заголовка [N] id=...',
      '',
      articleBlocks,
    ].join('\n')

    const aiRes = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.4,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    })

    if (!aiRes.ok) {
      const detail = await aiRes.text()
      return json({ error: 'ai-failed', detail }, 502)
    }

    const aiJson = (await aiRes.json()) as any
    const rawContent: string = aiJson?.choices?.[0]?.message?.content || ''
    let parsed: any
    try {
      parsed = JSON.parse(rawContent)
    } catch {
      return json({ error: 'ai-invalid-json', detail: rawContent.slice(0, 200) }, 502)
    }

    const questionsRaw: any[] = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.questions)
        ? parsed.questions
        : []

    const validIds = new Set(pool.map((a) => a.id as string))
    const questions: QuizQuestion[] = questionsRaw
      .filter(
        (q) =>
          q &&
          typeof q.q === 'string' &&
          Array.isArray(q.choices) &&
          q.choices.length === 4 &&
          typeof q.correct === 'number' &&
          q.correct >= 0 &&
          q.correct < 4 &&
          typeof q.article_id === 'string' &&
          validIds.has(q.article_id),
      )
      .slice(0, questionCount)

    if (questions.length === 0) {
      return json({ error: 'ai-no-valid-questions', detail: rawContent.slice(0, 200) }, 502)
    }

    const { data: attempt, error: insertError } = await supabase
      .from('knowledge_quiz_attempts')
      .insert([
        {
          organization_id: orgId,
          staff_id: body.staff_id,
          status: 'in_progress',
          questions,
          total_questions: questions.length,
        },
      ])
      .select('id, started_at, total_questions')
      .single()

    if (insertError) throw insertError

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'knowledge_quiz_attempt',
      entityId: (attempt as any).id,
      action: 'quiz-generated',
      payload: { staff_id: body.staff_id, count: questions.length },
    })

    return json({
      ok: true,
      data: {
        attempt_id: (attempt as any).id,
        questions: questions.map((q) => ({
          article_id: q.article_id,
          q: q.q,
          choices: q.choices,
        })),
        total_questions: questions.length,
      },
    })
  } catch (error) {
    return json(
      { error: 'admin-quiz-generate-failed', detail: (error as any)?.message || String(error) },
      500,
    )
  }
}
