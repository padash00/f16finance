import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type Body = {
  entityType?: string
  entityId?: string
  action?: string
  payload?: Record<string, unknown> | null
}

const ALLOWED_ENTITY_TYPES = new Set([
  'income',
  'income-export',
  'expense',
  'expense-export',
  'finance',
  'page-view',
  'data-export', // универсальная категория экспорта (Excel/CSV/PDF)
])

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const body = (await req.json().catch(() => null)) as Body | null
    if (!body?.entityType || !body?.entityId || !body?.action) {
      return NextResponse.json({ error: 'entityType, entityId и action обязательны' }, { status: 400 })
    }

    if (!ALLOWED_ENTITY_TYPES.has(body.entityType)) {
      return NextResponse.json({ error: 'entityType не разрешен' }, { status: 400 })
    }

    // Изоляция: раньше здесь не было ни staff-, ни company-проверки — только
    // getRequestAccessContext. writeAuditLog выводит organization_id из
    // payload.company_id, поэтому любой авторизованный пользователь (клиент или
    // оператор чужой орг) мог подписывать записи в журнал ЧУЖОЙ организации:
    // порча аудита и ложные события в /logs.
    if (!access.isSuperAdmin && !access.staffRole) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const payload = (body.payload || null) as Record<string, unknown> | null
    const payloadCompanyIds = [
      payload?.company_id,
      (payload?.next as Record<string, unknown> | null)?.company_id,
      (payload?.previous as Record<string, unknown> | null)?.company_id,
    ]
      .map((value) => String(value || '').trim())
      .filter(Boolean)

    if (payloadCompanyIds.length) {
      const companyScope = await resolveCompanyScope({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
      })
      if (
        companyScope.allowedCompanyIds &&
        payloadCompanyIds.some((id) => !companyScope.allowedCompanyIds!.includes(id))
      ) {
        return NextResponse.json({ error: 'company-forbidden' }, { status: 403 })
      }
    }

    const client = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    await writeAuditLog(client, {
      actorUserId: access.user?.id || null,
      entityType: body.entityType,
      entityId: body.entityId,
      action: body.action,
      payload: body.payload || null,
      // Организация — из сессии, а не из payload (payload подконтролен клиенту).
      organizationId: access.activeOrganization?.id || null,
    })

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Admin audit-event route error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/audit-event',
      message: error?.message || 'Admin audit-event route error',
    })
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
