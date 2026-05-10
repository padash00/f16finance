/**
 * Unified HR Update — atomic update для оператора или staff с любого поля
 * + операции повышения/понижения для гибридов (operator with is_admin_staff).
 *
 * POST /api/admin/hr/update
 * Body:
 *   {
 *     kind: 'operator' | 'staff',
 *     id: string,
 *     action?: 'updateProfile' | 'changeRole' | 'promote' | 'demote',
 *     payload?: {...}
 *   }
 *
 * Actions:
 *   - updateProfile: меняет ФИО/контакты/роль/оклад/точки в одном запросе
 *   - changeRole: только смена роли (быстрая операция для inline-dropdown)
 *   - promote (operator only): is_admin_staff=true + monthly_salary + role
 *   - demote (operator only): is_admin_staff=false
 */

import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type Kind = 'operator' | 'staff'
type Action = 'updateProfile' | 'changeRole' | 'promote' | 'demote'

type Payload = {
  full_name?: string
  short_name?: string
  role?: string
  phone?: string
  email?: string
  telegram_chat_id?: string
  monthly_salary?: number
  hire_date?: string
  company_ids?: string[]
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const body = (await request.json().catch(() => null)) as
      | { kind?: Kind; id?: string; action?: Action; payload?: Payload }
      | null
    if (!body) return json({ error: 'Invalid body' }, 400)

    const kind = body.kind
    const id = String(body.id || '').trim()
    const action: Action = body.action || 'updateProfile'
    const payload = body.payload || {}

    if (kind !== 'operator' && kind !== 'staff') {
      return json({ error: 'kind должен быть operator или staff' }, 400)
    }
    if (!id) return json({ error: 'id обязателен' }, 400)

    const denied = await requireCapability(
      access,
      kind === 'operator' ? 'operators.edit' : 'staff.edit',
    )
    if (denied) return denied as any

    const supabase = createAdminSupabaseClient()
    const userId = access.user?.id || null

    // ─── PROMOTE (operator → admin staff via is_admin_staff) ──────
    if (action === 'promote') {
      if (kind !== 'operator') return json({ error: 'promote только для операторов' }, 400)
      const newRole = String(payload.role || '').trim()
      const salary =
        typeof payload.monthly_salary === 'number' && payload.monthly_salary >= 0
          ? Math.round(payload.monthly_salary)
          : null
      if (!newRole) return json({ error: 'Новая должность обязательна' }, 400)

      // Проверка что роль существует
      const { data: pos } = await supabase.from('positions').select('name').eq('name', newRole).maybeSingle()
      if (!pos) return json({ error: `Должность "${newRole}" не найдена` }, 400)

      const { error: opErr } = await supabase
        .from('operators')
        .update({ role: newRole, is_admin_staff: true })
        .eq('id', id)
      if (opErr) return json({ error: opErr.message }, 500)

      // Создаём/обновляем staff-запись для этого человека если её ещё нет
      // (пытаемся склеить по telegram или имени)
      const { data: opData } = await supabase
        .from('operators')
        .select('name, short_name, telegram_chat_id, operator_profiles(full_name, phone, email, hire_date, photo_url)')
        .eq('id', id)
        .maybeSingle()
      const profile = (opData as any)?.operator_profiles?.[0] || (opData as any)?.operator_profiles || {}
      const fullName = profile.full_name || (opData as any)?.name || 'Сотрудник'

      let staffId: string | null = null
      const tg = (opData as any)?.telegram_chat_id?.trim() || null
      if (tg) {
        const { data: byTg } = await supabase.from('staff').select('id').eq('telegram_chat_id', tg).maybeSingle()
        staffId = (byTg as any)?.id || null
      }
      if (!staffId) {
        const { data: byName } = await supabase
          .from('staff')
          .select('id')
          .ilike('full_name', fullName)
          .maybeSingle()
        staffId = (byName as any)?.id || null
      }

      if (staffId) {
        // Обновляем существующего staff
        const update: Record<string, unknown> = { role: newRole, is_active: true }
        if (salary !== null) update.monthly_salary = salary
        await supabase.from('staff').update(update).eq('id', staffId)
      } else {
        // Создаём нового staff
        await supabase.from('staff').insert({
          full_name: fullName,
          short_name: (opData as any)?.short_name || null,
          role: newRole,
          monthly_salary: salary || 0,
          phone: profile.phone || null,
          email: profile.email || null,
          telegram_chat_id: tg,
          is_active: true,
        })
      }

      await writeAuditLog(supabase, {
        actorUserId: userId,
        entityType: 'operator',
        entityId: id,
        action: 'promote',
        payload: { new_role: newRole, monthly_salary: salary, source: 'hr/update' },
      })

      return json({ ok: true })
    }

    // ─── DEMOTE (operator with is_admin_staff → regular operator) ─
    if (action === 'demote') {
      if (kind !== 'operator') return json({ error: 'demote только для операторов' }, 400)

      const { error: opErr } = await supabase
        .from('operators')
        .update({ is_admin_staff: false })
        .eq('id', id)
      if (opErr) return json({ error: opErr.message }, 500)

      await writeAuditLog(supabase, {
        actorUserId: userId,
        entityType: 'operator',
        entityId: id,
        action: 'demote',
        payload: { source: 'hr/update' },
      })

      return json({ ok: true })
    }

    // ─── CHANGE ROLE only (fast inline) ───────────────────────────
    if (action === 'changeRole') {
      const newRole = String(payload.role || '').trim()
      if (!newRole) return json({ error: 'role обязательна' }, 400)

      const { data: pos } = await supabase.from('positions').select('name').eq('name', newRole).maybeSingle()
      if (!pos) return json({ error: `Должность "${newRole}" не найдена` }, 400)

      const table = kind === 'operator' ? 'operators' : 'staff'
      const { error } = await supabase.from(table).update({ role: newRole }).eq('id', id)
      if (error) return json({ error: error.message }, 500)

      await writeAuditLog(supabase, {
        actorUserId: userId,
        entityType: kind,
        entityId: id,
        action: 'change_role',
        payload: { new_role: newRole },
      })

      return json({ ok: true })
    }

    // ─── UPDATE PROFILE (full update) ─────────────────────────────
    // Собираем обновления для основной таблицы
    const mainUpdate: Record<string, unknown> = {}
    if (typeof payload.full_name === 'string' && payload.full_name.trim()) {
      mainUpdate[kind === 'operator' ? 'name' : 'full_name'] = payload.full_name.trim()
      // Для оператора name - это обычно short, full_name живёт в operator_profiles. Но в нашей UI
      // мы храним short_name отдельно — поэтому имя оператора берём из short_name.
      if (kind === 'operator' && payload.short_name) {
        mainUpdate.name = payload.short_name.trim()
      }
    }
    if (typeof payload.short_name === 'string') {
      mainUpdate.short_name = payload.short_name.trim() || null
    }
    if (typeof payload.role === 'string' && payload.role.trim()) {
      mainUpdate.role = payload.role.trim()
    }
    if (typeof payload.telegram_chat_id === 'string') {
      mainUpdate.telegram_chat_id = payload.telegram_chat_id.trim() || null
    }

    if (kind === 'staff') {
      if (typeof payload.phone === 'string') mainUpdate.phone = payload.phone.trim() || null
      if (typeof payload.email === 'string') mainUpdate.email = payload.email.trim() || null
      if (typeof payload.monthly_salary === 'number') {
        mainUpdate.monthly_salary = Math.round(payload.monthly_salary)
      }
      // staff.hire_date в БД отсутствует — игнорируем поле для staff
    }

    if (Object.keys(mainUpdate).length > 0) {
      const table = kind === 'operator' ? 'operators' : 'staff'
      const { error } = await supabase.from(table).update(mainUpdate).eq('id', id)
      if (error) return json({ error: error.message }, 500)
    }

    // operator_profiles — отдельная таблица с дополнительными полями
    if (kind === 'operator') {
      const profileUpdate: Record<string, unknown> = {}
      if (typeof payload.full_name === 'string') {
        profileUpdate.full_name = payload.full_name.trim() || null
      }
      if (typeof payload.phone === 'string') profileUpdate.phone = payload.phone.trim() || null
      if (typeof payload.email === 'string') profileUpdate.email = payload.email.trim() || null
      if (typeof payload.hire_date === 'string') profileUpdate.hire_date = payload.hire_date

      if (Object.keys(profileUpdate).length > 0) {
        const { data: existing } = await supabase
          .from('operator_profiles')
          .select('id')
          .eq('operator_id', id)
          .maybeSingle()
        if (existing) {
          await supabase.from('operator_profiles').update(profileUpdate).eq('operator_id', id)
        } else {
          await supabase.from('operator_profiles').insert({ operator_id: id, ...profileUpdate })
        }
      }

      // Обновление точек
      if (Array.isArray(payload.company_ids)) {
        // Сносим старые назначения и пишем новые (простая стратегия)
        await supabase.from('operator_company_assignments').delete().eq('operator_id', id)
        if (payload.company_ids.length > 0) {
          const rows = payload.company_ids.map((companyId, idx) => ({
            operator_id: id,
            company_id: companyId,
            role: 'operator',
            is_primary: idx === 0,
          }))
          await supabase.from('operator_company_assignments').insert(rows)
        }
      }
    }

    await writeAuditLog(supabase, {
      actorUserId: userId,
      entityType: kind,
      entityId: id,
      action: 'update',
      payload: { fields: Object.keys(payload), source: 'hr/update' },
    })

    return json({ ok: true })
  } catch (e: any) {
    return json({ error: e?.message || 'Server error' }, 500)
  }
}
