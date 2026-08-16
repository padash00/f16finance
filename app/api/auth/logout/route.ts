/**
 * Выход из системы.
 *
 * Раньше выход делался в браузере: сайдбар звал `supabase.auth.signOut()`.
 * Ради одного этого вызова весь клиент Supabase (212 КБ) попадал в сайдбар, а
 * сайдбар есть на каждой странице портала — то есть эти 212 КБ качались
 * всегда, даже когда никто никуда не выходит.
 *
 * Здесь тот же самый выход, но на сервере: сессия живёт в куках, и снимать её
 * правильнее там же, где она ставится.
 */

import { NextResponse } from 'next/server'

import { createRequestSupabaseClient } from '@/lib/server/request-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const supabase = createRequestSupabaseClient(request)
    await supabase.auth.signOut()
  } catch {
    // Сессия могла протухнуть сама — для человека это всё равно «вышел».
    // Ошибку здесь показывать не за что: он нажал «выйти» и должен выйти.
  }

  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
