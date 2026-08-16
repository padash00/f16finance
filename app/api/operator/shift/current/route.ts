import { NextResponse } from 'next/server'

import { requireOperator } from '@/lib/server/operator-context'
import { resolveCompanyOrganizationId } from '@/lib/server/point-devices'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

// PostgREST молча режет ответ до 1000 строк — продажи/возвраты смены забираем
// постранично, иначе итоги смены (деньги) считаются по обрезанным данным.
const PAGE = 1000
async function fetchAllPages(buildQuery: (from: number, to: number) => any): Promise<any[]> {
  const out: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery(from, from + PAGE - 1)
    if (error) throw error
    const rows = data || []
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

export async function GET(request: Request) {
  const ctx = await requireOperator(request)
  if ('response' in ctx) return ctx.response

  const { supabase, companyId, companyIds, staffId, operatorId } = ctx

  // Смотрим все точки, куда оператор назначен, а не только основную.
  // У человека, приписанного к двум точкам, основной считается первая, и
  // раньше приложение показывало смену соседней точки — чужую по смыслу,
  // хотя своя в это время была открыта рядом.
  const { data: openShifts, error } = await supabase
    .from('point_shifts')
    .select(
      `id, company_id, organization_id, operator_id, point_device_id,
       status, shift_type, opened_at, closed_at,
       opening_cash, opening_notes, handover_from_shift_id,
       operator:staff!operator_id ( id, full_name, short_name )`,
    )
    .in('company_id', companyIds.length ? companyIds : [companyId])
    .eq('status', 'open')
    .order('opened_at', { ascending: false })

  if (error) {
    return json({ error: 'point-shift-current-failed', detail: (error as any).message }, 500)
  }

  const openRows = (openShifts || []) as any[]
  const ownedByStaff = staffId
    ? openRows.find((row) => String(row.operator_id || '') === String(staffId))
    : undefined

  // Смена без владельца — след старой ошибки: оператор без связки со
  // staff открывал смену, и она записывалась ничьей. Хозяина в таком случае
  // восстанавливаем по журналу: кто открывал, тот и на смене.
  let ownerlessMine: any | undefined
  if (!ownedByStaff) {
    const ownerless = openRows.filter((row) => !row.operator_id)
    if (ownerless.length > 0) {
      const { data: openEvents } = await supabase
        .from('audit_log')
        .select('entity_id, payload')
        .eq('action', 'point_shift.open')
        .in(
          'entity_id',
          ownerless.map((row) => row.id),
        )
      const minePerAudit = new Set(
        ((openEvents || []) as any[])
          .filter((row) => String(row?.payload?.operator_id || '') === String(operatorId))
          .map((row) => String(row.entity_id)),
      )
      ownerlessMine = ownerless.find((row) => minePerAudit.has(String(row.id)))
    }
  }

  const shift =
    ownedByStaff ||
    ownerlessMine ||
    openRows.find((row) => String(row.company_id) === String(companyId)) ||
    openRows[0] ||
    null

  if (!shift) {
    return json({ shift: null })
  }

  const shiftId = (shift as any).id as string
  // Изоляция: чек-листы и статьи фильтровались только по company_id, поэтому
  // строки чужих организаций с company_id = null попадали в смену (и блокирующий
  // чек-лист чужого арендатора мешал закрыть смену).
  const orgId = await resolveCompanyOrganizationId(supabase as any, companyId)

  const [salesRows, returnsRows, templatesRes, runsRes] = await Promise.all([
    fetchAllPages((from, to) =>
      supabase
        .from('point_sales')
        .select('id, total_amount, cash_amount, kaspi_amount, sold_at')
        .eq('shift_id', shiftId)
        .order('id')
        .range(from, to),
    ),
    fetchAllPages((from, to) =>
      supabase
        .from('point_returns')
        .select('id, total_amount, cash_amount, kaspi_amount, returned_at')
        .eq('shift_id', shiftId)
        .order('id')
        .range(from, to),
    ),
    supabase
      .from('checklist_templates')
      .select(
        'id, title, description, role_scope, shift_scope, schedule_type, recurrence_minutes, blocks_shift, is_active, sort_order',
      )
      .eq('is_active', true)
      .eq('organization_id', orgId)
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

  const sales = (salesRows || []) as any[]
  const returns = (returnsRows || []) as any[]
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
      .eq('organization_id', orgId)
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

  // Чья это смена.
  //
  // Смену на точке открывает один человек, а приложение стоит у каждого. Без
  // этой пометки оператор, зашедший со своего телефона, видел выручку чужой
  // смены и кнопку «Закрыть» — то есть мог закрыть смену сменщицы, стоя дома.
  // В программе на точке такой путаницы нет: там устройство и есть точка, за
  // ним стоит тот, кто смену открыл.
  const shiftOperatorId = String((shift as any).operator_id || '')
  const isMine =
    shift === ownerlessMine ||
    (!!staffId && shiftOperatorId === String(staffId)) ||
    (!!operatorId && shiftOperatorId === String(operatorId))

  return json({
    shift,
    is_mine: isMine,
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
