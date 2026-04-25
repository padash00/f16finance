import { NextResponse } from 'next/server'

import { requirePointDevice } from '@/lib/server/point-devices'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type Body = {
  article_id?: string | null
  staff_id?: string | null
}

export async function POST(request: Request) {
  const point = await requirePointDevice(request)
  if ('response' in point) return point.response
  const { supabase, device } = point

  const body = (await request.json().catch(() => ({}))) as Body
  if (!body.article_id) return json({ error: 'article-id-required' }, 400)
  if (!body.staff_id) return json({ error: 'staff-id-required' }, 400)

  // Текущая версия статьи
  const { data: article, error: articleError } = await supabase
    .from('knowledge_articles')
    .select('id, version, requires_confirmation, is_published')
    .eq('id', body.article_id)
    .maybeSingle()

  if (articleError) return json({ error: 'article-load-failed', detail: articleError.message }, 400)
  if (!article) return json({ error: 'article-not-found' }, 404)
  if (!(article as any).requires_confirmation) {
    return json({ error: 'article-does-not-require-confirmation' }, 400)
  }
  if (!(article as any).is_published) {
    return json({ error: 'article-not-published' }, 400)
  }

  // Текущая открытая смена (для shift_id)
  const { data: shift } = await supabase
    .from('point_shifts')
    .select('id')
    .eq('company_id', device.company_id)
    .eq('status', 'open')
    .maybeSingle()

  const articleVersion = Number((article as any).version || 1)

  const { error: insertError } = await supabase.from('knowledge_article_confirmations').insert([
    {
      article_id: body.article_id,
      article_version: articleVersion,
      staff_id: body.staff_id,
      shift_id: shift?.id || null,
    },
  ])

  // 23505 = unique violation → уже подтверждено, мягко игнорим
  if (insertError && (insertError as any).code !== '23505') {
    return json({ error: 'confirmation-failed', detail: insertError.message }, 400)
  }

  return json({
    ok: true,
    data: {
      article_id: body.article_id,
      version: articleVersion,
      staff_id: body.staff_id,
      already_confirmed: (insertError as any)?.code === '23505',
    },
  })
}
