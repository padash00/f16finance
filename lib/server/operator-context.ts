import 'server-only'

import { NextResponse } from 'next/server'

import { getRequestOperatorContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export type OperatorContext = {
  operatorId: string
  staffId: string | null
  companyId: string
  companyIds: string[]
  supabase: ReturnType<typeof createAdminSupabaseClient>
}

export async function requireOperator(
  request: Request,
): Promise<{ response: NextResponse } | OperatorContext> {
  const context = await getRequestOperatorContext(request)
  if ('response' in context) return context

  const operatorId = context.operator.id
  const supabase = hasAdminSupabaseCredentials()
    ? createAdminSupabaseClient()
    : (context.supabase as any)

  const { data: staffLink } = await supabase
    .from('operator_staff_links')
    .select('staff_id')
    .eq('operator_id', operatorId)
    .maybeSingle()
  const staffId = (staffLink as any)?.staff_id || null

  const { data: assignments } = await supabase
    .from('operator_company_assignments')
    .select('company_id, is_primary, is_active')
    .eq('operator_id', operatorId)
    .eq('is_active', true)

  const activeAssignments = (assignments || []) as any[]
  if (activeAssignments.length === 0) {
    return {
      response: NextResponse.json({ error: 'no-company-assigned' }, { status: 403 }),
    }
  }

  const primary = activeAssignments.find((a) => a.is_primary) || activeAssignments[0]
  const companyId = primary.company_id as string
  const companyIds = activeAssignments.map((a) => a.company_id) as string[]

  return { operatorId, staffId, companyId, companyIds, supabase }
}
