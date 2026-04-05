import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const { data, error } = await supabase
      .from('companies')
      .select('id, name, code')
      .order('name', { ascending: true })

    if (error) throw error

    return json({ data: data ?? [] })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/companies GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const canManageCompanies = access.isSuperAdmin || access.staffRole === 'owner'
    if (!canManageCompanies) {
      return json({ error: 'forbidden' }, 403)
    }

    const body = (await req.json().catch(() => null)) as { name?: string | null; code?: string | null; showInStructure?: boolean | null } | null
    const name = String(body?.name || '').trim()
    const code = String(body?.code || '').trim() || null
    const showInStructure = body?.showInStructure !== false

    if (!name) {
      return json({ error: 'Название точки обязательно' }, 400)
    }

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const { data, error } = await supabase
      .from('companies')
      .insert([{ name, code, show_in_structure: showInStructure }])
      .select('id, name, code')
      .single()

    if (error) throw error

    return json({
      ok: true,
      company: {
        id: String((data as any).id),
        name: String((data as any).name || ''),
        code: (data as any).code || null,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/companies POST', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
