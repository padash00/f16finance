import { NextResponse } from 'next/server'

import { requireCapability } from '@/lib/server/capabilities'
import { requireOrgFeature } from '@/lib/server/entitlements'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageStore(access: {
  isSuperAdmin: boolean
  staffRole: string
}) {
  // Capability checks выше уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
}

// PostgREST молча режет ответ до 1000 строк — статистику по поставщикам
// (все приёмки/долги/алиасы) забираем постранично, чанками id по 200 (лимит URL).
const PAGE_SIZE = 1000
async function fetchAllPages<T = any>(buildQuery: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const rows = data || []
    out.push(...rows)
    if (rows.length < PAGE_SIZE) break
  }
  return out
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr]
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function fetchAllByChunkedIn(
  supabase: any,
  table: string,
  columns: string,
  inColumn: string,
  ids: string[],
): Promise<any[]> {
  const chunkResults = await Promise.all(
    chunkArray(ids, 200).map((chunk) =>
      fetchAllPages((from, to) =>
        supabase.from(table).select(columns).in(inColumn, chunk).order('id').range(from, to),
      ),
    ),
  )
  return chunkResults.flat()
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store-suppliers.view')
    if (denied) return denied
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)
    const entitlementGuard = await requireOrgFeature(access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    let query: any = supabase
      .from('inventory_suppliers')
      .select('id, name, organization_name, bin_iin, contact_name, phone, organization_id, preferred_expense_category_id, created_at')
      .order('name', { ascending: true })
      .limit(500)
    // NEVER-pattern: не-супер без орг → нулевой uuid → 0 строк (fail-closed).
    const scopeOrg = access.isSuperAdmin ? null : (access.activeOrganization?.id || '00000000-0000-0000-0000-000000000000')
    if (scopeOrg) {
      query = query.eq('organization_id', scopeOrg)
    }
    const { data: suppliers, error } = await query
    if (error) throw error

    const supplierIds = (suppliers || []).map((s: any) => s.id)
    let receiptStats = new Map<string, { count: number; total: number; last: string | null }>()
    let debtStats = new Map<string, { open: number; openSum: number }>()
    let aliasCounts = new Map<string, number>()

    if (supplierIds.length > 0) {
      // Это агрегация (суммы/количества) — забираем ВСЕ строки, не первые 1000.
      const [receiptRows, debtRows, aliasRows] = await Promise.all([
        fetchAllByChunkedIn(supabase, 'inventory_receipts', 'supplier_id, total_amount, received_at', 'supplier_id', supplierIds),
        fetchAllByChunkedIn(supabase, 'supplier_debts', 'supplier_id, total_amount, status', 'supplier_id', supplierIds),
        fetchAllByChunkedIn(supabase, 'invoice_name_mappings', 'supplier_id', 'supplier_id', supplierIds),
      ])

      for (const row of receiptRows as any[]) {
        const key = String(row.supplier_id)
        const cur = receiptStats.get(key) || { count: 0, total: 0, last: null }
        cur.count += 1
        cur.total += Number(row.total_amount || 0)
        if (!cur.last || (row.received_at && row.received_at > cur.last)) cur.last = row.received_at
        receiptStats.set(key, cur)
      }
      for (const row of debtRows as any[]) {
        const key = String(row.supplier_id)
        const cur = debtStats.get(key) || { open: 0, openSum: 0 }
        if (row.status === 'open') {
          cur.open += 1
          cur.openSum += Number(row.total_amount || 0)
        }
        debtStats.set(key, cur)
      }
      for (const row of aliasRows as any[]) {
        const key = String(row.supplier_id)
        aliasCounts.set(key, (aliasCounts.get(key) || 0) + 1)
      }
    }

    const enriched = (suppliers || []).map((s: any) => {
      const r = receiptStats.get(s.id) || { count: 0, total: 0, last: null }
      const d = debtStats.get(s.id) || { open: 0, openSum: 0 }
      return {
        ...s,
        receipts_count: r.count,
        receipts_total: r.total,
        last_receipt_date: r.last,
        open_debts_count: d.open,
        open_debts_sum: d.openSum,
        aliases_count: aliasCounts.get(s.id) || 0,
      }
    })

    return json({ ok: true, data: { suppliers: enriched } })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось загрузить поставщиков' }, 500)
  }
}

// Создание поставщика вручную (со страницы «Поставщики»).
export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store-suppliers.create')
    if (denied) return denied
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)
    const entitlementGuard = await requireOrgFeature(access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const body = (await request.json().catch(() => null)) as any

    const name = String(body?.name || '').trim()
    const organizationName = String(body?.organization_name || '').trim() || name
    const binIin = String(body?.bin_iin || '').replace(/\D/g, '')
    if (!name) return json({ error: 'Введите название поставщика' }, 400)
    if (binIin && !/^\d{12}$/.test(binIin)) return json({ error: 'ИИН/БИН должен состоять из 12 цифр' }, 400)

    const organizationId = access.activeOrganization?.id || null
    if (!access.isSuperAdmin && !organizationId) return json({ error: 'Нет активной организации' }, 400)

    // Дедуп в пределах своей орг (по БИН или названию) — не плодим дубли.
    if (binIin) {
      let dupQ: any = supabase.from('inventory_suppliers').select('id, name').eq('bin_iin', binIin).limit(1)
      if (organizationId) dupQ = dupQ.eq('organization_id', organizationId)
      const { data: dup } = await dupQ.maybeSingle()
      if (dup?.id) return json({ error: `Поставщик с таким БИН/ИИН уже есть: ${dup.name}` }, 409)
    }

    const leadTime = Number(body?.lead_time_days)
    const insertRow: Record<string, unknown> = {
      name,
      organization_name: organizationName,
      bin_iin: binIin || null,
      contact_name: String(body?.contact_name || '').trim() || null,
      phone: String(body?.phone || '').trim() || null,
      lead_time_days: Number.isFinite(leadTime) && leadTime >= 0 ? Math.round(leadTime) : 3,
      preferred_expense_category_id: String(body?.preferred_expense_category_id || '').trim() || null,
      organization_id: organizationId,
    }
    const { data: created, error } = await supabase.from('inventory_suppliers').insert([insertRow]).select('id').single()
    if (error) throw error
    return json({ ok: true, data: { id: created?.id } })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось создать поставщика' }, 500)
  }
}
