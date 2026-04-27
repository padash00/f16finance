import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const BUCKET_CANDIDATES = ['inventory-attachments', 'expense-attachments']

function detectMimeFromBytes(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  return null
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin && access.staffRole !== 'owner' && access.staffRole !== 'manager') {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Файл обязателен' }, { status: 400 })
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Максимальный размер: 10 МБ' }, { status: 400 })
    }
    if (!ALLOWED_MIME.includes(file.type)) {
      return NextResponse.json({ error: 'Допустимы только JPG, PNG, WEBP, PDF' }, { status: 400 })
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const detected = detectMimeFromBytes(bytes)
    if (!detected || !ALLOWED_MIME.includes(detected)) {
      return NextResponse.json({ error: 'Неверный формат файла накладной' }, { status: 400 })
    }

    const extByMime: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'application/pdf': 'pdf',
    }
    const ext = extByMime[detected]
    const suffix = Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map((b) => b.toString(16).padStart(2, '0')).join('')
    const fileName = `receipt_invoice_${Date.now()}_${suffix}.${ext}`

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(request)

    let uploadedBucket: string | null = null
    let uploadError: any = null
    for (const bucket of BUCKET_CANDIDATES) {
      const { error } = await supabase.storage.from(bucket).upload(fileName, bytes, {
        contentType: detected,
        upsert: false,
      })
      if (!error) {
        uploadedBucket = bucket
        uploadError = null
        break
      }
      uploadError = error
    }
    if (!uploadedBucket) throw uploadError || new Error('Не удалось загрузить файл накладной')

    const { data: publicData } = supabase.storage.from(uploadedBucket).getPublicUrl(fileName)
    return NextResponse.json({ ok: true, document_url: publicData.publicUrl, bucket: uploadedBucket })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/receipts/upload',
      message: error?.message || 'store receipt invoice upload failed',
    })
    return NextResponse.json({ error: error?.message || 'Ошибка загрузки накладной' }, { status: 500 })
  }
}
