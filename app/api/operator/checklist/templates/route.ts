import { NextResponse } from 'next/server'

import { requireOperator } from '@/lib/server/operator-context'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  const ctx = await requireOperator(request)
  if ('response' in ctx) return ctx.response

  const { supabase, companyId } = ctx

  const { data: templates, error } = await supabase
    .from('checklist_templates')
    .select(
      `id, title, description, role_scope, shift_scope, schedule_type,
       recurrence_minutes, blocks_shift, is_active, sort_order, company_id,
       items:checklist_items (
         id, template_id, title, description, answer_type, is_required,
         requires_photo, severity, fine_amount, bonus_amount, sort_order,
         knowledge_article_id
       )`,
    )
    .eq('is_active', true)
    .or(`company_id.is.null,company_id.eq.${companyId}`)
    .order('sort_order')

  if (error) return json({ error: 'checklist-templates-load-failed', detail: error.message }, 400)

  return json({ templates: templates || [] })
}
