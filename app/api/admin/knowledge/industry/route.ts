import { NextResponse } from 'next/server'

import {
  buildInterviewPlan,
  getIndustry,
  getInterviewForIndustry,
  getTopicsForIndustry,
  listIndustries,
  INDUSTRY_CODES,
  type KnowledgeTopic,
} from '@/lib/core/industries'
import { logAiUsageSafe } from '@/lib/ai/usage-tracker'
import { writeAuditLog } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Наполнение базы знаний под нишу точки.
 *
 * Два способа, оба выдают ЧЕРНОВИКИ (is_published = false):
 *   generate_facts     — собирает статьи из данных системы (каталог, правила ЗП,
 *                        чек-листы). Цифры настоящие, ввод не нужен.
 *   generate_interview — владелец отвечает на вопросы про свою точку, ИИ
 *                        оформляет ответы в регламенты.
 *
 * Ничего не публикуется автоматически. Если ИИ выдумает факт, а экзамен по нему
 * спросит — оператор получит неуд за правильный по жизни ответ, и доверие к
 * аттестации закончится на первом же случае.
 */

const OPENAI_MODEL = process.env.OPENAI_KNOWLEDGE_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini'
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type SupabaseLike = any

function slugify(topicKey: string, companyId: string) {
  return `${topicKey}-${companyId.slice(0, 8)}`.toLowerCase()
}

function findTopicLabel(industryCode: string, topicKey: string | undefined): string | null {
  if (!topicKey) return null
  return getTopicsForIndustry(industryCode).find((topic) => topic.key === topicKey)?.label || null
}

// ─── Сбор фактов из системы ────────────────────────────────────────────────

async function collectCatalogFacts(supabase: SupabaseLike, companyId: string): Promise<string | null> {
  const { data } = await supabase
    .from('inventory_items')
    .select('name, sale_price, unit')
    .eq('company_id', companyId)
    .not('sale_price', 'is', null)
    .order('sale_price', { ascending: false })
    .limit(60)

  const rows = (data || []) as Array<{ name: string; sale_price: number | null; unit: string | null }>
  if (rows.length === 0) return null
  return rows
    .map((row) => `- ${row.name}: ${Number(row.sale_price || 0).toLocaleString('ru-RU')} ₸${row.unit ? ` за ${row.unit}` : ''}`)
    .join('\n')
}

async function collectSalaryFacts(supabase: SupabaseLike, companyId: string): Promise<string | null> {
  const { data: company } = await supabase.from('companies').select('code').eq('id', companyId).maybeSingle()
  const code = (company as any)?.code
  if (!code) return null

  const { data } = await supabase
    .from('operator_salary_rules')
    .select('shift_type, base_per_shift, threshold1_turnover, threshold1_bonus, threshold2_turnover, threshold2_bonus')
    .eq('company_code', String(code).toLowerCase())

  const rows = (data || []) as Array<Record<string, number | string | null>>
  if (rows.length === 0) return null

  const money = (value: unknown) => Number(value || 0).toLocaleString('ru-RU')
  return rows
    .map((row) => {
      const parts = [
        `- ${row.shift_type === 'night' ? 'Ночная' : 'Дневная'} смена: оклад ${money(row.base_per_shift)} ₸`,
      ]
      if (Number(row.threshold1_turnover || 0) > 0) {
        parts.push(`  бонус ${money(row.threshold1_bonus)} ₸ при выручке от ${money(row.threshold1_turnover)} ₸`)
      }
      if (Number(row.threshold2_turnover || 0) > 0) {
        parts.push(`  бонус ${money(row.threshold2_bonus)} ₸ при выручке от ${money(row.threshold2_turnover)} ₸`)
      }
      return parts.join('\n')
    })
    .join('\n')
}

async function collectChecklistFacts(supabase: SupabaseLike, companyId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from('checklist_templates')
      .select('*')
      .or(`company_id.is.null,company_id.eq.${companyId}`)
      .limit(10)

    const rows = (data || []) as Array<Record<string, unknown>>
    if (rows.length === 0) return null
    return rows
      .map((row) => {
        const name = String(row.name || row.title || 'Чек-лист')
        const items = Array.isArray(row.items) ? (row.items as unknown[]) : []
        const points = items
          .slice(0, 15)
          .map((item: any) => `  • ${String(item?.label || item?.title || item?.text || item)}`)
          .join('\n')
        return points ? `- ${name}:\n${points}` : `- ${name}`
      })
      .join('\n')
  } catch {
    return null
  }
}

async function collectFacts(supabase: SupabaseLike, companyId: string) {
  const [catalog, salary, checklists] = await Promise.all([
    collectCatalogFacts(supabase, companyId),
    collectSalaryFacts(supabase, companyId),
    collectChecklistFacts(supabase, companyId),
  ])
  return { catalog, salary_rules: salary, checklists }
}

// ─── Генерация статьи ──────────────────────────────────────────────────────

const SYSTEM_PROMPT = [
  'Ты пишешь внутренний регламент для сотрудника точки (магазин, клуб, общепит, услуги).',
  'Пиши по-деловому, коротко, по пунктам, в повелительном наклонении: «проверь», «сообщи», «не оставляй».',
  'Строгие требования:',
  '- используй ТОЛЬКО факты из блока «Данные». Ничего не додумывай: не выдумывай суммы, сроки, имена, телефоны;',
  '- если данных для какого-то пункта нет — просто не пиши про него;',
  '- объём: 500–1200 символов;',
  '- без вступлений и без выводов, только сам регламент.',
  '',
  'Формат ответа — строго JSON:',
  '{ "title": "Заголовок", "summary": "Одно предложение о сути", "content": "Текст регламента" }',
].join('\n')

async function writeArticle(params: {
  topic: KnowledgeTopic
  companyName: string
  industryLabel: string
  facts: string
}): Promise<{ title: string; summary: string; content: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  try {
    const res = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        ...(OPENAI_MODEL.startsWith('gpt-5') ? { reasoning_effort: 'low' } : { temperature: 0.4 }),
        max_completion_tokens: 1200,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              `Точка: ${params.companyName} (${params.industryLabel}).`,
              `Тема регламента: ${params.topic.label}.`,
              `Что должно быть раскрыто: ${params.topic.hint}`,
              '',
              'Данные:',
              params.facts,
            ].join('\n'),
          },
        ],
      }),
    })
    if (!res.ok) return null

    const data = await res.json().catch(() => null)
    const parsed = JSON.parse(data?.choices?.[0]?.message?.content || '{}')
    if (typeof parsed.content !== 'string' || parsed.content.trim().length < 80) return null

    return {
      title: String(parsed.title || params.topic.label),
      summary: String(parsed.summary || ''),
      content: String(parsed.content),
    }
  } catch {
    return null
  }
}

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'knowledge-setup.view')
    if (denied) return denied

    const orgId = access.activeOrganization?.id || null
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: orgId,
      isSuperAdmin: access.isSuperAdmin,
    })

    let companiesQuery = supabase.from('companies').select('id, name, code, industry').order('name')
    if (companyScope.allowedCompanyIds) companiesQuery = companiesQuery.in('id', companyScope.allowedCompanyIds)
    const { data: companies } = await companiesQuery

    const url = new URL(request.url)
    const companyId = url.searchParams.get('company_id')

    if (!companyId) {
      return json({ ok: true, data: { companies: companies || [], industries: listIndustries() } })
    }

    const company = ((companies || []) as any[]).find((row) => String(row.id) === companyId)
    if (!company) return json({ error: 'company-out-of-scope' }, 403)

    // Покрытие каркаса: какие темы закрыты статьями этой точки или общими.
    let articlesQuery = supabase
      .from('knowledge_articles')
      .select('id, title, topic_key, company_id, industry, is_published, source, updated_at')
      .or(`company_id.is.null,company_id.eq.${companyId}`)
      .limit(500)
    if (orgId) articlesQuery = articlesQuery.eq('organization_id', orgId)
    const { data: articles } = await articlesQuery

    const relevant = ((articles || []) as any[]).filter((article) => {
      if (article.company_id) return true
      if (!article.industry) return true
      return article.industry === company.industry
    })

    const byTopic = new Map<string, any[]>()
    for (const article of relevant) {
      if (!article.topic_key) continue
      const list = byTopic.get(article.topic_key) || []
      list.push(article)
      byTopic.set(article.topic_key, list)
    }

    const facts = await collectFacts(supabase, companyId)

    const topics = getTopicsForIndustry(company.industry).map((topic) => {
      const matched = byTopic.get(topic.key) || []
      return {
        ...topic,
        articles: matched.map((a) => ({ id: a.id, title: a.title, is_published: a.is_published, source: a.source })),
        published: matched.filter((a) => a.is_published).length,
        drafts: matched.filter((a) => !a.is_published).length,
        // Можно ли собрать тему из данных прямо сейчас.
        factsAvailable: topic.factSource ? !!facts[topic.factSource] : false,
      }
    })

    // Тема считается занятой, если под неё уже есть статья — пусть даже
    // черновик: генерация всё равно её пропустит, и спрашивать повторно незачем.
    const takenTopics = topics.filter((topic) => topic.articles.length > 0).map((topic) => topic.key)

    return json({
      ok: true,
      data: {
        companies: companies || [],
        industries: listIndustries(),
        company,
        topics,
        interview: buildInterviewPlan(company.industry, takenTopics),
        interviewTotal: getInterviewForIndustry(company.industry).length,
        factsSummary: {
          catalog: facts.catalog ? facts.catalog.split('\n').length : 0,
          salary_rules: !!facts.salary_rules,
          checklists: !!facts.checklists,
        },
      },
    })
  } catch (error: any) {
    return json({ error: 'knowledge-industry-failed', detail: error?.message || String(error) }, 500)
  }
}

// ─── POST ──────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const body = (await request.json().catch(() => null)) as
      | { action?: string; company_id?: string; industry?: string; answers?: Record<string, string>; topic_keys?: string[] }
      | null
    if (!body?.action) return json({ error: 'action обязателен' }, 400)

    const orgId = access.activeOrganization?.id || null
    if (!orgId) return json({ error: 'Требуется активная организация' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: orgId,
      isSuperAdmin: access.isSuperAdmin,
    })

    const companyId = String(body.company_id || '')
    if (!companyId) return json({ error: 'company_id обязателен' }, 400)
    if (companyScope.allowedCompanyIds && !companyScope.allowedCompanyIds.includes(companyId)) {
      return json({ error: 'company-out-of-scope' }, 403)
    }

    const { data: company } = await supabase
      .from('companies')
      .select('id, name, code, industry')
      .eq('id', companyId)
      .maybeSingle()
    if (!company) return json({ error: 'company-not-found' }, 404)

    // ─── Установить нишу ────────────────────────────────────────────────
    if (body.action === 'set_industry') {
      const denied = await requireCapability(access, 'knowledge-setup.set_industry')
      if (denied) return denied

      const industry = String(body.industry || '')
      if (!INDUSTRY_CODES.includes(industry as any)) return json({ error: 'Неизвестная ниша' }, 400)

      const { error } = await supabase.from('companies').update({ industry }).eq('id', companyId)
      if (error) return json({ error: 'industry-update-failed', detail: error.message }, 500)

      await writeAuditLog(supabase as any, {
        actorUserId: access.user?.id || null,
        action: 'company.set_industry',
        entityType: 'company',
        entityId: companyId,
        payload: { industry },
      })

      return json({ ok: true })
    }

    const generating = body.action === 'generate_facts' || body.action === 'generate_interview'
    if (!generating) return json({ error: `Неизвестное action: ${body.action}` }, 400)

    const denied = await requireCapability(access, 'knowledge-setup.generate')
    if (denied) return denied
    if (!process.env.OPENAI_API_KEY) return json({ error: 'Не настроен OPENAI_API_KEY' }, 503)

    const industry = getIndustry((company as any).industry)
    if (!industry) return json({ error: 'Сначала выберите нишу точки' }, 400)

    const allTopics = getTopicsForIndustry(industry.code)

    // Категория для новых статей: берём любую из орг, иначе оставляем пустой.
    const { data: categories } = await supabase
      .from('knowledge_categories')
      .select('id, slug')
      .or(`organization_id.eq.${orgId},organization_id.is.null`)
      .limit(10)
    const categoryId =
      ((categories || []) as any[]).find((c) => c.slug === 'shift-rules')?.id ||
      ((categories || []) as any[])[0]?.id ||
      null

    // Какие темы пишем и на каких данных.
    let jobs: Array<{ topic: KnowledgeTopic; facts: string }> = []

    if (body.action === 'generate_facts') {
      const facts = await collectFacts(supabase, companyId)
      jobs = allTopics
        .filter((topic) => topic.factSource && facts[topic.factSource])
        .map((topic) => ({ topic, facts: facts[topic.factSource!] as string }))

      if (jobs.length === 0) {
        return json(
          {
            error:
              'Из данных системы пока нечего собрать: нет товаров с ценами по этой точке, правил зарплаты и чек-листов. Заполните каталог или пройдите интервью.',
          },
          400,
        )
      }
    } else {
      const answers = body.answers || {}
      const curated = getInterviewForIndustry(industry.code)
      const curatedByKey = new Map(curated.map((question) => [question.key, question]))

      // Ответ владельца — сырьё для тем, на которые он отвечал. Ключ вида
      // `topic:<key>` приходит от синтезированных вопросов (темы, под которые
      // в каталоге нет заготовленного вопроса) — их тема берётся из ключа.
      const factsByTopic = new Map<string, string[]>()
      for (const [key, rawAnswer] of Object.entries(answers)) {
        const answer = String(rawAnswer || '').trim()
        if (answer.length < 5) continue

        const question = curatedByKey.get(key)
        const topicKeys = question
          ? question.topics
          : key.startsWith('topic:')
            ? [key.slice('topic:'.length)]
            : []
        const label = question?.question || findTopicLabel(industry.code, topicKeys[0]) || key

        for (const topicKey of topicKeys) {
          const list = factsByTopic.get(topicKey) || []
          list.push(`Вопрос: ${label}\nОтвет владельца: ${answer}`)
          factsByTopic.set(topicKey, list)
        }
      }
      if (factsByTopic.size === 0) return json({ error: 'Заполните хотя бы один ответ' }, 400)

      const requested = new Set(body.topic_keys || [])
      jobs = allTopics
        .filter((topic) => factsByTopic.has(topic.key) && (requested.size === 0 || requested.has(topic.key)))
        .map((topic) => ({ topic, facts: (factsByTopic.get(topic.key) || []).join('\n\n') }))
    }

    // Не переписываем уже существующие статьи темы — только дополняем каркас.
    const { data: existing } = await supabase
      .from('knowledge_articles')
      .select('topic_key')
      .eq('organization_id', orgId)
      .eq('company_id', companyId)
      .in('topic_key', jobs.map((job) => job.topic.key))
    const alreadyCovered = new Set(((existing || []) as any[]).map((row) => String(row.topic_key)))
    jobs = jobs.filter((job) => !alreadyCovered.has(job.topic.key))

    if (jobs.length === 0) {
      return json({ ok: true, data: { created: 0, skipped: alreadyCovered.size, titles: [] } })
    }

    const written = await Promise.all(
      jobs.map(async (job) => {
        const article = await writeArticle({
          topic: job.topic,
          companyName: String((company as any).name || 'Точка'),
          industryLabel: industry.label,
          facts: job.facts,
        })
        return article ? { job, article } : null
      }),
    )

    const rows = written
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .map(({ job, article }) => ({
        organization_id: orgId,
        company_id: companyId,
        category_id: categoryId,
        title: article.title,
        slug: slugify(job.topic.key, companyId),
        summary: article.summary,
        content: article.content,
        severity: job.topic.severity || 'normal',
        topic_key: job.topic.key,
        industry: industry.code,
        source: body.action === 'generate_facts' ? 'auto_facts' : 'interview',
        // Черновик: публикует человек, глазами.
        is_published: false,
      }))

    if (rows.length === 0) return json({ error: 'ИИ не смог составить ни одной статьи. Попробуйте ещё раз.' }, 502)

    const { error: insertError } = await supabase.from('knowledge_articles').insert(rows)
    if (insertError) return json({ error: 'articles-insert-failed', detail: insertError.message }, 500)

    await logAiUsageSafe(supabase, {
      userId: access.user?.id || null,
      endpoint: '/api/admin/knowledge/industry',
      model: OPENAI_MODEL,
      payload: { action: body.action, companyId, created: rows.length },
    })

    await writeAuditLog(supabase as any, {
      actorUserId: access.user?.id || null,
      action: `knowledge.${body.action}`,
      entityType: 'company',
      entityId: companyId,
      payload: { created: rows.length, topics: rows.map((r) => r.topic_key) },
    })

    return json({
      ok: true,
      data: { created: rows.length, skipped: jobs.length - rows.length, titles: rows.map((r) => r.title) },
    })
  } catch (error: any) {
    return json({ error: 'knowledge-industry-failed', detail: error?.message || String(error) }, 500)
  }
}
