import { NextResponse } from 'next/server'

import { explainArticle, logKnowledgeQuestion } from '@/lib/server/knowledge-explain'
import { requireOperator } from '@/lib/server/operator-context'
import { resolveCompanyOrganizationId } from '@/lib/server/point-devices'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

/** «Объясни проще» для приложения оператора. */
export async function POST(request: Request) {
  const ctx = await requireOperator(request)
  if ('response' in ctx) return ctx.response
  const { supabase, companyIds, operatorId, staffId } = ctx

  const body = (await request.json().catch(() => null)) as { article_id?: string; question?: string } | null
  const articleId = String(body?.article_id || '').trim()
  if (!articleId) return json({ error: 'article_id обязателен' }, 400)

  // Изоляция: article_id приходит из тела. Проверки по company_id мало —
  // чужая статья с company_id = null проходила, и её текст уезжал в LLM и в
  // ответ. Скоупим по организации оператора.
  const orgId = await resolveCompanyOrganizationId(supabase as any, ctx.companyId)

  const { data: article, error } = await supabase
    .from('knowledge_articles')
    .select('id, title, summary, content, company_id, organization_id, is_published')
    .eq('id', articleId)
    .eq('is_published', true)
    .eq('organization_id', orgId)
    .maybeSingle()

  if (error) return json({ error: 'knowledge-explain-failed', detail: error.message }, 400)
  if (!article) return json({ error: 'Правило не найдено' }, 404)

  // Статья точки доступна только оператору этой точки; общая — всем своим.
  const companyId = (article as any).company_id
  if (companyId && !companyIds.includes(companyId)) return json({ error: 'Правило не найдено' }, 404)

  try {
    const result = await explainArticle({
      title: String((article as any).title || ''),
      content: String((article as any).content || ''),
      summary: (article as any).summary,
      question: body?.question || null,
    })

    await logKnowledgeQuestion(supabase, {
      article_id: articleId,
      question: body?.question || null,
      answer: result.answer,
      operator_id: operatorId,
      staff_id: staffId,
      company_id: companyId || ctx.companyId,
      organization_id: (article as any).organization_id || null,
    })

    return json({ ok: true, answer: result.answer })
  } catch (e: any) {
    return json({ error: e?.message || 'Не удалось объяснить правило' }, 500)
  }
}
