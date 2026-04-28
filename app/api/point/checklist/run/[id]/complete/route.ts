import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/server/audit'
import { requirePointDevice } from '@/lib/server/point-devices'

type Body = {
  status?: 'completed' | 'failed' | 'skipped'
  responses?: Record<string, unknown> | null
  operator_id?: string | null
  co_signed_by?: string | null
}

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

function sumByMatch(items: any[], responses: Record<string, any>, key: 'fine_amount' | 'bonus_amount') {
  return items.reduce((acc, item) => {
    const r = responses?.[item.id]
    if (!r) return acc
    const passed = r?.passed === true || r?.value === true
    // штраф: добавляется когда пункт провален (требовался but not passed)
    if (key === 'fine_amount' && !passed && Number(item.fine_amount || 0) > 0) {
      return acc + Number(item.fine_amount || 0)
    }
    // бонус: добавляется когда пункт пройден И установлен bonus_amount
    if (key === 'bonus_amount' && passed && Number(item.bonus_amount || 0) > 0) {
      return acc + Number(item.bonus_amount || 0)
    }
    return acc
  }, 0)
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const point = await requirePointDevice(request)
  if ('response' in point) return point.response
  const { supabase, device } = point

  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as Body
  const targetStatus = body.status || 'completed'
  if (!['completed', 'failed', 'skipped'].includes(targetStatus)) {
    return json({ error: 'invalid-status' }, 400)
  }

  const { data: run } = await supabase
    .from('checklist_runs')
    .select('id, shift_id, template_id, status, responses, run_by')
    .eq('id', id)
    .maybeSingle()

  if (!run) return json({ error: 'checklist-run-not-found' }, 404)

  const { data: shift } = await supabase
    .from('point_shifts')
    .select('id, company_id, status')
    .eq('id', (run as any).shift_id)
    .maybeSingle()

  if (!shift || (shift as any).company_id !== device.company_id) {
    return json({ error: 'checklist-run-forbidden' }, 403)
  }
  if ((run as any).status !== 'in_progress') {
    return json({ error: 'checklist-run-not-in-progress' }, 409)
  }

  const mergedResponses = {
    ...((run as any).responses || {}),
    ...(body.responses && typeof body.responses === 'object' && !Array.isArray(body.responses)
      ? body.responses
      : {}),
  }

  const { data: items } = await supabase
    .from('checklist_items')
    .select('id, fine_amount, bonus_amount, severity, is_required, title, knowledge_article_id')
    .eq('template_id', (run as any).template_id)

  const itemsArr = (items || []) as any[]
  const finesTotal = sumByMatch(itemsArr, mergedResponses, 'fine_amount')
  const bonusesTotal = sumByMatch(itemsArr, mergedResponses, 'bonus_amount')
  const resolvedStaffId =
    (run as any).run_by ||
    (await resolveStaffIdForOperator(
      supabase,
      body.operator_id || request.headers.get('x-point-operator-id'),
    ))

  const update: Record<string, unknown> = {
    status: targetStatus,
    completed_at: new Date().toISOString(),
    responses: mergedResponses,
    fines_total: finesTotal,
    bonuses_total: bonusesTotal,
  }
  if (resolvedStaffId && !(run as any).run_by) {
    update.run_by = resolvedStaffId
  }
  if (body.co_signed_by !== undefined) {
    update.co_signed_by = body.co_signed_by || null
  }

  const { error } = await supabase.from('checklist_runs').update(update).eq('id', id)
  if (error) return json({ error: 'checklist-run-complete-failed', detail: error.message }, 400)

  // Auto-incidents: для каждого item с фактическим штрафом/бонусом создаём инцидент.
  // Только при targetStatus !== 'skipped'.
  if (targetStatus !== 'skipped') {
    const subjectStaffId = resolvedStaffId || null
    const reportedBy = body.co_signed_by || resolvedStaffId || null
    const incidents: any[] = []
    for (const item of itemsArr) {
      const r = (mergedResponses as any)[item.id]
      const passed = r?.passed === true || r?.value === true
      const fine = Number(item.fine_amount || 0)
      const bonus = Number(item.bonus_amount || 0)
      if (!passed && item.is_required && fine > 0) {
        incidents.push({
          kind: 'violation',
          title: item.title || 'Нарушение чек-листа',
          description: r?.note || r?.comment || null,
          fine,
          bonus: 0,
          severity: item.severity || 'normal',
          checklist_item_id: item.id,
          knowledge_article_id: item.knowledge_article_id || null,
        })
      }
      if (passed && bonus > 0) {
        incidents.push({
          kind: 'bonus',
          title: item.title || 'Бонус по чек-листу',
          description: r?.note || r?.comment || null,
          fine: 0,
          bonus,
          severity: item.severity || 'normal',
          checklist_item_id: item.id,
          knowledge_article_id: item.knowledge_article_id || null,
        })
      }
    }

    for (const inc of incidents) {
      const { error: incError } = await supabase.rpc('incidents_create', {
        p_company_id: (shift as any).company_id,
        p_kind: inc.kind,
        p_title: inc.title,
        p_description: inc.description,
        p_subject_staff_id: subjectStaffId,
        p_reported_by: reportedBy,
        p_reported_by_user_id: null,
        p_article_id: inc.knowledge_article_id,
        p_severity: inc.severity,
        p_fine_amount: inc.fine,
        p_bonus_amount: inc.bonus,
        p_photo_urls: [],
        p_shift_id: (shift as any).id,
        p_source: 'checklist',
        p_checklist_run_id: id,
        p_checklist_item_id: inc.checklist_item_id,
        p_status: 'confirmed',
      })
      if (incError) {
        console.warn('auto-incident create failed', incError.message)
      }
    }
  }

  await writeAuditLog(supabase as any, {
    action: 'checklist_run.complete',
    entityType: 'checklist_run',
    entityId: id,
    payload: {
      shift_id: (shift as any).id,
      template_id: (run as any).template_id,
      status: targetStatus,
      fines_total: finesTotal,
      bonuses_total: bonusesTotal,
    },
  })

  return json({
    run_id: id,
    status: targetStatus,
    fines_total: finesTotal,
    bonuses_total: bonusesTotal,
  })
}
