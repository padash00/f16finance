import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { buildLoyaltySaveUrl, hasGoogleWalletCredentials } from '@/lib/server/google-wallet'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

/**
 * GET ?customer_id=… → ссылка «Добавить в Google Кошелёк» для клиента.
 * Если у клиента нет card_number — генерируем и сохраняем (код и есть QR карты).
 */
export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'customers.edit')
    if (denied) return denied

    if (!hasGoogleWalletCredentials()) {
      return json({ error: 'Google Wallet не настроен: добавьте GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_SA_EMAIL и GOOGLE_WALLET_SA_KEY в ENV' }, 400)
    }

    const customerId = String(new URL(request.url).searchParams.get('customer_id') || '').trim()
    if (!customerId) return json({ error: 'customer-id-required' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const { data: customer, error } = await supabase
      .from('customers')
      .select('id, name, phone, card_number, loyalty_points, company_id')
      .eq('id', customerId)
      .maybeSingle()
    if (error) throw error
    if (!customer) return json({ error: 'customer-not-found' }, 404)
    if (
      companyScope.allowedCompanyIds &&
      customer.company_id &&
      !companyScope.allowedCompanyIds.includes(String(customer.company_id))
    ) {
      return json({ error: 'forbidden' }, 403)
    }

    let cardNumber = String(customer.card_number || '').trim()
    if (!cardNumber) {
      cardNumber = 'ORDA-C-' + String(customer.id).replace(/-/g, '').slice(0, 12).toUpperCase()
      const { error: updErr } = await supabase
        .from('customers')
        .update({ card_number: cardNumber, updated_at: new Date().toISOString() })
        .eq('id', customer.id)
      if (updErr) throw updErr
    }

    const url = buildLoyaltySaveUrl({
      customer: {
        id: String(customer.id),
        name: customer.name,
        phone: customer.phone,
        card_number: cardNumber,
        loyalty_points: Number(customer.loyalty_points || 0),
      },
      organizationId: access.activeOrganization?.id || null,
      programName: access.activeOrganization?.name || 'Orda Club',
    })
    if (!url) return json({ error: 'google-wallet-not-configured' }, 400)

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'customer',
      entityId: String(customer.id),
      action: 'wallet-link-issued',
      payload: { card_number: cardNumber },
    })

    return json({ ok: true, data: { url, card_number: cardNumber } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/customers/wallet-link.GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Не удалось создать ссылку' }, 500)
  }
}
