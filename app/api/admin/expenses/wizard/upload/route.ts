import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']

function detectMimeFromBytes(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'image/heic'
  return null
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const role = access.staffRole
    if (!access.isSuperAdmin && role !== 'owner' && role !== 'manager') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const sessionId = String(formData.get('session_id') || '').trim()

    if (!sessionId) return NextResponse.json({ error: 'session_id обязателен' }, { status: 400 })
    if (!file) return NextResponse.json({ error: 'Файл обязателен' }, { status: 400 })
    if (!ALLOWED_MIME.includes(file.type)) {
      return NextResponse.json({ error: 'Допустимы только JPG, PNG, WebP, HEIC, PDF' }, { status: 400 })
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Максимальный размер: 10 МБ' }, { status: 400 })
    }

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(request)

    const { data: session, error: sessionError } = await supabase
      .from('expense_wizard_sessions')
      .select('id, user_id, payload, consumed_at, expires_at')
      .eq('id', sessionId)
      .single()

    if (sessionError || !session) return NextResponse.json({ error: 'Сессия не найдена' }, { status: 404 })
    if (session.user_id !== access.user?.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    if (session.consumed_at) return NextResponse.json({ error: 'Сессия уже использована' }, { status: 410 })
    if (new Date(session.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'Сессия истекла' }, { status: 410 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = new Uint8Array(arrayBuffer)
    const detected = detectMimeFromBytes(buffer)
    if (!detected || !ALLOWED_MIME.includes(detected)) {
      return NextResponse.json({ error: 'Содержимое файла не соответствует допустимому формату' }, { status: 400 })
    }

    const extByMime: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/heic': 'heic',
      'application/pdf': 'pdf',
    }
    const ext = extByMime[detected]
    const randomSuffix = Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map((b) => b.toString(16).padStart(2, '0')).join('')
    const fileName = `wizard_${sessionId}_${randomSuffix}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('expense-attachments')
      .upload(fileName, buffer, { contentType: detected, upsert: true })

    if (uploadError) throw uploadError

    const { data: urlData } = supabase.storage
      .from('expense-attachments')
      .getPublicUrl(fileName)

    const documentUrl = urlData.publicUrl

    const currentPayload = (session.payload || {}) as { document_url?: string | null; document_urls?: unknown }
    const currentUrls = Array.isArray(currentPayload.document_urls)
      ? currentPayload.document_urls.map((url) => String(url || '')).filter(Boolean)
      : currentPayload.document_url
        ? [String(currentPayload.document_url)]
        : []
    const documentUrls = [...currentUrls, documentUrl]
    const mergedPayload = {
      ...currentPayload,
      document_url: documentUrls[0] || documentUrl,
      document_urls: documentUrls,
    }

    const { error: updateError } = await supabase
      .from('expense_wizard_sessions')
      .update({
        payload: mergedPayload,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)

    if (updateError) throw updateError

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'expense_wizard',
      entityId: String(sessionId),
      action: 'wizard.expense.upload',
      payload: {
        session_id: sessionId,
        mime: detected,
        file_size: file.size,
      },
    })

    return NextResponse.json({ ok: true, document_url: documentUrl, document_urls: documentUrls })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/expenses/wizard/upload',
      message: error?.message || 'upload failed',
    })
    return NextResponse.json({ error: error?.message || 'Ошибка загрузки' }, { status: 500 })
  }
}
