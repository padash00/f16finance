import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Публичный health: показывает, к какому Supabase-проекту привязан СЕРВЕР (host из
// NEXT_PUBLIC_SUPABASE_URL — это и так публичное значение, не секрет). Нужен для
// диагностики мобилки: если ref сервера ≠ ref токена, сервер отвергает чужой токен
// как unauthorized. Никаких секретов не отдаём.
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  let host = ''
  try {
    host = url ? new URL(url).host : ''
  } catch {
    host = ''
  }
  const ref = host ? host.split('.')[0] : null
  return NextResponse.json({ host, ref })
}
