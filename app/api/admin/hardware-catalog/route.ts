import { NextResponse } from 'next/server'

import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

const KINDS = ['gpu', 'cpu', 'ram', 'monitor', 'mouse', 'keyboard', 'headset', 'chair'] as const

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

/**
 * Справочник моделей железа для карточки зоны.
 *
 * Общий на всех: моделью видеокарты никто не владеет, поэтому фильтра по
 * организации нет. Отдаём разом все виды — список читается один раз при
 * открытии редактора и дальше фильтруется на клиенте.
 */
export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    // Справочник глобальный (межтенантной утечки нет), но роут был открыт любому
    // залогиненному, включая клиента гостевого контура.
    if (!access.isSuperAdmin && !access.staffMember) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const url = new URL(request.url)
    const kind = url.searchParams.get('kind')

    let query = supabase
      .from('hardware_catalog')
      .select('id, kind, brand, model, meta')
      .eq('is_active', true)
      .order('kind')
      .order('brand')
      .order('sort_order')
      .limit(2000)
    if (kind && (KINDS as readonly string[]).includes(kind)) query = query.eq('kind', kind)

    const { data, error } = await query
    // Справочника может не быть, пока не применена миграция: тогда поля
    // работают как обычный ввод, а не ломаются.
    if (error) return json({ ok: true, data: { available: false, items: [] } })

    return json({ ok: true, data: { available: true, items: data || [] } })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
