import 'server-only'

import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export type ReportTarget = {
  /** Организация-получатель (null — env-фолбэк без TELEGRAM_OWNER_ORG_ID). */
  organizationId: string | null
  /** Telegram chat id, куда слать отчёт. */
  chatId: string
  /**
   * company_id этой организации для скоупа данных отчёта.
   * null = не скоупить (env-фолбэк single-tenant без указанной орг) → все данные.
   */
  companyIds: string[] | null
  /** 'org' — настроено в БД (per-org); 'env' — фолбэк из переменных окружения. */
  source: 'org' | 'env'
}

/** Только per-org цели из БД (с заданным telegram_owner_chat_id). Пусто → cron должен
 *  использовать своё прежнее env-поведение (чтобы у F16 отчёты не переехали в другой чат). */
export async function listOrgReportTargets(): Promise<ReportTarget[]> {
  return (await listReportTargets()).filter((t) => t.source === 'org')
}

/**
 * Кому слать cron/бот-отчёты с изоляцией по арендаторам.
 *
 * 1) Каждая организация с заданным `telegram_owner_chat_id` → свой чат + свои company_id.
 * 2) Env-фолбэк: если задан `TELEGRAM_OWNER_CHAT_ID` и его орг ещё не покрыта пунктом 1 —
 *    добавляем её (скоуп по `TELEGRAM_OWNER_ORG_ID`, либо все данные, если орг не задана).
 *    Это сохраняет текущие отчёты F16 при переходе на per-org рассылку.
 *
 * Использование в cron:
 *   for (const t of await listReportTargets()) {
 *     const data = await collect(t.companyIds)   // companyIds === null → без фильтра
 *     await sendTelegram(t.chatId, render(data))
 *   }
 */
export async function listReportTargets(): Promise<ReportTarget[]> {
  if (!hasAdminSupabaseCredentials()) return []
  const supabase = createAdminSupabaseClient()

  const targets: ReportTarget[] = []
  const coveredOrgs = new Set<string>()

  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, telegram_owner_chat_id')
    .not('telegram_owner_chat_id', 'is', null)

  for (const o of (orgs || []) as any[]) {
    const chatId = String(o.telegram_owner_chat_id || '').trim()
    if (!chatId) continue
    const { data: comps } = await supabase.from('companies').select('id').eq('organization_id', o.id)
    targets.push({
      organizationId: String(o.id),
      chatId,
      companyIds: (comps || []).map((c: any) => String(c.id)),
      source: 'org',
    })
    coveredOrgs.add(String(o.id))
  }

  // Env-фолбэк (обратная совместимость, single-tenant F16).
  const envChat = (process.env.TELEGRAM_OWNER_CHAT_ID || '').trim()
  const envOrg = (process.env.TELEGRAM_OWNER_ORG_ID || '').trim()
  if (envChat && (!envOrg || !coveredOrgs.has(envOrg))) {
    let companyIds: string[] | null = null
    if (envOrg) {
      const { data: comps } = await supabase.from('companies').select('id').eq('organization_id', envOrg)
      companyIds = (comps || []).map((c: any) => String(c.id))
    }
    targets.push({ organizationId: envOrg || null, chatId: envChat, companyIds, source: 'env' })
  }

  return targets
}
