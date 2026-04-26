import { NextResponse } from 'next/server'

import { requirePointDevice } from '@/lib/server/point-devices'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

// GET — статьи для оператора + список pending-подтверждений (если staff_id передан).
export async function GET(request: Request) {
  const point = await requirePointDevice(request)
  if ('response' in point) return point.response
  const { supabase, device } = point

  const url = new URL(request.url)
  const staffId = url.searchParams.get('staff_id')

  // Все опубликованные статьи с audience operator (или без аудитории)
  const { data: articles, error } = await supabase
    .from('knowledge_articles')
    .select(
      `id, title, slug, summary, content, tags, audience, severity, version,
       requires_confirmation, related_fine_amount, related_bonus_amount,
       company_id,
       category_id, category:category_id ( id, title, slug, kind )`,
    )
    .eq('is_published', true)
    .or(`company_id.is.null,company_id.eq.${device.company_id}`)
    .order('sort_order', { ascending: true })

  if (error) return json({ error: 'knowledge-list-failed', detail: error.message }, 400)

  const articlesArr = (articles || []) as any[]

  // Pending confirmations: те статьи где requires_confirmation=true и нет confirmation для текущей версии этим staff
  let pending: any[] = []
  if (staffId) {
    const idsRequiringConfirm = articlesArr
      .filter((a) => a.requires_confirmation === true)
      .map((a) => a.id)

    if (idsRequiringConfirm.length > 0) {
      const { data: confirmations } = await supabase
        .from('knowledge_article_confirmations')
        .select('article_id, article_version')
        .eq('staff_id', staffId)
        .in('article_id', idsRequiringConfirm)

      const confirmedKey = new Set(
        ((confirmations || []) as any[]).map((c) => `${c.article_id}:${c.article_version}`),
      )

      pending = articlesArr.filter(
        (a) =>
          a.requires_confirmation === true &&
          !confirmedKey.has(`${a.id}:${Number(a.version || 1)}`),
      )
    }
  }

  return json({
    ok: true,
    data: {
      company_id: device.company_id,
      articles: articlesArr,
      pending_confirmations: pending,
    },
  })
}
