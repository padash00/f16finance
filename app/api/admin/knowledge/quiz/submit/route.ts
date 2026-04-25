import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type Body = {
  attempt_id?: string | null
  // answers: { [questionIndex]: choiceIndex }
  answers?: Record<string, number> | null
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const body = (await request.json().catch(() => ({}))) as Body
    if (!body.attempt_id) return json({ error: 'attempt-id-required' }, 400)
    if (!body.answers || typeof body.answers !== 'object') {
      return json({ error: 'answers-required' }, 400)
    }

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    const { data: attempt, error: loadError } = await supabase
      .from('knowledge_quiz_attempts')
      .select('id, staff_id, status, questions, total_questions')
      .eq('id', body.attempt_id)
      .maybeSingle()

    if (loadError) throw loadError
    if (!attempt) return json({ error: 'attempt-not-found' }, 404)
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
    for (let i = 0; i < questions.length; i++) {
      const supplied = body.answers[String(i)]
      if (typeof supplied === 'number' && supplied === questions[i].correct) {
        correct += 1
      }
    }

    const total = questions.length
    const score = total > 0 ? Math.round((correct / total) * 100) : 0

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

    if (updateError) throw updateError

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'knowledge_quiz_attempt',
      entityId: body.attempt_id,
      action: 'quiz-submitted',
      payload: { staff_id: (attempt as any).staff_id, score, correct, total },
    })

    return json({
      ok: true,
      data: {
        attempt_id: body.attempt_id,
        score,
        correct,
        total,
      },
    })
  } catch (error) {
    return json(
      { error: 'admin-quiz-submit-failed', detail: (error as any)?.message || String(error) },
      500,
    )
  }
}
