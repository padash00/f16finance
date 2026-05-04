import { NextResponse } from 'next/server'

import { requireOperator } from '@/lib/server/operator-context'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  const ctx = await requireOperator(request)
  if ('response' in ctx) return ctx.response

  const { supabase, companyId, staffId } = ctx

  // Без staff-связки у оператора нет инцидентов (они хранятся по subject_staff_id)
  if (!staffId) {
    return json({ incidents: [] })
  }

  const url = new URL(request.url)
  const status = url.searchParams.get('status')
  const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200)

  let query = supabase
    .from('incidents')
    .select(
      `id, kind, severity, status, title, description,
       fine_amount, bonus_amount, photo_urls, occurred_at, created_at,
       shift_id, company_id,
       article:knowledge_articles!article_id ( id, title )`,
    )
    .eq('subject_staff_id', staffId)
    .eq('company_id', companyId)
    .order('occurred_at', { ascending: false })
    .limit(limit)

  if (status && status !== 'all') {
    query = query.eq('status', status)
  }

  const { data, error } = await query
  if (error) return json({ error: 'incidents-list-failed', detail: error.message }, 400)

  return json({ incidents: data || [] })
}
