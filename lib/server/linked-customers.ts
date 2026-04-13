import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

export type LinkedCustomerRow = {
  id: string
  company_id: string | null
  name: string
  email: string | null
}

export async function fetchLinkedCustomersForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<LinkedCustomerRow[]> {
  const { data, error } = await supabase
    .from('customers')
    .select('id, company_id, name, email')
    .eq('auth_user_id', userId)
    .eq('is_active', true)

  if (error) {
    console.warn('[linked-customers] fetch failed', error.message)
    return []
  }

  return ((data || []) as LinkedCustomerRow[]).filter((row) => row.id)
}

export type ResolveLinkedCustomerOptions = {
  /**
   * Если несколько точек в профиле и `companyId` не передан — взять одну строку детерминированно
   * (сортировка по company_id), чтобы гостю не нужно было выбирать клуб вручную.
   */
  defaultWhenMultiple?: boolean
}

/**
 * Один auth-пользователь может иметь несколько строк `customers` (разные `company_id`) — тогда клиент «видит» всю сеть.
 * Для POST: явный `companyId`, одна привязка, при `defaultWhenMultiple` — автоматический выбор точки.
 */
export function resolveLinkedCustomerForWrite(
  linkedCustomers: LinkedCustomerRow[],
  requestedCompanyId?: string | null,
  options?: ResolveLinkedCustomerOptions,
): { ok: true; customerId: string; companyId: string } | { ok: false; error: string } {
  const rows = linkedCustomers
    .map((c) => ({
      id: String(c.id || '').trim(),
      companyId: c.company_id ? String(c.company_id).trim() : '',
    }))
    .filter((r) => r.id && r.companyId)

  if (rows.length === 0) {
    return { ok: false, error: 'customer-company-not-found' }
  }

  const req = requestedCompanyId?.trim()
  if (req) {
    const hit = rows.find((r) => r.companyId === req)
    if (!hit) {
      return { ok: false, error: 'company-not-in-profile' }
    }
    return { ok: true, customerId: hit.id, companyId: hit.companyId }
  }

  if (rows.length === 1) {
    return { ok: true, customerId: rows[0].id, companyId: rows[0].companyId }
  }

  if (options?.defaultWhenMultiple) {
    const sorted = [...rows].sort((a, b) => a.companyId.localeCompare(b.companyId))
    return { ok: true, customerId: sorted[0].id, companyId: sorted[0].companyId }
  }

  return { ok: false, error: 'company-id-required' }
}
