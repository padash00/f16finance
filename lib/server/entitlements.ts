import 'server-only'

import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

// Серверный entitlement-слой (paid features), отдельно от RBAC (capabilities).
// Источник правды — таблица company_features (гранты на уровне точки), включая legacy-гранты.
//
// Режим: по умолчанию SHADOW — requireFeature НЕ блокирует, только логирует «отрезал бы».
// Принудительное ограничение включается переменной окружения ENTITLEMENTS_ENFORCE='true'
// (делать только после фазы изоляции и проверки логов).

const ENFORCE = process.env.ENTITLEMENTS_ENFORCE === 'true'

export type EntitlementContext = {
  supabase: any
  companyId: string | null
  capabilities?: Set<string>
}

export type FeatureCheck = {
  allowed: boolean
  entitled: boolean
  capabilityOk: boolean
  enforced: boolean
}

// Эффективные коды фич точки: enabled и не истёкшие записи company_features.
export async function resolveCompanyEntitlements(
  supabase: any,
  companyId: string | null,
): Promise<Set<string>> {
  if (!companyId) return new Set()
  try {
    const { data, error } = await supabase
      .from('company_features')
      .select('enabled, ends_at, feature:feature_id(code)')
      .eq('company_id', companyId)
      .eq('enabled', true)
    if (error) return new Set()

    const now = Date.now()
    const codes = new Set<string>()
    for (const row of data || []) {
      const ends = (row as any).ends_at ? new Date((row as any).ends_at).getTime() : null
      if (ends && ends < now) continue
      const feat = (row as any).feature
      const code = Array.isArray(feat) ? feat[0]?.code : feat?.code
      if (code) codes.add(String(code))
    }
    return codes
  } catch {
    // Таблицы может ещё не быть (миграция не применена) — не ломаем основной поток.
    return new Set()
  }
}

// Проверка доступа к платной фиче: capability (RBAC) И entitlement (оплачено).
// SHADOW (по умолчанию): возвращает allowed=true, но пишет в лог, что отрезал бы.
export async function requireFeature(
  ctx: EntitlementContext,
  featureCode: string,
  neededCapability?: string,
): Promise<FeatureCheck> {
  const capabilityOk = !neededCapability || !!ctx.capabilities?.has(neededCapability)
  const entitled = (await resolveCompanyEntitlements(ctx.supabase, ctx.companyId)).has(featureCode)
  const allowedReal = capabilityOk && entitled

  if (!allowedReal && !ENFORCE) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'entitlements/shadow',
      message: `SHADOW would block feature=${featureCode} company=${ctx.companyId || '-'} capabilityOk=${capabilityOk} entitled=${entitled}`,
    }).catch(() => {})
    return { allowed: true, entitled, capabilityOk, enforced: false }
  }

  return { allowed: allowedReal, entitled, capabilityOk, enforced: ENFORCE }
}

export type OrgEntitlements = { features: string[]; allAccess: boolean }

// Эффективные фичи организации (company_features по её точкам). allAccess=true —
// супер-админ, F16-legacy или орг без настроенных entitlements (не гейтим).
// Единый источник правды для session-role (меню) и серверных guard'ов (API).
export async function resolveOrgEntitlements(access: {
  isSuperAdmin?: boolean
  activeOrganization?: { id?: string | null } | null
}): Promise<OrgEntitlements> {
  if (access.isSuperAdmin) return { features: [], allAccess: true }
  const orgId = access.activeOrganization?.id || null
  if (!orgId || !hasAdminSupabaseCredentials()) return { features: [], allAccess: true }
  try {
    const supabase = createAdminSupabaseClient()
    const { data: cos } = await supabase.from('companies').select('id').eq('organization_id', orgId)
    const cids = (cos || []).map((c: any) => String(c.id))
    if (cids.length === 0) return { features: [], allAccess: true }
    const { data: cf } = await supabase
      .from('company_features')
      .select('source_type, enabled, ends_at, feature:feature_id(code)')
      .in('company_id', cids)
      .eq('enabled', true)
    const now = Date.now()
    let hasLegacy = false
    const codes = new Set<string>()
    for (const row of (cf || []) as any[]) {
      const ends = row.ends_at ? new Date(row.ends_at).getTime() : null
      if (ends && ends < now) continue
      if (row.source_type === 'legacy') hasLegacy = true
      const feat = Array.isArray(row.feature) ? row.feature[0] : row.feature
      if (feat?.code) codes.add(String(feat.code))
    }
    if (hasLegacy || codes.size === 0) return { features: Array.from(codes), allAccess: true }
    return { features: Array.from(codes), allAccess: false }
  } catch {
    return { features: [], allAccess: true }
  }
}

// Серверный guard платной фичи. Возвращает Response(402) если фича не куплена
// И включён ENTITLEMENTS_ENFORCE; иначе (shadow) — null, только лог.
export async function requireOrgFeature(access: any, featureCode: string): Promise<Response | null> {
  const { features, allAccess } = await resolveOrgEntitlements(access)
  if (allAccess || features.includes(featureCode)) return null
  if (!ENFORCE) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'entitlements/shadow-feature',
      message: `SHADOW would block feature=${featureCode} org=${access?.activeOrganization?.id || '-'}`,
    }).catch(() => {})
    return null
  }
  return NextResponse.json({ error: 'upgrade_required', feature: featureCode }, { status: 402 })
}
