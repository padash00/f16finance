import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { resolveStation, resolveClient } from '../../_lib/auth'

export async function GET(req: NextRequest) {
  if (!hasAdminSupabaseCredentials()) {
    return NextResponse.json({ error: 'service-unavailable' }, { status: 503 })
  }

  const stationResult = await resolveStation(req)
  if ('error' in stationResult) {
    return NextResponse.json({ error: stationResult.error }, { status: stationResult.status })
  }

  const clientResult = await resolveClient(req, stationResult.station.id)
  if ('error' in clientResult) {
    return NextResponse.json({ error: clientResult.error }, { status: clientResult.status })
  }

  const { customer } = clientResult

  return NextResponse.json({
    clientId: customer.id,
    displayName: customer.name,
    username: customer.phone ?? '',
    avatarUrl: null,
    balance: Number(customer.kiosk_balance),
  })
}

export async function PATCH(req: NextRequest) {
  if (!hasAdminSupabaseCredentials()) {
    return NextResponse.json({ error: 'service-unavailable' }, { status: 503 })
  }

  const stationResult = await resolveStation(req)
  if ('error' in stationResult) {
    return NextResponse.json({ error: stationResult.error }, { status: stationResult.status })
  }

  const clientResult = await resolveClient(req, stationResult.station.id)
  if ('error' in clientResult) {
    return NextResponse.json({ error: clientResult.error }, { status: clientResult.status })
  }

  const { customer } = clientResult
  const admin = createAdminSupabaseClient()
  const body = await req.json().catch(() => ({}))

  const update: Record<string, unknown> = {}
  if (typeof body.displayName === 'string' && body.displayName.trim()) {
    update.name = body.displayName.trim()
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true })
  }

  const { error } = await admin.from('customers').update(update).eq('id', customer.id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
