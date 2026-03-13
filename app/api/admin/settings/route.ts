import { NextResponse } from 'next/server'

import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

type MutationBody =
  | {
      entity: 'company'
      action: 'create'
      payload: { name: string; code?: string | null }
    }
  | {
      entity: 'company'
      action: 'update'
      id: string
      payload: { name: string; code?: string | null }
    }
  | {
      entity: 'company'
      action: 'delete'
      id: string
    }
  | {
      entity: 'staff'
      action: 'create'
      payload: { name: string; phone?: string | null; email?: string | null; role?: string | null }
    }
  | {
      entity: 'staff'
      action: 'update'
      id: string
      payload: { name: string; phone?: string | null; email?: string | null; role?: string | null }
    }
  | {
      entity: 'staff'
      action: 'delete'
      id: string
    }

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const body = (await req.json().catch(() => null)) as MutationBody | null
    if (!body?.entity || !body?.action) return badRequest('Неверный формат запроса')

    const supabase = createAdminSupabaseClient()

    if (body.entity === 'company') {
      if (body.action === 'create') {
        if (!body.payload.name?.trim()) return badRequest('Название компании обязательно')
        const { error } = await supabase.from('companies').insert([
          {
            name: body.payload.name.trim(),
            code: body.payload.code?.trim() || null,
          },
        ])
        if (error) throw error
        return NextResponse.json({ ok: true })
      }

      if (!body.id) return badRequest('id обязателен')

      if (body.action === 'update') {
        if (!body.payload.name?.trim()) return badRequest('Название компании обязательно')
        const { error } = await supabase
          .from('companies')
          .update({
            name: body.payload.name.trim(),
            code: body.payload.code?.trim() || null,
          })
          .eq('id', body.id)
        if (error) throw error
        return NextResponse.json({ ok: true })
      }

      const { error } = await supabase.from('companies').delete().eq('id', body.id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'create') {
      if (!body.payload.name?.trim()) return badRequest('Имя сотрудника обязательно')
      const { error } = await supabase.from('staff').insert([
        {
          full_name: body.payload.name.trim(),
          phone: body.payload.phone?.trim() || null,
          email: body.payload.email?.trim() || null,
          role: body.payload.role?.trim() || 'operator',
        },
      ])
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    if (!body.id) return badRequest('id обязателен')

    if (body.action === 'update') {
      if (!body.payload.name?.trim()) return badRequest('Имя сотрудника обязательно')
      const { error } = await supabase
        .from('staff')
        .update({
          full_name: body.payload.name.trim(),
          phone: body.payload.phone?.trim() || null,
          email: body.payload.email?.trim() || null,
          role: body.payload.role?.trim() || 'operator',
        })
        .eq('id', body.id)
      if (error) throw error
      return NextResponse.json({ ok: true })
    }

    const { error } = await supabase.from('staff').delete().eq('id', body.id)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Admin settings mutation error', error)
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
