import { isSupplierDebtOverdue, summarizeSupplierDebts } from '@/lib/domain/supplier-debts'
import { requireCapability } from '@/lib/server/capabilities'
import { requireOrgFeature } from '@/lib/server/entitlements'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { json } from '@/lib/server/api-response'

// Страница фильтрует и суммирует долги в браузере, поэтому обрезанный ответ —
// это неверные деньги в шапке. Читаем страницами; если упёрлись в потолок,
// честно говорим об этом в meta, чтобы UI написал «показаны последние N из M».
const PAGE_SIZE = 1000 // больше сервер всё равно не отдаст
const MAX_PAGES = 5

async function fetchPagedWithCount(
  buildQuery: () => any,
): Promise<{ rows: any[]; total: number; truncated: boolean }> {
  const rows: any[] = []
  let total = 0
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE
    const { data, error, count } = await buildQuery().range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    if (typeof count === 'number') total = count
    const batch = (data || []) as any[]
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
  }
  if (!total) total = rows.length
  return { rows, total, truncated: rows.length < total }
}

function canManageStore(access: {
  isSuperAdmin: boolean
  staffRole: string
}) {
  // Capability checks выше уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store-billing.view')
    if (denied) return denied as any
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)
    const entitlementGuard = await requireOrgFeature(access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const url = new URL(request.url)
    const statusParam = String(url.searchParams.get('status') || 'all')
    const includeReceipts = url.searchParams.get('include_receipts') === '1'

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: new URL(request.url).searchParams.get('company_id') || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const buildDebtsQuery = () => supabase
      .from('supplier_debts')
      .select(
        `id, receipt_id, supplier_id, company_id, organization_id,
         total_amount, status, due_date, is_consignment,
         payment_paid_at, payment_cash_amount, payment_kaspi_amount,
         payment_receipt_file_url, payment_comment, expense_id,
         created_at, updated_at,
         supplier:supplier_id(id, name, bin_iin, organization_name),
         company:company_id(id, name, code),
         receipt:receipt_id(id, received_at, invoice_number, invoice_file_url, total_amount,
           location:location_id(id, name, code, location_type),
           items:inventory_receipt_items(id, quantity, unit_cost, total_cost,
             item:item_id(id, name, barcode, unit)))`,
        { count: 'exact' },
      )
      // Порядок обязан быть устойчивым, иначе страницы поедут (id — тай-брейк)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })

    // NEVER-pattern: не-супер без орг → нулевой uuid → 0 строк (fail-closed).
    const scopeOrg = access.activeOrganization?.id || (access.isSuperAdmin ? null : '00000000-0000-0000-0000-000000000000')
    const scopedDebtsQuery = () => {
      let query: any = buildDebtsQuery()
      if (scopeOrg) query = query.eq('organization_id', scopeOrg)
      if (statusParam === 'open' || statusParam === 'paid' || statusParam === 'written_off') {
        query = query.eq('status', statusParam)
      } else if (statusParam === 'open_or_partial') {
        query = query.eq('status', 'open')
      }
      return query
    }

    const debtsPage = await fetchPagedWithCount(scopedDebtsQuery)

    // Накладные режем по локациям арендатора в самом запросе: раньше брали 500
    // свежих по всей базе и отсеивали чужие уже здесь — маленькой точке могло не
    // достаться ни одной своей строки.
    const allowedCompany = new Set(
      (companyScope.allowedCompanyIds || []).filter(Boolean).map((value) => String(value)),
    )
    let allowedLocationIds: string[] | null = null
    if (!access.isSuperAdmin || access.activeOrganization?.id) {
      const conditions: string[] = []
      if (access.activeOrganization?.id) conditions.push(`organization_id.eq.${access.activeOrganization.id}`)
      if (allowedCompany.size) conditions.push(`company_id.in.(${Array.from(allowedCompany).join(',')})`)
      if (!conditions.length) {
        allowedLocationIds = []
      } else {
        const { data: locationRows, error: locationsError } = await supabase
          .from('inventory_locations')
          .select('id')
          .or(conditions.join(','))
        if (locationsError) throw locationsError
        allowedLocationIds = (locationRows || []).map((row: any) => String(row.id))
      }
    }

    let receipts: any[] = []
    let receiptsTotal = 0
    let receiptsTruncated = false
    if (includeReceipts && (allowedLocationIds === null || allowedLocationIds.length > 0)) {
      const receiptsQuery = () => {
        let query: any = supabase
          .from('inventory_receipts')
          .select(
            `id, received_at, invoice_number, invoice_file_url, total_amount, comment, created_at,
             supplier:supplier_id(id, name, bin_iin, organization_name),
             location:location_id(id, name, code, location_type, organization_id, company_id),
             items:inventory_receipt_items(id, quantity, unit_cost, total_cost,
               item:item_id(id, name, barcode, unit))`,
            { count: 'exact' },
          )
          .order('received_at', { ascending: false })
          .order('id', { ascending: false })
        if (allowedLocationIds) query = query.in('location_id', allowedLocationIds)
        return query
      }
      const receiptsPage = await fetchPagedWithCount(receiptsQuery)
      receiptsTotal = receiptsPage.total
      receiptsTruncated = receiptsPage.truncated
      // Подстраховка на случай локации без организации — правило то же, что было
      receipts = receiptsPage.rows.filter((row: any) => {
        if (access.isSuperAdmin) return true
        const orgId = row?.location?.organization_id
        if (orgId && access.activeOrganization?.id && String(orgId) === access.activeOrganization.id) return true
        const companyId = row?.location?.company_id
        if (companyId && allowedCompany.has(String(companyId))) return true
        return false
      })
    }

    // Свод и признак просрочки считаем здесь: «сколько должны», «сколько
    // просрочено» и красные строки под этими цифрами обязаны сходиться, а с
    // одним правилом на всех клиентов разойтись им негде.
    const now = new Date()
    const rows = debtsPage.rows.map((row: any) => ({
      ...row,
      is_overdue: isSupplierDebtOverdue(row, now),
    }))
    const totals = summarizeSupplierDebts(rows, now)

    return json({
      ok: true,
      data: {
        debts: rows,
        receipts,
        totals,
        meta: {
          debts: { shown: rows.length, total: debtsPage.total, truncated: debtsPage.truncated },
          receipts: { shown: receipts.length, total: receiptsTotal, truncated: receiptsTruncated },
        },
      },
    })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось загрузить долги' }, 500)
  }
}
