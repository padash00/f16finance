import { NextResponse } from 'next/server'

import { requireCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canView(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || ['owner', 'manager', 'other'].includes(access.staffRole)
}

// GET — статус подтверждений: для каждой critical-статьи и каждого активного staff
// показывает confirmed/pending по последней версии.
export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canView(access)) return json({ error: 'forbidden' }, 403)
    const denied = await requireCapability(access, 'knowledge-admin.view')
    if (denied) return denied

    const url = new URL(request.url)
    const articleId = url.searchParams.get('article_id')
    const staffId = url.searchParams.get('staff_id')
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    // Изоляция по организации (null = legacy-строки видны своей орг).
    const orgId = access.activeOrganization?.id || null
    const orgScope = orgId ? `organization_id.is.null,organization_id.eq.${orgId}` : null

    let articleQuery = supabase
      .from('knowledge_articles')
      .select('id, title, slug, version, severity, requires_confirmation, is_published')
      .eq('requires_confirmation', true)
      .eq('is_published', true)
      .order('title', { ascending: true })
    if (articleId) articleQuery = articleQuery.eq('id', articleId)
    if (orgScope) articleQuery = articleQuery.or(orgScope)

    const { data: articles, error: articleError } = await articleQuery
    if (articleError) throw articleError

    // PostgREST режет ответ до 1000 строк (прежний .limit(2000) молча обрезался) —
    // подтверждения забираем постранично, иначе статусы «pending» ложные.
    const PAGE = 1000
    const confirmations: any[] = []
    for (let from = 0; ; from += PAGE) {
      let confirmQuery = supabase
        .from('knowledge_article_confirmations')
        .select(
          `id, article_id, article_version, staff_id, shift_id, confirmed_at,
           staff:staff_id ( id, full_name, short_name, role ),
           article:article_id ( id, title, slug, version )`,
        )
        .order('confirmed_at', { ascending: false })
        .order('id')
        .range(from, from + PAGE - 1)
      if (articleId) confirmQuery = confirmQuery.eq('article_id', articleId)
      if (staffId) confirmQuery = confirmQuery.eq('staff_id', staffId)
      if (orgScope) confirmQuery = confirmQuery.or(orgScope)

      const { data: pageRows, error: confirmError } = await confirmQuery
      if (confirmError) throw confirmError
      const rows = pageRows || []
      confirmations.push(...rows)
      if (rows.length < PAGE) break
    }

    return json({
      ok: true,
      data: {
        articles: articles || [],
        confirmations: confirmations || [],
      },
    })
  } catch (error) {
    return json(
      {
        error: 'admin-knowledge-confirmations-failed',
        detail: (error as any)?.message || String(error),
      },
      500,
    )
  }
}
