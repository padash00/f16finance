import { NextResponse } from 'next/server'

import { requirePointDevice } from '@/lib/server/point-devices'
import { getCurrentOpenShift } from '@/lib/server/point-shifts'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

async function resolveStaffIdForOperator(supabase: any, operatorId: string | null) {
  if (!operatorId) return null
  const { data } = await supabase
    .from('operator_staff_links')
    .select('staff_id')
    .eq('operator_id', operatorId)
    .maybeSingle()
  return data?.staff_id || null
}

// GET — статьи для оператора + список pending-подтверждений (если staff_id передан).
export async function GET(request: Request) {
  const point = await requirePointDevice(request)
  if ('response' in point) return point.response
  const { supabase, device } = point

  // Изоляция тенанта: статьи/чек-листы только СВОЕЙ организации. Иначе легаси-
  // строки с organization_id/company_id = null (напр. база знаний F16) утекали
  // бы в операторские других клиентов. NEVER-паттерн: нет орг → нулевой uuid.
  const orgId = device.company?.organization_id || '00000000-0000-0000-0000-000000000000'

  const url = new URL(request.url)
  const staffId =
    url.searchParams.get('staff_id') ||
    (await resolveStaffIdForOperator(
      supabase,
      url.searchParams.get('operator_id') || request.headers.get('x-point-operator-id'),
    ))

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
    .eq('organization_id', orgId)
    .or(`company_id.is.null,company_id.eq.${device.company_id}`)
    .order('sort_order', { ascending: true })

  if (error) return json({ error: 'knowledge-list-failed', detail: error.message }, 400)

  const articlesArr = (articles || []) as any[]

  const { data: templates, error: templatesError } = await supabase
    .from('checklist_templates')
    .select(
      'id, company_id, title, description, role_scope, shift_scope, schedule_type, recurrence_minutes, blocks_shift, sort_order, is_active',
    )
    .eq('is_active', true)
    .eq('organization_id', orgId)
    .or(`company_id.is.null,company_id.eq.${device.company_id}`)
    .order('sort_order', { ascending: true })
    .order('title', { ascending: true })

  if (templatesError) {
    return json({ error: 'checklist-templates-load-failed', detail: templatesError.message }, 400)
  }

  const templatesArr = (templates || []) as any[]
  const templateIds = templatesArr.map((template) => String(template.id))

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

  const openShift = await getCurrentOpenShift(supabase as any, device.company_id)
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
