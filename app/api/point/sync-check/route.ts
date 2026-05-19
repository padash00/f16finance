/**
 * Лёгкий sync-check для operator desktop.
 *
 * Возвращает version-маркеры (timestamps) ключевых таблиц, которые operator
 * кэширует локально. Operator опрашивает раз в ~30с, и если version изменилась —
 * запускает полную перезагрузку context.
 *
 * Эта реализация ОЧЕНЬ дешёвая — несколько SELECT max(updated_at) в параллель.
 * Real-time через WebSocket недоступен на Vercel serverless — поэтому polling.
 */

import { NextResponse } from 'next/server'
import { requirePointDevice } from '@/lib/server/point-devices'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point
    const companyId = device.company_id
    if (!companyId) return json({ catalog: null, tariffs: null, prices: null, serverTime: new Date().toISOString() })

    // inventory_items скоупится по organization_id, а не company_id —
    // подтягиваем org_id из company перед основным батчем.
    const { data: companyRow } = await supabase
      .from('companies')
      .select('organization_id')
      .eq('id', companyId)
      .maybeSingle()
    const organizationId = (companyRow as any)?.organization_id || null

    // Параллельно тянем maxUpdatedAt по ключевым таблицам
    const [itemsRes, balancesRes, tariffsRes, salesRes] = await Promise.all([
      organizationId
        ? supabase
            .from('inventory_items')
            .select('updated_at')
            .eq('organization_id', organizationId)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from('inventory_balances')
        .select('updated_at, location:location_id!inner(company_id)')
        .eq('location.company_id', companyId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('arena_tariffs')
        .select('created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('point_inventory_sales')
        .select('created_at')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    // Pending push-уведомления от админа
    const { data: pendingMessages } = await supabase
      .from('point_device_messages')
      .select('id, kind, body, sent_by_name, created_at')
      .eq('device_id', device.id)
      .is('delivered_at', null)
      .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(10)

    return json({
      catalogVersion: itemsRes.data?.updated_at || null,
      balancesVersion: balancesRes.data?.updated_at || null,
      tariffsVersion: (tariffsRes.data as any)?.created_at || null,
      lastSaleVersion: salesRes.data?.created_at || null,
      pendingMessages: pendingMessages || [],
      serverTime: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('[sync-check] error:', error?.message)
    return json({ error: error?.message || 'sync-check failed' }, 500)
  }
}
