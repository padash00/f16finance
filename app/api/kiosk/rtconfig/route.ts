import { NextResponse } from 'next/server'

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: 'realtime-not-configured' }, { status: 503 })
  }

  return NextResponse.json({ ok: true, supabaseUrl, supabaseAnonKey })
}
