import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/server/audit'
import { requirePointDevice } from '@/lib/server/point-devices'
import { getCurrentOpenShift } from '@/lib/server/point-shifts'

type Body = {
  template_id?: string | null
  run_by?: string | null
  co_signed_by?: string | null
  scheduled_at?: string | null
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

// POST /api/point/checklist/run — start a checklist run for current open shift
export async function POST(request: Request) {
  const point = await requirePointDevice(request)
  if ('response' in point) return point.response

  const { supabase, device } = point
  const body = (await request.json().catch(() => ({}))) as Body

  if (!body.template_id) return json({ error: 'template-id-required' }, 400)

  const shift = await getCurrentOpenShift(supabase, device.company_id)
  if (!shift) return json({ error: 'point-shift-no-open' }, 409)

  // Existing in_progress run for this template?
  const { data: existing } = await supabase
    .from('checklist_runs')
    .select('id')
    .eq('shift_id', shift.id)
    .eq('template_id', body.template_id)
    .eq('status', 'in_progress')
    .maybeSingle()

  if (existing?.id) {
    return json({ run_id: existing.id, reused: true })
  }

  const { data: inserted, error } = await supabase
    .from('checklist_runs')
    .insert({
      shift_id: shift.id,
      template_id: body.template_id,
      run_by: body.run_by || null,
      co_signed_by: body.co_signed_by || null,
      scheduled_at: body.scheduled_at || null,
      status: 'in_progress',
      responses: {},
    })
    .select('id')
    .single()

  if (error || !inserted) {
    return json({ error: 'checklist-run-create-failed', detail: (error as any)?.message }, 400)
  }

  await writeAuditLog(supabase as any, {
    action: 'checklist_run.start',
    entityType: 'checklist_run',
    entityId: inserted.id,
    payload: {
      shift_id: shift.id,
      template_id: body.template_id,
      run_by: body.run_by || null,
    },
  })

  return json({ run_id: inserted.id })
}
