import { NextRequest } from 'next/server'

import { json, resolveStation } from '@/app/api/kiosk/_lib/auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

export async function GET(req: NextRequest) {
  const auth = await resolveStation(req)
  if ('error' in auth) {
    return json({ error: auth.error }, auth.status)
  }
  const station = auth.station

  const admin = createAdminSupabaseClient()

  // Получаем organization_id точки.
  const { data: company } = await admin
    .from('companies')
    .select('id, organization_id')
    .eq('id', (station as any).company_id)
    .maybeSingle()
  const organizationId = (company as any)?.organization_id || null

  const stationCompanyId = (station as any).company_id as string | null

  let articleQuery = admin
    .from('knowledge_articles')
    .select('id, title, slug, summary, content, severity, audience, sort_order, company_id')
    .eq('is_published', true)
    .order('sort_order', { ascending: true })
    .limit(50)

  if (organizationId) {
    articleQuery = articleQuery.or(`organization_id.eq.${organizationId},organization_id.is.null`)
  } else {
    articleQuery = articleQuery.is('organization_id', null)
  }

  if (stationCompanyId) {
    articleQuery = articleQuery.or(`company_id.is.null,company_id.eq.${stationCompanyId}`)
  } else {
    articleQuery = articleQuery.is('company_id', null)
  }

  const { data: articles, error } = await articleQuery
  if (error) return json({ error: 'rules-load-failed', detail: error.message }, 500)

  // Только статьи где audience содержит 'client' или 'public'.
  const filtered = ((articles || []) as any[]).filter((a) => {
    const audience = (a.audience || []) as string[]
    return audience.some((kind) => kind === 'client' || kind === 'public' || kind === 'kiosk')
  })

  return json({
    ok: true,
    data: {
      station_id: (station as any).id,
      articles: filtered.map((a) => ({
        id: a.id,
        title: a.title,
        slug: a.slug,
        summary: a.summary,
        content: a.content,
        severity: a.severity,
      })),
    },
  })
}
