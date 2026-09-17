import { writeAuditLog } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { requireOrgFeature } from '@/lib/server/entitlements'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { json } from '@/lib/server/api-response'

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
    const scopeOrg = access.activeOrganization?.id || (access.isSuperAdmin ? null : '00000000-0000-0000-0000-000000000000')
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
      // Изоляция: fallback-категория — из справочника своей орг, иначе в расход
      // подставлялось название COGS-категории соседнего арендатора.
      let fallbackQuery: any = supabase
        .from('expense_categories')
        .select('name')
        .ilike('accounting_group', 'cogs')
        .order('name', { ascending: true })
        .limit(1)
      if (scopeOrg) fallbackQuery = fallbackQuery.eq('organization_id', scopeOrg)
      const { data: fallback } = await fallbackQuery.maybeSingle()
      fallbackCategoryName = (fallback as any)?.name || null
      if (!fallbackCategoryName) {
        return json({ error: 'У части долгов нет COGS-категории, и в справочнике не найдено fallback. Создайте COGS-категорию.' }, 400)
      }
    }

    const results: Array<{ debt_id: string; expense_id: string; total: number }> = []
    // Долг, который не удалось закрыть, больше не исчезает молча: ниже каждый шаг
    // проверяется, при сбое расход этого долга откатывается, а сам долг попадает
    // сюда — ответ показывает, что оплачено, а что нет.
    const failures: Array<{ debt_id: string; supplier: string; total: number; error: string }> = []

    for (const debt of open) {
      const total = normalizeMoney(debt.total_amount)
      const supplierName = debt.supplier?.organization_name || debt.supplier?.name || '—'
      if (total <= 0) {
        failures.push({ debt_id: String(debt.id), supplier: supplierName, total, error: 'Сумма долга не положительная' })
        continue
      }

      const categoryName = String(debt.category?.name || '').trim() || fallbackCategoryName || 'COGS'
      if (!debt.company_id) {
        failures.push({ debt_id: String(debt.id), supplier: supplierName, total, error: 'У долга не указана точка' })
        continue
      }

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
      // Расход, который создали именно мы: только его и можно откатывать.
      // Найденный по 23505 чужой/прежний расход трогать нельзя.
      let createdExpenseId: string | null = null
      try {
        const { data: insertedExpense, error: expenseError } = await supabase
          .from('expenses')
          .insert([expensePayload])
          .select('id')
          .single()
        if (expenseError) {
          if (String((expenseError as any)?.code || '') === '23505') {
            const { data: existingExpense, error: existingError } = await supabase
              .from('expenses')
              .select('id')
              .eq('source_type', 'inventory_receipt')
              .eq('source_id', debt.receipt_id)
              .maybeSingle()
            if (existingError) throw existingError
            if (!existingExpense?.id) throw expenseError
            const { error: updateExpenseError } = await supabase
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
            if (updateExpenseError) throw updateExpenseError
            expenseId = String(existingExpense.id)
          } else {
            throw expenseError
          }
        } else {
          expenseId = String(insertedExpense?.id || '')
          createdExpenseId = expenseId || null
        }

        const { data: updatedDebt, error: debtUpdateError } = await supabase
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
          .eq('status', 'open')
          .select('id')
        // Раньше ошибка этого шага не проверялась вовсе: расход уходил в кассу,
        // а долг оставался открытым — платили второй раз.
        if (debtUpdateError) throw debtUpdateError
        if (!updatedDebt || updatedDebt.length === 0) throw new Error('Долг уже закрыт другим платежом')

        const { error: paymentError } = await supabase
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
        // Раньше ошибка глоталась `.then(() => null, () => null)` — долг числился
        // оплаченным без единой записи в истории платежей.
        if (paymentError) {
          await supabase
            .from('supplier_debts')
            .update({
              status: 'open',
              payment_paid_at: null,
              payment_cash_amount: 0,
              payment_kaspi_amount: 0,
              payment_receipt_file_url: null,
              payment_comment: null,
              expense_id: null,
            })
            .eq('id', debt.id)
          throw paymentError
        }

        results.push({ debt_id: debt.id, expense_id: expenseId || '', total })
      } catch (debtError: any) {
        // Откатываем расход этого долга, чтобы в кассе не осталось оплаты
        // по долгу, который так и не закрылся.
        if (createdExpenseId) {
          await supabase.from('expenses').delete().eq('id', createdExpenseId)
        }
        failures.push({
          debt_id: String(debt.id),
          supplier: supplierName,
          total,
          error: String(debtError?.message || 'Не удалось закрыть долг'),
        })
      }
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
        failures,
      },
    })

    if (failures.length > 0) {
      // 207: часть прошла, часть нет. Текст ошибки перечисляет незакрытые долги —
      // иначе оператор увидел бы «закрыто N» и не узнал про остальные.
      const detail = failures.map((f) => `${f.supplier}: ${f.error}`).join('; ')
      return json(
        {
          ok: false,
          error: `Оплачено ${results.length} из ${open.length}. Не закрыто ${failures.length}: ${detail}`,
          data: { closed: results.length, results, failures },
        },
        207,
      )
    }

    return json({ ok: true, data: { closed: results.length, results, failures } })
  } catch (error: any) {
    return json({ error: error?.message || 'Не удалось провести объединённую оплату' }, 500)
  }
}
