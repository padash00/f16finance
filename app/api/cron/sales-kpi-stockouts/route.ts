/**
 * Cron: отсутствие ходовых позиций на витрине.
 *
 * Продавец не может продать то, чего нет. Смена с полупустой витриной
 * сравнивается с нормой, набранной по полной, и человек выглядит хуже, чем
 * работал. Отмечать это руками бесполезно — в конце смены никто не вспомнит.
 *
 * Почему в момент, а не задним числом: остатки в базе хранятся текущие,
 * вчерашних нет. Восстанавливать их по движениям значило бы гадать, а гадание
 * не должно попадать в журнал, на который смотрят при разборе смены. Поэтому
 * крон фиксирует то, что видит сейчас, и правда накапливается вперёд.
 *
 * Событие продлевается, пока товара нет, и перестаёт продлеваться, когда он
 * появился. Крон трогает только свои записи (`source = 'auto'`): пометка,
 * поставленная владельцем, исчезнуть не должна.
 *
 * На балл продавца это не влияет — только на уверенность в выводе.
 *
 * Расписание — 08:00 UTC, то есть 13:00 по Казахстану: дневная смена уже
 * открылась, и пустая витрина — это пустая витрина, а не «ещё не выложили».
 */

import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { verifyCronRequest } from '@/lib/server/cron-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { addDaysISO, todayISO } from '@/lib/server/store-kpi'
import {
  findStockouts,
  stockoutSeverity,
  stockoutTitle,
  type ItemSalesFrequency,
} from '@/lib/domain/store-kpi'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** Окно, по которому решаем, ходовая позиция или случайная. */
const WINDOW_DAYS = 60

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request: Request) {
  if (!verifyCronRequest(request)) return json({ error: 'unauthorized' }, 401)
  if (!hasAdminSupabaseCredentials()) return json({ error: 'service_role_missing' }, 500)

  const supabase = createAdminSupabaseClient()
  const today = todayISO()
  const windowFrom = addDaysISO(today, -WINDOW_DAYS)
  const report: Record<string, unknown>[] = []

  try {
    const { data: settingsRows, error } = await supabase
      .from('store_kpi_settings')
      .select('company_id, organization_id')
    if (error) throw error

    for (const row of settingsRows || []) {
      const companyId = String(row.company_id)
      const organizationId = row.organization_id ? String(row.organization_id) : null
      if (!organizationId) {
        report.push({ company_id: companyId, skipped: 'нет организации' })
        continue
      }

      try {
        // ── Что и как часто продавалось ───────────────────────────────────
        const { data: soldRows, error: soldErr } = await supabase
          .from('point_sale_items')
          .select('item_id, quantity, point_sales!inner(sale_date, company_id)')
          .eq('point_sales.company_id', companyId)
          .gte('point_sales.sale_date', windowFrom)
          .lte('point_sales.sale_date', today)
        if (soldErr) throw soldErr

        const byItem = new Map<string, { days: Set<string>; quantity: number }>()
        for (const line of soldRows || []) {
          const itemId = (line as any).item_id
          if (!itemId) continue
          const day = String((line as any).point_sales?.sale_date || '')
          const cur = byItem.get(itemId) || { days: new Set<string>(), quantity: 0 }
          if (day) cur.days.add(day)
          cur.quantity += Number((line as any).quantity) || 0
          byItem.set(itemId, cur)
        }

        if (byItem.size === 0) {
          report.push({ company_id: companyId, skipped: 'продаж за окно нет' })
          continue
        }

        const { data: itemRows } = await supabase
          .from('inventory_items')
          .select('id, name')
          .in('id', [...byItem.keys()])
        const names = new Map<string, string>()
        for (const item of itemRows || []) names.set(String(item.id), String(item.name || 'позиция'))

        const sales: ItemSalesFrequency[] = [...byItem.entries()].map(([itemId, agg]) => ({
          item_id: itemId,
          name: names.get(itemId) || 'позиция',
          days_with_sales: agg.days.size,
          quantity: agg.quantity,
        }))

        // ── Что сейчас на витрине ─────────────────────────────────────────
        const { data: locations } = await supabase
          .from('inventory_locations')
          .select('id')
          .eq('company_id', companyId)
          .eq('location_type', 'point_display')
          .eq('is_active', true)

        const locationIds = (locations || []).map((l: any) => String(l.id))
        if (locationIds.length === 0) {
          report.push({ company_id: companyId, skipped: 'витрина не заведена' })
          continue
        }

        const { data: balanceRows } = await supabase
          .from('inventory_balances')
          .select('item_id, quantity')
          .in('location_id', locationIds)

        // Одна позиция может лежать на нескольких витринах — складываем.
        const stockByItem = new Map<string, number>()
        for (const b of balanceRows || []) {
          const itemId = String((b as any).item_id)
          stockByItem.set(itemId, (stockByItem.get(itemId) || 0) + (Number((b as any).quantity) || 0))
        }
        const stock = [...stockByItem.entries()].map(([item_id, quantity]) => ({ item_id, quantity }))

        const missing = findStockouts({ sales, stock, windowDays: WINDOW_DAYS })

        // ── Открытое авто-событие ─────────────────────────────────────────
        const { data: openRows } = await supabase
          .from('store_kpi_business_events')
          .select('id, starts_on, ends_on, title, severity')
          .eq('company_id', companyId)
          .eq('event_type', 'STOCKOUT')
          .eq('source', 'auto')
          .gte('ends_on', addDaysISO(today, -1))
          .order('ends_on', { ascending: false })
          .limit(1)
        const open = openRows?.[0] || null

        if (missing.length === 0) {
          // Товар вернулся: событие просто перестаём продлевать. Закрывать
          // его задним числом нельзя — вчера витрина действительно пустовала.
          report.push({ company_id: companyId, stockouts: 0, closed: Boolean(open) })
          continue
        }

        const title = stockoutTitle(missing)
        const severity = stockoutSeverity(missing, WINDOW_DAYS)
        const notes =
          `Найдено автоматически ${today}. Ходовые позиции с нулём на витрине: ` +
          missing
            .slice(0, 10)
            .map((m) => `${m.name} (продавалась ${m.days_with_sales} дн. из ${WINDOW_DAYS})`)
            .join('; ')

        if (open) {
          await supabase
            .from('store_kpi_business_events')
            .update({ ends_on: today, title, severity, notes, updated_at: new Date().toISOString() })
            .eq('id', open.id)
          report.push({ company_id: companyId, stockouts: missing.length, extended: true })
        } else {
          await supabase.from('store_kpi_business_events').insert({
            organization_id: organizationId,
            company_id: companyId,
            starts_on: today,
            ends_on: today,
            // Пустая витрина мешает обеим сменам дня.
            shift: null,
            event_type: 'STOCKOUT',
            title,
            notes,
            severity,
            source: 'auto',
          })
          report.push({ company_id: companyId, stockouts: missing.length, created: true })
        }
      } catch (companyError) {
        // Одна точка не должна ронять обход остальных.
        report.push({
          company_id: companyId,
          error: companyError instanceof Error ? companyError.message : String(companyError),
        })
      }
    }

    return json({ ok: true, today, window_days: WINDOW_DAYS, report })
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/cron/sales-kpi-stockouts',
      message: error instanceof Error ? error.message : String(error),
    })
    return json({ error: 'internal-error' }, 500)
  }
}
