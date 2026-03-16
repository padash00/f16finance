import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'

// NOTE: Before using this route, run this SQL in Supabase:
// ALTER TABLE expenses ADD COLUMN attachment_url text;
// Also create the storage bucket "expence-attachments" with public access in Supabase Storage.

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

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Допустимы только JPG, PNG, WebP, HEIC, PDF' }, { status: 400 })
    }

    // Max 10MB
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Максимальный размер файла: 10 МБ' }, { status: 400 })
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const fileName = `${expenseId}_${Date.now()}.${ext}`
    const arrayBuffer = await file.arrayBuffer()
    const buffer = new Uint8Array(arrayBuffer)

    const { error: uploadError } = await access.supabase.storage
      .from('expence-attachments')
      .upload(fileName, buffer, { contentType: file.type, upsert: true })

    if (uploadError) throw uploadError

    const { data: urlData } = access.supabase.storage
      .from('expence-attachments')
      .getPublicUrl(fileName)

    const publicUrl = urlData.publicUrl

    // Update expense record
    const { error: updateError } = await access.supabase
      .from('expenses')
      .update({ attachment_url: publicUrl })
      .eq('id', expenseId)

    if (updateError) throw updateError

    return NextResponse.json({ ok: true, url: publicUrl })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Upload failed' }, { status: 500 })
  }
}
