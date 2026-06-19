import { NextResponse } from 'next/server'

import { requireOperator } from '@/lib/server/operator-context'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  const ctx = await requireOperator(request)
  if ('response' in ctx) return ctx.response

  const { supabase, companyId, staffId } = ctx

  const { data: shift, error } = await supabase
    .from('point_shifts')
    .select(
      `id, company_id, organization_id, operator_id, point_device_id,
       status, shift_type, opened_at, closed_at,
       opening_cash, opening_notes, handover_from_shift_id,
       operator:staff!operator_id ( id, full_name, short_name )`,
    )
    .eq('company_id', companyId)
    .eq('status', 'open')
    .maybeSingle()

  if (error) {
    return json({ error: 'point-shift-current-failed', detail: (error as any).message }, 500)
  }

  if (!shift) {
    return json({ shift: null })
  }

  const shiftId = (shift as any).id as string

  const [salesRes, returnsRes, templatesRes, runsRes] = await Promise.all([
    supabase
      .from('point_sales')
      .select('id, total_amount, cash_amount, kaspi_amount, sold_at')
      .eq('shift_id', shiftId),
    supabase
      .from('point_returns')
      .select('id, total_amount, cash_amount, kaspi_amount, returned_at')
      .eq('shift_id', shiftId),
    supabase
      .from('checklist_templates')
      .select(
        'id, title, description, role_scope, shift_scope, schedule_type, recurrence_minutes, blocks_shift, is_active, sort_order',
      )
      .eq('is_active', true)
      .or(`company_id.is.null,company_id.eq.${companyId}`)
      .order('sort_order'),
    supabase
      .from('checklist_runs')
      .select(
        'id, template_id, status, started_at, completed_at, scheduled_at, responses, fines_total, bonuses_total, run_by, co_signed_by',
      )
      .eq('shift_id', shiftId)
      .order('started_at', { ascending: false }),
  ])

  const sales = (salesRes.data || []) as any[]
  const returns = (returnsRes.data || []) as any[]
  const templates = (templatesRes.data || []) as any[]
  const runs = (runsRes.data || []) as any[]

  const sum = (rows: any[], key: string) =>
    rows.reduce((acc, row) => acc + Number(row?.[key] || 0), 0)

  // Pending knowledge confirmations для оператора через staffId
  let pendingConfirmations: any[] = []
  if (staffId) {
    const { data: critArticles } = await supabase
      .from('knowledge_articles')
      .select('id, title, slug, severity, version, summary, company_id')
      .eq('is_published', true)
      .eq('requires_confirmation', true)
      .or(`company_id.is.null,company_id.eq.${companyId}`)

    const critArr = (critArticles || []) as any[]
    if (critArr.length > 0) {
      const { data: confirmed } = await supabase
        .from('knowledge_article_confirmations')
        .select('article_id, article_version')
        .eq('staff_id', staffId)
        .in(
          'article_id',
          critArr.map((a) => a.id),
        )

      const confirmedKey = new Set(
        ((confirmed || []) as any[]).map((c) => `${c.article_id}:${c.article_version}`),
      )

      pendingConfirmations = critArr.filter(
        (a) => !confirmedKey.has(`${a.id}:${Number(a.version || 1)}`),
      )
    }
  }

  return json({
    shift,
    totals: {
      sales_count: sales.length,
      sales_total: sum(sales, 'total_amount'),
      sales_cash: sum(sales, 'cash_amount'),
      sales_kaspi: sum(sales, 'kaspi_amount'),
      returns_count: returns.length,
      returns_total: sum(returns, 'total_amount'),
      returns_cash: sum(returns, 'cash_amount'),
      returns_kaspi: sum(returns, 'kaspi_amount'),
    },
    checklists: {
      templates,
      runs,
    },
    knowledge: {
      pending_confirmations: pendingConfirmations,
    },
  })
}
