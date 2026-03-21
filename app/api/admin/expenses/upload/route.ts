import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

// NOTE: Before using this route, run this SQL in Supabase:
// ALTER TABLE expenses ADD COLUMN attachment_url text;
// Also create the storage bucket "expense-attachments" with public access in Supabase Storage.

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const expenseId = formData.get('expenseId') as string | null

    if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })
    if (!expenseId) return NextResponse.json({ error: 'expenseId required' }, { status: 400 })

    // Validate file type (client-provided MIME is untrusted — verify magic bytes server-side)
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Допустимы только JPG, PNG, WebP, HEIC, PDF' }, { status: 400 })
    }

    // Max 10MB
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Максимальный размер файла: 10 МБ' }, { status: 400 })
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = new Uint8Array(arrayBuffer)

    // Verify actual file content via magic bytes (prevents MIME spoofing)
    function detectMimeFromBytes(b: Uint8Array): string | null {
      if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
      if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
      if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf'
      // WebP: RIFF....WEBP
      if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
          b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
      // HEIC/HEIF: ftyp box at offset 4
      if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'image/heic'
      return null
    }
    const detectedMime = detectMimeFromBytes(buffer)
    if (!detectedMime || !allowedTypes.includes(detectedMime)) {
      return NextResponse.json({ error: 'Содержимое файла не соответствует допустимому формату' }, { status: 400 })
    }

    const allowedExtensions: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/heic': 'heic',
      'application/pdf': 'pdf',
    }
    const ext = allowedExtensions[detectedMime]
    const randomSuffix = Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map(b => b.toString(16).padStart(2, '0')).join('')
    const fileName = `${expenseId}_${randomSuffix}.${ext}`

    // Use admin client for storage + DB update to bypass RLS silently blocking the write
    const adminClient = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : access.supabase

    const { error: uploadError } = await adminClient.storage
      .from('expense-attachments')
      .upload(fileName, buffer, { contentType: file.type, upsert: true })

    if (uploadError) throw uploadError

    const { data: urlData } = adminClient.storage
      .from('expense-attachments')
      .getPublicUrl(fileName)

    const publicUrl = urlData.publicUrl

    // Update expense record using admin client so RLS does not silently drop the UPDATE
    const { error: updateError } = await adminClient
      .from('expenses')
      .update({ attachment_url: publicUrl })
      .eq('id', expenseId)

    if (updateError) throw updateError

    return NextResponse.json({ ok: true, url: publicUrl })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 })
  }
}
