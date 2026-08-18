/**
 * Убрать ревизию в архив и вернуть обратно.
 *
 * Почему архив, а не удаление. Проведённая ревизия — основание, по которому
 * изменились остатки: она пишет движения и правит балансы. Стереть акт значит
 * оставить движения без причины: товар списан, а почему — уже не восстановить.
 * Поэтому акт остаётся в базе целиком, просто пропадает из списка.
 *
 * Кто может: только суперадминистратор. Не владелец точки и не управляющий —
 * иначе архив превращается в способ убрать неудобную недостачу с глаз.
 *
 * Каждое действие пишется в журнал: архив без следа — это уже не архив.
 */

import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

type Body = {
  id?: string
  /**
   * Пачка актов. Ревизии убирают в архив обычно не по одной, а месяцем сразу,
   * и пятнадцать отдельных запросов — это пятнадцать шансов, что половина
   * уйдёт, а половина нет.
   */
  ids?: string[]
  /** true — убрать в архив, false — вернуть в список. */
  archived?: boolean
  reason?: string | null
}

/** Разумный потолок на одну пачку: список на странице всё равно короче. */
const MAX_BATCH = 200

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)
    if (!hasAdminSupabaseCredentials()) return json({ error: 'service_role_missing' }, 500)

    const supabase = createAdminSupabaseClient()
    const body = (await request.json().catch(() => null)) as Body | null
    const ids = Array.from(
      new Set(
        [...(Array.isArray(body?.ids) ? body.ids : []), body?.id]
          .map((value) => String(value || '').trim())
          .filter(Boolean),
      ),
    )
    if (ids.length === 0) return json({ error: 'Не указан акт' }, 400)
    if (ids.length > MAX_BATCH) return json({ error: `За раз можно убрать не больше ${MAX_BATCH} актов` }, 400)

    const archived = body?.archived !== false
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 500) : ''

    // Сначала читаем акты: и чтобы убедиться, что они есть, и чтобы в журнале
    // осталось, что именно убрали — по одному id через год не разобраться.
    const { data: existingRows, error: readError } = await supabase
      .from('inventory_stocktakes')
      .select('id, counted_at, comment, location_id, location:location_id(id, name, company_id)')
      .in('id', ids)
    if (readError) throw readError
    const existing = (existingRows || []) as any[]
    if (existing.length === 0) return json({ error: 'Акт не найден' }, 404)

    const { error } = await supabase
      .from('inventory_stocktakes')
      .update({
        archived_at: archived ? new Date().toISOString() : null,
        archived_by: archived ? access.user?.id || null : null,
        archive_reason: archived ? reason || null : null,
      })
      .in(
        'id',
        existing.map((row) => String(row.id)),
      )

    if (error) {
      // Типовой случай: код выложен, миграция ещё не накатана. Человеку нужен
      // понятный ответ, а не «column archived_at does not exist».
      const message = String((error as any)?.message || '')
      if (message.includes('archived_at') || (error as any)?.code === '42703') {
        return json(
          { error: 'Архив ещё не включён в базе: примените миграцию 20260904_stocktake_archive.' },
          409,
        )
      }
      throw error
    }

    // Запись в журнал на каждый акт, а не одна на пачку: искать в журнале
    // будут по конкретной ревизии («куда делась вот эта»), и общая запись
    // «убрано 15 актов» на такой вопрос не отвечает.
    for (const row of existing) {
      await writeAuditLog(supabase as any, {
        actorUserId: access.user?.id || null,
        entityType: 'inventory-stocktake',
        entityId: String(row.id),
        action: archived ? 'archive' : 'restore',
        organizationId: access.activeOrganization?.id || null,
        payload: {
          counted_at: row?.counted_at || null,
          comment: row?.comment || null,
          location: row?.location?.name || null,
          reason: reason || null,
          batch: existing.length > 1 ? existing.length : undefined,
        },
      })
    }

    return json({ ok: true, archived, count: existing.length })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/revisions/archive.POST',
      message: error?.message || 'Store revision archive error',
    })
    return json({ error: error?.message || 'Не удалось убрать акт в архив' }, 500)
  }
}
