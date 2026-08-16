import 'server-only'

/**
 * Сборка билета — общая для ручного создания и для расписания.
 *
 * Вынесена из роута, когда появились регулярные экзамены: две копии этой
 * логики разъехались бы через месяц, и еженедельный билет тихо начал бы
 * отличаться от того, что владелец собирает руками.
 *
 * Билет всегда собирается ЧЕРНОВИКОМ. Вопросы пишет модель, и кривой вопрос
 * дешевле выкинуть до отправки, чем объясняться перед семью людьми.
 */

import { collectFactQuestions, type FactTopic } from '@/lib/server/exam-facts'
import { generateExamQuestions, generateOpenQuestions } from '@/lib/server/operator-exams'
import type { IndustryCode } from '@/lib/core/industries'

/**
 * Темы вопросов по данным точки для каждой ниши.
 *
 * Это и есть «спрашивать разное с разных точек»: у продавца магазина —
 * каталог и остатки, у оператора клуба — тарифы и железо. Факт берётся из
 * базы, а не из головы модели, поэтому такие вопросы всегда точные и
 * обновляются вместе с прайсом.
 */
export const INDUSTRY_FACT_TOPICS: Record<IndustryCode, FactTopic[]> = {
  shop: ['catalog', 'warehouse'],
  food: ['catalog', 'warehouse'],
  club: ['tariffs', 'hardware', 'stations'],
  ps_club: ['tariffs', 'stations'],
  service: [],
  other: [],
}

export function factTopicsForIndustry(industry: string | null | undefined): FactTopic[] {
  const code = String(industry || '') as IndustryCode
  return INDUSTRY_FACT_TOPICS[code] ?? []
}

export type ComposeResult = {
  ok: true
  pool: any[]
  openPool: any[]
  questionCount: number
  openCount: number
} | {
  ok: false
  error: string
}

/**
 * Собирает пул вопросов: регламент, данные точки, ситуационные.
 *
 * Пул делается с запасом (вдвое больше, чем нужно на билет), чтобы у разных
 * людей билеты отличались — иначе за месяц ответы разойдутся по чату.
 */
export async function composeExamPool(args: {
  supabase: any
  organizationId: string
  companyIds: string[]
  questionCount: number
  openCount: number
  factTopics: FactTopic[]
}): Promise<ComposeResult> {
  const questionCount = Math.max(3, Math.min(20, args.questionCount))
  const openCount = Math.max(0, Math.min(5, args.openCount))

  const poolSize = Math.min(questionCount * 2, 20)
  const { questions: generated, error: generationError } = await generateExamQuestions({
    supabase: args.supabase,
    organizationId: args.organizationId,
    companyIds: args.companyIds,
    questionCount: poolSize,
  })

  // Пустой регламент — ещё не приговор: билет может состоять из вопросов по
  // данным точки. Ошибка только если не набралось ничего.
  const pool = [...generated]

  if (args.factTopics.length > 0) {
    const facts = await collectFactQuestions({
      supabase: args.supabase,
      companyIds: args.companyIds,
      topics: args.factTopics,
    })
    // Половина билета максимум: экзамен по одним ценникам не проверяет,
    // умеет ли человек работать.
    const factLimit = Math.min(facts.length, Math.ceil(questionCount / 2))
    for (const fact of facts.slice(0, factLimit)) {
      pool.push({
        article_id: '',
        company_id: args.companyIds[0] || null,
        article_title: fact.source,
        type: 'choice' as const,
        q: fact.q,
        choices: fact.choices,
        correct: fact.correct,
      })
    }
  }

  if (pool.length === 0) {
    return {
      ok: false,
      error:
        generationError === 'not-enough-articles'
          ? 'Нечего спрашивать: в регламентах точки меньше 3 статей с текстом, а тем по данным нет.'
          : generationError === 'openai-not-configured'
            ? 'Не настроен OPENAI_API_KEY.'
            : 'Не удалось собрать вопросы.',
    }
  }

  // Ситуационные генерим отдельно: у них другой промпт, рубрика и вес.
  const openPool =
    openCount > 0
      ? await generateOpenQuestions({
          supabase: args.supabase,
          organizationId: args.organizationId,
          companyIds: args.companyIds,
          count: Math.min(openCount * 2, 8),
        })
      : []

  return {
    ok: true,
    pool,
    openPool,
    questionCount,
    openCount: Math.min(openCount, openPool.length),
  }
}

/**
 * Кто работает на точке и кому имеет смысл слать экзамен.
 *
 * Экзамен по чужому регламенту — это не проверка знаний, а утечка стандартов
 * другой точки, поэтому список строго по назначениям.
 */
export async function operatorsOfCompanies(supabase: any, companyIds: string[]): Promise<string[]> {
  const { data } = await supabase
    .from('operator_company_assignments')
    .select('operator_id')
    .in('company_id', companyIds)
    .eq('is_active', true)

  return [...new Set(((data || []) as any[]).map((row) => String(row.operator_id)))]
}
