import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { resolveStation, resolveClient } from '../../_lib/auth'

export async function POST(req: NextRequest) {
  if (!hasAdminSupabaseCredentials()) {
    return NextResponse.json({ error: 'service-unavailable' }, { status: 503 })
  }

  const stationResult = await resolveStation(req)
  if ('error' in stationResult) {
    return NextResponse.json({ error: stationResult.error }, { status: stationResult.status })
  }
  const { station } = stationResult

  const clientResult = await resolveClient(req, station.id)
  if ('error' in clientResult) {
    return NextResponse.json({ error: clientResult.error }, { status: clientResult.status })
  }
  const { customer } = clientResult

  const admin = createAdminSupabaseClient()
  const body = await req.json().catch(() => ({}))
  const tariffId = String(body?.tariffId || '').trim()
  if (!tariffId) {
    return NextResponse.json({ error: 'tariffId-required' }, { status: 400 })
  }

  // Получаем тариф
  const { data: tariff, error: tariffErr } = await admin
    .from('arena_tariffs')
    .select('id, name, duration_min, price')
    .eq('id', tariffId)
    .eq('point_project_id', station.point_project_id)
    .eq('is_active', true)
    .maybeSingle()

  if (tariffErr || !tariff) {
    return NextResponse.json({ error: 'tariff-not-found' }, { status: 404 })
  }

  const price = Number(tariff.price)
  const balance = Number(customer.kiosk_balance)

  if (balance < price) {
    return NextResponse.json({ error: 'insufficient-balance', balance, price }, { status: 402 })
  }

  // Списываем баланс атомарно
  const { error: deductErr } = await admin.rpc('kiosk_deduct_balance', {
    p_customer_id: customer.id,
    p_amount: price,
  })

  if (deductErr) {
    // Fallback: прямое обновление если RPC ещё не создан
    const { error: updErr } = await admin
      .from('customers')
      .update({ kiosk_balance: balance - price })
      .eq('id', customer.id)
      .gte('kiosk_balance', price) // optimistic lock
    if (updErr) {
      return NextResponse.json({ error: 'balance-deduction-failed' }, { status: 500 })
    }
  }

  // Создаём arena_session
  const now = new Date()
  const endsAt = new Date(now.getTime() + tariff.duration_min * 60 * 1000)

  const { data: session, error: sessionErr } = await admin
    .from('arena_sessions')
    .insert({
      station_id: station.id,
      point_project_id: station.point_project_id,
      company_id: station.company_id,
      customer_id: customer.id,
      tariff_id: tariffId,
      started_at: now.toISOString(),
      ends_at: endsAt.toISOString(),
      amount: price,
      status: 'active',
      payment_method: 'kiosk_balance',
      cash_amount: price,
      kaspi_amount: 0,
      discount_percent: 0,
    })
    .select('id')
    .single()

  if (sessionErr) {
    return NextResponse.json({ error: sessionErr.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    sessionId: session.id,
    durationMin: tariff.duration_min,
    endsAt: endsAt.toISOString(),
    newBalance: balance - price,
  })
}
