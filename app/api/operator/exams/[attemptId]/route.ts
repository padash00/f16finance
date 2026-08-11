import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import {
  submitExamAnswer,
  type ExamQuestion,
  type StoredAnswer,
} from '@/lib/server/operator-exams'
import { getRequestOperatorContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Один экзамен: текущий вопрос и ответ на него.
 *
 * Вопрос отдаётся ровно один — тот, на котором человек остановился. Весь билет
 * разом не отдаём: получив его целиком, ответы находят в регламенте по ходу
 * дела, и аттестация превращается в переписывание.
 *
 * Поле `correct` в ответ не попадает никогда.
 *
 *   GET  /api/operator/exams/<attempt>
 *   POST /api/operator/exams/<attempt>   { choice } | { text }
 */

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type Params = { params: Promise<{ attemptId: string }> }

export async function GET(request: Request, { params }: Params) {
  try {
    const context = await getRequestOperatorContext(request)
    if ('response' in context) return context.response

    const { attemptId } = await params
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : context.supabase

    const { data: row, error } = await supabase
      .from('operator_exam_attempts')
      .select('id, exam_id, operator_id, status, questions, answers, current_index, total_questions, score, passed, exam:exam_id(title, pass_score, deadline_at)')
      .eq('id', attemptId)
      .maybeSingle()

    if (error) throw error
    if (!row) return json({ error: 'exam-not-found' }, 404)
    if (String((row as any).operator_id) !== String(context.operator.id)) {
      return json({ error: 'forbidden' }, 403)
    }

    const exam = Array.isArray((row as any).exam) ? (row as any).exam[0] : (row as any).exam
    const questions = ((row as any).questions || []) as ExamQuestion[]
    const answers = ((row as any).answers || {}) as Record<string, StoredAnswer>
    const index = Number((row as any).current_index || 0)
    const question = questions[index]
    const status = String((row as any).status || 'pending')
    const isOpen = ['pending', 'sent', 'in_progress', 'undeliverable'].includes(status)

    return json({
      data: {
        id: String((row as any).id),
        title: String(exam?.title || 'Экзамен'),
        status,
        is_open: isOpen,
        pass_score: Number(exam?.pass_score ?? 70),
        deadline_at: exam?.deadline_at || null,
        total_questions: Number((row as any).total_questions || questions.length || 0),
        answered: Object.keys(answers).length,
        current_index: index,
        score: (row as any).score == null ? null : Number((row as any).score),
        passed: (row as any).passed == null ? null : Boolean((row as any).passed),
        // Вопрос — без правильного варианта и без эталона: и то и другое
        // мгновенно оказалось бы в переписке следующего сдающего.
        question:
          isOpen && question
            ? {
                index,
                text: String(question.q || ''),
                type: question.type === 'open' ? 'open' : 'choice',
                choices: question.type === 'open' ? [] : question.choices || [],
                max_score: Number(question.max_score ?? 1),
              }
            : null,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/operator/exams/[attemptId] GET',
      message: error?.message || 'error',
    })
    return json({ error: 'exam-failed' }, 500)
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const context = await getRequestOperatorContext(request)
    if ('response' in context) return context.response

    const { attemptId } = await params
    const body = (await request.json().catch(() => null)) as
      | { index?: number; choice?: number; text?: string }
      | null

    if (!body || typeof body.index !== 'number') {
      return json({ error: 'index обязателен' }, 400)
    }

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : context.supabase

    const result = await submitExamAnswer({
      supabase,
      attemptId,
      operatorId: String(context.operator.id),
      questionIndex: body.index,
      choiceIndex: typeof body.choice === 'number' ? body.choice : undefined,
      text: typeof body.text === 'string' ? body.text : undefined,
    })

    if (!result.ok) return json({ error: result.error }, result.status)

    // Возвращаем свежее состояние, чтобы приложение не делало второй запрос:
    // между вопросами пауза заметна, а экзамен сдают стоя за стойкой.
    return GET(request, { params: Promise.resolve({ attemptId }) })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/operator/exams/[attemptId] POST',
      message: error?.message || 'error',
    })
    return json({ error: 'answer-failed' }, 500)
  }
}
