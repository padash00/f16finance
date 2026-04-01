import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { createRequestSupabaseClient } from '@/lib/server/request-auth'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

// Returns static reference data for operator analytics page:
// companies, operators, operator_profiles, operator_documents
export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const [compRes, opsRes, profilesRes, docsRes] = await Promise.all([
      supabase.from('companies').select('id,name,code').order('name'),
      supabase.from('operators').select('id,name,short_name,is_active').order('name'),
      supabase.from('operator_profiles').select('operator_id,photo_url,position,phone,email,hire_date'),
      supabase.from('operator_documents').select('operator_id,expiry_date'),
    ])

    if (compRes.error) throw compRes.error
    if (opsRes.error) throw opsRes.error
    if (profilesRes.error) throw profilesRes.error
    if (docsRes.error) throw docsRes.error

    return json({
      ok: true,
      data: {
        companies: compRes.data || [],
        operators: opsRes.data || [],
        profiles: profilesRes.data || [],
        documents: docsRes.data || [],
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/operator-analytics GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
