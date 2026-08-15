/**
 * Карта денег точки: что где настроено и кто это менял.
 *
 * После разделения «оборот платит зарплата, качество платит KPI» настройки
 * денег живут в двух местах, и по отдельности каждое выглядит полным — а
 * вместе может противоречить. Например, включённый `shift_bonus_paid` при
 * ненулевых порогах в правилах зарплаты означает двойную оплату одной смены.
 *
 * Этот экран собирает обе стороны в одном месте, показывает автора и дату
 * последнего изменения и явно называет противоречия, если они есть.
 */
import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { inScope, loadStoreKpiSettings, resolveStoreKpiContext } from '@/lib/server/store-kpi'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

/** Сущности модуля, изменения которых двигают деньги людей. */
const MONEY_ENTITIES = [
  'store_kpi_settings',
  'store_kpi_shift_plans',
  'store_kpi_monthly_indices',
  'store_kpi_bonus_awards',
  'store_kpi_cross_sell_rules',
]

const ENTITY_LABELS: Record<string, string> = {
  store_kpi_settings: 'Настройки модели',
  store_kpi_shift_plans: 'План смены',
  store_kpi_monthly_indices: 'Месячный индекс',
  store_kpi_bonus_awards: 'Начисление бонуса',
  store_kpi_cross_sell_rules: 'Правила допродаж',
}

const ACTION_LABELS: Record<string, string> = {
  create: 'создано',
  update: 'изменено',
  delete: 'удалено',
  override: 'правка вручную',
  lock: 'зафиксировано',
  approve: 'подтверждено',
}

/** Имена авторов по id пользователя: сначала почта, затем сотрудник по почте. */
async function resolveActors(actorIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (actorIds.length === 0 || !hasAdminSupabaseCredentials()) return out

  const admin = createAdminSupabaseClient()
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error || !data?.users) return out

  const emailById = new Map<string, string>()
  for (const user of data.users) {
    if (user.id && user.email && actorIds.includes(user.id)) emailById.set(user.id, user.email)
  }
  if (emailById.size === 0) return out

  const { data: staffRows } = await admin
    .from('staff')
    .select('email, full_name, short_name')
    .in('email', [...emailById.values()])

  const nameByEmail = new Map<string, string>()
  for (const row of (staffRows || []) as any[]) {
    const email = String(row.email || '').toLowerCase()
    const name = String(row.full_name || row.short_name || '').trim()
    if (email && name) nameByEmail.set(email, name)
  }

  for (const [id, email] of emailById) {
    out.set(id, nameByEmail.get(email.toLowerCase()) || email)
  }
  return out
}

export async function GET(request: Request) {
  try {
    const ctx = await resolveStoreKpiContext(request, 'sales-kpi.view', json)
    if ('response' in ctx) return ctx.response
    const { supabase, scope } = ctx

    const companyId = new URL(request.url).searchParams.get('company_id')
    if (!companyId) return json({ error: 'company-required' }, 400)
    if (!inScope(scope, companyId)) return json({ error: 'forbidden', code: 'company-out-of-scope' }, 403)

    const { row: settingsRow, settings } = await loadStoreKpiSettings(supabase, companyId)

    const { data: company } = await supabase
      .from('companies')
      .select('id, name, code')
      .eq('id', companyId)
      .maybeSingle()

    // ── Правила зарплаты этой точки ───────────────────────────────────────
    // Ключ у них не company_id, а company_code — отсюда лишний шаг.
    let salaryRules: any[] = []
    if (company?.code) {
      const { data } = await supabase
        .from('operator_salary_rules')
        .select(
          'id, shift_type, base_per_shift, threshold1_turnover, threshold1_bonus, threshold2_turnover, threshold2_bonus, low_turnover_threshold, low_turnover_base, effective_from, is_active',
        )
        .eq('company_code', company.code)
        .order('shift_type')
      salaryRules = data || []
    }

    // ── Кто и когда менял денежные настройки ──────────────────────────────
    const { data: auditRows } = await supabase
      .from('audit_log')
      .select('id, actor_user_id, entity_type, action, payload, created_at')
      .in('entity_type', MONEY_ENTITIES)
      .contains('payload', { company_id: companyId })
      .order('created_at', { ascending: false })
      .limit(30)

    const actorIds = [
      ...new Set(((auditRows || []) as any[]).map((r) => r.actor_user_id).filter(Boolean)),
    ] as string[]
    const actors = await resolveActors(actorIds)

    const changes = ((auditRows || []) as any[]).map((r) => ({
      at: r.created_at,
      who: r.actor_user_id ? actors.get(String(r.actor_user_id)) || 'Неизвестный пользователь' : 'Система',
      entity: ENTITY_LABELS[r.entity_type] || r.entity_type,
      action: ACTION_LABELS[r.action] || r.action,
      details: r.payload || null,
    }))

    // ── Противоречия ──────────────────────────────────────────────────────
    const conflicts: string[] = []
    const paidThresholds = salaryRules.filter(
      (r) => Number(r.threshold1_bonus || 0) > 0 || Number(r.threshold2_bonus || 0) > 0,
    )

    if (settings.shift_bonus_paid && paidThresholds.length > 0) {
      conflicts.push(
        'Сменные бонусы включены в KPI, но в правилах зарплаты остались ненулевые пороги по обороту. Смена будет оплачена дважды — обнулите пороги в правилах или выключите сменные бонусы в KPI.',
      )
    }
    if (!settings.shift_bonus_paid && paidThresholds.length === 0) {
      conflicts.push(
        'За оборот не платит ни KPI, ни правила зарплаты: пороги в правилах нулевые, а сменные бонусы в KPI выключены. Продавец получает только ставку и месячный бонус за качество.',
      )
    }
    if (!company?.code) {
      conflicts.push(
        'У точки не задан код компании, поэтому правила зарплаты к ней не привязываются — проверить пороги по обороту не получилось.',
      )
    }

    return json({
      data: {
        company: company ? { id: company.id, name: company.name, code: company.code } : null,
        kpi: {
          configured: Boolean(settingsRow),
          updated_at: settingsRow?.updated_at ?? null,
          updated_by: settingsRow?.updated_by
            ? (await resolveActors([String(settingsRow.updated_by)])).get(String(settingsRow.updated_by)) ||
              'Неизвестный пользователь'
            : null,
          shift_bonus_paid: settings.shift_bonus_paid,
          b1_amount: settings.b1_amount,
          b2_amount: settings.b2_amount,
          b3_amount: settings.b3_amount,
          record_amount: settings.record_amount,
          monthly_bonus_strong: settings.monthly_bonus_strong,
          monthly_bonus_top: settings.monthly_bonus_top,
          percentiles: {
            control: settings.control_percentile,
            b1: settings.b1_percentile,
            b2: settings.b2_percentile,
            b3: settings.b3_percentile,
          },
          require_product_test_for_top_bonus: settings.require_product_test_for_top_bonus,
          weather_adjusts_bonus_threshold: settings.weather_adjusts_bonus_threshold,
        },
        salary_rules: salaryRules,
        conflicts,
        changes,
      },
    })
  } catch (error) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/sales-kpi/money-map GET',
      message: error instanceof Error ? error.message : String(error),
    })
    console.error('[sales-kpi/money-map]', error)
    return json({ error: 'internal-error' }, 500)
  }
}
