import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

type MutationBody =
  | {
      entity: 'company'
      action: 'create'
      payload: { name: string; code?: string | null; show_in_structure?: boolean | null }
    }
  | {
      entity: 'company'
      action: 'update'
      id: string
      payload: { name: string; code?: string | null; show_in_structure?: boolean | null }
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
    const actorUserId = access.user?.id || null

    if (body.entity === 'company') {
      if (body.action === 'create') {
        if (!body.payload.name?.trim()) return badRequest('Название компании обязательно')
        const { data, error } = await supabase.from('companies').insert([
          {
            name: body.payload.name.trim(),
            code: body.payload.code?.trim() || null,
            show_in_structure: body.payload.show_in_structure !== false,
          },
        ]).select('id,name,code,show_in_structure').single()
        if (error) throw error
        await writeAuditLog(supabase, {
          actorUserId,
          entityType: 'company',
          entityId: String(data.id),
          action: 'create',
          payload: { name: data.name, code: data.code, show_in_structure: data.show_in_structure },
        })
        return NextResponse.json({ ok: true })
      }

      if (!body.id) return badRequest('id обязателен')

      if (body.action === 'update') {
        if (!body.payload.name?.trim()) return badRequest('Название компании обязательно')
        const { data, error } = await supabase
          .from('companies')
          .update({
            name: body.payload.name.trim(),
            code: body.payload.code?.trim() || null,
            show_in_structure: body.payload.show_in_structure !== false,
          })
          .eq('id', body.id)
          .select('id,name,code,show_in_structure')
          .single()
        if (error) throw error
        await writeAuditLog(supabase, {
          actorUserId,
          entityType: 'company',
          entityId: String(data.id),
          action: 'update',
          payload: { name: data.name, code: data.code, show_in_structure: data.show_in_structure },
        })
        return NextResponse.json({ ok: true })
      }

      const { error } = await supabase.from('companies').delete().eq('id', body.id)
      if (error) throw error
      await writeAuditLog(supabase, {
        actorUserId,
        entityType: 'company',
        entityId: body.id,
        action: 'delete',
      })
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'create') {
      if (!body.payload.name?.trim()) return badRequest('Имя сотрудника обязательно')
      const { data, error } = await supabase.from('staff').insert([
        {
          full_name: body.payload.name.trim(),
          phone: body.payload.phone?.trim() || null,
          email: body.payload.email?.trim() || null,
          role: body.payload.role?.trim() || 'operator',
        },
      ]).select('id,full_name,email,role').single()
      if (error) throw error
      await writeAuditLog(supabase, {
        actorUserId,
        entityType: 'staff',
        entityId: String(data.id),
        action: 'create',
        payload: { full_name: data.full_name, email: data.email, role: data.role },
      })
      return NextResponse.json({ ok: true })
    }

    if (!body.id) return badRequest('id обязателен')

    if (body.action === 'update') {
      if (!body.payload.name?.trim()) return badRequest('Имя сотрудника обязательно')
      const { data, error } = await supabase
        .from('staff')
        .update({
          full_name: body.payload.name.trim(),
          phone: body.payload.phone?.trim() || null,
          email: body.payload.email?.trim() || null,
          role: body.payload.role?.trim() || 'operator',
        })
        .eq('id', body.id)
        .select('id,full_name,email,role')
        .single()
      if (error) throw error
      await writeAuditLog(supabase, {
        actorUserId,
        entityType: 'staff',
        entityId: String(data.id),
        action: 'update',
        payload: { full_name: data.full_name, email: data.email, role: data.role },
      })
      return NextResponse.json({ ok: true })
    }

    const { error } = await supabase.from('staff').delete().eq('id', body.id)
    if (error) throw error
    await writeAuditLog(supabase, {
      actorUserId,
      entityType: 'staff',
      entityId: body.id,
      action: 'delete',
    })
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Admin settings mutation error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/settings',
      message: error?.message || 'Admin settings mutation error',
    })
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
