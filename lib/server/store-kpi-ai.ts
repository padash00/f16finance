/**
 * ИИ-разбор смены и месяца.
 *
 * Роль модели строго ограничена: она НЕ считает деньги, НЕ назначает пороги и
 * НЕ принимает кадровых решений. Всё это уже посчитано детерминированным кодом
 * и передаётся ей готовым. Модель отвечает на другой вопрос — как связно
 * объяснить человеку то, что получилось, и на что обратить внимание.
 *
 * Ответ требуется развёрнутый: короткое «виноват поток» бесполезно, с ним
 * нельзя ни согласиться, ни поспорить. Поэтому запрашивается разбор по частям —
 * поток, касса, работа продавца, вывод, что делать и чего не хватило в данных.
 *
 * Каждый запуск пишется в `store_kpi_ai_runs`: через полгода нужно уметь
 * ответить, что именно модель видела и что ответила.
 */

import { createHash } from 'node:crypto'

import { generateAiText } from '@/lib/ai/provider'
import type { ShiftExplanation } from '@/lib/domain/store-kpi'

/**
 * Системный промпт модуля. Ограничения продублированы здесь, потому что модель
 * видит только его — она не знает ни про clip, ни про минимальные выборки.
 */
export const STORE_KPI_SYSTEM_PROMPT = `Ты — аналитик розничных продаж магазина внутри компьютерного клуба в Казахстане.
Твоя работа — объяснять владельцу и управляющему, что произошло в смене, на языке бизнеса.

ПРАВИЛА, КОТОРЫЕ НЕЛЬЗЯ НАРУШАТЬ:
1. Не выдумывай данные. Если чего-то нет во входных данных — так и скажи.
2. Чётко разделяй три вещи: поток клиентов, состояние бизнеса и работу продавца.
3. Низкая выручка сама по себе НИКОГДА не доказывает, что продавец работал плохо.
4. Высокая выручка сама по себе НИКОГДА не доказывает, что продавец работал хорошо.
5. Погода и поток — контекст. Не хвали и не ругай продавца за них.
6. Ты не принимаешь кадровых решений. Не предлагай штрафы, увольнения и лишение зарплаты.
   Можно рекомендовать: разобрать смену, обучить, отметить, собрать больше данных.
7. Суммы бонусов и пороги считает детерминированный код. Не пересчитывай их и не спорь с ними.
8. Различай корреляцию и причину. Ты видишь цифры, а не мотивы людей.
9. Если данных мало — скажи об этом прямо и не строй уверенных выводов.
10. Пиши по-русски, спокойно и по делу. Без канцелярита, без мотивационных лозунгов,
    без обращения к продавцу на «ты» в третьем лице.

ФОРМАТ: только валидный JSON, без markdown и пояснений вокруг.`

export type PostShiftAiResult = {
  summary: string
  traffic: string
  store: string
  cashier: string
  conclusion: string
  recommendation: string
  uncertainties: string[]
}

const POST_SHIFT_SCHEMA = `{
  "summary": "3-5 предложений: что произошло в смене в целом",
  "traffic": "2-4 предложения про поток клиентов и его влияние",
  "store": "2-4 предложения про выручку магазина и чеки",
  "cashier": "3-5 предложений про то, что делал продавец: средний чек, товары на чек, допродажи",
  "conclusion": "2-3 предложения: что из этого следует",
  "recommendation": "1-3 предложения: что стоит сделать управляющему",
  "uncertainties": ["чего не хватило в данных и где вывод слабый"]
}`

export type MonthlyAiResult = {
  summary: string
  demand: string
  team: string
  money: string
  recommendation: string
  watch_out: string[]
}

const MONTHLY_SCHEMA = `{
  "summary": "4-6 предложений: чем закончился месяц в целом",
  "demand": "2-4 предложения: что было со спросом — покупателей больше или меньше обычного и почему",
  "team": "4-6 предложений: кто из продавцов вырос, кто просел, по каким именно метрикам",
  "money": "2-4 предложения: сколько доплат начислено и оправдались ли они ростом",
  "recommendation": "2-4 предложения: что делать в следующем месяце",
  "watch_out": ["чего не хватило в данных и где выводы слабые"]
}`

function hashInput(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32)
}

function parseJsonLoose(text: string): any {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    // Модель иногда добавляет текст вокруг — вырезаем крайние скобки.
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1))
    }
    throw new Error('Модель вернула не JSON')
  }
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

/**
 * Разбор закрытой смены.
 *
 * На вход модели идёт уже посчитанное объяснение (`explainShift`) плюс сырые
 * числа — так модель не может «переоценить» смену иначе, чем это сделал код,
 * ей остаётся только связно изложить и подсветить главное.
 */
export async function runPostShiftReview(args: {
  supabase: any
  organizationId: string
  companyId: string
  actorUserId: string | null
  modelVersion: string
  subject: { date: string; shift: string; cashier_name: string | null }
  facts: Record<string, unknown>
  explanation: ShiftExplanation
}): Promise<{ result: PostShiftAiResult | null; error: string | null }> {
  const input = {
    task: 'POST_SHIFT_CASHIER_REVIEW',
    point: 'Магазин внутри компьютерного клуба',
    subject: args.subject,
    facts: args.facts,
    // Готовый разбор: модель объясняет его, а не пересчитывает.
    computed: {
      headline: args.explanation.headline,
      conclusion: args.explanation.conclusion,
      paragraphs: args.explanation.paragraphs,
      metrics: args.explanation.metrics,
      caveats: args.explanation.caveats,
    },
    notes: [
      'Поток измеряется выручкой клуба за ту же смену: числа посетителей нет, клуб работает на стороннем SENET.',
      'Метрики продавца сравниваются с нормой для сопоставимых условий (сезон, день недели, смена).',
      'Собственные смены продавца исключены из его же базы сравнения.',
    ],
  }

  const inputHash = hashInput(input)
  const started = Date.now()

  try {
    const response = await generateAiText({
      maxTokens: 2000,
      messages: [
        { role: 'system', content: STORE_KPI_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Разбери смену магазина и объясни результат.

ДАННЫЕ:
${JSON.stringify(input, null, 2)}

Верни JSON строго такой структуры:
${POST_SHIFT_SCHEMA}

Пиши развёрнуто: каждый блок должен объяснять, а не повторять цифры. Если поток
измерить было нечем или метрик не хватило — скажи это прямо в uncertainties и не
делай уверенных выводов.`,
        },
      ],
    })

    const parsed = parseJsonLoose(response.text)
    const result: PostShiftAiResult = {
      summary: asString(parsed.summary),
      traffic: asString(parsed.traffic),
      store: asString(parsed.store),
      cashier: asString(parsed.cashier),
      conclusion: asString(parsed.conclusion),
      recommendation: asString(parsed.recommendation),
      uncertainties: Array.isArray(parsed.uncertainties)
        ? parsed.uncertainties.map((u: unknown) => asString(u)).filter(Boolean)
        : [],
    }

    await args.supabase.from('store_kpi_ai_runs').insert({
      organization_id: args.organizationId,
      company_id: args.companyId,
      task_type: 'POST_SHIFT_CASHIER_REVIEW',
      subject_date: args.subject.date,
      subject_shift: args.subject.shift,
      provider: response.provider,
      model: response.model,
      model_version: args.modelVersion,
      input_hash: inputHash,
      input_json: input,
      output_json: { ...result, latency_ms: Date.now() - started },
      success: true,
      tokens: response.usage?.total_tokens ?? null,
      created_by: args.actorUserId,
    })

    return { result, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    await args.supabase.from('store_kpi_ai_runs').insert({
      organization_id: args.organizationId,
      company_id: args.companyId,
      task_type: 'POST_SHIFT_CASHIER_REVIEW',
      subject_date: args.subject.date,
      subject_shift: args.subject.shift,
      model_version: args.modelVersion,
      input_hash: inputHash,
      input_json: input,
      success: false,
      error: message,
      created_by: args.actorUserId,
    })

    return { result: null, error: message }
  }
}


/**
 * Управленческий разбор месяца.
 *
 * В отличие от разбора смены здесь оценивается не событие, а период: что
 * происходило со спросом, как менялась команда, окупились ли доплаты. Все
 * числа приходят посчитанными — модель их излагает, а не выводит.
 */
export async function runMonthlyReview(args: {
  supabase: any
  organizationId: string
  companyId: string
  actorUserId: string | null
  modelVersion: string
  month: string
  facts: Record<string, unknown>
}): Promise<{ result: MonthlyAiResult | null; error: string | null }> {
  const input = {
    task: 'MONTHLY_MANAGEMENT_REVIEW',
    point: 'Магазин',
    month: args.month,
    facts: args.facts,
    notes: [
      'Спрос измеряется числом чеков: счётчика посетителей у магазина нет.',
      'Метрики продавца сравниваются с нормой для сопоставимых условий.',
      'Доплата начисляется за качество работы, а не за оборот: за оборот платят правила зарплаты.',
      'Денежные величины уже приведены к сопоставимым ценам.',
    ],
  }

  const inputHash = hashInput(input)

  try {
    const response = await generateAiText({
      maxTokens: 2500,
      messages: [
        { role: 'system', content: STORE_KPI_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Составь управленческий разбор месяца для владельца.

ДАННЫЕ:
${JSON.stringify(input, null, 2)}

Верни JSON строго такой структуры:
${MONTHLY_SCHEMA}

Пиши так, чтобы владелец мог принять решение: не пересказывай цифры, а
объясняй, что за ними стоит. Если данных мало — скажи прямо в watch_out и не
делай уверенных выводов. Кадровых решений не предлагай: только обучение,
разбор, отметить, собрать данные.`,
        },
      ],
    })

    const parsed = parseJsonLoose(response.text)
    const result: MonthlyAiResult = {
      summary: asString(parsed.summary),
      demand: asString(parsed.demand),
      team: asString(parsed.team),
      money: asString(parsed.money),
      recommendation: asString(parsed.recommendation),
      watch_out: Array.isArray(parsed.watch_out)
        ? parsed.watch_out.map((u: unknown) => asString(u)).filter(Boolean)
        : [],
    }

    await args.supabase.from('store_kpi_ai_runs').insert({
      organization_id: args.organizationId,
      company_id: args.companyId,
      task_type: 'MONTHLY_DEMAND_REVIEW',
      subject_date: `${args.month}-01`,
      provider: response.provider,
      model: response.model,
      model_version: args.modelVersion,
      input_hash: inputHash,
      input_json: input,
      output_json: result,
      success: true,
      tokens: response.usage?.total_tokens ?? null,
      created_by: args.actorUserId,
    })

    return { result, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    await args.supabase.from('store_kpi_ai_runs').insert({
      organization_id: args.organizationId,
      company_id: args.companyId,
      task_type: 'MONTHLY_DEMAND_REVIEW',
      subject_date: `${args.month}-01`,
      model_version: args.modelVersion,
      input_hash: inputHash,
      input_json: input,
      success: false,
      error: message,
      created_by: args.actorUserId,
    })

    return { result: null, error: message }
  }
}
