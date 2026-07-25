import { NextResponse } from 'next/server'
import { getAllCapabilityIds } from '@/lib/core/capabilities'
import { invalidateCapabilitiesCache, requireStaffCapability } from '@/lib/server/capabilities'
import { invalidateRoleMatrixCache } from '@/lib/server/role-hydration'
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
    // Capability checks (если есть выше) уже отсеивают; здесь — любой staff
    if (!access.isSuperAdmin && !access.staffRole) return json({ error: 'forbidden' }, 403)

    const supabase = createAdminSupabaseClient()
    // Скоуп по организации: встроенные роли (organization_id null) видны всем,
    // кастомные — только своей орг. Иначе роли одной организации протекали в
    // список другой (кросс-тенантная утечка).
    const orgId = access.activeOrganization?.id || null
    let query = supabase
      .from('positions')
      .select('id, name, description, is_builtin, created_at, organization_id')
      .order('is_builtin', { ascending: false })
      .order('name')

    if (orgId) {
      // Своя орг: встроенные + собственные кастомные.
      query = query.or(`organization_id.is.null,organization_id.eq.${orgId}`)
    } else if (!access.isSuperAdmin) {
      // Нет активной орг и не суперадмин → только общие встроенные.
      query = query.is('organization_id', null)
    }
    // Суперадмин без активной орг → видит всё (не фильтруем).

    const { data, error } = await query

    if (error) {
      if (error.code === '42P01') {
        // Table doesn't exist — return built-in list
        return json({ data: BUILTIN_POSITIONS.map((p, i) => ({ id: `builtin-${i}`, ...p, created_at: null })), tableExists: false })
      }
      if (error.code === '42703') {
        // Колонка organization_id ещё не создана (миграция не применена).
        // Безопасный фолбэк: только встроенные роли — без утечки чужих кастомных.
        const { data: builtins } = await supabase
          .from('positions')
          .select('id, name, description, is_builtin, created_at')
          .eq('is_builtin', true)
          .order('name')
        return json({ data: builtins ?? [], tableExists: true, pendingMigration: true })
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
    // Управление ролями (в т.ч. seed:'open') — staff + право access.manage_staff_roles.
    const denied = await requireStaffCapability(access, 'access.manage_staff_roles')
    if (denied) return denied

    const body = await req.json().catch(() => null)
    const action = body?.action

    const supabase = createAdminSupabaseClient()
    // Организация-владелец для новых ролей и проверки владения при правке/удалении.
    const orgId = access.activeOrganization?.id || null

    // Гард владения: встроенные роли не трогаем, чужие орг-роли — тоже.
    // Возвращает Response при отказе, либо null если можно.
    const assertOwned = async (id: string): Promise<Response | null> => {
      const { data: pos } = await supabase
        .from('positions')
        .select('id, name, is_builtin, organization_id')
        .eq('id', id)
        .single()
      if (!pos) return json({ error: 'Роль не найдена' }, 404)
      if ((pos as any).is_builtin) return json({ error: 'Встроенную роль нельзя изменить или удалить' }, 403)
      if (!access.isSuperAdmin && (pos as any).organization_id !== orgId) {
        return json({ error: 'forbidden', reason: 'cross-org' }, 403)
      }
      return null
    }

    if (action === 'create') {
      const name = String(body?.name || '').trim().toLowerCase().replace(/\s+/g, '_')
      const description = String(body?.description || '').trim() || null
      if (!name || name.length < 2) return json({ error: 'name обязателен (мин. 2 символа)' }, 400)

      // По умолчанию что включаем для новой роли:
      // 'open'  — все 265 capabilities включены (как у владельца)
      // 'closed' — ничего не включено, настраивает руками
      // 'copy_from' — копировать набор от другой роли (поле copy_from_role)
      const seedMode = String(body?.seed || 'open') as 'open' | 'closed' | 'copy_from'
      const copyFromRole = String(body?.copy_from_role || '').trim()

      const { data, error } = await supabase
        .from('positions')
        .insert({ name, description, is_builtin: false, organization_id: orgId })
        .select('id, name, description, is_builtin, created_at')
        .single()

      if (error) {
        // Имя роли глобально-уникально — понятное сообщение вместо 500.
        if ((error as any).code === '23505') return json({ error: `Роль «${name}» уже занята` }, 409)
        throw error
      }

      // Засеять capabilities + position_paths в зависимости от режима
      try {
        if (seedMode === 'open') {
          const allCaps = getAllCapabilityIds()
          const rows = allCaps.map((c) => ({ role: name, capability: c, granted: true }))
          await supabase.from('role_capabilities').upsert(rows, { onConflict: 'role,capability' })
          // Все paths owner-роли (наибольший набор) — даём полный доступ.
          const { data: ownerPaths } = await supabase
            .from('position_paths')
            .select('path')
            .eq('position_name', 'owner')
          const pathRows = (ownerPaths || []).map((p: any) => ({ position_name: name, path: p.path }))
          if (pathRows.length > 0) {
            await supabase.from('position_paths').upsert(pathRows, { onConflict: 'position_name,path' })
          }
        } else if (seedMode === 'copy_from' && copyFromRole) {
          // Копируем capabilities
          const { data: source } = await supabase
            .from('role_capabilities')
            .select('capability, granted')
            .eq('role', copyFromRole)
          const capRows = (source || []).map((r: any) => ({
            role: name,
            capability: r.capability,
            granted: r.granted,
          }))
          if (capRows.length > 0) {
            await supabase.from('role_capabilities').upsert(capRows, { onConflict: 'role,capability' })
          }
          // Копируем position_paths
          const { data: sourcePaths } = await supabase
            .from('position_paths')
            .select('path')
            .eq('position_name', copyFromRole)
          const pathRows = (sourcePaths || []).map((p: any) => ({ position_name: name, path: p.path }))
          if (pathRows.length > 0) {
            await supabase.from('position_paths').upsert(pathRows, { onConflict: 'position_name,path' })
          }
        }
        // 'closed' — ничего не вставляем, всё пустое
      } catch (e) {
        console.warn('Не удалось засеять capabilities/paths для новой роли', e)
      }

      invalidateCapabilitiesCache()
      invalidateRoleMatrixCache()
      return json({ ok: true, data })
    }

    if (action === 'update') {
      const id = String(body?.id || '').trim()
      const name = String(body?.name || '').trim().toLowerCase().replace(/\s+/g, '_')
      const description = String(body?.description || '').trim() || null
      if (!id) return json({ error: 'id required' }, 400)
      if (!name || name.length < 2) return json({ error: 'name обязателен' }, 400)

      const ownErr = await assertOwned(id)
      if (ownErr) return ownErr

      const { data, error } = await supabase
        .from('positions')
        .update({ name, description })
        .eq('id', id)
        .select('id, name, description, is_builtin, created_at')
        .single()

      if (error) throw error
      invalidateRoleMatrixCache()
      return json({ ok: true, data })
    }

    if (action === 'delete') {
      const id = String(body?.id || '').trim()
      if (!id) return json({ error: 'id required' }, 400)

      const ownErr = await assertOwned(id)
      if (ownErr) return ownErr

      const { data: pos } = await supabase.from('positions').select('name').eq('id', id).single()
      if (!pos) return json({ error: 'Должность не найдена' }, 404)

      // Безопасность: нельзя удалить роль у которой активные носители.
      // Сначала надо переназначить их на другую роль через /access → Аккаунты.
      const { count: staffCount } = await supabase
        .from('staff')
        .select('id', { count: 'exact', head: true })
        .eq('role', (pos as any).name)
        .eq('is_active', true)

      if (staffCount && staffCount > 0) {
        return json(
          {
            error: 'in-use',
            message: `Эта роль назначена ${staffCount} активному сотруднику. Сначала переназначьте их на другую роль через вкладку «Аккаунты».`,
            count: staffCount,
          },
          409,
        )
      }

      // Чистим обе системы: старую (page-level) и новую (capabilities)
      await supabase.from('role_permissions').delete().eq('role', (pos as any).name)
      await supabase.from('role_capabilities').delete().eq('role', (pos as any).name)
      // position_paths каскадно зачистится через FK on delete cascade

      const { error } = await supabase.from('positions').delete().eq('id', id)
      if (error) throw error
      invalidateCapabilitiesCache()
      invalidateRoleMatrixCache()
      return json({ ok: true })
    }

    return json({ error: 'unsupported action' }, 400)
  } catch (e: any) {
    return json({ error: e?.message || 'Error' }, 500)
  }
}
