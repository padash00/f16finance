import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

// GET — all disabled paths per role
export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)

    const supabase = createAdminSupabaseClient()
    const { data, error } = await supabase
      .from('role_permissions')
      .select('role, path, enabled')
      .order('role')
    if (error) {
      if (error.code === '42P01') return json({ data: [], tableExists: false })
      throw error
    }
    return json({ data: data ?? [], tableExists: true })
  } catch (e: any) {
    return json({ error: e?.message || 'Error' }, 500)
  }
}

// POST — upsert { role, path, enabled }
export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)

    const body = await req.json().catch(() => null)
    if (!body?.role || !body?.path || typeof body.enabled !== 'boolean') {
      return json({ error: 'role, path, enabled required' }, 400)
    }

    const supabase = createAdminSupabaseClient()
    const { error } = await supabase
      .from('role_permissions')
      .upsert({ role: body.role, path: body.path, enabled: body.enabled }, { onConflict: 'role,path' })
    if (error) throw error

    return json({ ok: true })
  } catch (e: any) {
    return json({ error: e?.message || 'Error' }, 500)
  }
}
