import { NextResponse } from 'next/server'

import { explainArticle, logKnowledgeQuestion } from '@/lib/server/knowledge-explain'
import { requirePointDevice } from '@/lib/server/point-devices'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

/** «Объясни проще» для кассы: оператор нажимает прямо в статье на терминале. */
export async function POST(request: Request) {
  const point = await requirePointDevice(request)
  if ('response' in point) return point.response
  const { supabase, device } = point

  const body = (await request.json().catch(() => null)) as
    | { article_id?: string; question?: string; operator_id?: string }
    | null
  const articleId = String(body?.article_id || '').trim()
  if (!articleId) return json({ error: 'article_id обязателен' }, 400)

  // NEVER-паттерн: нет организации → нулевой uuid, чужая статья не совпадёт.
  const orgId = device.company?.organization_id || '00000000-0000-0000-0000-000000000000'

  const { data: article, error } = await supabase
    .from('knowledge_articles')
    .select('id, title, summary, content, company_id, organization_id, is_published')
    .eq('id', articleId)
    .or(`organization_id.is.null,organization_id.eq.${orgId}`)
    .maybeSingle()

  if (error) return json({ error: 'knowledge-explain-failed', detail: error.message }, 400)
  if (!article || (article as any).is_published === false) return json({ error: 'Правило не найдено' }, 404)

  const companyId = (article as any).company_id
  if (companyId && companyId !== device.company_id) return json({ error: 'Правило не найдено' }, 404)

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
      operator_id: body?.operator_id || request.headers.get('x-point-operator-id') || null,
      company_id: device.company_id || null,
      organization_id: device.company?.organization_id || null,
    })

    return json({ ok: true, answer: result.answer })
  } catch (e: any) {
    return json({ error: e?.message || 'Не удалось объяснить правило' }, 500)
  }
}
