import { NextResponse } from 'next/server'

import { requireOperator } from '@/lib/server/operator-context'

type PatchBody = {
  // point-формат: объект { [item_id]: response }
  responses?: Record<string, unknown> | unknown[] | null
  // iOS-формат: массив { item_id, answer, comment, photo_base64 }
  answers?: Array<{
    item_id: string
    answer?: string | null
    comment?: string | null
    photo_base64?: string | null
  }> | null
  co_signed_by?: string | null
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function normalizeResponses(body: PatchBody): Record<string, unknown> | null {
  // iOS шлёт answers (массив) — конвертируем в объект
  if (Array.isArray(body.answers) && body.answers.length > 0) {
    const result: Record<string, unknown> = {}
    for (const item of body.answers) {
      result[item.item_id] = {
        answer: item.answer ?? null,
        value: item.answer ?? null,
        comment: item.comment ?? null,
        photo_data_url: item.photo_base64 ?? null,
      }
    }
    return result
  }

  // iOS может слать responses тоже как массив
  if (Array.isArray(body.responses)) {
    const result: Record<string, unknown> = {}
    for (const item of body.responses as any[]) {
      if (item?.item_id) {
        result[item.item_id] = {
          answer: item.answer ?? null,
          value: item.answer ?? null,
          comment: item.comment ?? null,
          photo_data_url: item.photo_base64 ?? null,
        }
      }
    }
    return result
  }

  // Point-формат: объект — принимаем как есть
  if (body.responses && typeof body.responses === 'object' && !Array.isArray(body.responses)) {
    return body.responses as Record<string, unknown>
  }

  return null
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOperator(request)
  if ('response' in ctx) return ctx.response

  const { supabase, companyId } = ctx
  const { id } = await params

  const { data: run } = await supabase
    .from('checklist_runs')
    .select(
      `id, template_id, status, started_at, completed_at, scheduled_at,
       responses, fines_total, bonuses_total, run_by, co_signed_by, shift_id,
       template:checklist_templates (
         id, title, description, blocks_shift,
         items:checklist_items ( id, title, answer_type, is_required, requires_photo, severity, fine_amount, bonus_amount, sort_order )
       ),
       shift:point_shifts ( id, company_id, status )`,
    )
    .eq('id', id)
    .maybeSingle()

  if (!run) return json({ error: 'checklist-run-not-found' }, 404)

  const shiftCompanyId = Array.isArray((run as any).shift)
    ? (run as any).shift[0]?.company_id
    : (run as any).shift?.company_id

  if (shiftCompanyId !== companyId) {
    return json({ error: 'checklist-run-forbidden' }, 403)
  }

  return json({ run })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOperator(request)
  if ('response' in ctx) return ctx.response

  const { supabase, companyId } = ctx
  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as PatchBody

  // Проверяем что run принадлежит компании оператора
  const { data: run } = await supabase
    .from('checklist_runs')
    .select('id, status, responses, shift_id')
    .eq('id', id)
    .maybeSingle()

  if (!run) return json({ error: 'checklist-run-not-found' }, 404)

  const { data: shift } = await supabase
    .from('point_shifts')
    .select('id, company_id, status')
    .eq('id', (run as any).shift_id)
    .maybeSingle()

  if (!shift || (shift as any).company_id !== companyId) {
    return json({ error: 'checklist-run-forbidden' }, 403)
  }
  if ((shift as any).status !== 'open') {
    return json({ error: 'checklist-run-shift-closed' }, 409)
  }
  if ((run as any).status !== 'in_progress') {
    return json({ error: 'checklist-run-not-in-progress' }, 409)
  }

  const patch: Record<string, unknown> = {}

  const normalizedResponses = normalizeResponses(body)
  if (normalizedResponses) {
    patch.responses = { ...((run as any).responses || {}), ...normalizedResponses }
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
