import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/server/audit'
import { requireOperator } from '@/lib/server/operator-context'
import { resolveCompanyOrganizationId } from '@/lib/server/point-devices'
import { getCurrentOpenShift } from '@/lib/server/point-shifts'

type Body = {
  template_id?: string | null
  scheduled_at?: string | null
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  const ctx = await requireOperator(request)
  if ('response' in ctx) return ctx.response

  const { supabase, companyId, staffId } = ctx
  const body = (await request.json().catch(() => ({}))) as Body

  if (!body.template_id) return json({ error: 'template-id-required' }, 400)

  // Изоляция: template_id приходит из тела и раньше не проверялся. Run с чужим
  // шаблоном создавался в СВОЕЙ смене, а GET /checklist/run/[id] отдавал по нему
  // шаблон и пункты другого арендатора (штрафы/бонусы) — проверка смены это не ловила.
  const orgId = await resolveCompanyOrganizationId(supabase as any, companyId)
  const { data: templateRow } = await supabase
    .from('checklist_templates')
    .select('id')
    .eq('id', body.template_id)
    .eq('organization_id', orgId)
    .or(`company_id.is.null,company_id.eq.${companyId}`)
    .maybeSingle()
  if (!templateRow) return json({ error: 'checklist-template-not-found' }, 404)

  const shift = await getCurrentOpenShift(supabase as any, companyId)
  if (!shift) return json({ error: 'point-shift-no-open' }, 409)

  // Idempotent: если уже есть in_progress run для этого template в этой смене — возвращаем его
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
      run_by: staffId || null,
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
      run_by: staffId || null,
      source: 'ios',
    },
  })

  return json({ run_id: inserted.id })
}
