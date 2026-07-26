import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

const BUCKET = 'org-logos'
const MAX_SIZE = 2 * 1024 * 1024 // 2 МБ — логотипу с запасом

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

function detectMime(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  )
    return 'image/webp'
  // SVG — текстовый: ищем '<svg' в начале файла.
  const head = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, 512)).toLowerCase()
  if (head.includes('<svg')) return 'image/svg+xml'
  return null
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

/** Загрузить/заменить логотип организации. Только супер-админ (управление на /platform). */
export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const organizationId = String(formData.get('organization_id') || '').trim()
    if (!organizationId) return json({ error: 'organization_id обязателен' }, 400)
    if (!file) return json({ error: 'Файл обязателен' }, 400)
    if (file.size > MAX_SIZE) return json({ error: 'Максимальный размер логотипа — 2 МБ' }, 400)

    const bytes = new Uint8Array(await file.arrayBuffer())
    const detected = detectMime(bytes)
    if (!detected) {
      return json({ error: 'Допустимы только PNG, JPG, WEBP или SVG' }, 400)
    }

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(request)

    // Организация должна существовать. Берём branding, чтобы дописать logo_url.
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('id, name, branding')
      .eq('id', organizationId)
      .maybeSingle()
    if (orgError) throw orgError
    if (!org) return json({ error: 'Организация не найдена' }, 404)

    const ext = EXT_BY_MIME[detected]
    const suffix = Array.from(crypto.getRandomValues(new Uint8Array(6)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    const fileName = `${organizationId}/logo_${Date.now()}_${suffix}.${ext}`

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(fileName, bytes, {
      contentType: detected,
      upsert: false,
    })
    if (uploadError) throw uploadError

    const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(fileName)
    const logoUrl = publicData.publicUrl

    const nextBranding = { ...((org as any).branding || {}), logo_url: logoUrl }
    const { error: updateError } = await supabase
      .from('organizations')
      .update({ branding: nextBranding })
      .eq('id', organizationId)
    if (updateError) throw updateError

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'organization',
      entityId: organizationId,
      action: 'update',
      payload: { logo_url: logoUrl, name: (org as any).name },
    })

    return json({ ok: true, logo_url: logoUrl })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/organizations/logo POST',
      message: error?.message || 'org logo upload failed',
    })
    return json({ error: error?.message || 'Ошибка загрузки' }, 500)
  }
}

/** Снять логотип организации (вернуть буквенную марку). Только супер-админ. */
export async function DELETE(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)

    const body = await request.json().catch(() => null)
    const organizationId = String(body?.organization_id || '').trim()
    if (!organizationId) return json({ error: 'organization_id обязателен' }, 400)

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(request)

    const { data: org } = await supabase
      .from('organizations')
      .select('id, branding')
      .eq('id', organizationId)
      .maybeSingle()
    const nextBranding = { ...((org as any)?.branding || {}), logo_url: null }

    const { error } = await supabase
      .from('organizations')
      .update({ branding: nextBranding })
      .eq('id', organizationId)
    if (error) throw error

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'organization',
      entityId: organizationId,
      action: 'update',
      payload: { logo_url: null },
    })

    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/organizations/logo DELETE',
      message: error?.message || 'org logo delete failed',
    })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}
