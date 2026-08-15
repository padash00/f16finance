/**
 * Cron: погода для точек с настроенным модулем эффективности.
 *
 * Забирает прогноз на две недели вперёд и факт за прошедшие дни. Прогноз
 * пишется снимком на сегодняшнюю дату (`captured_on`), факт — на сам день.
 * Разделение принципиально: без него оценка качества прогноза считалась бы по
 * погоде, которая стала известна уже после смены, и всегда выглядела бы лучше,
 * чем есть.
 *
 * Погода в этом модуле — контекст потока. На бонусные пороги она не влияет:
 * тумблер есть, но выключен по умолчанию.
 *
 * Расписание — 02:00 UTC, до ночного расчёта планов.
 */

import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { verifyCronRequest } from '@/lib/server/cron-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { fetchOpenMeteo } from '@/lib/server/weather-open-meteo'
import { todayISO } from '@/lib/server/store-kpi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) return json({ error: 'unauthorized' }, 401)
  if (!hasAdminSupabaseCredentials()) return json({ error: 'service_role_missing' }, 500)

  const supabase = createAdminSupabaseClient()
  const today = todayISO()
  const report: Record<string, unknown>[] = []

  try {
    const { data: rows, error } = await supabase
      .from('store_kpi_settings')
      .select('company_id, organization_id, latitude, longitude')
    if (error) throw error

    for (const row of rows || []) {
      const latitude = Number(row.latitude)
      const longitude = Number(row.longitude)
      // Без координат погоду не собираем и не пытаемся угадать город.
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        report.push({ company_id: row.company_id, skipped: 'no-coordinates' })
        continue
      }

      try {
        const days = await fetchOpenMeteo({ latitude, longitude })

        const payload = days.map((d) => ({
          organization_id: row.organization_id,
          company_id: row.company_id,
          day: d.day,
          kind: d.kind,
          // Прогноз — снимок на сегодня, факт привязан к самому дню.
          captured_on: d.kind === 'forecast' ? today : d.day,
          temperature_max: d.temperature_max,
          temperature_min: d.temperature_min,
          temperature_mean: d.temperature_mean,
          apparent_temperature_max: d.apparent_temperature_max,
          precipitation_mm: d.precipitation_mm,
          precipitation_probability: d.precipitation_probability,
          rain: d.rain,
          snow: d.snow,
          wind_speed: d.wind_speed,
          weather_code: d.weather_code,
          payload: d.payload,
          hourly: d.hourly,
        }))

        const { error: upsertErr } = await supabase
          .from('store_kpi_weather')
          .upsert(payload, { onConflict: 'company_id,day,kind,captured_on' })
        if (upsertErr) throw upsertErr

        report.push({
          company_id: row.company_id,
          forecast: payload.filter((p) => p.kind === 'forecast').length,
          actual: payload.filter((p) => p.kind === 'actual').length,
        })
      } catch (companyError) {
        // Недоступная погода не должна ронять сбор для остальных точек: модуль
        // обязан работать и вовсе без погоды.
        await writeSystemErrorLogSafe({
          scope: 'server',
          area: 'cron/sales-kpi-weather company',
          message: `${row.company_id}: ${companyError instanceof Error ? companyError.message : String(companyError)}`,
        })
        report.push({ company_id: row.company_id, error: true })
      }
    }

    return json({ ok: true, date: today, companies: report })
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'cron/sales-kpi-weather',
      message: error instanceof Error ? error.message : String(error),
    })
    return json({ error: 'internal-error' }, 500)
  }
}
