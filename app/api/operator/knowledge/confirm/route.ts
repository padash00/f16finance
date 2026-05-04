import { NextResponse } from 'next/server'

import { requireOperator } from '@/lib/server/operator-context'

type Body = {
  article_id?: string | null
  version?: number | null
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  const ctx = await requireOperator(request)
  if ('response' in ctx) return ctx.response

  const { supabase, companyId, staffId } = ctx

  if (!staffId) {
    return json(
      {
        ok: false,
        error: 'no-staff-link',
        message:
          'Ваш профиль оператора не связан с профилем сотрудника. Обратитесь к администратору, чтобы привязать ваш аккаунт.',
      },
      400,
    )
  }

  const body = (await request.json().catch(() => ({}))) as Body
  if (!body.article_id) return json({ error: 'article-id-required' }, 400)

  const { data: article, error: articleError } = await supabase
    .from('knowledge_articles')
    .select('id, version, requires_confirmation, is_published, company_id')
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

  const articleCompanyId = (article as any).company_id as string | null
  if (articleCompanyId && articleCompanyId !== companyId) {
    return json({ error: 'article-not-for-this-company' }, 403)
  }

  // Используем version из body если передан, иначе берём из статьи
  const articleVersion = Number(body.version || (article as any).version || 1)

  const { data: shift } = await supabase
    .from('point_shifts')
    .select('id')
    .eq('company_id', companyId)
    .eq('status', 'open')
    .maybeSingle()

  const { error: insertError } = await supabase.from('knowledge_article_confirmations').insert([
    {
      article_id: body.article_id,
      article_version: articleVersion,
      staff_id: staffId,
      shift_id: (shift as any)?.id || null,
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
      staff_id: staffId,
      already_confirmed: (insertError as any)?.code === '23505',
    },
  })
}
