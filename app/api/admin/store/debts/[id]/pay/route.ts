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
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 0
  return Math.round((numeric + Number.EPSILON) * 100) / 100
}

type Body = {
  paid_at?: string
  payment_method?: 'cash' | 'kaspi'
  receipt_file_url?: string | null
  comment?: string | null
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'store-billing.pay_debt')
    if (denied) return denied as any
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)
    const entitlementGuard = await requireOrgFeature(access, 'shop.catalog')
    if (entitlementGuard) return entitlementGuard

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const body = (await request.json().catch(() => null)) as Body | null
    if (!body) return json({ error: 'invalid-body' }, 400)

    const paidAt = String(body.paid_at || '').trim()
    if (!paidAt) return json({ error: 'Укажите дату оплаты' }, 400)
    const method = body.payment_method === 'kaspi' ? 'kaspi' : 'cash'
    const receiptFileUrl = String(body.receipt_file_url || '').trim()
    if (!receiptFileUrl) return json({ error: 'Загрузите чек об оплате' }, 400)
    const comment = String(body.comment || '').trim() || null

    let debtQuery: any = supabase
      .from('supplier_debts')
      .select(
        `id, receipt_id, supplier_id, company_id, organization_id, expense_category_id,
         total_amount, status, expense_id,
         supplier:supplier_id(id, name, bin_iin, organization_name),
         category:expense_category_id(id, name, accounting_group),
         receipt:receipt_id(id, received_at, invoice_number, invoice_file_url, comment)`,
      )
      .eq('id', id)
      .limit(1)
    if (!access.isSuperAdmin && access.activeOrganization?.id) {
      debtQuery = debtQuery.eq('organization_id', access.activeOrganization.id)
    }
    const { data: debt, error: debtError } = await debtQuery.maybeSingle()
    if (debtError) throw debtError
    if (!debt?.id) return json({ error: 'Долг не найден' }, 404)
    if (debt.status === 'paid') return json({ error: 'Этот долг уже оплачен' }, 409)
    if (debt.status === 'written_off') return json({ error: 'Этот долг списан' }, 409)

    const total = normalizeMoney(debt.total_amount)
    if (total <= 0) return json({ error: 'Сумма долга равна нулю — нечего оплачивать' }, 400)

    // Fallback: if category was deleted from expense_categories after debt was created,
    // try to find a generic COGS category instead of failing the payment.
    let categoryName = String(debt.category?.name || '').trim()
    if (!categoryName) {
      const { data: fallbackCategory } = await supabase
        .from('expense_categories')
        .select('id, name')
        .ilike('accounting_group', 'cogs')
        .order('name', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (fallbackCategory?.name) {
        categoryName = String(fallbackCategory.name).trim()
      } else {
        return json(
          { error: 'У долга нет категории COGS, и в справочнике не нашлось ни одной COGS-категории. Создайте её в Настройках → Категории расходов.' },
          400,
        )
      }
    }
    if (!debt.company_id) {
      return json({ error: 'Не удалось определить точку (company_id) для расхода' }, 400)
    }

    const supplierBinIin = debt.supplier?.bin_iin
    const supplierOrgName = debt.supplier?.organization_name || debt.supplier?.name
    const receiptInvoiceNumber = debt.receipt?.invoice_number
    const expenseCommentParts = [
      `Оплата приемки №${receiptInvoiceNumber || debt.receipt_id}`,
      supplierOrgName ? `Поставщик: ${supplierOrgName}` : null,
      supplierBinIin ? `БИН/ИИН: ${supplierBinIin}` : null,
      comment ? `Комментарий: ${comment}` : null,
    ].filter(Boolean)
    const expenseComment = expenseCommentParts.join('\n')

    const expenseInsertPayload: Record<string, unknown> = {
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

    let expenseId = ''

    const { data: insertedExpense, error: expenseError } = await supabase
      .from('expenses')
      .insert([expenseInsertPayload])
      .select('id')
      .single()
    if (expenseError) {
      // 23505 means there's already an expense for this receipt — reuse it.
      if (String((expenseError as any)?.code || '') === '23505') {
        const { data: existingExpense } = await supabase
          .from('expenses')
          .select('id')
          .eq('source_type', 'inventory_receipt')
          .eq('source_id', debt.receipt_id)
          .maybeSingle()
        if (!existingExpense?.id) {
          throw expenseError
        }
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
        expenseId = existingExpense.id as string
      } else {
        throw expenseError
      }
    } else {
      expenseId = String(insertedExpense?.id || '')
    }

    const { error: updateError } = await supabase
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
    if (updateError) throw updateError

    // Append to payment history for audit and future reporting.
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
        created_by: access.user?.id || null,
      }])
      .then(() => null, () => null)

    await writeAuditLog(supabase as any, {
      action: 'supplier_debt.pay',
      entityType: 'supplier_debt',
      entityId: debt.id,
      actorUserId: access.user?.id || null,
      payload: {
        organization_id: debt.organization_id || null,
        paid_at: paidAt,
        method,
        total,
        receipt_file_url: receiptFileUrl,
      },
    })

    return json({ ok: true, data: { id: debt.id, expense_id: expenseId } })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось провести оплату' }, 500)
  }
}
