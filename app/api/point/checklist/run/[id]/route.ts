import { NextResponse } from 'next/server'

import { requirePointDevice } from '@/lib/server/point-devices'

type PatchBody = {
  responses?: Record<string, unknown> | null
  co_signed_by?: string | null
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

async function loadRunForDevice(supabase: any, runId: string, companyId: string) {
  const { data: run } = await supabase
    .from('checklist_runs')
    .select('id, shift_id, template_id, status, responses')
    .eq('id', runId)
    .maybeSingle()

  if (!run) return { run: null as any, blocked: 'checklist-run-not-found' as const }

  const { data: shift } = await supabase
    .from('point_shifts')
    .select('id, company_id, status')
    .eq('id', run.shift_id)
    .maybeSingle()

  if (!shift || shift.company_id !== companyId) {
    return { run: null as any, blocked: 'checklist-run-forbidden' as const }
  }
  if (shift.status !== 'open') {
    return { run, blocked: 'checklist-run-shift-closed' as const }
  }
  return { run, blocked: null as null }
}

// PATCH — update responses (in_progress only)
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const point = await requirePointDevice(request)
  if ('response' in point) return point.response
  const { supabase, device } = point

  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as PatchBody

  const ctx = await loadRunForDevice(supabase as any, id, device.company_id)
  if (ctx.blocked) return json({ error: ctx.blocked }, ctx.blocked === 'checklist-run-forbidden' ? 403 : 409)
  if (ctx.run.status !== 'in_progress') {
    return json({ error: 'checklist-run-not-in-progress' }, 409)
  }

  const patch: Record<string, unknown> = {}
  if (body.responses && typeof body.responses === 'object' && !Array.isArray(body.responses)) {
    patch.responses = { ...(ctx.run.responses || {}), ...body.responses }
  }
  if (body.co_signed_by !== undefined) {
    patch.co_signed_by = body.co_signed_by || null
  }

  if (Object.keys(patch).length === 0) {
    return json({ run_id: id, updated: false })
  }

  const { error } = await supabase.from('checklist_runs').update(patch).eq('id', id)
  if (error) return json({ error: 'checklist-run-update-failed', detail: error.message }, 400)

  return json({ run_id: id, updated: true })
}
