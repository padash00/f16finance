import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Адрес живой активности смены.
 *
 * Apple выдаёт карточке на экране блокировки собственный адрес — отдельный от
 * адреса устройства. Приложение присылает его сюда, и дальше сервер сам
 * досылает карточке новые цифры, когда на точке что-то продали. Без этого
 * карточка обновлялась только пока телефон в руках, а продажи идут в
 * операторской программе на точке.
 */
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!hasAdminSupabaseCredentials()) return json({ error: 'not-configured' }, 503)

    const body = (await request.json().catch(() => null)) as {
      token?: string
      company_id?: string
      shift_id?: string | null
      action?: 'register' | 'stop'
    } | null

    const token = String(body?.token || '').trim()
    if (!token) return json({ error: 'token-required' }, 400)

    const supabase = createAdminSupabaseClient()

    if (body?.action === 'stop') {
      await supabase.from('live_activity_tokens').delete().eq('token', token)
      return json({ ok: true })
    }

    const companyId = String(body?.company_id || '').trim()
    if (!companyId) return json({ error: 'company-required' }, 400)

    // Точка должна быть той, на которой человек работает: иначе чужая карточка
    // получала бы чужие деньги.
    const operatorId = (access as any).operatorAuth?.operator_id
      ? String((access as any).operatorAuth.operator_id)
      : null

    if (operatorId) {
      const { data: assignment } = await supabase
        .from('operator_company_assignments')
        .select('id')
        .eq('operator_id', operatorId)
        .eq('company_id', companyId)
        .eq('is_active', true)
        .maybeSingle()
      if (!assignment?.id) return json({ error: 'forbidden' }, 403)
    }

    const { error } = await supabase.from('live_activity_tokens').upsert(
      {
        token,
        company_id: companyId,
        shift_id: body?.shift_id || null,
        user_id: access.user?.id || null,
        operator_id: operatorId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'token' },
    )
    if (error) throw error

    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/mobile/live-activity POST',
      message: error?.message || 'error',
    })
    return json({ error: 'live-activity-failed' }, 500)
  }
}
