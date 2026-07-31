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

export type OrgEntitlements = { features: string[]; allAccess: boolean; enforce: boolean }

// Эффективные фичи организации (company_features по её точкам). allAccess=true —
// супер-админ, F16-legacy или орг без настроенных entitlements (не гейтим).
// enforce — пер-орг тумблер жёсткой блокировки (organizations.features_enforced);
// глобальный ENTITLEMENTS_ENFORCE тоже включает блокировку.
// Единый источник правды для session-role (меню) и серверных guard'ов (API).
export async function resolveOrgEntitlements(access: {
  isSuperAdmin?: boolean
  activeOrganization?: { id?: string | null } | null
}): Promise<OrgEntitlements> {
  if (access.isSuperAdmin) return { features: [], allAccess: true, enforce: false }
  const orgId = access.activeOrganization?.id || null
  if (!orgId || !hasAdminSupabaseCredentials()) return { features: [], allAccess: true, enforce: false }
  try {
    const supabase = createAdminSupabaseClient()

    // Пер-орг флаг жёсткого энфорсмента. ВАЖНО: billing_exempt тут НЕ трогаем —
    // он про биллинг (не блокировать за неоплату), а НЕ про доступ к страницам.
    // Иначе billing-exempt орг (напр. castle) обходила бы гейтинг пакета и
    // видела все страницы.
    let enforce = false
    try {
      const { data: orgRow } = await supabase
        .from('organizations')
        .select('features_enforced')
        .eq('id', orgId)
        .maybeSingle()
      enforce = !!(orgRow as any)?.features_enforced
    } catch {
      // колонки может ещё не быть (миграция не применена) → enforce=false
    }

    // ── НОВАЯ МОДЕЛЬ: пакет + аддоны организации ─────────────────────────────
    // Если организации НАЗНАЧЕН пакет — фичи = пакет.feature_codes ∪ включённые
    // аддоны.feature_codes, и гейтинг ВКЛЮЧАЕТСЯ (allAccess=false). Если пакета
    // нет — fail-open ниже (F16-legacy и ненастроенные орги не трогаем).
    try {
      const { data: pkgRow } = await supabase
        .from('organization_packages')
        .select('package_code')
        .eq('organization_id', orgId)
        .maybeSingle()
      if (pkgRow?.package_code) {
        const features = new Set<string>()
        const { data: pkg } = await supabase
          .from('packages')
          .select('feature_codes')
          .eq('code', pkgRow.package_code)
          .maybeSingle()
        for (const f of ((pkg?.feature_codes as string[]) || [])) features.add(String(f))
        const { data: addonRows } = await supabase
          .from('organization_addons')
          .select('addon_code')
          .eq('organization_id', orgId)
          .eq('enabled', true)
        const addonCodes = (addonRows || []).map((r: any) => String(r.addon_code)).filter(Boolean)
        if (addonCodes.length > 0) {
          const { data: addons } = await supabase.from('addons').select('feature_codes').in('code', addonCodes)
          for (const a of (addons || []) as any[]) {
            for (const f of ((a.feature_codes as string[]) || [])) features.add(String(f))
          }
        }
        return { features: Array.from(features), allAccess: false, enforce }
      }
    } catch {
      // Таблиц пакетов может ещё не быть — падаем в legacy-путь ниже.
    }
    // ── LEGACY: company_features (старый источник) / fail-open ────────────────

    const { data: cos } = await supabase.from('companies').select('id').eq('organization_id', orgId)
    const cids = (cos || []).map((c: any) => String(c.id))
    if (cids.length === 0) return { features: [], allAccess: true, enforce }
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
    if (hasLegacy || codes.size === 0) return { features: Array.from(codes), allAccess: true, enforce }
    return { features: Array.from(codes), allAccess: false, enforce }
  } catch {
    return { features: [], allAccess: true, enforce: false }
  }
}

/**
 * Эффективный лимит точек (компаний) организации.
 *   = max( точки_пакета + Σ(аддон.included_companies × quantity), ручной company_limit )
 * Ручное organizations.company_limit — override/fallback: для орг без пакета,
 * освобождённых от биллинга и индив. сделок. Никогда не занижает существующее.
 * Обратно-совместимо: если колонок included_companies/quantity ещё нет (миграция
 * не применена) — отдаём ручной лимит (как было).
 */
export async function resolveCompanyLimit(orgId: string | null | undefined): Promise<number> {
  if (!orgId || !hasAdminSupabaseCredentials()) return 1
  const supabase = createAdminSupabaseClient()

  const readManual = async (): Promise<number> => {
    try {
      const { data } = await supabase.from('organizations').select('company_limit').eq('id', orgId).maybeSingle()
      const n = Number((data as any)?.company_limit ?? 1)
      return Number.isFinite(n) && n > 0 ? Math.round(n) : 1
    } catch {
      return 1
    }
  }

  const manual = await readManual()

  try {
    // База: точки пакета (если назначен), иначе ручной лимит как fallback.
    let base = manual
    const { data: pkgRow } = await supabase
      .from('organization_packages')
      .select('package_code')
      .eq('organization_id', orgId)
      .maybeSingle()
    if ((pkgRow as any)?.package_code) {
      const { data: pkg } = await supabase
        .from('packages')
        .select('included_companies')
        .eq('code', (pkgRow as any).package_code)
        .maybeSingle()
      const inc = Number((pkg as any)?.included_companies ?? 1)
      base = Number.isFinite(inc) && inc > 0 ? Math.round(inc) : 1
    }

    // Аддоны: сумма included_companies × quantity по включённым.
    let addonPoints = 0
    const { data: addonRows } = await supabase
      .from('organization_addons')
      .select('addon_code, quantity')
      .eq('organization_id', orgId)
      .eq('enabled', true)
    const rows = (addonRows || []) as Array<{ addon_code: string; quantity: number | null }>
    if (rows.length > 0) {
      const codes = rows.map((r) => String(r.addon_code)).filter(Boolean)
      const { data: addons } = await supabase.from('addons').select('code, included_companies').in('code', codes)
      const incByCode = new Map<string, number>()
      for (const a of (addons || []) as any[]) incByCode.set(String(a.code), Number(a.included_companies ?? 0) || 0)
      for (const r of rows) {
        const inc = incByCode.get(String(r.addon_code)) || 0
        const qty = Math.max(1, Number(r.quantity ?? 1) || 1)
        addonPoints += inc * qty
      }
    }

    return Math.max(base + addonPoints, manual)
  } catch {
    // Колонок included_companies/quantity может ещё не быть — ведём себя как раньше.
    return manual
  }
}

// Серверный guard платной фичи. Возвращает Response(402) если фича не куплена
// И включён ENTITLEMENTS_ENFORCE; иначе (shadow) — null, только лог.
// featureCode — одна фича или список (проходит, если есть ЛЮБАЯ из них).
export async function requireOrgFeature(access: any, featureCode: string | string[]): Promise<Response | null> {
  const codes = Array.isArray(featureCode) ? featureCode : [featureCode]
  const { features, allAccess, enforce } = await resolveOrgEntitlements(access)
  if (allAccess || codes.some((c) => features.includes(c))) return null
  // Блокируем, если включён глобальный ENFORCE ИЛИ пер-орг тумблер features_enforced.
  const shouldBlock = ENFORCE || enforce
  if (!shouldBlock) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'entitlements/shadow-feature',
      message: `SHADOW would block feature=${codes.join('|')} org=${access?.activeOrganization?.id || '-'}`,
    }).catch(() => {})
    return null
  }
  return NextResponse.json({ error: 'upgrade_required', feature: codes[0] }, { status: 402 })
}

/**
 * Гейт data-API страницы аддона. Тонкая обёртка над requireOrgFeature — ставится в
 * начале роутов, относящихся к аддону (напр. requireAddon(access, 'addon.hr')).
 * Без него аддон обходится прямым вызовом API. Использовать код аддона из
 * lib/core/addons.ts (ADDON_CATALOG).
 */
export async function requireAddon(access: any, addonCode: string | string[]): Promise<Response | null> {
  return requireOrgFeature(access, addonCode)
}
