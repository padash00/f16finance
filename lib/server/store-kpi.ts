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
  buildPriceIndex,
  normalizeStoreKpiSettings,
  priceIndexFor,
  type PriceHistoryRow,
  type PriceIndex,
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
  shift_id: string | null
  duration_minutes: number | null
  opened_at: string | null
  closed_at: string | null
  sale_date: string
  shift: string
  cashier_id: string | null
  gross_revenue: number | string
  refunds: number | string
  receipts: number | string
  items: number | string
  lines: number | string
  receipts_2plus: number | string
  receipts_3plus: number | string
  attach_opportunities: number | string
  attach_success: number | string
  cogs: number | string
  discount_amount: number | string
  discounted_receipts: number | string
  unique_skus: number | string
}

/**
 * Индекс цен точки.
 *
 * В `point_sale_items.unit_price` записана цена на момент продажи, то есть
 * настоящая история по каждой позиции. Отсюда и считается индекс — без него
 * повышение цен выглядело бы улучшением работы продавцов.
 */
export async function loadPriceIndex(
  supabase: AnyClient,
  companyId: string,
  from: string,
  to: string,
): Promise<PriceIndex> {
  const { data } = await supabase.rpc('store_kpi_price_history', {
    p_company_id: companyId,
    p_from: from,
    p_to: to,
  })
  return buildPriceIndex(
    ((data || []) as any[]).map(
      (r): PriceHistoryRow => ({
        month: String(r.month),
        item_id: String(r.item_id),
        avg_price: Number(r.avg_price) || 0,
        quantity: Number(r.quantity) || 0,
        revenue: Number(r.revenue) || 0,
      }),
    ),
  )
}

/**
 * Свёртка смен за период.
 *
 * Свёртку считает БД (`store_kpi_shift_facts`): год работы точки — это десятки
 * тысяч строк позиций, тянуть их сюда нельзя.
 */
/**
 * Насколько свежим считается экзамен.
 *
 * Знание, подтверждённое полгода назад, о сегодняшней работе не говорит.
 * После этого срока метрика становится пустой — не нулевой: «не проверяли» и
 * «знает на ноль» это разные вещи, и второе утащило бы человека вниз за то,
 * чего он не делал.
 */
const EXAM_FRESH_DAYS = 60

type ExamResult = { on: string; score: number }

/** Сданные экзамены продавцов за период плюс запас на свежесть. */
async function loadExamScores(
  supabase: AnyClient,
  operatorIds: string[],
  from: string,
  to: string,
): Promise<Map<string, ExamResult[]>> {
  const out = new Map<string, ExamResult[]>()
  if (operatorIds.length === 0) return out

  const since = new Date(`${from}T00:00:00Z`)
  since.setUTCDate(since.getUTCDate() - EXAM_FRESH_DAYS)

  // Мягко: у организации может не быть экзаменов вовсе, и модуль
  // эффективности от этого падать не должен.
  const { data } = await supabase
    .from('operator_exam_attempts')
    .select('operator_id, score, completed_at, status')
    .in('operator_id', operatorIds)
    .eq('status', 'completed')
    .gte('completed_at', since.toISOString())
    .lte('completed_at', `${to}T23:59:59Z`)
    .then((r: any) => r, () => ({ data: null }))

  for (const row of (data || []) as any[]) {
    const score = Number(row.score)
    if (!Number.isFinite(score)) continue
    const key = String(row.operator_id)
    const list = out.get(key) || []
    list.push({ on: String(row.completed_at).slice(0, 10), score })
    out.set(key, list)
  }

  for (const list of out.values()) list.sort((a, b) => a.on.localeCompare(b.on))
  return out
}

/**
 * Результат последнего экзамена, сданного ДО этой смены.
 *
 * Именно «до»: если взять последний вообще, смена в начале месяца получила бы
 * оценку знаний, подтверждённых через три недели после неё. Так модуль
 * выглядел бы точнее, чем есть.
 */
function examScoreAt(
  scores: Map<string, ExamResult[]>,
  operatorId: string,
  date: string,
): number | null {
  const list = scores.get(operatorId)
  if (!list || list.length === 0) return null

  let best: ExamResult | null = null
  for (const item of list) {
    if (item.on > date) break
    best = item
  }
  if (!best) return null

  const age = Math.floor(
    (new Date(`${date}T00:00:00Z`).getTime() - new Date(`${best.on}T00:00:00Z`).getTime()) / 86_400_000,
  )
  if (age > EXAM_FRESH_DAYS) return null

  // Балл экзамена приходит в процентах, метрика работает в долях.
  return Math.max(0, Math.min(1, best.score / 100))
}

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

  const priceIndex = await loadPriceIndex(supabase, companyId, from, to)

  // Результаты экзаменов продавцов: метрика «знание товара» берётся отсюда.
  const examScores = await loadExamScores(
    supabase,
    [...new Set(factRows.map((r) => r.cashier_id).filter(Boolean))] as string[],
    from,
    to,
  )

  // Пометки смен и деловые события: они не меняют цифры, но меняют то, как
  // эти цифры читать. Оба списка небольшие — грузим целиком за период.
  const [{ data: flagRows }, { data: eventRows }] = await Promise.all([
    supabase
      .from('store_kpi_shift_flags')
      .select('shift_date, shift, is_anomaly, exclude_from_baseline, reason')
      .eq('company_id', companyId)
      .gte('shift_date', from)
      .lte('shift_date', to),
    supabase
      .from('store_kpi_business_events')
      .select('starts_on, ends_on, shift, event_type, title, severity')
      .eq('company_id', companyId)
      .lte('starts_on', to)
      .gte('ends_on', from),
  ])

  const flags = new Map<string, { is_anomaly: boolean; exclude_from_baseline: boolean; reason: string }>()
  for (const f of flagRows || []) {
    flags.set(`${f.shift_date}|${normalizeShift(f.shift)}`, {
      is_anomaly: Boolean(f.is_anomaly),
      exclude_from_baseline: Boolean(f.exclude_from_baseline),
      reason: String(f.reason || ''),
    })
  }

  const eventsFor = (date: string, shift: ShiftType) =>
    (eventRows || [])
      .filter(
        (e: any) =>
          String(e.starts_on) <= date && date <= String(e.ends_on) && (!e.shift || e.shift === shift),
      )
      .map((e: any) => ({
        event_type: e.event_type,
        title: String(e.title || ''),
        severity: (e.severity || 'medium') as 'low' | 'medium' | 'high',
      }))

  return factRows.map((row) => {
    const shift = normalizeShift(row.shift)
    const gross = num(row.gross_revenue)
    const refunds = num(row.refunds)
    return {
      company_id: companyId,
      shift_id: row.shift_id,
      duration_minutes: row.duration_minutes == null ? null : num(row.duration_minutes),
      // Экзамен, сданный ДО этой смены: знание, подтверждённое позже, о работе
      // в этот вечер ничего не говорит.
      exam_score: row.cashier_id ? examScoreAt(examScores, row.cashier_id, row.sale_date) : null,
      opened_at: row.opened_at,
      closed_at: row.closed_at,
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
      receipts_3plus: num(row.receipts_3plus),
      attach_opportunities: num(row.attach_opportunities),
      attach_success: num(row.attach_success),
      cogs: num(row.cogs),
      discount_amount: num(row.discount_amount),
      discounted_receipts: num(row.discounted_receipts),
      unique_skus: num(row.unique_skus),
      is_anomaly: flags.get(`${row.sale_date}|${shift}`)?.is_anomaly ?? false,
      exclude_from_baseline: flags.get(`${row.sale_date}|${shift}`)?.exclude_from_baseline ?? false,
      anomaly_reason: flags.get(`${row.sale_date}|${shift}`)?.reason ?? null,
      events: eventsFor(row.sale_date, shift),
      price_index: priceIndexFor(priceIndex, row.sale_date),
    }
  })
}

/** Точки-магазины в скоупе вызывающего. */
export async function listStorePoints(
  supabase: AnyClient,
  scope: { allowedCompanyIds: string[] | null },
): Promise<{ id: string; name: string; organization_id: string | null }[]> {
  let query = supabase
    .from('companies')
    .select('id, name, store_enabled, organization_id')
    .eq('store_enabled', true)
    .order('name')
  if (scope.allowedCompanyIds) query = query.in('id', scope.allowedCompanyIds)
  const { data, error } = await query
  if (error) throw error
  return (data || []) as { id: string; name: string; organization_id: string | null }[]
}
