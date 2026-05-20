import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

const BUCKET = 'customer-display-ads'
const MAX_SIZE = 200 * 1024 * 1024 // 200MB

const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const VIDEO_MIME = ['video/mp4', 'video/webm', 'video/quicktime']

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}

function detectMimeFromBytes(b: Uint8Array): string | null {
  // images
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  )
    return 'image/webp'
  // video: ISO base media (mp4/mov) — 'ftyp' at offset 4
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11])
    if (brand.startsWith('qt')) return 'video/quicktime'
    return 'video/mp4'
  }
  // webm/mkv: EBML header 0x1A45DFA3
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm'
  return null
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin && !access.staffRole) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Файл обязателен' }, { status: 400 })
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'Максимальный размер: 200 МБ' }, { status: 400 })
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const detected = detectMimeFromBytes(bytes)
    if (!detected || (!IMAGE_MIME.includes(detected) && !VIDEO_MIME.includes(detected))) {
      return NextResponse.json(
        { error: 'Допустимы только картинки (JPG, PNG, WEBP, GIF) и видео (MP4, WEBM, MOV)' },
        { status: 400 },
      )
    }

    const mediaType = IMAGE_MIME.includes(detected) ? 'image' : 'video'
    const ext = EXT_BY_MIME[detected]
    const suffix = Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
    const fileName = `ad_${Date.now()}_${suffix}.${ext}`

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(request)

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(fileName, bytes, {
      contentType: detected,
      upsert: false,
    })
    if (uploadError) throw uploadError

    const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(fileName)
    return NextResponse.json({
      ok: true,
      url: publicData.publicUrl,
      media_type: mediaType,
      bucket: BUCKET,
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/advertising/upload',
      message: error?.message || 'advertising upload failed',
    })
    return NextResponse.json({ error: error?.message || 'Ошибка загрузки' }, { status: 500 })
  }
}
