/**
 * HR Analytics — агрегированные метрики команды.
 *
 * GET /api/admin/hr/analytics?days=30
 *
 * Возвращает:
 *   {
 *     headcount: { operators, staff, hybrid, total },
 *     byRole: [{ role, label, count }, ...],
 *     byCompany: [{ company_id, name, count }, ...],
 *     turnover: { hired, dismissed, net, period_days },
 *     tenure: { avg_months_operator, avg_months_staff },
 *     upcoming: {
 *       birthdays: [{ name, date, days_until }, ...],     // 30 дней вперёд
 *       anniversaries: [{ name, hire_date, years, days_until }, ...]
 *     },
 *     issues: {
 *       no_login: [{ id, name }, ...],   // операторы без operator_auth
 *     }
 *   }
 */

import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import {
  listOrganizationOperatorIds,
  listOrganizationStaffIds,
  resolveCompanyScope,
} from '@/lib/server/organizations'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function monthsBetween(fromIso: string | null, toDate: Date): number {
  if (!fromIso) return 0
  const from = new Date(fromIso)
  if (Number.isNaN(from.getTime())) return 0
  const months = (toDate.getFullYear() - from.getFullYear()) * 12 + (toDate.getMonth() - from.getMonth())
  return Math.max(0, months)
}

function daysUntilNextOccurrence(birthOrHireIso: string, today: Date): { days: number; next: Date } {
  const d = new Date(birthOrHireIso)
  const next = new Date(today.getFullYear(), d.getMonth(), d.getDate())
  if (next < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
    next.setFullYear(today.getFullYear() + 1)
  }
  const ms = next.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  return { days: Math.round(ms / (1000 * 60 * 60 * 24)), next }
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const denied = await requireCapability(access, 'hr.view')
    if (denied) return denied as any
    if (!access.isSuperAdmin && !access.staffRole) return json({ error: 'forbidden' }, 403)

    const url = new URL(req.url)
    const days = Math.max(7, Math.min(365, Number(url.searchParams.get('days')) || 30))
    const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const today = new Date()

    // Мультитенантная изоляция. Пока LEGACY_SINGLE_TENANT_MODE=true все
    // helper'ы возвращают полный набор id, а scope.allowedCompanyIds === null —
    // поэтому фильтры ниже остаются no-op. Активируется после флипа флага.
    const scope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const orgOperatorIds = await listOrganizationOperatorIds({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
      includeInactive: true,
    })
    const orgStaffIds = await listOrganizationStaffIds({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const scopeOperators = !scope.allowedCompanyIds ? null : orgOperatorIds
    const scopeStaff = !scope.allowedCompanyIds ? null : orgStaffIds

    let operatorsQuery = supabase
      .from('operators')
      .select('id, name, short_name, role, is_active, dismissed_at, is_admin_staff')
    if (scopeOperators) operatorsQuery = operatorsQuery.in('id', scopeOperators)

    let staffQuery = supabase
      .from('staff')
      .select('id, full_name, short_name, role, is_active, dismissed_at, created_at')
    if (scopeStaff) staffQuery = staffQuery.in('id', scopeStaff)

    let profilesQuery = supabase
      .from('operator_profiles')
      .select('operator_id, full_name, birth_date, hire_date')
    if (scopeOperators) profilesQuery = profilesQuery.in('operator_id', scopeOperators)

    let assignQuery = supabase
      .from('operator_company_assignments')
      .select('operator_id, company_id')
    if (scope.allowedCompanyIds) assignQuery = assignQuery.in('company_id', scope.allowedCompanyIds)

    let companiesQuery = supabase.from('companies').select('id, name')
    if (scope.allowedCompanyIds) companiesQuery = companiesQuery.in('id', scope.allowedCompanyIds)

    let authQuery = supabase.from('operator_auth').select('operator_id, is_active')
    if (scopeOperators) authQuery = authQuery.in('operator_id', scopeOperators)

    const [opRes, staffRes, profilesRes, assignRes, companiesRes, authRes, auditRes, positionsRes] = await Promise.all([
      operatorsQuery,
      staffQuery,
      profilesQuery,
      assignQuery,
      companiesQuery,
      authQuery,
      supabase
        .from('audit_log')
        .select('action, entity_type, created_at')
        .in('entity_type', ['staff', 'operator'])
        .in('action', ['create', 'dismiss'])
        .gte('created_at', sinceIso),
      supabase.from('positions').select('name, label'),
    ])

    if (opRes.error) throw opRes.error
    if (staffRes.error) throw staffRes.error

    const operators = (opRes.data || []) as any[]
    const staff = (staffRes.data || []) as any[]
    const profiles = (profilesRes.data || []) as any[]
    const profileById = new Map<string, any>()
    for (const p of profiles) profileById.set(p.operator_id, p)
    const assignments = (assignRes.data || []) as any[]
    const companies = (companiesRes.data || []) as any[]
    const authRows = (authRes.data || []) as any[]
    const audit = (auditRes.data || []) as any[]
    const positions = (positionsRes.data || []) as any[]
    const positionLabel = new Map<string, string>()
    for (const p of positions) positionLabel.set(p.name, p.label || p.name)

    // ─── Headcount ───────────────────────────────────────────────
    const activeOperators = operators.filter((o) => o.is_active && !o.dismissed_at)
    const activeStaff = staff.filter((s) => s.is_active && !s.dismissed_at)
    const hybrid = activeOperators.filter((o) => o.is_admin_staff === true).length
    const pureOperators = activeOperators.length - hybrid
    const headcount = {
      operators: pureOperators,
      staff: activeStaff.length,
      hybrid,
      total: pureOperators + activeStaff.length + hybrid,
    }

    // ─── Распределение по ролям ──────────────────────────────────
    const byRoleMap = new Map<string, number>()
    for (const o of activeOperators) {
      const r = o.role || 'без_роли'
      byRoleMap.set(r, (byRoleMap.get(r) || 0) + 1)
    }
    for (const s of activeStaff) {
      const r = s.role || 'без_роли'
      byRoleMap.set(r, (byRoleMap.get(r) || 0) + 1)
    }
    const byRole = Array.from(byRoleMap.entries())
      .map(([role, count]) => ({ role, label: positionLabel.get(role) || role, count }))
      .sort((a, b) => b.count - a.count)

    // ─── Распределение по компаниям ──────────────────────────────
    const companyById = new Map<string, string>()
    for (const c of companies) companyById.set(c.id, c.name)
    const byCompanyMap = new Map<string, number>()
    const activeOpIdSet = new Set(activeOperators.map((o) => o.id))
    for (const a of assignments) {
      if (!activeOpIdSet.has(a.operator_id)) continue
      byCompanyMap.set(a.company_id, (byCompanyMap.get(a.company_id) || 0) + 1)
    }
    const byCompany = Array.from(byCompanyMap.entries())
      .map(([id, count]) => ({ company_id: id, name: companyById.get(id) || id, count }))
      .sort((a, b) => b.count - a.count)

    // ─── Текучка за период ───────────────────────────────────────
    let hired = 0
    let dismissed = 0
    for (const e of audit) {
      if (e.action === 'create') hired++
      else if (e.action === 'dismiss') dismissed++
    }
    const turnover = { hired, dismissed, net: hired - dismissed, period_days: days }

    // ─── Средний стаж ────────────────────────────────────────────
    let opTenureSum = 0
    let opTenureCnt = 0
    for (const o of activeOperators) {
      const profile = profileById.get(o.id)
      const months = monthsBetween(profile?.hire_date || null, today)
      if (months > 0) {
        opTenureSum += months
        opTenureCnt++
      }
    }
    let staffTenureSum = 0
    let staffTenureCnt = 0
    for (const s of activeStaff) {
      // hire_date в staff отсутствует — используем created_at как fallback
      const months = monthsBetween(s.created_at || null, today)
      if (months > 0) {
        staffTenureSum += months
        staffTenureCnt++
      }
    }
    const tenure = {
      avg_months_operator: opTenureCnt > 0 ? Math.round(opTenureSum / opTenureCnt) : 0,
      avg_months_staff: staffTenureCnt > 0 ? Math.round(staffTenureSum / staffTenureCnt) : 0,
    }

    // ─── Скоро события (30 дней вперёд) ──────────────────────────
    const HORIZON = 30
    const birthdays: Array<{ name: string; date: string; days_until: number }> = []
    const anniversaries: Array<{ name: string; hire_date: string; years: number; days_until: number }> = []

    for (const o of activeOperators) {
      const profile = profileById.get(o.id)
      const name = profile?.full_name || o.name || ''
      if (profile?.birth_date) {
        const { days, next } = daysUntilNextOccurrence(profile.birth_date, today)
        if (days >= 0 && days <= HORIZON) {
          birthdays.push({ name, date: next.toISOString().slice(0, 10), days_until: days })
        }
      }
      if (profile?.hire_date) {
        const { days, next } = daysUntilNextOccurrence(profile.hire_date, today)
        if (days >= 0 && days <= HORIZON && days > 0) {
          const years = next.getFullYear() - new Date(profile.hire_date).getFullYear()
          if (years > 0) {
            anniversaries.push({ name, hire_date: profile.hire_date, years, days_until: days })
          }
        }
      }
    }
    for (const s of activeStaff) {
      const name = s.full_name || s.short_name || ''
      if (s.created_at) {
        const hireProxy = String(s.created_at).slice(0, 10)
        const { days, next } = daysUntilNextOccurrence(hireProxy, today)
        if (days >= 0 && days <= HORIZON && days > 0) {
          const years = next.getFullYear() - new Date(hireProxy).getFullYear()
          if (years > 0) {
            anniversaries.push({ name, hire_date: hireProxy, years, days_until: days })
          }
        }
      }
    }
    birthdays.sort((a, b) => a.days_until - b.days_until)
    anniversaries.sort((a, b) => a.days_until - b.days_until)

    // ─── Issues: операторы без логина ────────────────────────────
    const opIdsWithAuth = new Set(authRows.filter((a) => a.is_active).map((a) => a.operator_id))
    const noLogin = activeOperators
      .filter((o) => !opIdsWithAuth.has(o.id))
      .map((o) => ({ id: o.id, name: o.name || profileById.get(o.id)?.full_name || '—' }))

    return json({
      headcount,
      byRole,
      byCompany,
      turnover,
      tenure,
      upcoming: { birthdays, anniversaries },
      issues: { no_login: noLogin },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/hr/analytics GET',
      message: error?.message || 'analytics failed',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
