import { NextResponse } from 'next/server'
import { revokeAdminToken } from '@/lib/server/admin-tokens'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const token = String(body?.token || '').trim()
    if (token) revokeAdminToken(token)
    return json({ ok: true })
  } catch {
    return json({ ok: true })
  }
}
