import 'server-only'

import { createAdminSupabaseClient } from '@/lib/server/supabase'

export type PointShiftRow = {
  id: string
  company_id: string
  organization_id: string | null
  operator_id: string | null
  point_device_id: string | null
  status: 'open' | 'closed' | 'voided'
  shift_type: 'day' | 'night' | 'custom'
  opened_at: string
  closed_at: string | null
  opening_cash: number
  opening_notes: string | null
  closing_cash: number | null
  closing_kaspi: number | null
  closing_kaspi_before_midnight: number | null
  closing_kaspi_after_midnight: number | null
  closing_notes: string | null
  z_report_url: string | null
  x_report_url: string | null
  totals_json: Record<string, unknown> | null
  handover_from_shift_id: string | null
  closed_by: string | null
  created_at: string
  updated_at: string
}

export async function getCurrentOpenShift(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  companyId: string,
): Promise<PointShiftRow | null> {
  if (!companyId) return null
  const { data, error } = await supabase
    .from('point_shifts')
    .select('*')
    .eq('company_id', companyId)
    .eq('status', 'open')
    .maybeSingle()
  if (error) return null
  return (data as PointShiftRow) || null
}

export async function requireCurrentOpenShiftId(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  companyId: string,
): Promise<string | null> {
  const row = await getCurrentOpenShift(supabase, companyId)
  return row?.id || null
}
