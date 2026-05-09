/**
 * Загрузка фото / голосовых / файлов в чат.
 * Принимает multipart/form-data с полем 'file'.
 * Загружает в Supabase Storage bucket 'team-chat-attachments'.
 * Возвращает public URL.
 */

import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const form = await request.formData().catch(() => null)
  const file = form?.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 })

  const sizeLimit = 50 * 1024 * 1024
  if (file.size > sizeLimit) {
    return NextResponse.json({ error: 'Файл слишком большой (макс 50 МБ)' }, { status: 400 })
  }

  const buf = Buffer.from(await file.arrayBuffer())
  const ext = (file.name?.split('.').pop() || 'bin').toLowerCase()
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 8)
  const path = `${ts}_${rand}.${ext}`

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
  const { error: uploadError } = await supabase.storage
    .from('team-chat-attachments')
    .upload(path, buf, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  const { data: pub } = supabase.storage.from('team-chat-attachments').getPublicUrl(path)
  return NextResponse.json({
    url: pub.publicUrl,
    path,
    name: file.name,
    type: file.type,
    size: file.size,
  })
}
