/**
 * Серверная обвязка модуля «Эффективность продавцов».
 *
 * Здесь собрано всё, что нужно и странице разбора, и планам смен: настройки,
 * свёртка смен и прокси потока. Общий модуль, а не копипаста в двух роутах —
 * если план и факт начнут считаться по разным данным, продавцу назначат одну
 * планку, а спросят по другой.
 */

import { requireStaffCapability } from '@/lib/server/capabilities'
import { requireAddon } from '@/lib/server/entitlements'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import {
  normalizeStoreKpiSettings,
  type ShiftFact,
  type ShiftType,
  type StoreKpiSettings,
} from '@/lib/domain/store-kpi'

/** PostgREST режет любой ответ до 1000 строк — всё читаем постранично. */
export const PAGE = 1000

type AnyClient = any

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y || 1970, (m || 1) - 1, (d || 1) + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function normalizeShift(raw: string | null | undefined): ShiftType {
  return raw === 'night' ? 'night' : 'day'
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export type StoreKpiContext = {
  access: any
  scope: { allowedCompanyIds: string[] | null }
  supabase: AnyClient
}

/**
 * Авторизация, аддон и скоуп арендатора — одинаково для всех роутов модуля.
 * Возвращает либо готовый контекст, либо ответ, который надо вернуть как есть.
 */
export async function resolveStoreKpiContext(
  request: Request,
  capability: string,
  json: (data: unknown, status?: number) => Response,
): Promise<StoreKpiContext | { response: Response }> {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return { response: access.response }

  const denied = await requireStaffCapability(access, capability)
  if (denied) return { response: denied }

  const noAddon = await requireAddon(access, 'addon.sales_kpi')
  if (noAddon) return { response: noAddon }

  if (!hasAdminSupabaseCredentials()) return { response: json({ error: 'service_role_missing' }, 500) }

  const scope = await resolveCompanyScope({
    activeOrganizationId: access.activeOrganization?.id || null,
    isSuperAdmin: access.isSuperAdmin,
  })

  return { access, scope, supabase: createAdminSupabaseClient() }
}

export function inScope(scope: { allowedCompanyIds: string[] | null }, companyId: string): boolean {
  return !scope.allowedCompanyIds || scope.allowedCompanyIds.includes(companyId)
}

export type LoadedSettings = {
  row: Record<string, unknown> | null
  settings: StoreKpiSettings
}

export async function loadStoreKpiSettings(
  supabase: AnyClient,
  companyId: string,
): Promise<LoadedSettings> {
  const { data, error } = await supabase
    .from('store_kpi_settings')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle()
  if (error) throw error

  return { row: data ?? null, settings: normalizeStoreKpiSettings(data) }
}

/** Самая ранняя продажа точки — левая граница истории. */
export async function earliestSaleDate(supabase: AnyClient, companyId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('point_sales')
    .select('sale_date')
    .eq('company_id', companyId)
    .order('sale_date', { ascending: true })
    .limit(1)
  if (error) throw error
  return data?.[0]?.sale_date ?? null
}

type FactRow = {
  sale_date: string
  shift: string
  cashier_id: string | null
  gross_revenue: number | string
  refunds: number | string
  receipts: number | string
  items: number | string
  lines: number | string
  receipts_2plus: number | string
  attach_opportunities: number | string
  attach_success: number | string
}

/**
 * Свёртка смен за период.
 *
 * Свёртку считает БД (`store_kpi_shift_facts`): год работы точки — это десятки
 * тысяч строк позиций, тянуть их сюда нельзя.
 */
export async function loadShiftFacts(
  supabase: AnyClient,
  args: { companyId: string; from: string; to: string },
): Promise<ShiftFact[]> {
  const { companyId, from, to } = args

  const factRows: FactRow[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .rpc('store_kpi_shift_facts', { p_company_id: companyId, p_from: from, p_to: to })
      .range(offset, offset + PAGE - 1)
    if (error) throw error
    const rows = (data || []) as FactRow[]
    factRows.push(...rows)
    if (rows.length < PAGE) break
  }

  return factRows.map((row) => {
    const shift = normalizeShift(row.shift)
    const gross = num(row.gross_revenue)
    const refunds = num(row.refunds)
    return {
      company_id: companyId,
      date: row.sale_date,
      shift,
      cashier_id: row.cashier_id,
      revenue: gross - refunds,
      gross_revenue: gross,
      refunds,
      receipts: num(row.receipts),
      items: num(row.items),
      lines: num(row.lines),
      receipts_2plus: num(row.receipts_2plus),
      attach_opportunities: num(row.attach_opportunities),
      attach_success: num(row.attach_success),
    }
  })
}

/** Точки-магазины в скоупе вызывающего. */
export async function listStorePoints(
  supabase: AnyClient,
  scope: { allowedCompanyIds: string[] | null },
): Promise<{ id: string; name: string }[]> {
  let query = supabase
    .from('companies')
    .select('id, name, store_enabled')
    .eq('store_enabled', true)
    .order('name')
  if (scope.allowedCompanyIds) query = query.in('id', scope.allowedCompanyIds)
  const { data, error } = await query
  if (error) throw error
  return (data || []) as { id: string; name: string }[]
}
