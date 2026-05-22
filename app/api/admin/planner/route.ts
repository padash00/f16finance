import { NextResponse } from 'next/server'

import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

// Личный планировщик доступен владельцу/суперадмину.
function canUsePlanner(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || access.staffRole === 'owner'
}

function isValidDate(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canUsePlanner(access)) return json({ error: 'forbidden' }, 403)
    const userId = access.user?.id
    if (!userId) return json({ error: 'no-user' }, 401)

    const url = new URL(request.url)
    const dateParam = url.searchParams.get('date')
    const date = isValidDate(dateParam) ? dateParam : new Date().toISOString().slice(0, 10)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    // Задачи, применимые к дате: все ежедневные + разовые на эту дату.
    const { data: tasks, error } = await supabase
      .from('personal_tasks')
      .select(
        'id, title, notes, recurrence, task_date, task_time, remind, remind_minutes_before, sort_order, created_at',
      )
      .eq('user_id', userId)
      .or(`recurrence.eq.daily,and(recurrence.eq.once,task_date.eq.${date})`)
      .order('task_time', { ascending: true, nullsFirst: false })
      .order('sort_order', { ascending: true })
    if (error) throw error

    const taskRows = (tasks || []) as any[]
    const ids = taskRows.map((t) => t.id)

    // Статус выполнения за выбранную дату.
    let doneIds = new Set<string>()
    if (ids.length > 0) {
      const { data: comps } = await supabase
        .from('personal_task_completions')
        .select('task_id')
        .eq('user_id', userId)
        .eq('done_date', date)
        .in('task_id', ids)
      doneIds = new Set(((comps || []) as any[]).map((c) => String(c.task_id)))
    }

    const items = taskRows.map((t) => ({ ...t, done: doneIds.has(String(t.id)) }))
    const doneCount = items.filter((t) => t.done).length
    return json({
      ok: true,
      data: {
        date,
        items,
        progress: { done: doneCount, total: items.length },
      },
    })
  } catch (error: any) {
    return json({ error: 'planner-list-failed', detail: error?.message || String(error) }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canUsePlanner(access)) return json({ error: 'forbidden' }, 403)
    const userId = access.user?.id
    if (!userId) return json({ error: 'no-user' }, 401)

    const body = (await request.json().catch(() => ({}))) as {
      title?: string
      notes?: string | null
      recurrence?: 'once' | 'daily'
      task_date?: string | null
      task_time?: string | null
      remind?: boolean
      remind_minutes_before?: number
    }
    if (!body.title || !body.title.trim()) return json({ error: 'title-required' }, 400)
    const recurrence = body.recurrence === 'daily' ? 'daily' : 'once'
    if (recurrence === 'once' && !isValidDate(body.task_date || null)) {
      return json({ error: 'task_date-required' }, 400)
    }

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const { data, error } = await supabase
      .from('personal_tasks')
      .insert([
        {
          user_id: userId,
          title: body.title.trim(),
          notes: body.notes?.trim() || null,
          recurrence,
          task_date: recurrence === 'once' ? body.task_date : null,
          task_time: body.task_time || null,
          remind: !!body.remind,
          remind_minutes_before: Number(body.remind_minutes_before) > 0 ? Math.round(Number(body.remind_minutes_before)) : 0,
        },
      ])
      .select(
        'id, title, notes, recurrence, task_date, task_time, remind, remind_minutes_before, sort_order, created_at',
      )
      .single()
    if (error) throw error
    return json({ ok: true, data })
  } catch (error: any) {
    return json({ error: 'planner-create-failed', detail: error?.message || String(error) }, 500)
  }
}

export async function PATCH(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canUsePlanner(access)) return json({ error: 'forbidden' }, 403)
    const userId = access.user?.id
    if (!userId) return json({ error: 'no-user' }, 401)

    const body = (await request.json().catch(() => ({}))) as {
      id?: string
      // переключение выполнения за дату
      toggle?: { date: string; done: boolean }
      // редактирование полей
      title?: string
      notes?: string | null
      task_time?: string | null
      remind?: boolean
      remind_minutes_before?: number
      task_date?: string | null
    }
    if (!body.id) return json({ error: 'id-required' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    // Проверяем, что задача принадлежит пользователю.
    const { data: task } = await supabase
      .from('personal_tasks')
      .select('id, user_id')
      .eq('id', body.id)
      .eq('user_id', userId)
      .maybeSingle()
    if (!task) return json({ error: 'not-found' }, 404)

    // Переключение completion за конкретную дату.
    if (body.toggle && isValidDate(body.toggle.date)) {
      if (body.toggle.done) {
        const { error } = await supabase
          .from('personal_task_completions')
          .upsert(
            { task_id: body.id, user_id: userId, done_date: body.toggle.date, done_at: new Date().toISOString() },
            { onConflict: 'task_id,done_date' },
          )
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('personal_task_completions')
          .delete()
          .eq('task_id', body.id)
          .eq('done_date', body.toggle.date)
        if (error) throw error
      }
      return json({ ok: true })
    }

    // Редактирование полей задачи.
    const patch: Record<string, any> = { updated_at: new Date().toISOString() }
    if (body.title !== undefined) patch.title = body.title?.trim() || 'Без названия'
    if (body.notes !== undefined) patch.notes = body.notes?.trim() || null
    if (body.task_time !== undefined) patch.task_time = body.task_time || null
    if (body.task_date !== undefined) patch.task_date = body.task_date || null
    if (body.remind !== undefined) patch.remind = !!body.remind
    if (body.remind_minutes_before !== undefined)
      patch.remind_minutes_before = Number(body.remind_minutes_before) > 0 ? Math.round(Number(body.remind_minutes_before)) : 0

    const { data, error } = await supabase
      .from('personal_tasks')
      .update(patch)
      .eq('id', body.id)
      .eq('user_id', userId)
      .select(
        'id, title, notes, recurrence, task_date, task_time, remind, remind_minutes_before, sort_order, created_at',
      )
      .single()
    if (error) throw error
    return json({ ok: true, data })
  } catch (error: any) {
    return json({ error: 'planner-update-failed', detail: error?.message || String(error) }, 500)
  }
}

export async function DELETE(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canUsePlanner(access)) return json({ error: 'forbidden' }, 403)
    const userId = access.user?.id
    if (!userId) return json({ error: 'no-user' }, 401)

    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    if (!id) return json({ error: 'id-required' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const { error } = await supabase
      .from('personal_tasks')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
    if (error) throw error
    return json({ ok: true })
  } catch (error: any) {
    return json({ error: 'planner-delete-failed', detail: error?.message || String(error) }, 500)
  }
}
