/**
 * Принять ответы на квиз и посчитать результат.
 */

import { NextResponse } from 'next/server'
import { requirePointDevice } from '@/lib/server/point-devices'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type Body = {
  attempt_id?: string | null
  answers?: Record<string, number> | null
}

const PASS_THRESHOLD = 80  // 80% — порог сдачи

export async function POST(request: Request) {
  const point = await requirePointDevice(request)
  if ('response' in point) return point.response
  const { supabase, device } = point

  const body = (await request.json().catch(() => ({}))) as Body
  if (!body.attempt_id) return json({ error: 'attempt-id-required' }, 400)
  if (!body.answers || typeof body.answers !== 'object') {
    return json({ error: 'answers-required' }, 400)
  }

  const { data: attempt, error: loadError } = await supabase
    .from('knowledge_quiz_attempts')
    .select('id, staff_id, operator_id, status, questions, total_questions')
    .eq('id', body.attempt_id)
    .maybeSingle()

  if (loadError) return json({ error: 'load-failed', detail: loadError.message }, 500)
  if (!attempt) return json({ error: 'attempt-not-found' }, 404)
  // Изоляция: завершать можно только попытку оператора компании устройства.
  const attemptOpId = (attempt as any).operator_id
  if (attemptOpId) {
    const { data: assignment } = await supabase
      .from('operator_company_assignments')
      .select('id')
      .eq('operator_id', attemptOpId)
      .eq('company_id', device.company_id)
      .eq('is_active', true)
      .maybeSingle()
    if (!assignment) return json({ error: 'attempt-not-found' }, 404)
  }
  if ((attempt as any).status !== 'in_progress') {
    return json({ error: 'attempt-not-in-progress' }, 409)
  }

  const questions = (((attempt as any).questions || []) as any[]) as Array<{
    article_id: string
    q: string
    choices: string[]
    correct: number
  }>

  let correct = 0
  const wrongArticleIds: string[] = []
  for (let i = 0; i < questions.length; i++) {
    const supplied = body.answers[String(i)]
    if (typeof supplied === 'number' && supplied === questions[i].correct) {
      correct += 1
    } else {
      wrongArticleIds.push(questions[i].article_id)
    }
  }

  const total = questions.length
  const score = total > 0 ? Math.round((correct / total) * 100) : 0
  const passed = score >= PASS_THRESHOLD

  const { error: updateError } = await supabase
    .from('knowledge_quiz_attempts')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      answers: body.answers,
      correct_answers: correct,
      score,
    })
    .eq('id', body.attempt_id)

  if (updateError) return json({ error: 'update-failed', detail: updateError.message }, 500)

  return json({
    ok: true,
    data: {
      attempt_id: body.attempt_id,
      score,
      correct,
      total,
      passed,
      wrongArticleIds,
    },
  })
}
