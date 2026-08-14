import { generateAiText } from '@/lib/ai/provider'

/**
 * Объяснение правила своими словами.
 *
 * Регламент пишет владелец, а читает оператор восемнадцати лет в свою первую
 * смену: формулировки вроде «материальная ответственность за недостачу»
 * ничего ему не говорят. Здесь тот же текст пересказывается простыми словами
 * и, если оператор спросил про конкретную ситуацию, отвечает на его вопрос.
 *
 * Строгое ограничение: модель отвечает ТОЛЬКО по тексту статьи. Придуманный
 * порядок действий в регламенте опаснее непонятного — по нему человек пойдёт
 * и сделает не то.
 */
const SYSTEM_PROMPT = `Ты объясняешь сотруднику точки правило из внутреннего регламента.

Требования:
- Отвечай простыми короткими фразами, как объясняют новичку на смене.
- Опирайся ТОЛЬКО на текст правила. Не придумывай порядок действий, суммы и сроки.
- Если в тексте нет ответа на вопрос, так и скажи: «В правиле про это не сказано» и посоветуй спросить руководителя.
- Формат: 3–6 пунктов списком, каждое — конкретное действие или факт. Без вступлений и прощаний.
- Сохраняй цифры, суммы и сроки ровно как в правиле.
- Пиши по-русски, обращайся на «ты».`

export type ExplainArticleInput = {
  title: string
  content: string
  summary?: string | null
  question?: string | null
}

export type ExplainArticleResult = {
  answer: string
  model: string
  provider: string
}

/** Текст статьи приходит из редактора в HTML — модели нужен чистый текст. */
function stripHtml(html: string): string {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function explainArticle(input: ExplainArticleInput): Promise<ExplainArticleResult> {
  const text = stripHtml(input.content)
  if (!text) throw new Error('У правила пустой текст — объяснять нечего')

  const question = String(input.question || '').trim().slice(0, 500)

  const userParts = [
    `Правило: ${input.title}`,
    input.summary ? `Кратко: ${input.summary}` : '',
    '',
    'Текст правила:',
    text.slice(0, 8000),
    '',
    question ? `Вопрос сотрудника: ${question}` : 'Сотрудник не понял правило целиком. Объясни его.',
  ].filter(Boolean)

  const result = await generateAiText({
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userParts.join('\n') },
    ],
    maxTokens: 700,
  })

  const answer = String(result.text || '').trim()
  if (!answer) throw new Error('Не удалось получить объяснение')

  return { answer, model: result.model, provider: result.provider }
}

/**
 * Вопрос сотрудника — сигнал владельцу, что правило написано непонятно.
 * Таблица может отсутствовать (миграция не применена) — тогда молча пропускаем,
 * объяснение важнее статистики.
 */
export async function logKnowledgeQuestion(
  supabase: any,
  row: {
    article_id: string
    question: string | null
    answer: string
    staff_id?: string | null
    operator_id?: string | null
    company_id?: string | null
    organization_id?: string | null
  },
) {
  try {
    await supabase.from('knowledge_questions').insert([
      {
        article_id: row.article_id,
        question: row.question,
        answer: row.answer,
        staff_id: row.staff_id || null,
        operator_id: row.operator_id || null,
        company_id: row.company_id || null,
        organization_id: row.organization_id || null,
      },
    ])
  } catch {
    /* нет таблицы или нет прав — не мешаем оператору получить ответ */
  }
}
