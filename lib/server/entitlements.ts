import 'server-only'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'

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
