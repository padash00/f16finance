import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

const BUILTIN_POSITIONS = [
  { name: 'owner', description: 'Владелец — полный доступ', is_builtin: true },
  { name: 'manager', description: 'Руководитель — оперативное управление', is_builtin: true },
  { name: 'marketer', description: 'Маркетолог — только задачи', is_builtin: true },
]

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)

    const supabase = createAdminSupabaseClient()
    const { data, error } = await supabase
      .from('positions')
      .select('id, name, description, is_builtin, created_at')
      .order('is_builtin', { ascending: false })
      .order('name')

    if (error) {
      if (error.code === '42P01') {
        // Table doesn't exist — return built-in list
        return json({ data: BUILTIN_POSITIONS.map((p, i) => ({ id: `builtin-${i}`, ...p, created_at: null })), tableExists: false })
      }
      throw error
    }

    return json({ data: data ?? [], tableExists: true })
  } catch (e: any) {
    return json({ error: e?.message || 'Error' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)

    const body = await req.json().catch(() => null)
    const action = body?.action

    const supabase = createAdminSupabaseClient()

    if (action === 'create') {
      const name = String(body?.name || '').trim().toLowerCase().replace(/\s+/g, '_')
      const description = String(body?.description || '').trim() || null
      if (!name || name.length < 2) return json({ error: 'name обязателен (мин. 2 символа)' }, 400)

      const { data, error } = await supabase
        .from('positions')
        .insert({ name, description, is_builtin: false })
        .select('id, name, description, is_builtin, created_at')
        .single()

      if (error) throw error
      return json({ ok: true, data })
    }

    if (action === 'update') {
      const id = String(body?.id || '').trim()
      const name = String(body?.name || '').trim().toLowerCase().replace(/\s+/g, '_')
      const description = String(body?.description || '').trim() || null
      if (!id) return json({ error: 'id required' }, 400)
      if (!name || name.length < 2) return json({ error: 'name обязателен' }, 400)

      const { data, error } = await supabase
        .from('positions')
        .update({ name, description })
        .eq('id', id)
        .eq('is_builtin', false) // can't rename built-ins
        .select('id, name, description, is_builtin, created_at')
        .single()

      if (error) throw error
      return json({ ok: true, data })
    }

    if (action === 'delete') {
      const id = String(body?.id || '').trim()
      if (!id) return json({ error: 'id required' }, 400)

      // Remove associated permissions first
      const { data: pos } = await supabase.from('positions').select('name, is_builtin').eq('id', id).single()
      if (!pos) return json({ error: 'Должность не найдена' }, 404)
      if (pos.is_builtin) return json({ error: 'Нельзя удалить встроенную должность' }, 400)

      await supabase.from('role_permissions').delete().eq('role', pos.name)

      const { error } = await supabase.from('positions').delete().eq('id', id)
      if (error) throw error
      return json({ ok: true })
    }

    return json({ error: 'unsupported action' }, 400)
  } catch (e: any) {
    return json({ error: e?.message || 'Error' }, 500)
  }
}
