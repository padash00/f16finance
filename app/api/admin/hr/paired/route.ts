import { NextResponse } from 'next/server'

import { findPairedRecord } from '@/lib/server/hr-paired'
import { requireCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import {
  listOrganizationOperatorIds,
  listOrganizationStaffIds,
} from '@/lib/server/organizations'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const denied = await requireCapability(access, 'staff.toggle_status')
    if (denied) return denied as any

    if (!access.isSuperAdmin && !access.staffRole) {
      return json({ error: 'forbidden' }, 403)
    }

    const url = new URL(req.url)
    const kind = url.searchParams.get('kind')
    const id = url.searchParams.get('id')

    if (kind !== 'staff' && kind !== 'operator') {
      return json({ error: 'kind должен быть staff или operator' }, 400)
    }
    if (!id) return json({ error: 'id обязателен' }, 400)

    // Тенант-скоупинг входного id. В LEGACY single-tenant режиме (флаг включён)
    // эти хелперы возвращают ВСЕ id, поэтому проверка членства — no-op. После
    // флипа флага запрос на чужой staff/operator id вернёт 403.
    const allowedIds = !access.isSuperAdmin
      ? kind === 'staff'
        ? await listOrganizationStaffIds({
            activeOrganizationId: access.activeOrganization?.id || null,
            isSuperAdmin: access.isSuperAdmin,
          })
        : await listOrganizationOperatorIds({
            activeOrganizationId: access.activeOrganization?.id || null,
            isSuperAdmin: access.isSuperAdmin,
            includeInactive: true,
          })
      : null
    if (allowedIds && !allowedIds.includes(String(id))) {
      return json({ error: 'forbidden' }, 403)
    }

    const supabase = createAdminSupabaseClient()
    const paired = await findPairedRecord(supabase, { kind, id })

    // Если парная запись уже уволена — не предлагаем каскад.
    if (paired && !paired.is_active) {
      return json({ ok: true, paired: null })
    }

    return json({ ok: true, paired })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
