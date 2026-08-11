import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { isOpenAnswer, type ExamQuestion, type StoredAnswer } from '@/lib/server/operator-exams'
import { getRequestOperatorContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Экзамены оператора.
 *
 * Аттестация жила только в Telegram: вопросы приходили ботом, ответы — кнопками
 * под сообщением. У кого Telegram не заведён, попытка сразу помечалась
 * «недоставлено» — человек числился обязанным сдать экзамен, которого не
 * видел, и владелец потом гадал, лень это или не дошло.
 *
 * Приложение — вторая дверь к тому же экзамену. Билет и подсчёт общие: сдать
 * дважды нельзя, ответы на пройденные вопросы не переписываются.
 *
 * Правильные ответы наружу не отдаются никогда. Достаточно одного скриншота,
 * чтобы билет ушёл следующему сдающему.
 *
 *   GET /api/operator/exams
 */

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

/** Сколько вопросов уже отвечено — по сохранённым ответам, а не по индексу. */
function answeredCount(answers: Record<string, StoredAnswer> | null | undefined): number {
  return Object.keys(answers || {}).length
}

export async function GET(request: Request) {
  try {
    const context = await getRequestOperatorContext(request)
    if ('response' in context) return context.response

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : context.supabase

    const { data, error } = await supabase
      .from('operator_exam_attempts')
      .select('id, exam_id, status, questions, answers, current_index, total_questions, correct_answers, score, max_score, passed, sent_at, completed_at, created_at, exam:exam_id(title, pass_score, deadline_at, status)')
      .eq('operator_id', context.operator.id)
      .order('created_at', { ascending: false })
      .limit(30)

    if (error) throw error

    const items = ((data || []) as any[]).map((row) => {
      const exam = Array.isArray(row.exam) ? row.exam[0] : row.exam
      const questions = (row.questions || []) as ExamQuestion[]
      const answers = (row.answers || {}) as Record<string, StoredAnswer>

      return {
        id: String(row.id),
        title: String(exam?.title || 'Экзамен'),
        status: String(row.status || 'pending'),
        // Экзамен «активен», пока на него можно отвечать. Разосланный, но не
        // начатый, и начатый — для оператора одно и то же: садись и сдавай.
        is_open: ['pending', 'sent', 'in_progress', 'undeliverable'].includes(String(row.status)),
        deadline_at: exam?.deadline_at || null,
        pass_score: Number(exam?.pass_score ?? 70),
        total_questions: Number(row.total_questions || questions.length || 0),
        answered: answeredCount(answers),
        current_index: Number(row.current_index || 0),
        score: row.score == null ? null : Number(row.score),
        passed: row.passed == null ? null : Boolean(row.passed),
        // Развёрнутые ответы проверяет руководитель — итог может измениться,
        // и обещать окончательный балл сразу было бы неправдой.
        has_open: questions.some((q) => q.type === 'open'),
        awaiting_review: Object.values(answers).some(
          (value) => isOpenAnswer(value) && !value.overridden,
        ),
        sent_at: row.sent_at || null,
        completed_at: row.completed_at || null,
      }
    })

    return json({ data: items })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/operator/exams GET',
      message: error?.message || 'error',
    })
    return json({ error: 'exams-failed' }, 500)
  }
}
