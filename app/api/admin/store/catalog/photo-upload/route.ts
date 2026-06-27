import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { checkRateLimit } from '@/lib/server/rate-limit'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { isStoreManager } from '@/lib/server/store-access'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

// Загрузка фото товара в bucket product-photos. Образец: store/receipts/upload.
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp']
const BUCKET = 'product-photos'

function detectMimeFromBytes(b: Uint8Array): string | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) return 'image/webp'
  return null
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!isStoreManager(access)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const rl = checkRateLimit(`photo-up:${access.user?.id || 'anon'}`, 20, 60_000)
    if (!rl.allowed) return NextResponse.json({ error: 'too-many-requests' }, { status: 429 })

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Файл обязателен' }, { status: 400 })
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Максимальный размер: 5 МБ' }, { status: 400 })
    }
    if (!ALLOWED_MIME.includes(file.type)) {
      return NextResponse.json({ error: 'Допустимы только JPG, PNG, WEBP' }, { status: 400 })
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const detected = detectMimeFromBytes(bytes)
    if (!detected || !ALLOWED_MIME.includes(detected)) {
      return NextResponse.json({ error: 'Неверный формат изображения' }, { status: 400 })
    }

    const extByMime: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    }
    const ext = extByMime[detected]
    const suffix = Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map((b) => b.toString(16).padStart(2, '0')).join('')
    const fileName = `product_${Date.now()}_${suffix}.${ext}`

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(request)

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(fileName, bytes, {
      contentType: detected,
      upsert: false,
    })
    if (uploadError) {
      // Мягкая деградация: bucket ещё не создан (миграция не применена).
      const msg = String((uploadError as any)?.message || '').toLowerCase()
      if (msg.includes('not found') || msg.includes('bucket')) {
        return NextResponse.json(
          { error: 'Хранилище фото товаров не настроено. Примените миграцию product-photos.' },
          { status: 503 },
        )
      }
      throw uploadError
    }

    const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(fileName)
    return NextResponse.json({ ok: true, image_url: publicData.publicUrl, bucket: BUCKET })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/catalog/photo-upload',
      message: error?.message || 'product photo upload failed',
    })
    return NextResponse.json({ error: error?.message || 'Ошибка загрузки фото' }, { status: 500 })
  }
}
