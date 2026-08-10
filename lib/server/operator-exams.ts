import 'server-only'

import { logAiUsageSafe } from '@/lib/ai/usage-tracker'
import { answerTelegramCallback, editTelegramMessage, sendTelegramMessage } from '@/lib/telegram/send'

/**
 * Экзамен оператора: сборка билета из стандартов точки и диалог в Telegram.
 *
 * Билет генерится ОДИН раз при назначении и хранится в попытке целиком — чтобы
 * правка статьи посреди экзамена не меняла вопросы, на которые человек уже
 * ответил, и чтобы разбор ошибок ссылался ровно на ту версию, что спрашивали.
 */

const OPENAI_MODEL = process.env.OPENAI_QUIZ_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini'
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

export type ExamQuestion = {
  article_id: string
  company_id: string | null
  article_title: string
  q: string
  choices: string[]
  correct: number
}

export type ExamAttemptRow = {
  id: string
  exam_id: string
  organization_id: string
  operator_id: string
  telegram_chat_id: string | null
  status: 'pending' | 'sent' | 'in_progress' | 'completed' | 'expired' | 'undeliverable'
  questions: ExamQuestion[]
  answers: Record<string, number>
  current_index: number
  total_questions: number
  correct_answers: number
  score: number | null
  passed: boolean | null
}

type SupabaseLike = any

function esc(value: string | null | undefined): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const LETTERS = ['А', 'Б', 'В', 'Г']

// ─── Генерация билета ──────────────────────────────────────────────────────

/**
 * Собирает вопросы по статьям выбранных точек.
 *
 * Вопрос делается ПО КОНКРЕТНОЙ статье конкретной точки — это главная защита
 * от списывания: «сколько стоит час в прайме на Аргынбекова» внешняя нейросеть
 * не угадает, ответ есть только в твоём регламенте. Общие вопросы про сервис
 * бесполезны — их проходит кто угодно.
 */
export async function generateExamQuestions(params: {
  supabase: SupabaseLike
  organizationId: string
  companyIds: string[]
  questionCount: number
}): Promise<{ questions: ExamQuestion[]; error?: string }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return { questions: [], error: 'openai-not-configured' }

  let query = params.supabase
    .from('knowledge_articles')
    .select('id, company_id, title, content')
    .eq('organization_id', params.organizationId)
    .eq('is_published', true)
    .limit(200)

  // Статьи выбранных точек + общесетевые (company_id is null).
  if (params.companyIds.length > 0) {
    query = query.or(`company_id.is.null,company_id.in.(${params.companyIds.join(',')})`)
  }

  const { data: articles, error } = await query
  if (error) return { questions: [], error: `articles-load-failed: ${error.message}` }

  const usable = ((articles || []) as Array<{ id: string; company_id: string | null; title: string; content: string | null }>)
    .filter((a) => String(a.content || '').trim().length >= 80)

  if (usable.length < 3) {
    return { questions: [], error: 'not-enough-articles' }
  }

  // Берём столько статей, сколько нужно вопросов; если статей меньше — пойдём
  // по кругу, но каждая статья даст свой вопрос не более одного раза.
  const shuffled = [...usable].sort(() => Math.random() - 0.5)
  const selected = shuffled.slice(0, Math.min(params.questionCount, shuffled.length))

  const systemPrompt = [
    'Ты составляешь экзамен для оператора точки (игровой клуб / магазин / общепит).',
    'На основе регламента точки сформулируй ОДИН вопрос с 4 вариантами ответа.',
    'Требования:',
    '- вопрос должен проверять знание КОНКРЕТИКИ этого регламента (суммы, порядок действий, к кому обращаться), а не общую эрудицию;',
    '- один вариант верный, три правдоподобных но неверных;',
    '- вопрос и варианты — на языке регламента;',
    '- формулируй так, чтобы ответ нельзя было угадать без чтения регламента.',
    '',
    'Формат ответа — строго JSON:',
    '{ "q": "Вопрос?", "choices": ["A", "B", "C", "D"], "correct": 0 }',
    'correct — индекс правильного варианта (0..3).',
  ].join('\n')

  const results = await Promise.all(
    selected.map(async (article): Promise<ExamQuestion | null> => {
      try {
        const res = await fetch(OPENAI_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: OPENAI_MODEL,
            ...(OPENAI_MODEL.startsWith('gpt-5') ? { reasoning_effort: 'low' } : { temperature: 0.7 }),
            max_completion_tokens: 600,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemPrompt },
              {
                role: 'user',
                content: `Регламент «${article.title}»:\n\n${String(article.content || '').slice(0, 1200)}\n\nСоставь вопрос по этому регламенту.`,
              },
            ],
          }),
        })
        if (!res.ok) return null

        const data = await res.json().catch(() => null)
        const parsed = JSON.parse(data?.choices?.[0]?.message?.content || '{}')
        if (
          typeof parsed.q !== 'string' ||
          !Array.isArray(parsed.choices) ||
          parsed.choices.length !== 4 ||
          typeof parsed.correct !== 'number'
        ) {
          return null
        }

        return {
          article_id: String(article.id),
          company_id: article.company_id || null,
          article_title: String(article.title || ''),
          q: String(parsed.q),
          choices: parsed.choices.map((c: unknown) => String(c)),
          correct: Math.max(0, Math.min(3, Math.round(parsed.correct))),
        }
      } catch {
        return null
      }
    }),
  )

  const questions = results.filter((q): q is ExamQuestion => q !== null)
  if (questions.length === 0) return { questions: [], error: 'generation-failed' }

  await logAiUsageSafe(params.supabase, {
    userId: null,
    endpoint: '/api/admin/operator-exams',
    model: OPENAI_MODEL,
    payload: { questions: questions.length, companies: params.companyIds.length, source: 'operator-exam' },
  })

  return { questions }
}

/**
 * Личный билет оператора из общего пула вопросов.
 *
 * Пул генерится один раз на экзамен (дорого дёргать GPT на каждого), а вот
 * подборка и порядок вариантов у каждого свои — чтобы «Б, А, Г, В» из соседнего
 * чата не работало как ответ.
 */
export function buildOperatorTicket(pool: ExamQuestion[], count: number): ExamQuestion[] {
  const picked = [...pool].sort(() => Math.random() - 0.5).slice(0, Math.min(count, pool.length))
  return picked.map((question) => {
    const order = question.choices.map((_, i) => i).sort(() => Math.random() - 0.5)
    return {
      ...question,
      choices: order.map((i) => question.choices[i]),
      correct: order.indexOf(question.correct),
    }
  })
}

// ─── Диалог в Telegram ─────────────────────────────────────────────────────

function questionMarkup(attemptId: string, index: number, choices: string[]) {
  return {
    inline_keyboard: choices.map((_, choiceIndex) => [
      { text: `${LETTERS[choiceIndex] || choiceIndex + 1}`, callback_data: `exam:${attemptId}:${index}:${choiceIndex}` },
    ]),
  }
}

function questionText(params: { title: string; index: number; total: number; question: ExamQuestion }) {
  const lines = [
    `📝 <b>${esc(params.title)}</b>`,
    `Вопрос <b>${params.index + 1}</b> из ${params.total}`,
    '',
    esc(params.question.q),
    '',
    ...params.question.choices.map((choice, i) => `<b>${LETTERS[i] || i + 1}.</b> ${esc(choice)}`),
  ]
  return lines.join('\n')
}

/** Отправить оператору очередной вопрос. Возвращает ok/ошибку доставки. */
export async function sendExamQuestion(params: {
  attempt: ExamAttemptRow
  examTitle: string
}): Promise<{ ok: boolean; error?: string }> {
  const { attempt } = params
  if (!attempt.telegram_chat_id) return { ok: false, error: 'Не указан Telegram оператора' }

  const question = attempt.questions[attempt.current_index]
  if (!question) return { ok: false, error: 'Вопрос не найден' }

  return sendTelegramMessage(
    attempt.telegram_chat_id,
    questionText({
      title: params.examTitle,
      index: attempt.current_index,
      total: attempt.total_questions,
      question,
    }),
    { replyMarkup: questionMarkup(attempt.id, attempt.current_index, question.choices) },
  )
}

/** Подсчёт результата по сохранённым ответам. */
export function scoreAttempt(questions: ExamQuestion[], answers: Record<string, number>) {
  let correct = 0
  const wrong: ExamQuestion[] = []
  questions.forEach((question, index) => {
    if (answers[String(index)] === question.correct) correct += 1
    else wrong.push(question)
  })
  const total = questions.length
  return { correct, total, wrong, score: total > 0 ? Math.round((correct / total) * 100) : 0 }
}

/**
 * Обработка нажатия варианта в чате.
 *
 * Идемпотентна по (попытка, вопрос): повторное нажатие по уже отвеченному
 * вопросу ничего не меняет — Telegram легко присылает дубли, а «часики» на
 * кнопке провоцируют человека жать ещё раз.
 */
export async function handleExamAnswer(params: {
  supabase: SupabaseLike
  attemptId: string
  questionIndex: number
  choiceIndex: number
  chatId: string
  callbackQueryId: string
  messageId?: number
}): Promise<void> {
  const { supabase } = params

  const { data: attemptRow } = await supabase
    .from('operator_exam_attempts')
    .select('id, exam_id, organization_id, operator_id, telegram_chat_id, status, questions, answers, current_index, total_questions')
    .eq('id', params.attemptId)
    .maybeSingle()

  const attempt = attemptRow as ExamAttemptRow | null
  if (!attempt) {
    await answerTelegramCallback(params.callbackQueryId, 'Экзамен не найден', true)
    return
  }
  // Отвечать может только тот чат, куда экзамен был отправлен.
  if (String(attempt.telegram_chat_id || '') !== String(params.chatId)) {
    await answerTelegramCallback(params.callbackQueryId, 'Это не ваш экзамен', true)
    return
  }
  if (attempt.status === 'completed') {
    await answerTelegramCallback(params.callbackQueryId, 'Экзамен уже завершён', true)
    return
  }
  if (attempt.status === 'expired' || attempt.status === 'undeliverable') {
    await answerTelegramCallback(params.callbackQueryId, 'Экзамен закрыт', true)
    return
  }

  const answers = { ...(attempt.answers || {}) }
  if (answers[String(params.questionIndex)] !== undefined) {
    await answerTelegramCallback(params.callbackQueryId, 'На этот вопрос вы уже ответили')
    return
  }

  const question = attempt.questions?.[params.questionIndex]
  if (!question) {
    await answerTelegramCallback(params.callbackQueryId, 'Вопрос не найден', true)
    return
  }

  answers[String(params.questionIndex)] = params.choiceIndex
  const nextIndex = params.questionIndex + 1
  const finished = nextIndex >= attempt.total_questions

  const { data: exam } = await supabase
    .from('operator_exams')
    .select('id, title, pass_score')
    .eq('id', attempt.exam_id)
    .maybeSingle()
  const examTitle = String((exam as any)?.title || 'Экзамен')
  const passScore = Number((exam as any)?.pass_score ?? 70)

  await answerTelegramCallback(params.callbackQueryId, `Принято: ${LETTERS[params.choiceIndex] || params.choiceIndex + 1}`)

  // Снимаем кнопки с отвеченного вопроса — иначе к нему можно вернуться скроллом.
  if (params.messageId) {
    await editTelegramMessage(
      params.chatId,
      params.messageId,
      [
        `📝 <b>${esc(examTitle)}</b>`,
        `Вопрос <b>${params.questionIndex + 1}</b> из ${attempt.total_questions} — ответ принят`,
        '',
        esc(question.q),
        '',
        `Ваш ответ: <b>${LETTERS[params.choiceIndex] || params.choiceIndex + 1}. ${esc(question.choices[params.choiceIndex] || '')}</b>`,
      ].join('\n'),
    )
  }

  if (!finished) {
    const patch: Record<string, unknown> = {
      answers,
      current_index: nextIndex,
      status: 'in_progress',
    }
    // Момент старта фиксируем на первом ответе — по нему видно, сколько человек
    // тянул с началом и сколько потратил на сам экзамен.
    if (attempt.status !== 'in_progress') patch.started_at = new Date().toISOString()

    await supabase.from('operator_exam_attempts').update(patch).eq('id', attempt.id)

    await sendExamQuestion({
      attempt: { ...attempt, answers, current_index: nextIndex },
      examTitle,
    })
    return
  }

  // ─── Финал ───────────────────────────────────────────────────────────────
  const result = scoreAttempt(attempt.questions || [], answers)
  const passed = result.score >= passScore

  await supabase
    .from('operator_exam_attempts')
    .update({
      answers,
      current_index: nextIndex,
      status: 'completed',
      correct_answers: result.correct,
      score: result.score,
      passed,
      completed_at: new Date().toISOString(),
    })
    .eq('id', attempt.id)

  // Разбор ошибок: какие регламенты перечитать. Сами верные ответы не шлём —
  // иначе билет утечёт следующему сдающему через пересылку сообщения.
  const toReview = Array.from(new Set(result.wrong.map((q) => q.article_title))).slice(0, 10)

  const summary = [
    passed ? '✅ <b>Экзамен сдан</b>' : '❌ <b>Экзамен не сдан</b>',
    '',
    `<b>${esc(examTitle)}</b>`,
    `Результат: <b>${result.score}%</b> (${result.correct} из ${result.total}), порог ${passScore}%`,
    ...(toReview.length > 0
      ? ['', '📚 <b>Перечитать:</b>', ...toReview.map((title) => `• ${esc(title)}`)]
      : []),
    '',
    passed ? '<i>Хорошая работа.</i>' : '<i>Результат отправлен руководителю. О пересдаче сообщат отдельно.</i>',
  ].join('\n')

  await sendTelegramMessage(params.chatId, summary)
}
