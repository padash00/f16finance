/**
 * Календарь особых дней и учебных периодов.
 *
 * Месячный индекс спроса складывается из четырёх частей, и две из них —
 * праздники и учебный период — до сих пор было нечем заполнить: таблицы
 * существовали, расчёт их читал, но интерфейса не было, и обе части всегда
 * оставались нейтральными. То есть механизм работал вхолостую.
 *
 * Праздники Казахстана и учебный календарь лежат в справочнике
 * `lib/data/kz-calendar.ts` с датами, переносами выходных и ссылками на
 * источники, поэтому их не вбивают руками, а импортируют одним действием.
 *
 * Важное ограничение: учебный период, добавленный автоматически или «на
 * глаз», в расчёт не идёт до подтверждения. Сдвигать планку людям по догадке
 * нельзя.
 */
import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe, describeError } from '@/lib/server/audit'
import {
  confidenceOf,
  expandHolidays,
  holidaysNeedingDates,
  loadEducationCalendar,
  loadPublicHolidays,
  periodTypeOf,
  splitEducationCalendar,
  strengthToIndex,
} from '@/lib/server/kz-education-calendar'
import { inScope, resolveStoreKpiContext, todayISO } from '@/lib/server/store-kpi'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request: Request) {
  try {
    const ctx = await resolveStoreKpiContext(request, 'sales-kpi.view', json)
    if ('response' in ctx) return ctx.response
    const { supabase, scope } = ctx

    const url = new URL(request.url)
    const companyId = url.searchParams.get('company_id')
    if (!companyId) return json({ error: 'company-required' }, 400)
    if (!inScope(scope, companyId)) return json({ error: 'forbidden', code: 'company-out-of-scope' }, 403)

    const year = Number(url.searchParams.get('year')) || Number(todayISO().slice(0, 4))
    const from = `${year}-01-01`
    const to = `${year}-12-31`

    // Организацию берём у точки, а не из активной сессии: у суперадмина
    // активной организации может не быть, и тогда запрос без фильтра вернул бы
    // общие дни чужих организаций.
    const { data: company, error: companyErr } = await supabase
      .from('companies')
      .select('id, organization_id')
      .eq('id', companyId)
      .maybeSingle()
    if (companyErr) throw companyErr
    if (!company?.organization_id) return json({ error: 'company-without-organization' }, 400)
    const organizationId = String(company.organization_id)

    const [{ data: days }, { data: periods }] = await Promise.all([
      supabase
        .from('store_kpi_calendar_days')
        .select('id, day, day_type, name, impact_index, company_id, source, verified')
        .eq('organization_id', organizationId)
        .gte('day', from)
        .lte('day', to)
        .order('day'),
      supabase
        .from('store_kpi_academic_periods')
        .select(
          'id, start_date, end_date, period_type, name, manual_index, is_confirmed, company_id, audience, source, source_url, confidence',
        )
        .eq('organization_id', organizationId)
        .lte('start_date', to)
        .gte('end_date', from)
        .order('start_date'),
    ])

    // Точка видит и общие для организации дни (company_id пуст), и свои.
    const visibleDays = (days || []).filter((d: any) => !d.company_id || d.company_id === companyId)
    const visiblePeriods = (periods || []).filter((p: any) => !p.company_id || p.company_id === companyId)

    // Сколько дней из справочника праздников ещё не заведено.
    const known = new Set(visibleDays.map((d: any) => `${d.day}|${d.day_type}`))
    const missingHolidays = expandHolidays(loadPublicHolidays()).filter(
      (h) => h.day >= from && h.day <= to && !known.has(`${h.day}|${h.day_type}`),
    )

    return json({
      data: {
        year,
        organization_id: organizationId,
        days: visibleDays,
        periods: visiblePeriods,
        // Праздники РК, которых ещё нет в календаре модуля.
        holidays_to_import: missingHolidays.map((h) => ({ date: h.day, name: h.name })),
        holidays_need_dates: holidaysNeedingDates(loadPublicHolidays()).map((e) => e.name),
        education_available: loadEducationCalendar().length,
      },
    })
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/sales-kpi/calendar GET',
      message: describeError(error),
    })
    console.error('[sales-kpi/calendar]', error)
    return json({ error: 'internal-error' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await resolveStoreKpiContext(request, 'sales-kpi.manage', json)
    if ('response' in ctx) return ctx.response
    const { supabase, scope, access } = ctx

    const body = (await request.json().catch(() => ({}))) as Record<string, any>
    const companyId = String(body.company_id || '')
    if (!companyId) return json({ error: 'company-required' }, 400)
    if (!inScope(scope, companyId)) return json({ error: 'forbidden', code: 'company-out-of-scope' }, 403)

    const { data: company, error: companyErr } = await supabase
      .from('companies')
      .select('id, organization_id')
      .eq('id', companyId)
      .maybeSingle()
    if (companyErr) throw companyErr
    if (!company?.organization_id) return json({ error: 'company-without-organization' }, 400)

    const organizationId = String(company.organization_id)
    const actor = access.user?.id || null
    const action = String(body.action || '')

    /** Влияние дня: 1.00 — нейтрально, за границы не выпускаем. */
    const impact = (raw: unknown): number => {
      const n = typeof raw === 'string' ? Number(raw.replace(',', '.')) : Number(raw)
      return Number.isFinite(n) && n > 0 && n < 3 ? Math.round(n * 100) / 100 : 1
    }

    // ── Импорт праздников РК ──────────────────────────────────────────────
    if (action === 'import_holidays') {
      // Источник — справочник нерабочих дней с официальными датами и
      // переносами. Старая таблица kz_holidays для этого не годится: там нет
      // переносов, а День Конституции стоит на 30 августа, хотя с 01.07.2026
      // он перенесён на 15 марта.
      const rows = expandHolidays(loadPublicHolidays()).map((h) => ({
        organization_id: organizationId,
        // Праздники страны одни на все точки организации.
        company_id: null,
        day: h.day,
        day_type: h.day_type,
        name: h.name,
        // Влияние нейтральное: по конкретному празднику своей истории пока
        // нет, а придумывать коэффициент нельзя.
        impact_index: 1,
        source: h.source_name,
        source_url: h.source_url,
        verified: h.verified,
        created_by: actor,
      }))

      if (rows.length > 0) {
        const { error } = await supabase
          .from('store_kpi_calendar_days')
          .upsert(rows, { onConflict: 'organization_id,company_id,day,day_type' })
        if (error) throw error
      }

      await writeAuditLog(supabase, {
        actorUserId: actor,
        entityType: 'store_kpi_calendar_days',
        entityId: companyId,
        action: 'create',
        organizationId,
        payload: { company_id: companyId, imported: rows.length, source: 'kz-public-holidays-2026-2027' },
      })

      return json({
        ok: true,
        imported: rows.length,
        // Курбан айт и подобные — даты плавают, их добавляют руками.
        needs_dates: holidaysNeedingDates(loadPublicHolidays()).map((e) => e.name),
      })
    }

    // ── Импорт учебного календаря Казахстана ──────────────────────────────
    if (action === 'import_education_calendar') {
      // Длинные выходные из учебного справочника пропускаем: они приходят из
      // справочника праздников, где есть официальные даты и переносы.
      const { periods, holidayWeekends } = splitEducationCalendar(loadEducationCalendar())

      // Учебные периоды: семестры, каникулы, приёмные кампании.
      const periodRows = periods.map((e) => ({
        organization_id: organizationId,
        // Общие для организации: учебный календарь страны один на все точки.
        company_id: null,
        start_date: e.start_date,
        end_date: e.end_date,
        period_type: periodTypeOf(e),
        name: e.name,
        manual_index: strengthToIndex(e.demand_strength),
        source: e.source_name,
        source_url: e.source_url,
        audience: e.audience,
        notes: e.description,
        confidence: confidenceOf(e.verification_status),
        // Подтверждёнными считаем только те, чьи даты взяты из официального
        // источника. Остальные лежат рядом, но в расчёт не идут, пока их не
        // проверит человек.
        is_confirmed: e.verification_status === 'confirmed',
        created_by: actor,
      }))

      if (periodRows.length > 0) {
        const { error } = await supabase
          .from('store_kpi_academic_periods')
          .upsert(periodRows, { onConflict: 'organization_id,company_id,name,start_date' })
        if (error) throw error
      }

      await writeAuditLog(supabase, {
        actorUserId: actor,
        entityType: 'store_kpi_academic_periods',
        entityId: companyId,
        action: 'create',
        organizationId,
        payload: {
          company_id: companyId,
          periods: periodRows.length,
          skipped_holidays: holidayWeekends.length,
          source: 'kz-education-calendar-2026-2027',
        },
      })

      return json({ ok: true, periods: periodRows.length, skipped: holidayWeekends.length })
    }

    // ── Подтвердить день ──────────────────────────────────────────────────
    if (action === 'verify_day') {
      const id = String(body.day_id || '')
      if (!id) return json({ error: 'day-required' }, 400)

      const { data: row } = await supabase
        .from('store_kpi_calendar_days')
        .select('id, organization_id, day, name')
        .eq('id', id)
        .maybeSingle()
      if (!row || String(row.organization_id) !== organizationId) {
        return json({ error: 'not-found' }, 404)
      }

      const { error } = await supabase
        .from('store_kpi_calendar_days')
        .update({ verified: true, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: actor,
        entityType: 'store_kpi_calendar_days',
        entityId: companyId,
        action: 'approve',
        organizationId,
        payload: { company_id: companyId, day: row.day, name: row.name },
      })

      return json({ ok: true })
    }

    // ── Особый день ───────────────────────────────────────────────────────
    if (action === 'add_day') {
      const day = String(body.day || '')
      const name = String(body.name || '').trim()
      if (!day || !name) return json({ error: 'day-invalid' }, 400)

      const { error } = await supabase.from('store_kpi_calendar_days').upsert(
        {
          organization_id: organizationId,
          // Дни точки хранятся с company_id, общие — без него.
          company_id: body.for_all_points === true ? null : companyId,
          day,
          day_type: String(body.day_type || 'CUSTOM'),
          name,
          impact_index: impact(body.impact_index),
          source: 'manual',
          verified: true,
          created_by: actor,
        },
        { onConflict: 'organization_id,company_id,day,day_type' },
      )
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: actor,
        entityType: 'store_kpi_calendar_days',
        entityId: companyId,
        action: 'create',
        organizationId,
        payload: { company_id: companyId, day, name, impact: impact(body.impact_index) },
      })

      return json({ ok: true })
    }

    if (action === 'delete_day') {
      const id = String(body.day_id || '')
      if (!id) return json({ error: 'day-required' }, 400)

      // День ищется по id — принадлежность организации проверяем явно.
      const { data: row } = await supabase
        .from('store_kpi_calendar_days')
        .select('id, organization_id')
        .eq('id', id)
        .maybeSingle()
      if (!row || String(row.organization_id) !== organizationId) {
        return json({ error: 'not-found' }, 404)
      }

      const { error } = await supabase.from('store_kpi_calendar_days').delete().eq('id', id)
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: actor,
        entityType: 'store_kpi_calendar_days',
        entityId: companyId,
        action: 'delete',
        organizationId,
        payload: { company_id: companyId, day_id: id },
      })

      return json({ ok: true })
    }

    // ── Учебный период ────────────────────────────────────────────────────
    if (action === 'add_period') {
      const start = String(body.start_date || '')
      const end = String(body.end_date || '')
      const name = String(body.name || '').trim()
      if (!start || !end || !name) return json({ error: 'period-invalid' }, 400)
      if (end < start) return json({ error: 'period-range-invalid' }, 400)

      const { error } = await supabase.from('store_kpi_academic_periods').insert({
        organization_id: organizationId,
        company_id: body.for_all_points === true ? null : companyId,
        start_date: start,
        end_date: end,
        period_type: String(body.period_type || 'SEMESTER'),
        name,
        manual_index: impact(body.manual_index),
        source: 'manual',
        // Период, добавленный руками владельца, подтверждён по факту ввода.
        is_confirmed: true,
        created_by: actor,
      })
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: actor,
        entityType: 'store_kpi_academic_periods',
        entityId: companyId,
        action: 'create',
        organizationId,
        payload: { company_id: companyId, start, end, name, index: impact(body.manual_index) },
      })

      return json({ ok: true })
    }

    if (action === 'confirm_period') {
      const id = String(body.period_id || '')
      if (!id) return json({ error: 'period-required' }, 400)

      const { data: row } = await supabase
        .from('store_kpi_academic_periods')
        .select('id, organization_id, name')
        .eq('id', id)
        .maybeSingle()
      if (!row || String(row.organization_id) !== organizationId) {
        return json({ error: 'not-found' }, 404)
      }

      const { error } = await supabase
        .from('store_kpi_academic_periods')
        .update({ is_confirmed: true, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: actor,
        entityType: 'store_kpi_academic_periods',
        entityId: companyId,
        action: 'approve',
        organizationId,
        payload: { company_id: companyId, name: row.name },
      })

      return json({ ok: true })
    }

    if (action === 'delete_period') {
      const id = String(body.period_id || '')
      if (!id) return json({ error: 'period-required' }, 400)

      const { data: row } = await supabase
        .from('store_kpi_academic_periods')
        .select('id, organization_id')
        .eq('id', id)
        .maybeSingle()
      if (!row || String(row.organization_id) !== organizationId) {
        return json({ error: 'not-found' }, 404)
      }

      const { error } = await supabase.from('store_kpi_academic_periods').delete().eq('id', id)
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: actor,
        entityType: 'store_kpi_academic_periods',
        entityId: companyId,
        action: 'delete',
        organizationId,
        payload: { company_id: companyId, period_id: id },
      })

      return json({ ok: true })
    }

    return json({ error: 'unknown-action' }, 400)
  } catch (error) {
    const message = describeError(error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/sales-kpi/calendar POST',
      message,
    })
    console.error('[sales-kpi/calendar]', error)
    // Причину показываем: действие доступно только управляющему, а глухое
    // «internal-error» не помогает ни ему, ни разбору потом.
    return json({ error: 'internal-error', detail: message }, 500)
  }
}
