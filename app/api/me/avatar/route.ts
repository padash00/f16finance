/**
 * Своя фотография в профиле.
 *
 * На сайте её грузит браузер прямо в хранилище — у приложения такого пути нет
 * и быть не должно: клиент ходит только через наш API.
 *
 * Права здесь не спрашиваем и не должны: человек меняет **своё** фото. Право
 * `operators.avatar_upload` — про чужие карточки, и путать эти два случая
 * значит запретить человеку поменять собственный аватар.
 */
import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

const BUCKET = 'operator-files'
const MAX_BYTES = 5 * 1024 * 1024

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const operatorId = access.operatorAuth?.operator_id || null
    const staffId = access.staffMember?.id || null
    if (!operatorId && !staffId) return json({ error: 'no-profile' }, 404)

    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) return json({ error: 'file обязателен' }, 400)

    if (!file.type.startsWith('image/')) {
      return json({ error: 'Нужна фотография' }, 400)
    }
    if (file.size > MAX_BYTES) {
      return json({ error: 'Файл больше 5 МБ' }, 400)
    }

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    const extension = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
    const owner = operatorId || staffId
    const path = `avatars/${owner}-${Date.now()}.${extension || 'jpg'}`
    const bytes = new Uint8Array(await file.arrayBuffer())

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType: file.type,
      upsert: true,
    })
    if (uploadError) return json({ error: uploadError.message }, 500)

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
    const url = pub?.publicUrl || null
    if (!url) return json({ error: 'no-public-url' }, 500)

    if (operatorId) {
      // Карточки профиля может не быть: оператора заводят одной строкой, а
      // профиль появляется позже.
      const { data: existing } = await supabase
        .from('operator_profiles')
        .select('id')
        .eq('operator_id', operatorId)
        .maybeSingle()

      const { error } = existing?.id
        ? await supabase.from('operator_profiles').update({ photo_url: url }).eq('operator_id', operatorId)
        : await supabase.from('operator_profiles').insert([{ operator_id: operatorId, photo_url: url }])
      if (error) throw error
    } else if (staffId) {
      const { error } = await supabase.from('staff').update({ photo_url: url }).eq('id', staffId)
      if (error) throw error
    }

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: operatorId ? 'operator' : 'staff',
      entityId: String(owner),
      action: 'avatar.update',
      payload: { url },
    })

    return json({ ok: true, data: { url } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/me/avatar POST',
      message: error?.message || 'error',
    })
    return json({ error: 'avatar-failed' }, 500)
  }
}
