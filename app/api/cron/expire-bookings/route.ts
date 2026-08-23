/**
 * Cron: закрывает брони, время которых прошло.
 *
 * Бронь оставалась «подтверждённой» вечно: на карте она исчезала сама (там
 * окно от текущего момента), а в базе висела живой. История номера состояла из
 * незакрытых обещаний, и статистика по ней ничего не значила.
 *
 * Ставится `expired` — «время прошло», а не `completed` — «состоялась».
 * Пришёл человек или нет, система не знает: отметку явки никто не ставит, и
 * записывать факт, которого не наблюдали, нельзя.
 */

import { NextResponse } from 'next/server'

import { verifyCronRequest } from '@/lib/server/cron-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (!hasAdminSupabaseCredentials()) {
    return NextResponse.json({ error: 'admin supabase not configured' }, { status: 500 })
  }

  const supabase = createAdminSupabaseClient()
  const nowIso = new Date().toISOString()

  const { data, error } = await supabase
    .from('client_bookings')
    .update({ status: 'expired', updated_at: nowIso })
    .in('status', ['requested', 'confirmed'])
    .not('ends_at', 'is', null)
    .lt('ends_at', nowIso)
    // Только брони конкретных ПК. Заявка из клиентского приложения — это
    // просьба «хочу прийти вечером», её разбирает человек, и закрывать её по
    // часам значило бы прятать необработанное обращение.
    .not('station_id', 'is', null)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, expired: (data || []).length })
}
