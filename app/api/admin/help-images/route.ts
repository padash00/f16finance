import { NextResponse } from 'next/server'

import { HELP_IMAGE_SLOTS, findHelpImageSlot } from '@/lib/core/help-images'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

const BUCKET = 'help-images'
const MAX_SIZE = 4 * 1024 * 1024 // 4 МБ — скриншоту экрана хватает с запасом

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** Определяем тип по сигнатуре файла, а не по расширению из формы. */
function detectMime(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  )
    return 'image/webp'
  return null
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function client(request: Request) {
  return hasAdminSupabaseCredentials()
    ? createAdminSupabaseClient()
    : createRequestSupabaseClient(request)
}

/** Список слотов вместе с уже загруженными картинками. Только супер-админ. */
export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)

    const supabase = client(request)
    const { data, error } = await supabase.from('help_images').select('*')
    if (error) throw error

    const bySlot = new Map((data || []).map((row: any) => [String(row.slot), row]))
    const slots = HELP_IMAGE_SLOTS.map((slot) => ({
      ...slot,
      image: bySlot.get(slot.slot) || null,
    }))

    // Строки от удалённых из кода слотов — показываем отдельно, чтобы их можно
    // было убрать, а не гадать, почему картинка нигде не появляется.
    const orphans = (data || []).filter((row: any) => !findHelpImageSlot(String(row.slot)))

    return json({ ok: true, slots, orphans })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/help-images:get',
      message: error?.message || 'Help images GET error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

/** Загрузить или заменить картинку слота. multipart: slot, file, caption?, alt? */
export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)

    const formData = await request.formData()
    const slot = String(formData.get('slot') || '').trim()
    const file = formData.get('file') as File | null
    const caption = String(formData.get('caption') || '').trim()
    const alt = String(formData.get('alt') || '').trim()

    const known = findHelpImageSlot(slot)
    if (!known) return json({ error: 'Неизвестный слот иллюстрации' }, 400)

    const supabase = client(request)

    // Без файла — правим только подписи у уже загруженной картинки.
    if (!file || file.size === 0) {
      const { data: current, error: currentError } = await supabase
        .from('help_images')
        .select('*')
        .eq('slot', slot)
        .maybeSingle()
      if (currentError) throw currentError
      if (!current) return json({ error: 'Сначала загрузите изображение' }, 400)

      const { data, error } = await supabase
        .from('help_images')
        .update({
          caption: caption || null,
          alt: alt || null,
          updated_at: new Date().toISOString(),
          updated_by: access.user?.id || null,
        })
        .eq('slot', slot)
        .select('*')
        .single()
      if (error) throw error
      return json({ ok: true, data })
    }

    if (file.size > MAX_SIZE) return json({ error: 'Максимальный размер файла — 4 МБ' }, 400)

    const bytes = new Uint8Array(await file.arrayBuffer())
    const detected = detectMime(bytes)
    if (!detected) return json({ error: 'Допустимы только PNG, JPG или WEBP' }, 400)

    const suffix = Array.from(crypto.getRandomValues(new Uint8Array(6)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    const fileName = `${slot}/${Date.now()}_${suffix}.${EXT_BY_MIME[detected]}`

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(fileName, bytes, {
      contentType: detected,
      upsert: false,
    })
    if (uploadError) throw uploadError

    const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(fileName)

    const { data: previous } = await supabase
      .from('help_images')
      .select('storage_path')
      .eq('slot', slot)
      .maybeSingle()

    const { data, error } = await supabase
      .from('help_images')
      .upsert(
        {
          slot,
          url: publicData.publicUrl,
          storage_path: fileName,
          caption: caption || known.caption,
          alt: alt || known.title,
          updated_at: new Date().toISOString(),
          updated_by: access.user?.id || null,
        },
        { onConflict: 'slot' },
      )
      .select('*')
      .single()
    if (error) throw error

    // Старый файл больше не нужен — иначе бакет растёт с каждой заменой.
    const previousPath = (previous as any)?.storage_path
    if (previousPath && previousPath !== fileName) {
      await supabase.storage.from(BUCKET).remove([previousPath]).catch(() => null)
    }

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'help-image',
      entityId: slot,
      action: 'upload',
      payload: { slot, url: publicData.publicUrl },
    })

    return json({ ok: true, data })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/help-images:post',
      message: error?.message || 'Help images POST error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

/** Убрать картинку со страницы: удаляем запись и файл. */
export async function DELETE(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)

    const slot = String(new URL(request.url).searchParams.get('slot') || '').trim()
    if (!slot) return json({ error: 'slot обязателен' }, 400)

    const supabase = client(request)
    const { data: current, error: currentError } = await supabase
      .from('help_images')
      .select('storage_path')
      .eq('slot', slot)
      .maybeSingle()
    if (currentError) throw currentError
    if (!current) return json({ ok: true })

    const { error } = await supabase.from('help_images').delete().eq('slot', slot)
    if (error) throw error

    const path = (current as any).storage_path
    if (path) await supabase.storage.from(BUCKET).remove([path]).catch(() => null)

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'help-image',
      entityId: slot,
      action: 'delete',
      payload: { slot },
    })

    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/help-images:delete',
      message: error?.message || 'Help images DELETE error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
