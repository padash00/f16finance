/**
 * Плейлист рекламы для экрана клиента.
 *
 * Operator desktop запрашивает активную рекламу для своей company и
 * проигрывает её на втором мониторе в состоянии idle (между клиентами).
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
    if (!companyId) return json({ ok: true, data: [] })

    const { data, error } = await supabase
      .from('customer_display_ads')
      .select('id, media_type, url, title, duration_sec, sort_order')
      .eq('company_id', companyId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) throw error
    return json({ ok: true, data: data || [] })
  } catch (error: any) {
    return json({ error: 'ad-playlist-failed', detail: error?.message || String(error) }, 500)
  }
}
