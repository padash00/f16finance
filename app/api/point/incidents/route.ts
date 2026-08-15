import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/server/audit'
import { requirePointDevice } from '@/lib/server/point-devices'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type CreateBody = {
  kind?: string | null
  title?: string | null
  description?: string | null
  subject_staff_id?: string | null
  reported_by?: string | null
  article_id?: string | null
  severity?: string | null
  bonus_amount?: number | null
  photo_urls?: string[] | null
}

// GET: список инцидентов в текущей открытой смене (если есть)
export async function GET(request: Request) {
  const point = await requirePointDevice(request)
  if ('response' in point) return point.response
  const { supabase, device } = point

  const url = new URL(request.url)
  const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200)

  const { data: shift } = await supabase
    .from('point_shifts')
    .select('id')
    .eq('company_id', device.company_id)
    .eq('status', 'open')
    .maybeSingle()

  let query = supabase
    .from('incidents')
    .select(
      `id, shift_id, kind, title, description, severity, status,
       fine_amount, bonus_amount, photo_urls, occurred_at,
       subject:staff!subject_staff_id ( id, full_name, short_name ),
       reporter:staff!reported_by ( id, full_name, short_name )`,
    )
    .eq('company_id', device.company_id)
    .order('occurred_at', { ascending: false })
    .limit(limit)

  if (shift?.id) {
    query = query.eq('shift_id', shift.id)
  } else {
    return json({ ok: true, data: { incidents: [], shift_id: null } })
  }

  const { data, error } = await query
  if (error) return json({ error: 'incidents-list-failed', detail: error.message }, 400)

  return json({ ok: true, data: { incidents: data || [], shift_id: shift.id } })
}

// POST: оператор создаёт bonus или note (штрафы — только через админку)
export async function POST(request: Request) {
  const point = await requirePointDevice(request)
  if ('response' in point) return point.response
  const { supabase, device } = point

  const body = (await request.json().catch(() => ({}))) as CreateBody

  const kind = (body.kind || '').trim() || 'note'
  if (!['bonus', 'note'].includes(kind)) {
    return json({ error: 'incident-kind-restricted', detail: 'operator may only create bonus or note' }, 403)
  }

  if (!body.title || !body.title.trim()) return json({ error: 'title-required' }, 400)

  // Изоляция: staff/article приходят из тела запроса. Без проверки инцидент
  // своей компании ссылался на сотрудника и статью другого арендатора
  // (штрафы/бонусы и база знаний чужой орг).
  const orgId = device.company?.organization_id || '00000000-0000-0000-0000-000000000000'
  const staffIdsFromBody = [body.subject_staff_id, body.reported_by]
    .map((v) => String(v || '').trim())
    .filter(Boolean)
  if (staffIdsFromBody.length > 0) {
    const { data: staffRows } = await supabase
      .from('staff')
      .select('id')
      .in('id', staffIdsFromBody)
      .or(`organization_id.eq.${orgId},organization_id.is.null`)
    const allowedStaffIds = new Set(((staffRows || []) as any[]).map((r) => String(r.id)))
    if (staffIdsFromBody.some((id) => !allowedStaffIds.has(id))) {
      return json({ error: 'staff-not-in-organization' }, 403)
    }
  }
  if (body.article_id) {
    const { data: articleRow } = await supabase
      .from('knowledge_articles')
      .select('id')
      .eq('id', body.article_id)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (!articleRow) return json({ error: 'article-not-found' }, 404)
  }

  const { data: incidentId, error: rpcError } = await supabase.rpc('incidents_create', {
    p_company_id: device.company_id,
    p_kind: kind,
    p_title: body.title,
    p_description: body.description || null,
    p_subject_staff_id: body.subject_staff_id || null,
    p_reported_by: body.reported_by || null,
    p_reported_by_user_id: null,
    p_article_id: body.article_id || null,
    p_severity: body.severity || 'normal',
    p_fine_amount: 0,
    p_bonus_amount: kind === 'bonus' ? Math.max(0, Number(body.bonus_amount) || 0) : 0,
    p_photo_urls: body.photo_urls || [],
    p_shift_id: null,
    p_source: 'manual',
    p_checklist_run_id: null,
    p_checklist_item_id: null,
    p_status: 'confirmed',
  })

  if (rpcError) {
    return json({ error: 'incident-create-failed', detail: rpcError.message }, 400)
  }

  await writeAuditLog(supabase, {
    actorUserId: null,
    entityType: 'incident',
    entityId: String(incidentId),
    action: 'incident-created-by-operator',
    payload: { kind, company_id: device.company_id, device_id: device.id },
  })

  return json({ ok: true, data: { id: incidentId } }, 201)
}
