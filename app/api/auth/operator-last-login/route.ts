import { NextResponse } from 'next/server'

import { requireOperatorAuthRow } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { authId?: string } | null
    if (!body?.authId) {
      return NextResponse.json({ error: 'authId обязателен' }, { status: 400 })
    }

    const guard = await requireOperatorAuthRow(req, body.authId)
    if (guard) return guard

    const supabase = createAdminSupabaseClient()
    const { error } = await supabase
      .from('operator_auth')
      .update({ last_login: new Date().toISOString() })
      .eq('id', body.authId)

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Operator last_login update error', error)
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
