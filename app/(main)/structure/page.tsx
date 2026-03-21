'use client'

import React, { useEffect, useMemo, useState } from 'react'
import {
  BriefcaseBusiness,
  Building2,
  Crown,
  Loader2,
  Mail,
  Network,
  PencilLine,
  Phone,
  Plus,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getOperatorDisplayName } from '@/lib/core/operator-name'

type StaffRole = 'owner' | 'manager' | 'marketer'
type CompanyOperatorRole = 'operator' | 'senior_operator' | 'senior_cashier'

type StaffMember = {
  id: string
  full_name: string | null
  short_name: string | null
  role: StaffRole
  monthly_salary: number | null
  phone: string | null
  email: string | null
  is_active: boolean
}

type Company = {
  id: string
  name: string
  code: string | null
}

type Operator = {
  id: string
  name: string
  short_name: string | null
  is_active: boolean
  telegram_chat_id: string | null
  operator_profiles?: Array<{
    full_name?: string | null
    phone?: string | null
    email?: string | null
    position?: string | null
    photo_url?: string | null
    hire_date?: string | null
  }> | null
}

type Assignment = {
  id: string
  operator_id: string
  company_id: string
  role_in_company: CompanyOperatorRole
  is_primary: boolean
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

type CareerLink = {
  id: string
  operator_id: string
  staff_id: string
  assigned_role: StaffRole | 'other'
  assigned_at: string
  updated_at: string
  operator?: {
    id: string
    name: string
    short_name: string | null
    operator_profiles?: Array<{
      full_name?: string | null
      hire_date?: string | null
      position?: string | null
    }> | null
  } | null
  staff?: {
    id: string
    full_name: string | null
    short_name: string | null
    role: StaffRole | 'other'
    monthly_salary: number | null
    is_active: boolean
  } | null
}

type AssignmentEditorRow = {
  id?: string
  company_id: string
  role_in_company: CompanyOperatorRole
  is_primary: boolean
  is_active: boolean
  notes: string
}

type StructureResponse = {
  ok: boolean
  data?: {
    staff: StaffMember[]
    companies: Company[]
    operators: Operator[]
    assignments: Assignment[]
    careerLinks: CareerLink[]
  }
  error?: string
}

const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  owner: 'Владелец',
  manager: 'Руководитель',
  marketer: 'Маркетолог',
}

const COMPANY_ROLE_LABEL: Record<CompanyOperatorRole, string> = {
  operator: 'Оператор',
  senior_operator: 'Старший оператор',
  senior_cashier: 'Старший кассир',
}

function formatMoney(value: number | null | undefined) {
  if (value == null) return 'Не задан'
  return `${Number(value).toLocaleString('ru-RU')} ₸`
}

function getPersonName(person: { full_name?: string | null; short_name?: string | null; name?: string | null }) {
  return person.full_name?.trim() || person.name?.trim() || person.short_name?.trim() || 'Без имени'
}

function getCompanyLeadTitle(company: Company) {
  return (company.code || '').toLowerCase() === 'ramen' ? 'Старший кассир' : 'Старший оператор'
}

function getStaffRoleLabel(role: StaffRole | 'other') {
  if (role === 'other') return 'Сотрудник'
  return STAFF_ROLE_LABEL[role]
}

function formatTenure(hireDate?: string | null) {
  if (!hireDate) return 'Стаж не указан'
  const start = new Date(`${hireDate}T00:00:00`)
  const now = new Date()
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  if (months < 0) months = 0
  const years = Math.floor(months / 12)
  const restMonths = months % 12
  if (years > 0 && restMonths > 0) return `${years} г ${restMonths} мес`
  if (years > 0) return `${years} г`
  return `${restMonths || 1} мес`
}

function StaffNode({ member, tone }: { member: StaffMember; tone: 'owner' | 'manager' | 'marketer' }) {
  const toneClass =
    tone === 'owner'
      ? 'from-amber-500/20 to-orange-500/15 border-amber-500/20'
      : tone === 'manager'
        ? 'from-cyan-500/15 to-blue-500/10 border-cyan-500/20'
        : 'from-pink-500/15 to-fuchsia-500/10 border-pink-500/20'

  return (
    <Card className={`border bg-gradient-to-br ${toneClass} p-5 text-white shadow-[0_18px_44px_rgba(0,0,0,0.18)]`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{STAFF_ROLE_LABEL[member.role]}</p>
          <h3 className="mt-2 text-lg font-semibold tracking-[-0.02em]">{getPersonName(member)}</h3>
          <p className="mt-1 text-sm text-slate-400">{member.short_name || 'Сотрудник админ-команды'}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
          {member.role === 'owner' ? <Crown className="h-5 w-5 text-amber-300" /> : <ShieldCheck className="h-5 w-5 text-cyan-300" />}
        </div>
      </div>

      <div className="mt-4 space-y-2 text-sm text-slate-300">
        {member.phone ? (
          <div className="flex items-center gap-2">
            <Phone className="h-3.5 w-3.5 text-slate-500" />
            <span>{member.phone}</span>
          </div>
        ) : null}
        {member.email ? (
          <div className="flex items-center gap-2">
            <Mail className="h-3.5 w-3.5 text-slate-500" />
            <span className="truncate">{member.email}</span>
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-2xl border border-white/8 bg-black/15 px-3 py-2 text-xs text-slate-400">
        Оклад: <span className="font-medium text-white">{formatMoney(member.monthly_salary)}</span>
      </div>
    </Card>
  )
}

function OperatorChip({
  operator,
  role,
  isPrimary,
  onEdit,
}: {
  operator: Operator
  role: CompanyOperatorRole
  isPrimary: boolean
  onEdit?: () => void
}) {
  const profile = operator.operator_profiles?.[0]
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">
            {getOperatorDisplayName({
              ...operator,
              full_name: profile?.full_name || null,
            })}
          </p>
          <p className="mt-1 text-xs text-slate-500">{COMPANY_ROLE_LABEL[role]}</p>
        </div>
        {isPrimary ? (
          <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-300">
            main
          </span>
        ) : null}
      </div>

      {(profile?.phone || profile?.email) ? (
        <div className="mt-3 space-y-1 text-xs text-slate-400">
          {profile?.phone ? <div>{profile.phone}</div> : null}
          {profile?.email ? <div className="truncate">{profile.email}</div> : null}
        </div>
      ) : null}

      {onEdit ? (
        <Button variant="ghost" size="sm" className="mt-3 h-8 w-full justify-center" onClick={onEdit}>
          <PencilLine className="mr-2 h-3.5 w-3.5" />
          Изменить точку
        </Button>
      ) : null}
    </div>
  )
}

function CompanyBranch({
  company,
  assignments,
  operatorsById,
  onEditOperator,
}: {
  company: Company
  assignments: Assignment[]
  operatorsById: Map<string, Operator>
  onEditOperator: (operator: Operator) => void
}) {
  const leadAssignments = assignments.filter((item) => item.role_in_company !== 'operator')
  const operatorAssignments = assignments.filter((item) => item.role_in_company === 'operator')

  return (
    <Card className="border-white/10 bg-slate-950/65 p-5 text-white shadow-[0_18px_48px_rgba(0,0,0,0.22)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-400">
            <Building2 className="h-3.5 w-3.5" />
            {company.code || 'точка'}
          </div>
          <h3 className="mt-3 text-xl font-semibold tracking-[-0.03em] text-white">{company.name}</h3>
          <p className="mt-1 text-sm text-slate-400">{getCompanyLeadTitle(company)}</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-2 text-right">
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Операторов</div>
          <div className="mt-1 text-xl font-semibold text-white">{assignments.length}</div>
        </div>
      </div>

      <div className="mt-5">
        <p className="mb-3 text-xs uppercase tracking-[0.18em] text-slate-500">{getCompanyLeadTitle(company)}</p>
        {leadAssignments.length > 0 ? (
          <div className="space-y-3">
            {leadAssignments.map((assignment) => {
              const operator = operatorsById.get(assignment.operator_id)
              if (!operator) return null
              return (
                <OperatorChip
                  key={assignment.id}
                  operator={operator}
                  role={assignment.role_in_company}
                  isPrimary={assignment.is_primary}
                  onEdit={() => onEditOperator(operator)}
                />
              )
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            Старшая роль пока не назначена.
          </div>
        )}
      </div>

      <div className="mt-5">
        <p className="mb-3 text-xs uppercase tracking-[0.18em] text-slate-500">Операторы точки</p>
        {operatorAssignments.length > 0 ? (
          <div className="space-y-3">
            {operatorAssignments.map((assignment) => {
              const operator = operatorsById.get(assignment.operator_id)
              if (!operator) return null
              return (
                <OperatorChip
                  key={assignment.id}
                  operator={operator}
                  role={assignment.role_in_company}
                  isPrimary={assignment.is_primary}
                  onEdit={() => onEditOperator(operator)}
                />
              )
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-slate-500">
            Операторы по этой точке ещё не назначены.
          </div>
        )}
      </div>
    </Card>
  )
}

// ===================== ORG CHART =====================

function OrgNode({
  label,
  name,
  sub,
  color,
  icon,
  size = 'md',
}: {
  label: string
  name: string
  sub?: string
  color: 'amber' | 'violet' | 'cyan' | 'emerald' | 'slate'
  icon?: React.ReactNode
  size?: 'lg' | 'md' | 'sm'
}) {
  const colorMap = {
    amber:   'border-amber-400/40 bg-gradient-to-br from-amber-500/20 to-orange-500/10 shadow-amber-500/10',
    violet:  'border-violet-400/40 bg-gradient-to-br from-violet-500/20 to-purple-500/10 shadow-violet-500/10',
    cyan:    'border-cyan-400/40 bg-gradient-to-br from-cyan-500/20 to-blue-500/10 shadow-cyan-500/10',
    emerald: 'border-emerald-400/40 bg-gradient-to-br from-emerald-500/20 to-teal-500/10 shadow-emerald-500/10',
    slate:   'border-white/10 bg-white/[0.04] shadow-black/20',
  }
  const labelColor = {
    amber: 'text-amber-400', violet: 'text-violet-400', cyan: 'text-cyan-400',
    emerald: 'text-emerald-400', slate: 'text-slate-500',
  }
  const sizeMap = {
    lg: 'min-w-[160px] px-5 py-4',
    md: 'min-w-[140px] px-4 py-3',
    sm: 'min-w-[128px] px-3 py-2.5',
  }
  return (
    <div className={`rounded-2xl border shadow-lg text-center ${colorMap[color]} ${sizeMap[size]}`}>
      {icon && <div className="flex justify-center mb-1.5">{icon}</div>}
      <div className={`text-[9px] uppercase tracking-[0.18em] font-semibold mb-1 ${labelColor[color]}`}>{label}</div>
      <div className={`font-bold text-white leading-tight ${size === 'lg' ? 'text-base' : size === 'md' ? 'text-sm' : 'text-xs'}`}>{name}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  )
}

function VLine({ height = 8 }: { height?: number }) {
  return <div className="w-px bg-white/15 self-center" style={{ height: height * 4 }} />
}

function HBranch({ count }: { count: number }) {
  if (count === 1) return <div className="w-px h-6 bg-white/15 self-center" />
  return (
    <div className="relative flex justify-center" style={{ width: '100%' }}>
      <div className="absolute top-0 left-1/2 w-px bg-white/15" style={{ height: 12 }} />
      <div className="absolute border-t border-white/15" style={{ top: 12, left: '12.5%', right: '12.5%' }} />
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex-1 flex justify-center">
          <div className="w-px bg-white/15" style={{ height: 12, marginTop: 12 }} />
        </div>
      ))}
    </div>
  )
}

function OrgChart({
  owners,
  managers,
  marketers,
  companies,
  assignments,
  operatorsById,
}: {
  owners: StaffMember[]
  managers: StaffMember[]
  marketers: StaffMember[]
  companies: Company[]
  assignments: Assignment[]
  operatorsById: Map<string, Operator>
}) {
  const activeCompanies = companies.filter(c =>
    assignments.some(a => a.company_id === c.id && a.is_active)
  )

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold text-white flex items-center gap-2">
        <Network className="h-5 w-5 text-cyan-300" />
        Организационная схема
      </h2>

      <div className="overflow-x-auto pb-6">
        <div className="flex flex-col items-center min-w-max mx-auto px-4">

          {/* ── Level 1: Owners ── */}
          {owners.length > 0 && (
            <div className="flex gap-4">
              {owners.map(o => (
                <OrgNode
                  key={o.id}
                  label="Владелец"
                  name={getPersonName(o)}
                  color="amber"
                  size="lg"
                  icon={<Crown className="h-4 w-4 text-amber-400" />}
                />
              ))}
            </div>
          )}

          {/* connector owner → managers */}
          {owners.length > 0 && (managers.length > 0 || marketers.length > 0) && (
            <VLine height={7} />
          )}

          {/* ── Level 2: Managers + Marketers ── */}
          {(managers.length > 0 || marketers.length > 0) && (
            <div className="flex items-start gap-4">

              {/* Managers column */}
              {managers.length > 0 && (
                <div className="flex flex-col items-center gap-0">
                  <div className="flex gap-3">
                    {managers.map(m => (
                      <OrgNode
                        key={m.id}
                        label="Руководитель"
                        name={getPersonName(m)}
                        color="violet"
                        size="md"
                        icon={<ShieldCheck className="h-3.5 w-3.5 text-violet-400" />}
                      />
                    ))}
                  </div>

                  {/* connector manager → companies */}
                  {activeCompanies.length > 0 && (
                    <>
                      <VLine height={7} />
                      {/* horizontal bridge */}
                      <div className="relative flex" style={{ width: activeCompanies.length * 188 }}>
                        <div
                          className="absolute border-t-2 border-white/15 rounded-sm"
                          style={{
                            top: 0,
                            left: activeCompanies.length === 1 ? '50%' : '8%',
                            right: activeCompanies.length === 1 ? '50%' : '8%',
                          }}
                        />
                        {activeCompanies.map((_, i) => (
                          <div key={i} className="flex-1 flex justify-center">
                            <div className="w-px bg-white/15" style={{ height: 28, marginTop: 1 }} />
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  {/* ── Level 3: Companies ── */}
                  {activeCompanies.length > 0 && (
                    <div className="flex items-start gap-5">
                      {activeCompanies.map(company => {
                        const compAssignments = assignments.filter(
                          a => a.company_id === company.id && a.is_active,
                        )
                        const leads = compAssignments.filter(a => a.role_in_company !== 'operator')
                        const ops = compAssignments.filter(a => a.role_in_company === 'operator')
                        const totalPeople = compAssignments.length

                        return (
                          <div key={company.id} className="flex flex-col items-center gap-0">
                            {/* Company box */}
                            <OrgNode
                              label={company.code || 'точка'}
                              name={company.name}
                              sub={`${totalPeople} чел.`}
                              color="cyan"
                              size="md"
                            />

                            {/* connector company → people */}
                            {compAssignments.length > 0 && (
                              <>
                                <VLine height={6} />
                                {/* Leads */}
                                {leads.length > 0 && (
                                  <div className="flex flex-col items-center gap-1.5">
                                    {leads.map(a => {
                                      const op = operatorsById.get(a.operator_id)
                                      if (!op) return null
                                      return (
                                        <OrgNode
                                          key={a.id}
                                          label={COMPANY_ROLE_LABEL[a.role_in_company]}
                                          name={getOperatorDisplayName(op)}
                                          color="emerald"
                                          size="sm"
                                        />
                                      )
                                    })}
                                    {ops.length > 0 && <VLine height={4} />}
                                  </div>
                                )}
                                {/* Operators */}
                                {ops.length > 0 && (
                                  <div className="flex flex-col items-center gap-1.5">
                                    {ops.map(a => {
                                      const op = operatorsById.get(a.operator_id)
                                      if (!op) return null
                                      return (
                                        <OrgNode
                                          key={a.id}
                                          label="Оператор"
                                          name={getOperatorDisplayName(op)}
                                          color="slate"
                                          size="sm"
                                        />
                                      )
                                    })}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Divider between managers and marketers */}
              {managers.length > 0 && marketers.length > 0 && (
                <div className="flex flex-col items-center justify-center pt-3 px-2">
                  <div className="h-px w-8 bg-white/10" />
                </div>
              )}

              {/* Marketers column */}
              {marketers.length > 0 && (
                <div className="flex flex-col items-center pt-0">
                  <div className="flex flex-col gap-2">
                    {marketers.map(m => (
                      <OrgNode
                        key={m.id}
                        label="Маркетолог"
                        name={getPersonName(m)}
                        color="violet"
                        size="md"
                        icon={<Sparkles className="h-3.5 w-3.5 text-violet-400" />}
                      />
                    ))}
                  </div>
                  <div className="mt-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2 text-center max-w-[140px]">
                    <div className="text-[9px] text-slate-600 uppercase tracking-widest mb-1">Зона ответственности</div>
                    <div className="text-[10px] text-slate-400 leading-relaxed">Задачи и маркетинг</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {owners.length === 0 && managers.length === 0 && marketers.length === 0 && (
            <div className="text-slate-500 text-sm py-12 text-center">
              Нет данных о сотрудниках для отображения схемы
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export default function StructurePage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [careerLinks, setCareerLinks] = useState<CareerLink[]>([])
  const [editingOperator, setEditingOperator] = useState<Operator | null>(null)
  const [editorRows, setEditorRows] = useState<AssignmentEditorRow[]>([])
  const [savingAssignments, setSavingAssignments] = useState(false)
  const [companyFilter, setCompanyFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState<'all' | CompanyOperatorRole>('all')
  const [viewMode, setViewMode] = useState<'tree' | 'career' | 'schema'>('tree')

  useEffect(() => {
    let ignore = false

    const loadStructure = async () => {
      try {
        setLoading(true)
        setError(null)

        const response = await fetch('/api/admin/structure', { cache: 'no-store' }).catch(() => null)
        const json = (await response?.json().catch(() => null)) as StructureResponse | null
        if (ignore) return

        if (!response?.ok || !json?.ok || !json.data) {
          setError(json?.error || 'Не удалось загрузить структуру')
          return
        }

        setStaff(json.data.staff || [])
        setCompanies(json.data.companies || [])
        setOperators(json.data.operators || [])
        setAssignments(json.data.assignments || [])
        setCareerLinks((json.data.careerLinks || []) as CareerLink[])
      } catch (loadError: any) {
        if (!ignore) setError(loadError?.message || 'Не удалось загрузить структуру')
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    loadStructure()
    return () => {
      ignore = true
    }
  }, [])

  const owners = useMemo(() => staff.filter((member) => member.role === 'owner'), [staff])
  const managers = useMemo(() => staff.filter((member) => member.role === 'manager'), [staff])
  const marketers = useMemo(() => staff.filter((member) => member.role === 'marketer'), [staff])
  const operatorsById = useMemo(() => new Map(operators.map((operator) => [operator.id, operator])), [operators])
  const companiesById = useMemo(() => new Map(companies.map((company) => [company.id, company])), [companies])
  const assignmentsByCompany = useMemo(() => {
    const map = new Map<string, Assignment[]>()
    for (const assignment of assignments) {
      if (companyFilter !== 'all' && assignment.company_id !== companyFilter) continue
      if (roleFilter !== 'all' && assignment.role_in_company !== roleFilter) continue
      const bucket = map.get(assignment.company_id) || []
      bucket.push(assignment)
      map.set(assignment.company_id, bucket)
    }
    return map
  }, [assignments, companyFilter, roleFilter])
  const visibleCompanies = useMemo(
    () => companies.filter((company) => companyFilter === 'all' || company.id === companyFilter),
    [companies, companyFilter],
  )
  const leadRoster = useMemo(() => {
    return assignments
      .filter((assignment) => assignment.role_in_company !== 'operator')
      .map((assignment) => {
        const operator = operatorsById.get(assignment.operator_id)
        const company = companiesById.get(assignment.company_id)
        return {
          assignment,
          operator,
          company,
        }
      })
      .filter((item) => item.operator && item.company)
      .sort((a, b) => {
        const companyCompare = String(a.company?.name || '').localeCompare(String(b.company?.name || ''), 'ru')
        if (companyCompare !== 0) return companyCompare
        return String(a.operator?.name || '').localeCompare(String(b.operator?.name || ''), 'ru')
      })
  }, [assignments, operatorsById, companiesById])
  const openOperatorEditor = (operator: Operator) => {
    const rows = assignments
      .filter((assignment) => assignment.operator_id === operator.id)
      .slice(0, 2)
      .map((assignment) => ({
        id: assignment.id,
        company_id: assignment.company_id,
        role_in_company: assignment.role_in_company,
        is_primary: assignment.is_primary,
        is_active: assignment.is_active,
        notes: assignment.notes || '',
      }))

    setEditingOperator(operator)
    setEditorRows(rows.length > 0 ? rows : [{ company_id: '', role_in_company: 'operator', is_primary: true, is_active: true, notes: '' }])
  }

  const closeOperatorEditor = () => {
    if (savingAssignments) return
    setEditingOperator(null)
    setEditorRows([])
  }

  const saveOperatorAssignments = async () => {
    if (!editingOperator) return

    try {
      setSavingAssignments(true)
      const response = await fetch('/api/admin/operator-company-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveAssignments',
          operatorId: editingOperator.id,
          assignments: editorRows,
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || 'Не удалось сохранить структуру оператора')
      }

      const nextRows = (json.data || []) as Assignment[]
      setAssignments((prev) => [
        ...prev.filter((item) => item.operator_id !== editingOperator.id),
        ...nextRows.map((row: any) => ({
          id: row.id,
          operator_id: row.operator_id,
          company_id: row.company_id,
          role_in_company: row.role_in_company,
          is_primary: row.is_primary,
          is_active: row.is_active,
          notes: row.notes,
          created_at: row.created_at,
          updated_at: row.updated_at,
        })),
      ])
      closeOperatorEditor()
    } catch (saveError: any) {
      setError(saveError?.message || 'Не удалось сохранить структуру оператора')
    } finally {
      setSavingAssignments(false)
    }
  }

  return (
    <>
        <div className="app-page space-y-6">
          <Card className="overflow-hidden border-white/10 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_32%),linear-gradient(135deg,rgba(9,15,31,0.98),rgba(6,10,22,0.96))] p-6 text-white shadow-[0_24px_70px_rgba(0,0,0,0.3)] sm:p-8">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <div className="mb-4 inline-flex rounded-2xl bg-cyan-400/10 p-4">
                  <Network className="h-7 w-7 text-cyan-300" />
                </div>
                <h1 className="text-3xl font-semibold tracking-[-0.03em] text-white sm:text-4xl">Структура команды</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                  Здесь видно управленческую и операционную иерархию: кто отвечает за клуб в целом, кто ведёт маркетинг и кто является старшим по каждой точке.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 rounded-3xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Компаний</div>
                  <div className="mt-1 text-2xl font-semibold text-white">{companies.length}</div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Операторов</div>
                  <div className="mt-1 text-2xl font-semibold text-white">{operators.length}</div>
                </div>
              </div>
            </div>
          </Card>

          {loading ? (
            <Card className="border-white/10 bg-slate-950/65 p-8 text-white">
              <div className="flex items-center gap-3 text-slate-300">
                <Loader2 className="h-5 w-5 animate-spin text-cyan-300" />
                Загружаем оргструктуру...
              </div>
            </Card>
          ) : error ? (
            <Card className="border-rose-500/20 bg-rose-500/10 p-6 text-rose-100">
              {error}
            </Card>
          ) : (
            <>
              <Card className="border-white/10 bg-slate-950/60 p-4 text-white">
                <div className="flex flex-wrap gap-2">
                  <Button variant={viewMode === 'tree' ? 'default' : 'outline'} onClick={() => setViewMode('tree')}>
                    Древо точек
                  </Button>
                  <Button variant={viewMode === 'career' ? 'default' : 'outline'} onClick={() => setViewMode('career')}>
                    Карьерный рост
                  </Button>
                  <Button variant={viewMode === 'schema' ? 'default' : 'outline'} onClick={() => setViewMode('schema')}>
                    Схема
                  </Button>
                </div>
              </Card>

              {viewMode === 'schema' ? (
                <OrgChart
                  owners={owners}
                  managers={managers}
                  marketers={marketers}
                  companies={companies}
                  assignments={assignments}
                  operatorsById={operatorsById}
                />
              ) : viewMode === 'tree' ? (
                <>
              <Card className="border-white/10 bg-slate-950/60 p-4 text-white">
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-slate-500">Точка</label>
                    <select
                      value={companyFilter}
                      onChange={(event) => setCompanyFilter(event.target.value)}
                      className="h-10 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 text-sm text-white outline-none focus:border-cyan-400/50"
                    >
                      <option value="all">Все точки</option>
                      {companies.map((company) => (
                        <option key={company.id} value={company.id}>
                          {company.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-slate-500">Роль в точке</label>
                    <select
                      value={roleFilter}
                      onChange={(event) => setRoleFilter(event.target.value as 'all' | CompanyOperatorRole)}
                      className="h-10 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 text-sm text-white outline-none focus:border-cyan-400/50"
                    >
                      <option value="all">Все роли</option>
                      <option value="operator">Оператор</option>
                      <option value="senior_operator">Старший оператор</option>
                      <option value="senior_cashier">Старший кассир</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        setCompanyFilter('all')
                        setRoleFilter('all')
                      }}
                    >
                      Сбросить фильтры
                    </Button>
                  </div>
                </div>
              </Card>

              <section className="space-y-4">
                <div className="flex items-center gap-2">
                  <Crown className="h-5 w-5 text-amber-300" />
                  <h2 className="text-xl font-semibold text-white">Управленческий контур</h2>
                </div>

                {owners.length > 0 ? (
                  <div className="grid gap-4 lg:grid-cols-1">
                    {owners.map((member) => (
                      <StaffNode key={member.id} member={member} tone="owner" />
                    ))}
                  </div>
                ) : null}

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-white">
                      <BriefcaseBusiness className="h-4 w-4 text-cyan-300" />
                      <h3 className="font-semibold">Руководители</h3>
                    </div>
                    {managers.length > 0 ? (
                      <div className="space-y-4">
                        {managers.map((member) => (
                          <StaffNode key={member.id} member={member} tone="manager" />
                        ))}
                      </div>
                    ) : (
                      <Card className="border-dashed border-white/10 bg-slate-950/40 p-5 text-sm text-slate-500">
                        Руководитель пока не назначен.
                      </Card>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-white">
                      <Sparkles className="h-4 w-4 text-pink-300" />
                      <h3 className="font-semibold">Маркетинг</h3>
                    </div>
                    {marketers.length > 0 ? (
                      <div className="space-y-4">
                        {marketers.map((member) => (
                          <StaffNode key={member.id} member={member} tone="marketer" />
                        ))}
                      </div>
                    ) : (
                      <Card className="border-dashed border-white/10 bg-slate-950/40 p-5 text-sm text-slate-500">
                        Маркетолог пока не назначен.
                      </Card>
                    )}
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-cyan-300" />
                  <h2 className="text-xl font-semibold text-white">Операционная структура по точкам</h2>
                </div>

                <div className="grid gap-5 xl:grid-cols-3">
                  {visibleCompanies.map((company) => (
                    <CompanyBranch
                      key={company.id}
                      company={company}
                      assignments={assignmentsByCompany.get(company.id) || []}
                      operatorsById={operatorsById}
                      onEditOperator={openOperatorEditor}
                    />
                  ))}
                </div>
              </section>

                </>
              ) : (
                <section className="space-y-5">
                  <div className="grid gap-4 xl:grid-cols-2">
                    <Card className="border-white/10 bg-slate-950/60 p-5 text-white">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="h-5 w-5 text-cyan-300" />
                        <h2 className="text-xl font-semibold">Старшие по точкам</h2>
                      </div>
                      <div className="mt-4 space-y-3">
                        {leadRoster.length > 0 ? (
                          leadRoster.map(({ assignment, operator, company }) => (
                            <div key={assignment.id} className="rounded-2xl border border-white/8 bg-black/20 p-4">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-base font-semibold text-white">
                                    {getOperatorDisplayName({
                                      ...(operator as Operator),
                                      full_name: operator?.operator_profiles?.[0]?.full_name || null,
                                    })}
                                  </div>
                                  <div className="mt-1 text-sm text-slate-400">
                                    {company?.name} • {COMPANY_ROLE_LABEL[assignment.role_in_company]}
                                  </div>
                                </div>
                                {assignment.is_primary ? (
                                  <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-cyan-300">
                                    main
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Должность</div>
                                  <div className="mt-1 text-sm text-slate-200">
                                    {operator?.operator_profiles?.[0]?.position || 'Оператор точки'}
                                  </div>
                                </div>
                                <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Стаж</div>
                                  <div className="mt-1 text-sm text-slate-200">
                                    {formatTenure(operator?.operator_profiles?.[0]?.hire_date || null)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-sm text-slate-500">Старшие роли по точкам ещё не назначены.</div>
                        )}
                      </div>
                    </Card>

                    <Card className="border-white/10 bg-slate-950/60 p-5 text-white">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-pink-300" />
                        <h2 className="text-xl font-semibold">Рост в staff</h2>
                      </div>
                      <div className="mt-4 space-y-3">
                        {careerLinks.length > 0 ? (
                          careerLinks.map((link) => (
                            <div key={link.id} className="rounded-2xl border border-white/8 bg-black/20 p-4">
                              <div className="text-base font-semibold text-white">
                                {getOperatorDisplayName({
                                  id: link.operator?.id || '',
                                  name: link.operator?.name || 'Оператор',
                                  short_name: link.operator?.short_name || null,
                                  full_name: link.operator?.operator_profiles?.[0]?.full_name || null,
                                } as any)}
                              </div>
                              <div className="mt-1 text-sm text-slate-400">
                                Переведён в staff как {getStaffRoleLabel(link.assigned_role)}
                              </div>
                              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Дата повышения</div>
                                  <div className="mt-1 text-sm text-slate-200">
                                    {new Date(link.updated_at || link.assigned_at).toLocaleDateString('ru-RU')}
                                  </div>
                                </div>
                                <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
                                  <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Оклад staff</div>
                                  <div className="mt-1 text-sm text-slate-200">{formatMoney(link.staff?.monthly_salary)}</div>
                                </div>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-sm text-slate-500">Переходов из оператора в staff пока нет.</div>
                        )}
                      </div>
                    </Card>
                  </div>

                </section>
              )}
            </>
          )}
        </div>

      {editingOperator ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <Card className="w-full max-w-3xl border-white/10 bg-slate-950/96 p-6 text-white shadow-[0_24px_80px_rgba(0,0,0,0.5)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Редактор дерева</div>
                <h3 className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
                  {getOperatorDisplayName({
                    ...editingOperator,
                    full_name: editingOperator.operator_profiles?.[0]?.full_name || null,
                  })}
                </h3>
                <p className="mt-2 text-sm text-slate-400">
                  Назначьте оператору до двух точек и укажите роль внутри каждой точки прямо из структуры.
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={closeOperatorEditor} disabled={savingAssignments}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-6 space-y-4">
              {editorRows.map((row, index) => (
                <div key={`${row.id || 'new'}-${index}`} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-slate-500">Точка</label>
                      <select
                        value={row.company_id}
                        onChange={(event) =>
                          setEditorRows((prev) =>
                            prev.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, company_id: event.target.value } : item,
                            ),
                          )
                        }
                        className="h-10 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 text-sm text-white outline-none focus:border-cyan-400/50"
                      >
                        <option value="">Выберите точку</option>
                        {companies.map((company) => (
                          <option key={company.id} value={company.id}>
                            {company.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="mb-2 block text-xs uppercase tracking-[0.16em] text-slate-500">Роль</label>
                      <select
                        value={row.role_in_company}
                        onChange={(event) =>
                          setEditorRows((prev) =>
                            prev.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, role_in_company: event.target.value as CompanyOperatorRole } : item,
                            ),
                          )
                        }
                        className="h-10 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 text-sm text-white outline-none focus:border-cyan-400/50"
                      >
                        <option value="operator">Оператор</option>
                        <option value="senior_operator">Старший оператор</option>
                        <option value="senior_cashier">Старший кассир</option>
                      </select>
                    </div>

                    <label className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-900/70 px-3 text-sm text-slate-200">
                      <input
                        type="checkbox"
                        checked={row.is_primary}
                        onChange={(event) =>
                          setEditorRows((prev) =>
                            prev.map((item, itemIndex) => ({
                              ...item,
                              is_primary: itemIndex === index ? event.target.checked : event.target.checked ? false : item.is_primary,
                            })),
                          )
                        }
                      />
                      Основная точка
                    </label>

                    <div className="flex items-center justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditorRows((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
                        disabled={editorRows.length === 1}
                      >
                        Удалить
                      </Button>
                    </div>
                  </div>

                  <textarea
                    value={row.notes}
                    onChange={(event) =>
                      setEditorRows((prev) =>
                        prev.map((item, itemIndex) => (itemIndex === index ? { ...item, notes: event.target.value } : item)),
                      )
                    }
                    rows={2}
                    placeholder="Комментарий по роли или точке"
                    className="mt-3 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-cyan-400/50"
                  />
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                variant="outline"
                onClick={() =>
                  setEditorRows((prev) =>
                    prev.length >= 2
                      ? prev
                      : [...prev, { company_id: '', role_in_company: 'operator', is_primary: prev.length === 0, is_active: true, notes: '' }],
                  )
                }
                disabled={editorRows.length >= 2 || savingAssignments}
              >
                <Plus className="mr-2 h-4 w-4" />
                Добавить точку
              </Button>

              <div className="ml-auto flex flex-wrap gap-3">
                <Button variant="ghost" onClick={closeOperatorEditor} disabled={savingAssignments}>
                  Отмена
                </Button>
                <Button onClick={saveOperatorAssignments} disabled={savingAssignments}>
                  {savingAssignments ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Сохранить дерево
                </Button>
              </div>
            </div>
          </Card>
        </div>
      ) : null}
    </>
  )
}
