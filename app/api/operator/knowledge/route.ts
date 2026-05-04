import { NextResponse } from 'next/server'

import { requireOperator } from '@/lib/server/operator-context'
import { getCurrentOpenShift } from '@/lib/server/point-shifts'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  const ctx = await requireOperator(request)
  if ('response' in ctx) return ctx.response

  const { supabase, companyId, staffId } = ctx

  const { data: articles, error } = await supabase
    .from('knowledge_articles')
    .select(
      `id, title, slug, summary, content, tags, audience, severity, version,
       requires_confirmation, related_fine_amount, related_bonus_amount,
       company_id,
       category_id, category:category_id ( id, title, slug, kind )`,
    )
    .eq('is_published', true)
    .or(`company_id.is.null,company_id.eq.${companyId}`)
    .order('sort_order', { ascending: true })

  if (error) return json({ error: 'knowledge-list-failed', detail: error.message }, 400)

  const articlesArr = (articles || []) as any[]

  const { data: templates, error: templatesError } = await supabase
    .from('checklist_templates')
    .select(
      'id, company_id, title, description, role_scope, shift_scope, schedule_type, recurrence_minutes, blocks_shift, sort_order, is_active',
    )
    .eq('is_active', true)
    .or(`company_id.is.null,company_id.eq.${companyId}`)
    .order('sort_order', { ascending: true })
    .order('title', { ascending: true })

  if (templatesError) {
    return json({ error: 'checklist-templates-load-failed', detail: templatesError.message }, 400)
  }

  const templatesArr = (templates || []) as any[]
  const templateIds = templatesArr.map((t) => String(t.id))

  let itemsArr: any[] = []
  if (templateIds.length > 0) {
    const { data: items, error: itemsError } = await supabase
      .from('checklist_items')
      .select(
        'id, template_id, category_id, knowledge_article_id, title, description, answer_type, is_required, requires_photo, severity, fine_amount, bonus_amount, sort_order',
      )
      .in('template_id', templateIds)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (itemsError) return json({ error: 'checklist-items-load-failed', detail: itemsError.message }, 400)
    itemsArr = (items || []) as any[]
  }

  const openShift = await getCurrentOpenShift(supabase as any, companyId)
  let runsArr: any[] = []
  if (openShift && templateIds.length > 0) {
    const { data: runs, error: runsError } = await supabase
      .from('checklist_runs')
      .select('id, shift_id, template_id, run_by, co_signed_by, started_at, completed_at, scheduled_at, status, responses, fines_total, bonuses_total')
      .eq('shift_id', openShift.id)
      .in('template_id', templateIds)
      .order('started_at', { ascending: false })

    if (runsError) return json({ error: 'checklist-runs-load-failed', detail: runsError.message }, 400)
    runsArr = (runs || []) as any[]
  }

  // Pending confirmations — возвращаем всегда (даже если staffId = null, чтобы iOS показал список)
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
  } else {
    // Нет staff-связки: все требующие подтверждения статьи — pending (iOS покажет banner)
    pending = articlesArr.filter((a) => a.requires_confirmation === true)
  }

  return json({
    ok: true,
    data: {
      company_id: companyId,
      articles: articlesArr,
      pending_confirmations: pending,
      checklist_templates: templatesArr,
      checklist_items: itemsArr,
      checklist_runs: runsArr,
      open_shift: openShift
        ? {
            id: openShift.id,
            shift_type: (openShift as any).shift_type || null,
            opened_at: (openShift as any).opened_at || null,
            operator_id: (openShift as any).operator_id || null,
          }
        : null,
    },
  })
}
