import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/server/audit'
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

function normalizeMoney(value: unknown) {
  const n = Number(value || 0)
  if (!Number.isFinite(n)) return 0
  return Math.round((n + Number.EPSILON) * 100) / 100
}

type Body = {
  debt_ids?: string[]
  paid_at?: string
  payment_method?: 'cash' | 'kaspi'
  receipt_file_url?: string | null
  comment?: string | null
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store-billing.bulk_pay')
    if (denied) return denied as any
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)
    const entitlementGuard = await requireOrgFeature(access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const body = (await request.json().catch(() => null)) as Body | null
    const debtIds = Array.isArray(body?.debt_ids) ? body!.debt_ids.map(String).filter(Boolean) : []
    if (debtIds.length === 0) return json({ error: 'Не выбран ни один долг' }, 400)

    const paidAt = String(body?.paid_at || '').trim()
    if (!paidAt) return json({ error: 'Укажите дату оплаты' }, 400)
    const method = body?.payment_method === 'kaspi' ? 'kaspi' : 'cash'
    const receiptFileUrl = String(body?.receipt_file_url || '').trim()
    if (!receiptFileUrl) return json({ error: 'Загрузите чек об оплате' }, 400)
    const comment = String(body?.comment || '').trim() || null

    let debtsQuery: any = supabase
      .from('supplier_debts')
      .select(
        `id, receipt_id, supplier_id, company_id, organization_id, expense_category_id,
         total_amount, status,
         supplier:supplier_id(id, name, organization_name),
         category:expense_category_id(id, name, accounting_group)`,
      )
      .in('id', debtIds)
    // NEVER-pattern: не-супер без орг → нулевой uuid → чужие id не совпадут.
    const scopeOrg = access.isSuperAdmin ? null : (access.activeOrganization?.id || '00000000-0000-0000-0000-000000000000')
    if (scopeOrg) {
      debtsQuery = debtsQuery.eq('organization_id', scopeOrg)
    }
    const { data: debts, error: debtsError } = await debtsQuery
    if (debtsError) throw debtsError
    if (!debts || debts.length === 0) return json({ error: 'Долги не найдены' }, 404)

    const open = (debts as any[]).filter((d) => d.status === 'open')
    if (open.length === 0) return json({ error: 'Среди выбранных нет открытых долгов' }, 409)

    // Resolve a fallback COGS category if any debt lost its category.
    let fallbackCategoryName: string | null = null
    const needsFallback = open.some((d) => !String(d.category?.name || '').trim())
    if (needsFallback) {
      const { data: fallback } = await supabase
        .from('expense_categories')
        .select('name')
        .ilike('accounting_group', 'cogs')
        .order('name', { ascending: true })
        .limit(1)
        .maybeSingle()
      fallbackCategoryName = (fallback as any)?.name || null
      if (!fallbackCategoryName) {
        return json({ error: 'У части долгов нет COGS-категории, и в справочнике не найдено fallback. Создайте COGS-категорию.' }, 400)
      }
    }

    const results: Array<{ debt_id: string; expense_id: string; total: number }> = []

    for (const debt of open) {
      const total = normalizeMoney(debt.total_amount)
      if (total <= 0) continue

      const categoryName = String(debt.category?.name || '').trim() || fallbackCategoryName || 'COGS'
      if (!debt.company_id) continue

      const supplierName = debt.supplier?.organization_name || debt.supplier?.name || '—'
      const expenseComment = [
        `Объединённая оплата (${open.length} долгов)`,
        `Поставщик: ${supplierName}`,
        comment ? `Комментарий: ${comment}` : null,
      ].filter(Boolean).join('\n')

      const expensePayload: Record<string, unknown> = {
        date: paidAt,
        company_id: debt.company_id,
        operator_id: null,
        category: categoryName,
        cash_amount: method === 'cash' ? total : 0,
        kaspi_amount: method === 'kaspi' ? total : 0,
        comment: expenseComment,
        attachment_url: receiptFileUrl,
        document_kind: 'receipt',
        document_url: receiptFileUrl,
        status: 'confirmed',
        source_type: 'inventory_receipt',
        source_id: debt.receipt_id,
      }

      let expenseId: string | null = null
      const { data: insertedExpense, error: expenseError } = await supabase
        .from('expenses')
        .insert([expensePayload])
        .select('id')
        .single()
      if (expenseError) {
        if (String((expenseError as any)?.code || '') === '23505') {
          const { data: existingExpense } = await supabase
            .from('expenses')
            .select('id')
            .eq('source_type', 'inventory_receipt')
            .eq('source_id', debt.receipt_id)
            .maybeSingle()
          if (existingExpense?.id) {
            await supabase
              .from('expenses')
              .update({
                date: paidAt,
                cash_amount: method === 'cash' ? total : 0,
                kaspi_amount: method === 'kaspi' ? total : 0,
                attachment_url: receiptFileUrl,
                document_kind: 'receipt',
                document_url: receiptFileUrl,
                comment: expenseComment,
              })
              .eq('id', existingExpense.id)
            expenseId = String(existingExpense.id)
          } else {
            throw expenseError
          }
        } else {
          throw expenseError
        }
      } else {
        expenseId = String(insertedExpense?.id || '')
      }

      await supabase
        .from('supplier_debts')
        .update({
          status: 'paid',
          payment_paid_at: paidAt,
          payment_cash_amount: method === 'cash' ? total : 0,
          payment_kaspi_amount: method === 'kaspi' ? total : 0,
          payment_receipt_file_url: receiptFileUrl,
          payment_comment: comment,
          expense_id: expenseId,
        })
        .eq('id', debt.id)

      await supabase
        .from('supplier_debt_payments')
        .insert([{
          debt_id: debt.id,
          organization_id: debt.organization_id || null,
          paid_at: paidAt,
          cash_amount: method === 'cash' ? total : 0,
          kaspi_amount: method === 'kaspi' ? total : 0,
          receipt_file_url: receiptFileUrl,
          comment,
          expense_id: expenseId,
          event_type: 'payment',
          event_payload: { bulk: true, batch_size: open.length },
          created_by: access.user?.id || null,
        }])
        .then(() => null, () => null)

      results.push({ debt_id: debt.id, expense_id: expenseId || '', total })
    }

    await writeAuditLog(supabase as any, {
      action: 'supplier_debt.bulk_pay',
      entityType: 'supplier_debt_batch',
      entityId: 'batch',
      actorUserId: access.user?.id || null,
      payload: {
        organization_id: access.activeOrganization?.id || null,
        method,
        paid_at: paidAt,
        receipt_file_url: receiptFileUrl,
        debts: results,
      },
    })

    return json({ ok: true, data: { closed: results.length, results } })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось провести объединённую оплату' }, 500)
  }
}
