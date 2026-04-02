import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { createRequestSupabaseClient } from '@/lib/server/request-auth'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const url = new URL(req.url)
    const operatorId = url.searchParams.get('operator_id') || ''
    if (!operatorId) return json({ error: 'operator_id required' }, 400)

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const [
      { data: operator, error: operatorError },
      { data: profile },
      { data: workHistory },
      { data: documents },
      { data: notes },
      { data: account },
      { data: companies },
    ] = await Promise.all([
      supabase.from('operators').select('*').eq('id', operatorId).maybeSingle(),
      supabase.from('operator_profiles').select('*').eq('operator_id', operatorId).maybeSingle(),
      supabase
        .from('operator_work_history')
        .select('*, companies:company_id(name, code)')
        .eq('operator_id', operatorId)
        .order('start_date', { ascending: false }),
      supabase
        .from('operator_documents')
        .select('*')
        .eq('operator_id', operatorId)
        .order('created_at', { ascending: false }),
      supabase
        .from('operator_notes')
        .select('*')
        .eq('operator_id', operatorId)
        .order('created_at', { ascending: false }),
      supabase.from('operator_auth').select('*').eq('operator_id', operatorId).maybeSingle(),
      supabase.from('companies').select('id, name, code').order('name'),
    ])

    if (operatorError) throw operatorError
    if (!operator) return json({ error: 'Оператор не найден' }, 404)

    return json({
      ok: true,
      data: {
        operator,
        profile: profile || null,
        workHistory: (workHistory || []).map((w: any) => ({
          ...w,
          company_name: Array.isArray(w.companies) ? w.companies[0]?.name : w.companies?.name,
          company_code: Array.isArray(w.companies) ? w.companies[0]?.code : w.companies?.code,
        })),
        documents: documents || [],
        notes: notes || [],
        account: account || null,
        companies: companies || [],
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/operators/profile GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function PATCH(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const body = await req.json().catch(() => null)
    const operatorId = String(body?.operator_id || '').trim()
    if (!operatorId) return json({ error: 'operator_id required' }, 400)

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const profilePayload: Record<string, unknown> = body?.profile && typeof body.profile === 'object'
      ? { ...(body.profile as Record<string, unknown>) }
      : {}
    // also accept top-level photo_url (sent by AvatarUpload)
    if ('photo_url' in (body ?? {})) {
      profilePayload.photo_url = body.photo_url ?? null
    }
    delete profilePayload.id
    delete profilePayload.operator_id
    delete profilePayload.created_at

    const telegramChatId =
      typeof body?.telegram_chat_id === 'string' && body.telegram_chat_id.trim()
        ? body.telegram_chat_id.trim()
        : null

    const { error: operatorError } = await supabase
      .from('operators')
      .update({ telegram_chat_id: telegramChatId })
      .eq('id', operatorId)

    if (operatorError) throw operatorError

    const { error } = await supabase
      .from('operator_profiles')
      .upsert(
        {
          operator_id: operatorId,
          ...profilePayload,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'operator_id' }
      )

    if (error) throw error

    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/operators/profile PATCH', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
