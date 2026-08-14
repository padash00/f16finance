import 'server-only'

import { logAiUsageSafe } from '@/lib/ai/usage-tracker'
import { sendTelegram } from '@/lib/server/telegram'
import { answerTelegramCallback, editTelegramMessage, sendTelegramMessage } from '@/lib/telegram/send'

/**
 * Экзамен оператора: сборка билета из стандартов точки и диалог в Telegram.
 *
 * Билет генерится ОДИН раз при назначении и хранится в попытке целиком — чтобы
 * правка статьи посреди экзамена не меняла вопросы, на которые человек уже
 * ответил, и чтобы разбор ошибок ссылался ровно на ту версию, что спрашивали.
 */

const OPENAI_MODEL = process.env.OPENAI_QUIZ_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini'
import { analyzeOpenAnswer, type IntegrityReport } from '@/lib/server/exam-integrity'

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

export type ExamQuestion = {
  article_id: string
  company_id: string | null
  article_title: string
  q: string
  /** 'choice' — тест с вариантами, 'open' — ситуационный со свободным ответом. */
  type?: 'choice' | 'open'
  choices: string[]
  correct: number
  /** Только для open: по каким критериям оценивать. */
  rubric?: string[]
  /** Только для open: выдержка из регламента, с которой сверяется ответ. */
  reference?: string
  /** Только для open: максимум баллов (у теста всегда 1). */
  max_score?: number
}

/** Оценка развёрнутого ответа: предложение ИИ либо ручная правка владельца. */
export type OpenAnswer = {
  text: string
  score: number
  max: number
  justification: string
  citation: string
  overridden?: boolean
  override_comment?: string | null
  /** Признаки несамостоятельного ответа. Не вердикт — повод посмотреть глазами. */
  integrity?: IntegrityReport
}

export type StoredAnswer = number | OpenAnswer

export function isOpenAnswer(value: unknown): value is OpenAnswer {
  return !!value && typeof value === 'object' && 'text' in (value as Record<string, unknown>)
}

export type ExamAttemptRow = {
  id: string
  exam_id: string
  organization_id: string
  operator_id: string
  telegram_chat_id: string | null
  status: 'pending' | 'sent' | 'in_progress' | 'completed' | 'expired' | 'undeliverable'
  questions: ExamQuestion[]
  answers: Record<string, StoredAnswer>
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
type ExamArticle = {
  id: string
  company_id: string | null
  title: string
  content: string | null
  industry: string | null
  topic_key: string | null
}

/**
 * Опубликованные регламенты, применимые к выбранным точкам.
 *
 * Общесетевая статья с отраслевой пометкой годится только «своим» — иначе
 * продавец корейского магазина получал бы вопрос про поломку игрового ПК.
 */
async function loadExamArticles(params: {
  supabase: SupabaseLike
  organizationId: string
  companyIds: string[]
}): Promise<ExamArticle[]> {
  let query = params.supabase
    .from('knowledge_articles')
    .select('id, company_id, title, content, industry, topic_key')
    .eq('organization_id', params.organizationId)
    .eq('is_published', true)
    .limit(200)

  if (params.companyIds.length > 0) {
    query = query.or(`company_id.is.null,company_id.in.(${params.companyIds.join(',')})`)
  }

  const { data: articles, error } = await query
  if (error) return []

  // Все точки организации, а не только выбранные: нужно знать, как называются
  // чужие, чтобы узнать их в тексте общей статьи.
  const { data: allCompanyRows } = await params.supabase
    .from('companies')
    .select('id, name, industry')
    .eq('organization_id', params.organizationId)

  const allCompanies = ((allCompanyRows || []) as Array<{ id: string; name: string | null; industry: string | null }>)
  const selectedSet = new Set(params.companyIds)
  const industries = new Set(
    allCompanies
      .filter((row) => selectedSet.has(row.id))
      .map((row) => row.industry)
      .filter((value): value is string => !!value),
  )

  const ownWords = companyWords(allCompanies.filter((row) => selectedSet.has(row.id)))
  const foreignWords = companyWords(allCompanies.filter((row) => !selectedSet.has(row.id))).filter(
    (word) => !ownWords.includes(word),
  )

  return ((articles || []) as ExamArticle[])
    .filter((a) => String(a.content || '').trim().length >= 80)
    .filter((a) => {
      if (a.company_id) return true
      if (a.industry && !industries.has(a.industry)) return false
      // Регламент часто пишут одним документом на всю сеть: раздел про Arena
      // лежит как общий и без правки утекает в экзамен для Ramen. Если общая
      // статья говорит про чужую точку и молчит про свою — она не наша.
      return !mentionsForeignPoint(a, ownWords, foreignWords)
    })
    .sort((left, right) => {
      // Статьи своей точки идут первыми: их всегда должно хватить на билет.
      const l = left.company_id ? 0 : 1
      const r = right.company_id ? 0 : 1
      return l - r
    })
}

/** Названия точек экзамена — их модель должна видеть в промпте. */
async function examPointNames(supabase: SupabaseLike, companyIds: string[]): Promise<string[]> {
  if (!companyIds.length) return []
  const { data } = await supabase.from('companies').select('name').in('id', companyIds)
  return ((data || []) as Array<{ name: string | null }>)
    .map((row) => String(row.name || '').trim())
    .filter(Boolean)
}

/** Опорные слова названий точек: «F16 Ramen» → ['f16 ramen', 'ramen']. */
function companyWords(companies: Array<{ name: string | null }>): string[] {
  const words: string[] = []
  for (const company of companies) {
    const name = String(company.name || '').trim().toLowerCase()
    if (!name) continue
    words.push(name)
    const last = name.split(/\s+/).filter(Boolean).pop() || ''
    // Короткие хвосты вроде «б» или «№2» ловят что попало — берём от 4 букв.
    if (last.length >= 4 && last !== name) words.push(last)
  }
  return Array.from(new Set(words))
}

/** Общая статья явно про чужую точку и ни разу не про нашу. */
function mentionsForeignPoint(article: ExamArticle, ownWords: string[], foreignWords: string[]): boolean {
  if (foreignWords.length === 0) return false
  const haystack = `${article.title || ''} ${String(article.content || '').slice(0, 4000)}`.toLowerCase()
  const hitsForeign = foreignWords.some((word) => haystack.includes(word))
  if (!hitsForeign) return false
  const hitsOwn = ownWords.some((word) => haystack.includes(word))
  return !hitsOwn
}

export async function generateExamQuestions(params: {
  supabase: SupabaseLike
  organizationId: string
  companyIds: string[]
  questionCount: number
}): Promise<{ questions: ExamQuestion[]; error?: string }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return { questions: [], error: 'openai-not-configured' }

  const usable = await loadExamArticles({
    supabase: params.supabase,
    organizationId: params.organizationId,
    companyIds: params.companyIds,
  })

  if (usable.length < 3) {
    return { questions: [], error: 'not-enough-articles' }
  }

  // Берём столько статей, сколько нужно вопросов; если статей меньше — пойдём
  // по кругу, но каждая статья даст свой вопрос не более одного раза.
  const shuffled = [...usable].sort(() => Math.random() - 0.5)
  const selected = shuffled.slice(0, Math.min(params.questionCount, shuffled.length))

  const pointNames = await examPointNames(params.supabase, params.companyIds)
  const scopeLine = pointNames.length
    ? `Экзамен для точек: ${pointNames.join(', ')}. Спрашивай только то, что относится к этим точкам: не упоминай оборудование, системы и правила других точек сети, даже если они есть в тексте.`
    : ''

  const systemPrompt = [
    'Ты составляешь экзамен для оператора точки (игровой клуб / магазин / общепит).',
    'На основе регламента точки сформулируй ОДИН вопрос с 4 вариантами ответа.',
    scopeLine,
    'Требования:',
    '- вопрос должен проверять знание КОНКРЕТИКИ этого регламента (суммы, порядок действий, к кому обращаться), а не общую эрудицию;',
    '- один вариант верный, три правдоподобных но неверных;',
    '- вопрос и варианты — на языке регламента;',
    '- формулируй так, чтобы ответ нельзя было угадать без чтения регламента.',
    '',
    'Формат ответа — строго JSON:',
    '{ "q": "Вопрос?", "choices": ["A", "B", "C", "D"], "correct": 0 }',
    'correct — индекс правильного варианта (0..3).',
  ]
    .filter(Boolean)
    .join('\n')

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
          type: 'choice' as const,
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

const OPEN_MAX_SCORE = 5

/**
 * Ситуационные вопросы: «клиент требует вернуть деньги за час, который сам не
 * доиграл — твои действия». Тестом такое не проверишь, поэтому спрашиваем
 * развёрнутый ответ и оцениваем его по рубрике из того же регламента.
 *
 * Рубрику придумывает не проверяющая модель, а эта — заранее и из текста
 * регламента. Иначе оценка каждый раз опиралась бы на новые, ниоткуда не
 * взявшиеся критерии, и спорить с ней было бы невозможно.
 */
export async function generateOpenQuestions(params: {
  supabase: SupabaseLike
  organizationId: string
  companyIds: string[]
  count: number
}): Promise<ExamQuestion[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey || params.count <= 0) return []

  const articles = await loadExamArticles({
    supabase: params.supabase,
    organizationId: params.organizationId,
    companyIds: params.companyIds,
  })
  if (articles.length === 0) return []

  // Ситуации интереснее по «мягким» темам — общение, конфликты, спорные случаи.
  const priority = ['conflict_basics', 'communication_tone', 'shop_returns', 'food_complaints', 'ps_disputes', 'club_noise_alcohol']
  const sorted = [...articles].sort((left, right) => {
    const l = priority.includes(String(left.topic_key || '')) ? 0 : 1
    const r = priority.includes(String(right.topic_key || '')) ? 0 : 1
    return l - r || Math.random() - 0.5
  })
  const selected = sorted.slice(0, Math.min(params.count, sorted.length))

  const openPointNames = await examPointNames(params.supabase, params.companyIds)
  const openScopeLine = openPointNames.length
    ? `Задание для точек: ${openPointNames.join(', ')}. Описывай только их работу: оборудование, системы и правила других точек сети упоминать нельзя.`
    : ''

  const systemPrompt = [
    'Ты составляешь ситуационное задание для аттестации сотрудника точки.',
    openScopeLine,
    'На основе регламента придумай РЕАЛЬНУЮ рабочую ситуацию и спроси, как сотрудник поступит.',
    'Требования:',
    '- ситуация конкретная и правдоподобная, из повседневной работы;',
    '- ответ на неё должен следовать из регламента, а не из общих соображений;',
    '- рубрика: 3–4 коротких критерия, по которым будет оцениваться ответ;',
    '- каждый критерий проверяем: «назвал порядок действий», «не обещал того, чего нельзя», «сказал, когда звать руководителя».',
    '',
    'Формат ответа — строго JSON:',
    '{ "q": "Ситуация и вопрос", "rubric": ["критерий 1", "критерий 2", "критерий 3"] }',
  ]
    .filter(Boolean)
    .join('\n')

  const results = await Promise.all(
    selected.map(async (article): Promise<ExamQuestion | null> => {
      try {
        const res = await fetch(OPENAI_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: OPENAI_MODEL,
            ...(OPENAI_MODEL.startsWith('gpt-5') ? { reasoning_effort: 'low' } : { temperature: 0.8 }),
            max_completion_tokens: 700,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: systemPrompt },
              {
                role: 'user',
                content: `Регламент «${article.title}»:\n\n${String(article.content || '').slice(0, 1200)}\n\nПридумай ситуацию по этому регламенту.`,
              },
            ],
          }),
        })
        if (!res.ok) return null

        const data = await res.json().catch(() => null)
        const parsed = JSON.parse(data?.choices?.[0]?.message?.content || '{}')
        if (typeof parsed.q !== 'string' || !Array.isArray(parsed.rubric) || parsed.rubric.length === 0) return null

        return {
          article_id: String(article.id),
          company_id: article.company_id || null,
          article_title: String(article.title || ''),
          type: 'open',
          q: String(parsed.q),
          choices: [],
          correct: -1,
          rubric: parsed.rubric.slice(0, 4).map((item: unknown) => String(item)),
          reference: String(article.content || '').slice(0, 1500),
          max_score: OPEN_MAX_SCORE,
        }
      } catch {
        return null
      }
    }),
  )

  return results.filter((item): item is ExamQuestion => item !== null)
}

/**
 * Личный билет оператора из общего пула вопросов.
 *
 * Пул генерится один раз на экзамен (дорого дёргать GPT на каждого), а вот
 * подборка и порядок вариантов у каждого свои — чтобы «Б, А, Г, В» из соседнего
 * чата не работало как ответ.
 */
export function buildOperatorTicket(
  pool: ExamQuestion[],
  count: number,
  openPool: ExamQuestion[] = [],
  openCount = 0,
): ExamQuestion[] {
  const picked = [...pool].sort(() => Math.random() - 0.5).slice(0, Math.min(count, pool.length))
  const shuffled = picked.map((question) => {
    const order = question.choices.map((_, i) => i).sort(() => Math.random() - 0.5)
    return {
      ...question,
      type: 'choice' as const,
      choices: order.map((i) => question.choices[i]),
      correct: order.indexOf(question.correct),
    }
  })

  // Ситуационные идут в конце: они дольше и тяжелее, и если поставить их первыми,
  // часть людей бросит экзамен на первом же вопросе.
  const open = [...openPool].sort(() => Math.random() - 0.5).slice(0, Math.min(openCount, openPool.length))
  return [...shuffled, ...open]
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
  const isOpen = params.question.type === 'open'
  const header = [
    `📝 <b>${esc(params.title)}</b>`,
    `Вопрос <b>${params.index + 1}</b> из ${params.total}${isOpen ? ' · развёрнутый ответ' : ''}`,
    '',
    esc(params.question.q),
  ]

  if (!isOpen) {
    return [...header, '', ...params.question.choices.map((choice, i) => `<b>${LETTERS[i] || i + 1}.</b> ${esc(choice)}`)].join('\n')
  }

  return [
    ...header,
    '',
    '<i>Ответьте сообщением — своими словами, по пунктам. Оценивается полнота и соответствие регламенту.</i>',
    ...(params.question.rubric?.length
      ? ['', '<b>Что учитывается:</b>', ...params.question.rubric.map((item) => `• ${esc(item)}`)]
      : []),
  ].join('\n')
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

  const text = questionText({
    title: params.examTitle,
    index: attempt.current_index,
    total: attempt.total_questions,
    question,
  })

  // У ситуационного вопроса кнопок нет — ответ приходит обычным сообщением.
  return sendTelegramMessage(
    attempt.telegram_chat_id,
    text,
    question.type === 'open'
      ? undefined
      : { replyMarkup: questionMarkup(attempt.id, attempt.current_index, question.choices) },
  )
}

/**
 * Подсчёт результата.
 *
 * Считаем долю НАБРАННЫХ баллов, а не долю верных вопросов: у теста вес 1, у
 * ситуационного — до 5. Иначе один развёрнутый ответ весил бы столько же,
 * сколько угаданный вариант из четырёх.
 */
export function scoreAttempt(questions: ExamQuestion[], answers: Record<string, StoredAnswer>) {
  let earned = 0
  let max = 0
  let correct = 0
  const wrong: ExamQuestion[] = []

  questions.forEach((question, index) => {
    const answer = answers[String(index)]
    if (question.type === 'open') {
      const questionMax = Number(question.max_score || OPEN_MAX_SCORE)
      max += questionMax
      const score = isOpenAnswer(answer) ? Number(answer.score || 0) : 0
      earned += score
      // «Верным» считаем ответ, взявший больше половины рубрики.
      if (score * 2 >= questionMax) correct += 1
      else wrong.push(question)
      return
    }

    max += 1
    if (answer === question.correct) {
      earned += 1
      correct += 1
    } else {
      wrong.push(question)
    }
  })

  return {
    correct,
    total: questions.length,
    wrong,
    earned,
    max,
    score: max > 0 ? Math.round((earned / max) * 100) : 0,
  }
}

/** Оценка развёрнутого ответа по рубрике вопроса. */
export async function gradeOpenAnswer(params: {
  question: ExamQuestion
  answer: string
}): Promise<OpenAnswer> {
  const max = Number(params.question.max_score || OPEN_MAX_SCORE)
  const fallback: OpenAnswer = {
    text: params.answer,
    score: 0,
    max,
    justification: 'Автооценка недоступна — требуется проверка вручную.',
    citation: '',
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return fallback

  const systemPrompt = [
    'Ты проверяешь ответ сотрудника на ситуационный вопрос по внутреннему регламенту.',
    `Оцени ответ целым числом от 0 до ${max} строго по рубрике.`,
    'Правила оценки:',
    '- опирайся ТОЛЬКО на текст регламента, а не на свои представления о том, как правильно;',
    '- ответ своими словами и не по пунктам — это нормально, оценивается суть;',
    '- если ответ противоречит регламенту — низкий балл, даже если звучит разумно;',
    '- если регламент не покрывает ситуацию — не снижай балл за это;',
    '- обоснование: 1–2 предложения, конкретно чего не хватило;',
    '- citation: дословная цитата из регламента, подтверждающая оценку (пустая строка, если подходящей нет).',
    '',
    'Формат ответа — строго JSON:',
    '{ "score": 0, "justification": "...", "citation": "..." }',
  ].join('\n')

  try {
    const res = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        ...(OPENAI_MODEL.startsWith('gpt-5') ? { reasoning_effort: 'low' } : { temperature: 0.2 }),
        max_completion_tokens: 700,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              `Регламент «${params.question.article_title}»:`,
              params.question.reference || '',
              '',
              `Ситуация: ${params.question.q}`,
              '',
              'Рубрика:',
              ...(params.question.rubric || []).map((item) => `- ${item}`),
              '',
              `Ответ сотрудника:\n${params.answer}`,
            ].join('\n'),
          },
        ],
      }),
    })
    if (!res.ok) return fallback

    const data = await res.json().catch(() => null)
    const parsed = JSON.parse(data?.choices?.[0]?.message?.content || '{}')
    const score = Math.max(0, Math.min(max, Math.round(Number(parsed.score))))
    if (!Number.isFinite(score)) return fallback

    return {
      text: params.answer,
      score,
      max,
      justification: String(parsed.justification || ''),
      citation: String(parsed.citation || ''),
    }
  } catch {
    return fallback
  }
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
    .select('id, exam_id, organization_id, operator_id, telegram_chat_id, status, questions, answers, current_index, total_questions, updated_at')
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

  await advanceAttempt({
    supabase,
    attempt,
    answers,
    nextIndex,
    examTitle,
    passScore,
    chatId: params.chatId,
  })
}

/**
 * Приём развёрнутого ответа обычным сообщением.
 *
 * Возвращает true, если сообщение было ответом на экзамен — тогда webhook не
 * должен отдавать его копилоту. Иначе «клиент требует вернуть деньги...» уйдёт
 * ИИ-ассистенту, и тот начнёт заводить расход.
 */
export async function handleExamTextAnswer(params: {
  supabase: SupabaseLike
  chatId: string
  text: string
}): Promise<boolean> {
  const { supabase } = params
  if (!params.text || params.text.startsWith('/')) return false

  const { data: attemptRow } = await supabase
    .from('operator_exam_attempts')
    .select('id, exam_id, organization_id, operator_id, telegram_chat_id, status, questions, answers, current_index, total_questions')
    .eq('telegram_chat_id', String(params.chatId))
    .in('status', ['sent', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const attempt = attemptRow as ExamAttemptRow | null
  if (!attempt) return false

  const question = attempt.questions?.[attempt.current_index]
  // Текущий вопрос с вариантами — сообщение к экзамену не относится, отдаём дальше.
  if (!question || question.type !== 'open') return false

  if (params.text.trim().length < 15) {
    await sendTelegramMessage(
      params.chatId,
      '✍️ <i>Ответ слишком короткий. Опишите порядок действий — хотя бы пару предложений.</i>',
    )
    return true
  }

  const { data: exam } = await supabase
    .from('operator_exams')
    .select('id, title, pass_score')
    .eq('id', attempt.exam_id)
    .maybeSingle()
  const examTitle = String((exam as any)?.title || 'Экзамен')
  const passScore = Number((exam as any)?.pass_score ?? 70)

  await sendTelegramMessage(params.chatId, '⏳ <i>Проверяю ответ…</i>')

  const graded = await gradeOpenAnswer({ question, answer: params.text.trim() })
  const answers = { ...(attempt.answers || {}) } as Record<string, StoredAnswer>
  answers[String(attempt.current_index)] = graded

  await advanceAttempt({
    supabase,
    attempt,
    answers,
    nextIndex: attempt.current_index + 1,
    examTitle,
    passScore,
    chatId: params.chatId,
  })

  return true
}

/**
 * Ответ из приложения.
 *
 * Telegram остаётся, но перестаёт быть единственной дверью: у половины
 * операторов его нет, и такие попытки помечались «недоставлено» — человек
 * числился обязанным сдать экзамен, которого не видел.
 *
 * Правильные ответы наружу не отдаём ни здесь, ни в ответе роута: билет
 * утечёт следующему сдающему через один скриншот.
 */
export async function submitExamAnswer(params: {
  supabase: SupabaseLike
  attemptId: string
  operatorId: string
  questionIndex: number
  choiceIndex?: number
  text?: string
}): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const { supabase } = params

  const { data: attemptRow } = await supabase
    .from('operator_exam_attempts')
    .select('id, exam_id, organization_id, operator_id, telegram_chat_id, status, questions, answers, current_index, total_questions')
    .eq('id', params.attemptId)
    .maybeSingle()

  const attempt = attemptRow as ExamAttemptRow | null
  if (!attempt) return { ok: false, error: 'Экзамен не найден', status: 404 }
  // Чужую попытку не трогаем: иначе сдать экзамен можно было бы за товарища.
  if (String(attempt.operator_id) !== String(params.operatorId)) {
    return { ok: false, error: 'Это не ваш экзамен', status: 403 }
  }
  if (attempt.status === 'completed') return { ok: false, error: 'Экзамен уже завершён', status: 409 }
  if (attempt.status === 'expired') return { ok: false, error: 'Экзамен закрыт', status: 409 }

  // Отвечают строго на текущий вопрос: вернуться к прошлому и переписать
  // ответ нельзя, иначе оценка перестаёт что-либо значить.
  if (params.questionIndex !== attempt.current_index) {
    return { ok: false, error: 'Вопрос уже пройден', status: 409 }
  }

  const answers = { ...(attempt.answers || {}) } as Record<string, StoredAnswer>
  if (answers[String(params.questionIndex)] !== undefined) {
    return { ok: false, error: 'На этот вопрос вы уже ответили', status: 409 }
  }

  const question = attempt.questions?.[params.questionIndex]
  if (!question) return { ok: false, error: 'Вопрос не найден', status: 404 }

  const { data: exam } = await supabase
    .from('operator_exams')
    .select('id, title, pass_score')
    .eq('id', attempt.exam_id)
    .maybeSingle()
  const examTitle = String((exam as any)?.title || 'Экзамен')
  const passScore = Number((exam as any)?.pass_score ?? 70)

  if (question.type === 'open') {
    const text = String(params.text || '').trim()
    if (text.length < 15) {
      return { ok: false, error: 'Опишите порядок действий — хотя бы пару предложений', status: 400 }
    }

    // Время думания: updated_at обновляется при выдаче вопроса, поэтому разница
    // до текущего момента — это ровно столько, сколько человек отвечал.
    const askedAt = (attemptRow as any)?.updated_at ? new Date(String((attemptRow as any).updated_at)).getTime() : null
    const seconds = askedAt ? Math.max(0, Math.round((Date.now() - askedAt) / 1000)) : null

    const graded = await gradeOpenAnswer({ question, answer: text })
    const integrity = analyzeOpenAnswer({
      text,
      seconds,
      others: await siblingAnswers(supabase, attempt, question.q, params.questionIndex),
    })
    answers[String(params.questionIndex)] = integrity.risk > 0 ? { ...graded, integrity } : graded
  } else {
    const choice = Number(params.choiceIndex)
    if (!Number.isInteger(choice) || choice < 0 || choice >= (question.choices || []).length) {
      return { ok: false, error: 'Выберите вариант ответа', status: 400 }
    }
    answers[String(params.questionIndex)] = choice
  }

  await advanceAttempt({
    supabase,
    attempt,
    answers,
    nextIndex: params.questionIndex + 1,
    examTitle,
    passScore,
    // В Telegram дублируем, только если экзамен туда и отправляли: иначе
    // человек, сдающий в приложении, получит те же вопросы вторым потоком.
    chatId: attempt.telegram_chat_id ? String(attempt.telegram_chat_id) : null,
  })

  return { ok: true }
}

/**
 * Ответы других сотрудников на этот же вопрос в рамках экзамена.
 *
 * Билеты генерируются на каждую попытку отдельно, поэтому сравниваем по тексту
 * вопроса, а не по индексу: у коллеги тот же вопрос может стоять третьим.
 */
async function siblingAnswers(
  supabase: SupabaseLike,
  attempt: ExamAttemptRow,
  questionText: string,
  questionIndex: number,
): Promise<Array<{ operatorName?: string | null; text: string }>> {
  const needle = String(questionText || '').trim()
  if (!needle) return []

  const { data } = await supabase
    .from('operator_exam_attempts')
    .select('id, operator_id, questions, answers')
    .eq('exam_id', attempt.exam_id)
    .neq('id', attempt.id)
    .limit(50)

  const rows = (data || []) as Array<{ operator_id: string; questions: ExamQuestion[]; answers: Record<string, StoredAnswer> }>
  if (rows.length === 0) return []

  const operatorIds = Array.from(new Set(rows.map((row) => String(row.operator_id)).filter(Boolean)))
  const { data: operators } = await supabase.from('operators').select('id, name').in('id', operatorIds)
  const nameById = new Map(
    ((operators || []) as Array<{ id: string; name: string | null }>).map((row) => [String(row.id), row.name]),
  )

  const result: Array<{ operatorName?: string | null; text: string }> = []
  for (const row of rows) {
    const index = (row.questions || []).findIndex((item) => String(item?.q || '').trim() === needle)
    if (index < 0) continue
    const answer = (row.answers || {})[String(index)]
    if (!isOpenAnswer(answer)) continue
    const text = String(answer.text || '').trim()
    if (text.length < 15) continue
    result.push({ operatorName: nameById.get(String(row.operator_id)) || null, text })
  }
  return result
}

/** Записать ответ и либо выдать следующий вопрос, либо закрыть попытку. */
async function advanceAttempt(params: {
  supabase: SupabaseLike
  attempt: ExamAttemptRow
  answers: Record<string, StoredAnswer>
  nextIndex: number
  examTitle: string
  passScore: number
  /// `null` — экзамен сдают в приложении: следующий вопрос оператор увидит
  /// сам, слать его в Telegram некуда и незачем.
  chatId: string | null
}): Promise<void> {
  const { supabase, attempt, answers, nextIndex } = params

  if (nextIndex < attempt.total_questions) {
    const patch: Record<string, unknown> = {
      answers,
      current_index: nextIndex,
      status: 'in_progress',
    }
    // Момент старта фиксируем на первом ответе — по нему видно, сколько человек
    // тянул с началом и сколько потратил на сам экзамен.
    if (attempt.status !== 'in_progress') patch.started_at = new Date().toISOString()

    await supabase.from('operator_exam_attempts').update(patch).eq('id', attempt.id)

    if (params.chatId) {
      await sendExamQuestion({
        attempt: { ...attempt, answers, current_index: nextIndex },
        examTitle: params.examTitle,
      })
    }
    return
  }

  // ─── Финал ───────────────────────────────────────────────────────────────
  const result = scoreAttempt(attempt.questions || [], answers)
  const passed = result.score >= params.passScore

  await supabase
    .from('operator_exam_attempts')
    .update({
      answers,
      current_index: nextIndex,
      status: 'completed',
      correct_answers: result.correct,
      score: result.score,
      max_score: result.max,
      passed,
      completed_at: new Date().toISOString(),
    })
    .eq('id', attempt.id)

  // Разбор ошибок: какие регламенты перечитать. Сами верные ответы не шлём —
  // иначе билет утечёт следующему сдающему через пересылку сообщения.
  const toReview = Array.from(new Set(result.wrong.map((q) => q.article_title))).slice(0, 10)
  const hasOpen = (attempt.questions || []).some((q) => q.type === 'open')

  const summary = [
    passed ? '✅ <b>Экзамен сдан</b>' : '❌ <b>Экзамен не сдан</b>',
    '',
    `<b>${esc(params.examTitle)}</b>`,
    `Результат: <b>${result.score}%</b> (${result.earned} из ${result.max} баллов), порог ${params.passScore}%`,
    ...(toReview.length > 0
      ? ['', '📚 <b>Перечитать:</b>', ...toReview.map((title) => `• ${esc(title)}`)]
      : []),
    ...(hasOpen ? ['', '<i>Развёрнутые ответы дополнительно проверит руководитель.</i>'] : []),
    '',
    passed ? '<i>Хорошая работа.</i>' : '<i>Результат отправлен руководителю. О пересдаче сообщат отдельно.</i>',
  ].join('\n')

  if (params.chatId) await sendTelegramMessage(params.chatId, summary)

  // Владельцу — короткий итог сразу. Иначе он узнаёт о результате, только если
  // сам зайдёт на страницу, а провал важно увидеть в тот же день.
  const { data: operator } = await supabase
    .from('operators')
    .select('name, short_name, operator_profiles(full_name)')
    .eq('id', attempt.operator_id)
    .maybeSingle()
  const profile = Array.isArray((operator as any)?.operator_profiles)
    ? (operator as any).operator_profiles[0]
    : (operator as any)?.operator_profiles
  const operatorName = profile?.full_name || (operator as any)?.name || (operator as any)?.short_name || 'Оператор'

  await notifyOwnerExamFinished({
    operatorName,
    examTitle: params.examTitle,
    score: result.score,
    earned: result.earned,
    max: result.max,
    passed,
    hasOpen,
  }).catch(() => null)
}

/** Итог аттестации владельцу в общий чат отчётов. */
async function notifyOwnerExamFinished(params: {
  operatorName: string
  examTitle: string
  score: number
  earned: number
  max: number
  passed: boolean
  hasOpen: boolean
}): Promise<void> {
  const text = [
    params.passed ? '✅ <b>Экзамен сдан</b>' : '❌ <b>Экзамен не сдан</b>',
    '',
    `👤 <b>${esc(params.operatorName)}</b>`,
    `📝 ${esc(params.examTitle)}`,
    `Результат: <b>${params.score}%</b> (${params.earned} из ${params.max} баллов)`,
    ...(params.hasOpen ? ['', '<i>Есть развёрнутые ответы — их стоит проверить глазами.</i>'] : []),
  ].join('\n')

  await sendTelegram(text)
}

/**
 * Пересчёт после ручной правки балла владельцем.
 * Итог и вердикт «сдал/не сдал» пересобираются целиком из сохранённых ответов.
 */
export async function recomputeAttempt(params: {
  supabase: SupabaseLike
  attemptId: string
  passScore: number
  gradedBy: string | null
}): Promise<{ score: number; passed: boolean } | null> {
  const { data } = await params.supabase
    .from('operator_exam_attempts')
    .select('id, questions, answers')
    .eq('id', params.attemptId)
    .maybeSingle()
  if (!data) return null

  const result = scoreAttempt((data as any).questions || [], (data as any).answers || {})
  const passed = result.score >= params.passScore

  await params.supabase
    .from('operator_exam_attempts')
    .update({
      correct_answers: result.correct,
      score: result.score,
      max_score: result.max,
      passed,
      manual_override: true,
      graded_by: params.gradedBy,
      graded_at: new Date().toISOString(),
    })
    .eq('id', params.attemptId)

  return { score: result.score, passed }
}
