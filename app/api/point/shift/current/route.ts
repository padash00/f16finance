import { NextResponse } from 'next/server'

import { requirePointDevice } from '@/lib/server/point-devices'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  const point = await requirePointDevice(request)
  if ('response' in point) return point.response

  const { supabase, device } = point
  if (!device.company_id) {
    return json({ shift: null })
  }

  const { data: shift, error } = await supabase
    .from('point_shifts')
    .select(
      `id, company_id, organization_id, operator_id, point_device_id,
       status, shift_type, opened_at, closed_at,
       opening_cash, opening_notes, handover_from_shift_id,
       operator:operator_id ( id, name, short_name )`,
    )
    .eq('company_id', device.company_id)
    .eq('status', 'open')
    .maybeSingle()

  if (error) {
    return json({ error: 'point-shift-current-failed', detail: (error as any).message }, 500)
  }

  if (!shift) {
    return json({ shift: null })
  }

  const [salesRes, returnsRes] = await Promise.all([
    supabase
      .from('point_sales')
      .select('id, total_amount, cash_amount, kaspi_amount, sold_at')
      .eq('shift_id', (shift as any).id),
    supabase
      .from('point_returns')
      .select('id, total_amount, cash_amount, kaspi_amount, returned_at')
      .eq('shift_id', (shift as any).id),
  ])

  const sales = (salesRes.data || []) as any[]
  const returns = (returnsRes.data || []) as any[]

  const sum = (rows: any[], key: string) =>
    rows.reduce((acc, row) => acc + Number(row?.[key] || 0), 0)

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
  })
}
