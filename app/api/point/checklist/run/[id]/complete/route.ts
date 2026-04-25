import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/server/audit'
import { requirePointDevice } from '@/lib/server/point-devices'

type Body = {
  status?: 'completed' | 'failed' | 'skipped'
  responses?: Record<string, unknown> | null
  co_signed_by?: string | null
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
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
    .select('id, shift_id, template_id, status, responses')
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
    .select('id, fine_amount, bonus_amount, severity, is_required, title')
    .eq('template_id', (run as any).template_id)

  const itemsArr = (items || []) as any[]
  const finesTotal = sumByMatch(itemsArr, mergedResponses, 'fine_amount')
  const bonusesTotal = sumByMatch(itemsArr, mergedResponses, 'bonus_amount')

  const update: Record<string, unknown> = {
    status: targetStatus,
    completed_at: new Date().toISOString(),
    responses: mergedResponses,
    fines_total: finesTotal,
    bonuses_total: bonusesTotal,
  }
  if (body.co_signed_by !== undefined) {
    update.co_signed_by = body.co_signed_by || null
  }

  const { error } = await supabase.from('checklist_runs').update(update).eq('id', id)
  if (error) return json({ error: 'checklist-run-complete-failed', detail: error.message }, 400)

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
