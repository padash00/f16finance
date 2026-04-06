import { NextResponse } from 'next/server'
import { arenaExtensionMinutesFromPayment } from '@/lib/core/arena-extension-minutes'
import { effectiveZoneExtensionHourly } from '@/lib/core/arena-zone-extension-hourly'
import { computeTimeWindowEndsAt, isNowInTariffWindow, isTariffOfferedNow } from '@/lib/core/arena-tariff-window'
import { requirePointDevice } from '@/lib/server/point-devices'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { escapeTelegramHtml } from '@/lib/telegram/message-kit'
import { sendTelegramMessage } from '@/lib/telegram/send'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function getCurrentShift(): 'day' | 'night' {
  const hour = new Date().getHours()
  return hour >= 6 && hour < 22 ? 'day' : 'night'
}

// In-memory map: sessionId → notifiedAt timestamp (for 5-min Telegram dedup)
const notified5minMap = new Map<string, number>()

// Cleanup entries older than 3 hours every hour
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const cutoff = Date.now() - 3 * 60 * 60_000
    for (const [id, ts] of notified5minMap) {
      if (ts < cutoff) notified5minMap.delete(id)
    }
  }, 60 * 60_000)
}

// ─── GET: fetch zones, stations, tariffs, active sessions ─────────────────────

export async function GET(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response
    const { supabase, device } = point
    const projectId = device.id
    const companyId = device.company_id || null

    /** Строки с company_id = null (старые данные) должны быть видны той же точке, что и привязанная компания */
    function withCo<T>(q: T): T {
      if (!companyId) return q
      return (q as any).or(`company_id.eq.${companyId},company_id.is.null`) as T
    }

    const todayDate = new Date().toISOString().slice(0, 10)

    const [
      { data: zones, error: zonesError },
      { data: stations, error: stationsError },
      { data: tariffs, error: tariffsError },
      { data: sessions, error: sessionsError },
      { data: decorations },
      { data: todayIncomes },
      { data: todayTechLogs },
    ] = await Promise.all([
      withCo(supabase.from('arena_zones').select('*').eq('point_project_id', projectId).eq('is_active', true)).order('name'),
      withCo(supabase.from('arena_stations').select('*').eq('point_project_id', projectId).eq('is_active', true)).order('order_index').order('name'),
      withCo(supabase.from('arena_tariffs').select('*').eq('point_project_id', projectId).eq('is_active', true)).order('price'),
      withCo(supabase.from('arena_sessions').select('*').eq('point_project_id', projectId).eq('status', 'active')),
      withCo(supabase.from('arena_map_decorations').select('*').eq('point_project_id', projectId)).order('created_at'),
      withCo(supabase.from('incomes').select('cash_amount,kaspi_amount,comment,created_at').eq('source', 'arena-session').eq('date', todayDate)),
      withCo(supabase.from('arena_tech_logs').select('id,station_name,reason,amount,created_at').eq('point_project_id', projectId)).gte('created_at', todayDate + 'T00:00:00.000Z').order('created_at'),
    ])

    if (zonesError) throw zonesError
    if (stationsError) throw stationsError
    if (tariffsError) throw tariffsError
    if (sessionsError) throw sessionsError

    // Auto-complete sessions overdue by more than 2 hours
    const nowTs = new Date()
    const autoCutoff = new Date(nowTs.getTime() - 2 * 60 * 60_000).toISOString()
    const staleSessions = (sessions || []).filter((s: any) => s.ends_at < autoCutoff)
    if (staleSessions.length > 0) {
      await supabase
        .from('arena_sessions')
        .update({ status: 'completed', ended_at: nowTs.toISOString() })
        .in('id', staleSessions.map((s: any) => s.id))
        .eq('status', 'active')
    }
    const activeSessions = (sessions || []).filter((s: any) => s.ends_at >= autoCutoff)
    const activeTariffIds = new Set(
      (activeSessions as { tariff_id?: string }[]).map((s) => s.tariff_id).filter(Boolean) as string[],
    )

    const incomeRows = todayIncomes || []
    const todayCash = incomeRows.reduce((s: number, r: any) => s + Number(r.cash_amount || 0), 0)
    const todayKaspi = incomeRows.reduce((s: number, r: any) => s + Number(r.kaspi_amount || 0), 0)

    const tariffsVisible = (tariffs || []).filter((t: any) =>
      activeTariffIds.has(String(t.id)) ||
      isTariffOfferedNow(nowTs, {
        tariff_type: t.tariff_type,
        window_start_time: t.window_start_time,
        window_end_time: t.window_end_time,
      }),
    )

    const allTariffs = tariffs || []
    const zonesOut = (zones || []).map((z: any) => {
      const eff = effectiveZoneExtensionHourly(z, z.id, allTariffs)
      return eff != null ? { ...z, extension_hourly_price: eff } : z
    })

    return json({
      ok: true,
      data: {
        zones: zonesOut,
        stations: stations || [],
        tariffs: tariffsVisible,
        sessions: activeSessions,
        decorations: decorations || [],
        today_income: { cash: todayCash, kaspi: todayKaspi, rows: incomeRows },
        today_tech_logs: todayTechLogs || [],
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/point/arena:get',
      message: error?.message || 'Arena GET error',
    })
    return json({ error: error?.message || 'Ошибка загрузки' }, 500)
  }
}

// ─── POST: session management actions ─────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response
    const { supabase, device } = point
    const projectId = device.id
    const companyId = device.company_id || null

    const body = await request.json().catch(() => null)
    if (!body?.action) return json({ error: 'action required' }, 400)

    // ─── START SESSION ────────────────────────────────────────────────────────
    if (body.action === 'startSession') {
      const {
        stationId,
        tariffId,
        operatorId,
        payment_method = 'cash',
        cash_amount: rawCashAmt,
        kaspi_amount: rawKaspiAmt,
        discount_percent = 0,
      } = body
      if (!stationId || !tariffId) return json({ error: 'stationId and tariffId required' }, 400)

      // Ensure station is not already occupied
      const { data: existing } = await supabase
        .from('arena_sessions')
        .select('id')
        .eq('station_id', stationId)
        .eq('status', 'active')
        .maybeSingle()

      if (existing) return json({ error: 'station-already-occupied' }, 409)

      // Fetch tariff for duration and price
      const { data: tariff, error: tariffError } = await supabase
        .from('arena_tariffs')
        .select('*')
        .eq('id', tariffId)
        .single()
      if (tariffError || !tariff) return json({ error: 'tariff-not-found' }, 404)

      const startedAt = new Date()
      let endsAt: Date

      if (tariff.tariff_type === 'time_window' && tariff.window_end_time) {
        const windowCheck = isNowInTariffWindow(
          startedAt,
          String(tariff.tariff_type),
          tariff.window_start_time as string | null | undefined,
          tariff.window_end_time as string | null | undefined,
        )
        if (!windowCheck.ok) {
          return json(
            {
              error: 'Этот тариф сейчас недоступен: вне окна времени (настройки тарифа на сайте).',
              code: 'outside-tariff-window',
            },
            403,
          )
        }
        const computed = computeTimeWindowEndsAt(
          startedAt,
          tariff.window_start_time as string | null | undefined,
          tariff.window_end_time as string | null | undefined,
        )
        endsAt = computed ?? new Date(startedAt.getTime() + Number(tariff.duration_minutes) * 60_000)
      } else {
        endsAt = new Date(startedAt.getTime() + Number(tariff.duration_minutes) * 60_000)
      }

      // Calculate discounted price
      const discPct = Number(discount_percent) || 0
      const discountedPrice = Math.round(Number(tariff.price) * (1 - discPct / 100))

      // Resolve cash/kaspi amounts
      let finalCash: number
      let finalKaspi: number
      if (payment_method === 'cash') {
        finalCash = discountedPrice
        finalKaspi = 0
      } else if (payment_method === 'kaspi') {
        finalCash = 0
        finalKaspi = discountedPrice
      } else {
        finalCash = Number(rawCashAmt) || 0
        finalKaspi = Number(rawKaspiAmt) || 0
      }

      // Fetch station name for income comment
      const { data: stationRow } = await supabase
        .from('arena_stations')
        .select('name')
        .eq('id', stationId)
        .maybeSingle()
      const stationName = (stationRow as any)?.name || stationId

      const { data: arenaSession, error: insertError } = await supabase
        .from('arena_sessions')
        .insert({
          point_project_id: projectId,
          company_id: companyId,
          station_id: stationId,
          tariff_id: tariffId,
          operator_id: operatorId || null,
          started_at: startedAt.toISOString(),
          ends_at: endsAt.toISOString(),
          amount: discountedPrice,
          status: 'active',
          payment_method,
          cash_amount: finalCash,
          kaspi_amount: finalKaspi,
          discount_percent: discPct,
        })
        .select()
        .single()

      if (insertError) throw insertError

      // Create income record
      const { data: incomeRow, error: incomeError } = await supabase
        .from('incomes')
        .insert({
          date: new Date().toISOString().slice(0, 10),
          company_id: companyId || null,
          operator_id: operatorId || null,
          shift: getCurrentShift(),
          zone: 'pc',
          cash_amount: finalCash,
          kaspi_amount: finalKaspi,
          online_amount: 0,
          card_amount: 0,
          comment: `Арена: ${stationName} — ${tariff.name}`,
          source: 'arena-session',
        })
        .select('id')
        .single()

      if (incomeError) {
        await writeSystemErrorLogSafe({
          scope: 'server',
          area: 'api/point/arena:startSession:incomeInsert',
          message: incomeError.message || 'Income insert failed',
        })
      }

      // Update session with income_id if successfully created
      if (incomeRow?.id) {
        await supabase
          .from('arena_sessions')
          .update({ income_id: incomeRow.id })
          .eq('id', (arenaSession as any).id)
      }

      return json({ ok: true, data: arenaSession })
    }

    // ─── END SESSION ──────────────────────────────────────────────────────────
    if (body.action === 'endSession') {
      const { sessionId } = body
      if (!sessionId) return json({ error: 'sessionId required' }, 400)

      const { data: session, error: updateError } = await supabase
        .from('arena_sessions')
        .update({ status: 'completed', ended_at: new Date().toISOString() })
        .eq('id', sessionId)
        .eq('point_project_id', projectId)
        .select()
        .single()

      if (updateError) throw updateError
      notified5minMap.delete(sessionId)
      return json({ ok: true, data: session })
    }

    // ─── EXTEND SESSION ───────────────────────────────────────────────────────
    if (body.action === 'extendSession') {
      const {
        sessionId,
        tariffId,
        amount_extension: amountExtension,
        payment_method = 'cash',
        cash_amount: extCashAmt,
        kaspi_amount: extKaspiAmt,
      } = body
      if (!sessionId) return json({ error: 'sessionId required' }, 400)

      const { data: current, error: fetchError } = await supabase
        .from('arena_sessions')
        .select('ends_at, amount, station_id, operator_id, tariff_id')
        .eq('id', sessionId)
        .eq('point_project_id', projectId)
        .single()
      if (fetchError || !current) return json({ error: 'session-not-found' }, 404)

      const currentEndsAt = new Date((current as any).ends_at)
      const baseTime = currentEndsAt > new Date() ? currentEndsAt : new Date()

      let extraMinutes: number
      let extCash: number
      let extKaspi: number
      let extPrice: number

      if (amountExtension === true) {
        const sid = (current as any).tariff_id as string | null
        if (!sid) {
          return json(
            { error: 'У сессии нет тарифа — продление только по выбранному пакету с сайта невозможно. Завершите и откройте заново.', code: 'session-tariff-missing' },
            400,
          )
        }
        const { data: rateTariff, error: rateErr } = await supabase.from('arena_tariffs').select('*').eq('id', sid).single()
        if (rateErr || !rateTariff) return json({ error: 'tariff-not-found' }, 404)

        if (payment_method === 'cash') {
          extCash = Math.round(Number(extCashAmt) || 0)
          extKaspi = 0
        } else if (payment_method === 'kaspi') {
          extCash = 0
          extKaspi = Math.round(Number(extKaspiAmt) || 0)
        } else {
          extCash = Math.round(Number(extCashAmt) || 0)
          extKaspi = Math.round(Number(extKaspiAmt) || 0)
        }
        extPrice = extCash + extKaspi

        let zoneHourly: number | null = null
        const { data: stRow } = await supabase
          .from('arena_stations')
          .select('zone_id')
          .eq('id', (current as any).station_id as string)
          .maybeSingle()
        let stZoneId = stRow?.zone_id as string | null | undefined
        const tariffZoneId = (rateTariff as Record<string, unknown>).zone_id
        if (!stZoneId && tariffZoneId != null && tariffZoneId !== '') {
          stZoneId = String(tariffZoneId)
        }
        if (stZoneId) {
          const [{ data: zoneRow }, { data: zoneTariffRows }] = await Promise.all([
            supabase.from('arena_zones').select('extension_hourly_price').eq('id', stZoneId).maybeSingle(),
            supabase
              .from('arena_tariffs')
              .select('zone_id,duration_minutes,price,tariff_type')
              .eq('zone_id', stZoneId)
              .eq('is_active', true),
          ])
          const eff = effectiveZoneExtensionHourly(zoneRow, stZoneId, zoneTariffRows || [])
          if (eff != null) zoneHourly = eff
        }

        const tariffHourlyRaw = (rateTariff as Record<string, unknown>).extension_hourly_price
        const tariffHourly =
          tariffHourlyRaw != null && tariffHourlyRaw !== '' ? Number(tariffHourlyRaw) : null
        const extHourly =
          zoneHourly != null
            ? zoneHourly
            : tariffHourly != null && Number.isFinite(tariffHourly) && tariffHourly > 0
              ? tariffHourly
              : null

        const computed = arenaExtensionMinutesFromPayment(
          Number(rateTariff.price),
          Number(rateTariff.duration_minutes),
          extPrice,
          extHourly,
        )
        if (!computed.ok) {
          const msg =
            computed.code === 'extension-amount-too-small'
              ? 'Сумма слишком мала для хотя бы 1 минуты по тарифу зоны'
              : computed.code === 'invalid-tariff-rate'
                ? 'Тариф сессии некорректен (цена/длительность)'
                : 'Укажите сумму продления'
          return json({ error: msg, code: computed.code }, 400)
        }
        extraMinutes = computed.minutes
      } else {
        if (!tariffId) return json({ error: 'tariffId required (или amount_extension: true)' }, 400)

        const { data: tariff, error: tariffError } = await supabase
          .from('arena_tariffs')
          .select('*')
          .eq('id', tariffId)
          .single()
        if (tariffError || !tariff) return json({ error: 'tariff-not-found' }, 404)

        extraMinutes = Number(tariff.duration_minutes) || 0
        if (extraMinutes < 1) return json({ error: 'Некорректная длительность тарифа' }, 400)

        extPrice = Number(tariff.price) || 0
        if (payment_method === 'cash') {
          extCash = extPrice
          extKaspi = 0
        } else if (payment_method === 'kaspi') {
          extCash = 0
          extKaspi = extPrice
        } else {
          extCash = Number(extCashAmt) || 0
          extKaspi = Number(extKaspiAmt) || 0
        }
      }

      const newEndsAt = new Date(baseTime.getTime() + extraMinutes * 60_000)

      const { data: updatedSession, error: updateError } = await supabase
        .from('arena_sessions')
        .update({
          ends_at: newEndsAt.toISOString(),
          amount: (Number((current as any).amount) || 0) + extPrice,
        })
        .eq('id', sessionId)
        .select()
        .single()

      if (updateError) throw updateError

      // Fetch station name for income comment
      const { data: extStationRow } = await supabase
        .from('arena_stations')
        .select('name')
        .eq('id', (current as any).station_id)
        .maybeSingle()
      const extStationName = (extStationRow as any)?.name || (current as any).station_id

      // Create income record for extension
      const { error: extIncomeError } = await supabase.from('incomes').insert({
        date: new Date().toISOString().slice(0, 10),
        company_id: companyId,
        operator_id: (current as any).operator_id || null,
        shift: getCurrentShift(),
        zone: 'pc',
        cash_amount: extCash,
        kaspi_amount: extKaspi,
        online_amount: 0,
        card_amount: 0,
        comment: `Арена продление: ${extStationName}`,
        source: 'arena-session',
      })
      if (extIncomeError) {
        await writeSystemErrorLogSafe({
          scope: 'server',
          area: 'api/point/arena:extendSession:incomeInsert',
          message: extIncomeError.message || 'Income insert failed',
        })
      }

      // Reset notification flag so the new end time gets a fresh notification
      notified5minMap.delete(sessionId)
      return json({ ok: true, data: updatedSession })
    }

    // ─── NOTIFY 5 MIN ─────────────────────────────────────────────────────────
    if (body.action === 'notify5min') {
      const { sessionId, operatorId } = body
      if (!sessionId) return json({ error: 'sessionId required' }, 400)

      // In-memory dedup
      if (notified5minMap.has(sessionId)) {
        return json({ ok: true, skipped: 'already-notified' })
      }

      // Fetch session to verify and get station name
      const { data: session } = await supabase
        .from('arena_sessions')
        .select('ends_at, station:station_id(name)')
        .eq('id', sessionId)
        .eq('point_project_id', projectId)
        .eq('status', 'active')
        .maybeSingle()

      if (!session) return json({ ok: true, skipped: 'session-not-found' })

      const endsAt = new Date(session.ends_at)
      const remaining = endsAt.getTime() - Date.now()
      if (remaining > 5 * 60_000 + 30_000) return json({ ok: true, skipped: 'too-early' })

      // Mark notified with timestamp for TTL cleanup
      notified5minMap.set(sessionId, Date.now())

      // Send Telegram if operator has chat_id
      if (operatorId) {
        const { data: operator } = await supabase
          .from('operators')
          .select('name, telegram_chat_id')
          .eq('id', operatorId)
          .maybeSingle()

        if (operator?.telegram_chat_id) {
          const stationName = Array.isArray(session.station)
            ? session.station[0]?.name
            : (session.station as any)?.name
          const mins = Math.max(0, Math.ceil(remaining / 60_000))
          const timeStr = endsAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
          const station = escapeTelegramHtml(String(stationName || '—'))
          const text = [
            `<b>⏰ Аренда · ${mins} мин до конца</b>`,
            ``,
            `<b>Станция</b> · ${station}`,
            `<b>Окончание</b> · <code>${escapeTelegramHtml(timeStr)}</code>`,
          ].join('\n')
          await sendTelegramMessage(operator.telegram_chat_id, text).catch(() => null)
        }
      }

      return json({ ok: true })
    }

    // ─── TECH LOG ─────────────────────────────────────────────────────────────
    if (body.action === 'techLog') {
      const { stationId, stationName, reason, amount, operatorId } = body
      if (!reason) return json({ error: 'reason required' }, 400)

      const { data: log, error: logError } = await supabase
        .from('arena_tech_logs')
        .insert({
          point_project_id: projectId,
          company_id: companyId,
          station_id: stationId || null,
          station_name: stationName || null,
          reason,
          amount: Number(amount) || 0,
          operator_id: operatorId || null,
        })
        .select()
        .single()

      if (logError) throw logError
      return json({ ok: true, data: log })
    }

    return json({ error: 'unknown action' }, 400)
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/point/arena:post',
      message: error?.message || 'Arena POST error',
    })
    return json({ error: error?.message || 'Ошибка операции' }, 500)
  }
}
