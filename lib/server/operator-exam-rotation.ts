import 'server-only'

/**
 * Ротация вопросов: хранение истории.
 *
 * Сам отбор — в `lib/domain/exam-rotation` (чистая логика, покрыта тестами).
 * Здесь только чтение и запись: что человеку задавали и где он ошибся.
 *
 * Все обращения мягкие: пока миграция не применена, ротации просто нет, а
 * экзамены работают как раньше.
 */

import { questionHash, type AskedQuestion } from '@/lib/domain/exam-rotation'

export {
  blockedHashes,
  pickWithRotation,
  questionHash,
  type AskedQuestion,
} from '@/lib/domain/exam-rotation'

/** Сколько дней истории читаем: дальше отсев всё равно не действует. */
const HISTORY_WINDOW_DAYS = 28

/** История вопросов оператора за период отсева. */
export async function loadAskedHistory(
  supabase: any,
  operatorIds: string[],
): Promise<Map<string, AskedQuestion[]>> {
  const out = new Map<string, AskedQuestion[]>()
  if (operatorIds.length === 0) return out

  const since = new Date()
  since.setDate(since.getDate() - HISTORY_WINDOW_DAYS)
  const sinceIso = since.toISOString().slice(0, 10)

  // Мягко: пока миграция не применена, ротации просто нет, а экзамены
  // работают как раньше.
  const { data } = await supabase
    .from('operator_exam_question_history')
    .select('operator_id, question_hash, asked_on, was_correct')
    .in('operator_id', operatorIds)
    .gte('asked_on', sinceIso)
    .then((r: any) => r, () => ({ data: null }))

  for (const row of (data || []) as any[]) {
    const key = String(row.operator_id)
    const list = out.get(key) || []
    list.push({
      question_hash: String(row.question_hash),
      asked_on: String(row.asked_on),
      was_correct: row.was_correct ?? null,
    })
    out.set(key, list)
  }

  return out
}

/** Запоминает, что эти вопросы человеку уже задавали. */
export async function rememberAsked(
  supabase: any,
  args: { organizationId: string; operatorId: string; questions: { q?: string }[] },
): Promise<void> {
  if (args.questions.length === 0) return

  const rows = args.questions.map((question) => ({
    organization_id: args.organizationId,
    operator_id: args.operatorId,
    question_hash: questionHash(question),
    question_text: String(question?.q || '').slice(0, 500),
  }))

  await supabase
    .from('operator_exam_question_history')
    .insert(rows)
    .then(
      (r: any) => r,
      () => null,
    )
}


/**
 * Отмечает в истории, на каких вопросах человек ошибся.
 *
 * Ошибочный вопрос возвращается через две недели, верный — через месяц.
 * Обновляем только последнюю запись по каждому отпечатку: один и тот же
 * вопрос мог задаваться и раньше, и та история уже закрыта.
 */
export async function markAnswerHistory(
  supabase: any,
  args: { operatorId: string; questions: { q?: string }[]; wrong: { q?: string }[] },
): Promise<void> {
  if (args.questions.length === 0) return

  const wrongHashes = new Set(args.wrong.map(questionHash))

  for (const question of args.questions) {
    const hash = questionHash(question)
    await supabase
      .from('operator_exam_question_history')
      .update({ was_correct: !wrongHashes.has(hash) })
      .eq('operator_id', args.operatorId)
      .eq('question_hash', hash)
      .is('was_correct', null)
      .then(
        (r: any) => r,
        () => null,
      )
  }
}
