'use client'

import { FormEvent, Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { downloadReportPdf } from '@/lib/client/download-pdf'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { useCashlessLabels } from '@/lib/client/use-cashless-labels'
import { useModalEscape } from '@/lib/client/use-modal-escape'
import Image from 'next/image'
import Link from 'next/link'
import { Building2, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, CreditCard, DollarSign, Download, Loader2, MessageCircle, Pencil, Plus, RefreshCw, Send, TrendingDown, Users, Wallet, X } from 'lucide-react'

import { AdminPageHeader, AdminTableViewport, adminTableStickyTheadClass } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { addDaysISO, formatRuDate, mondayOfDate, toISODateLocal, todayISO } from '@/lib/core/date'
import { formatMoney } from '@/lib/core/format'
import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { getStaffRoleLabel } from '@/lib/core/access'

type CompanyOption = { id: string; code: string | null; name: string | null }
type Allocation = { companyId: string; companyCode: string | null; companyName: string | null; accruedAmount: number; bonusAmount: number; fineAmount: number; debtAmount: number; advanceAmount: number; netAmount: number; shareRatio: number }
type Payment = {
  id: string
  payment_date: string
  cash_amount: number
  kaspi_amount: number
  total_amount: number
  comment: string | null
  status: string
  created_at?: string | null
}
type OperatorTimelineEventKind = 'week_total' | 'payment' | 'bonus' | 'fine' | 'debt' | 'advance'
type OperatorTimelineEvent = {
  id: string
  operator_id: string
  operator_name: string
  date: string
  created_at?: string | null
  kind: OperatorTimelineEventKind
  amount: number
  comment: string | null
  status: 'active' | 'voided'
}
type ShiftBreakdown = { id: string; date: string; shift: string; companyCode: string | null; companyName: string | null; totalIncome: number; baseSalary: number; seniorityBonus?: number; seniorityPercent?: number; autoBonus: number; roleBonus: number; salary: number }

// ─── Admin staff salary types ─────────────────────────────────────────────────
type StaffMember = { id: string; full_name: string; short_name: string | null; role: string; monthly_salary: number; extra_day_company_code: string | null; extra_day_shift_type: string | null; telegram_chat_id: string | null; source_type?: 'staff' | 'operator'; is_active?: boolean; dismissed_at?: string | null; dismissal_date?: string | null }
type StaffAdjustment = {
  id: string
  staff_id: string
  kind: 'debt' | 'fine' | 'bonus' | 'advance'
  amount: number
  date: string
  comment: string | null
  status: string
  created_at?: string | null
  closed_by_payment_id?: string | null
  source_payment_id?: string | null
  closed_at?: string | null
}
type StaffPayment = { id: string; staff_id: string; pay_date: string; slot: string; amount: number; comment: string | null; created_at?: string | null }
type StaffTimelineEvent = {
  id: string
  date: string
  created_at?: string | null
  kind: 'payment' | 'bonus' | 'fine' | 'debt' | 'advance'
  amount: number
  comment: string | null
  status?: string
}
type StaffDebtPayment = { id: string; staff_id: string; amount: number; comment: string | null; paid_at: string; status: string }
type StaffSalaryData = {
  can_edit?: boolean
  staff: StaffMember[]
  adjustments: StaffAdjustment[]
  payments: StaffPayment[]
  debtPayments?: StaffDebtPayment[]
  salaryRules: { company_code: string; shift_type: string; base_per_shift: number }[]
  consistency?: {
    has_issues: boolean
    missing_payment_expense_count: number
    orphan_payment_expense_count: number
    missing_advance_expense_count: number
    orphan_advance_expense_count: number
  }
}

function getSalarySlotRange(payDate: string, slot: 'first' | 'second' | 'extra') {
  const [yearRaw, monthRaw] = String(payDate || '').split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null
  const mm = String(month).padStart(2, '0')
  const endDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (slot === 'first') return { from: `${year}-${mm}-01`, to: `${year}-${mm}-15` }
  // extra (доплата остатка) — учитываем корректировки за весь месяц.
  if (slot === 'extra') return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(endDay).padStart(2, '0')}` }
  return { from: `${year}-${mm}-16`, to: `${year}-${mm}-${String(endDay).padStart(2, '0')}` }
}

function getStaffPaymentAdjustmentPeriod(payDate: string, slot: 'first' | 'second' | 'extra') {
  const slotRange = getSalarySlotRange(payDate, slot)
  if (!slotRange) return null
  const payDateValue = String(payDate || '')
  const cutoff = /^\d{4}-\d{2}-\d{2}$/.test(payDateValue) ? payDateValue : slotRange.to
  return { from: slotRange.from, to: cutoff }
}

function monthPrefixFromIsoDate(isoDate: string) {
  return isoDate.slice(0, 7)
}

function monthPrefixFromPaymentDate(paymentDate: string | null | undefined) {
  return String(paymentDate || '').slice(0, 7)
}

function staffPaymentSlotLabel(slot: string | null | undefined) {
  if (slot === 'first') return 'выплата 1-го числа'
  if (slot === 'second') return 'выплата 15-го числа'
  if (slot === 'extra') return 'доплата остатка'
  return 'разово'
}

function getStaffPaymentClosingWindow(
  staffId: string,
  payments: StaffPayment[],
  payDate: string,
  currentPaymentId?: string | null,
) {
  const to = String(payDate || '')
  const previousPayment =
    payments
      .filter((p) => p.staff_id === staffId)
      .filter((p) => (currentPaymentId ? String(p.id) !== String(currentPaymentId) : true))
      .filter((p) => String(p.pay_date || '') <= to)
      .sort((a, b) => {
        const byDate = String(b.pay_date || '').localeCompare(String(a.pay_date || ''))
        if (byDate !== 0) return byDate
        return String(b.created_at || '').localeCompare(String(a.created_at || ''))
      })[0] || null

  if (!previousPayment) {
    return {
      from: '',
      to,
      label: to ? `до ${formatRuDate(to)}` : 'до даты выплаты',
      previousPayment,
    }
  }

  const nextDayAfterPrevious = addDaysISO(String(previousPayment.pay_date || ''), 1)
  const from = nextDayAfterPrevious && nextDayAfterPrevious <= to ? nextDayAfterPrevious : to
  return {
    from,
    to,
    label: `${formatRuDate(from)} - ${formatRuDate(to)}`,
    previousPayment,
  }
}

function isStaffAdjustmentInsideClosingWindow(
  adj: StaffAdjustment,
  closingWindow: ReturnType<typeof getStaffPaymentClosingWindow>,
) {
  const date = String(adj.date || '')
  if (!date || date > closingWindow.to) return false
  if (closingWindow.from && date < closingWindow.from) return false
  return true
}

function getStaffPaymentClosedAdjustments(params: {
  staffId: string
  adjustments: StaffAdjustment[]
  payment: StaffPayment
  closingWindow: ReturnType<typeof getStaffPaymentClosingWindow>
}) {
  const paymentId = String(params.payment.id)
  const seen = new Set<string>()
  const result: StaffAdjustment[] = []

  for (const adj of params.adjustments) {
    if (adj.staff_id !== params.staffId) continue
    const linkedToPayment = String(adj.closed_by_payment_id || '') === paymentId
    const paidInsideWindow =
      !adj.closed_by_payment_id &&
      String(adj.status || '') === 'paid' &&
      isStaffAdjustmentInsideClosingWindow(adj, params.closingWindow)

    if (!linkedToPayment && !paidInsideWindow) continue
    if (seen.has(String(adj.id))) continue
    seen.add(String(adj.id))
    result.push(adj)
  }

  return result.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')))
}

function getStaffPaymentGeneratedAdjustments(params: {
  staffId: string
  adjustments: StaffAdjustment[]
  payment: StaffPayment
}) {
  const paymentId = String(params.payment.id)
  const paymentDate = String(params.payment.pay_date || '')
  return params.adjustments.filter((adj) => {
    if (adj.staff_id !== params.staffId) return false
    if (String(adj.source_payment_id || '') === paymentId) return true
    if (adj.source_payment_id) return false
    return (
      adj.kind === 'advance' &&
      String(adj.status || '') === 'active' &&
      String(adj.date || '') === paymentDate &&
      String(adj.comment || '').includes(`Переплата по выплате ${paymentDate}`)
    )
  })
}

function filterStaffAdjustmentsForSlot(
  adjs: StaffAdjustment[],
  staffId: string,
  payments: StaffPayment[],
  period?: { from: string; to: string } | null,
) {
  const periodEnd = period?.to || '9999-12-31'
  const lastPayment =
    payments
      .filter((p) => p.staff_id === staffId && String(p.pay_date || '') <= periodEnd)
      .sort((a, b) => {
        const byDate = String(b.pay_date || '').localeCompare(String(a.pay_date || ''))
        if (byDate !== 0) return byDate
        return String(b.created_at || '').localeCompare(String(a.created_at || ''))
      })[0] || null

  return adjs.filter((a) => {
    if (a.staff_id !== staffId || a.status !== 'active') return false
    if (!period) return true
    if (a.date > periodEnd) return false
    if (!lastPayment) return true
    const lastPayDate = String(lastPayment.pay_date || '')
    if (a.date < lastPayDate) return false
    if (a.date > lastPayDate) return true
    if (a.created_at && lastPayment.created_at) {
      return String(a.created_at) > String(lastPayment.created_at)
    }
    if (a.created_at && !lastPayment.created_at) return true
    if (!a.created_at && lastPayment.created_at) return false
    return true
  })
}

function calcStaffToPay(
  s: StaffMember,
  adjs: StaffAdjustment[],
  payments: StaffPayment[],
  period?: { from: string; to: string } | null,
) {
  const active = filterStaffAdjustmentsForSlot(adjs, s.id, payments, period)
  const half = Math.round(s.monthly_salary / 2)
  const bonuses = active.filter(a => a.kind === 'bonus').reduce((sum, a) => sum + a.amount, 0)
  const debts = active.filter(a => a.kind === 'debt').reduce((sum, a) => sum + a.amount, 0)
  const fines = active.filter(a => a.kind === 'fine').reduce((sum, a) => sum + a.amount, 0)
  const advances = active.filter(a => a.kind === 'advance').reduce((sum, a) => sum + a.amount, 0)
  return { half, bonuses, debts, fines, advances, toPay: half + bonuses - debts - fines - advances }
}

function staffAdjustmentKindLabel(kind: StaffAdjustment['kind']) {
  if (kind === 'bonus') return 'бонус'
  if (kind === 'advance') return 'аванс'
  if (kind === 'fine') return 'штраф'
  return 'долг'
}

function staffAdjustmentTone(kind: StaffAdjustment['kind']) {
  if (kind === 'bonus') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
  if (kind === 'advance') return 'border-amber-500/30 bg-amber-500/10 text-amber-300'
  return 'border-rose-500/30 bg-rose-500/10 text-rose-300'
}

function buildStaffTimelineEvents(params: {
  staffId: string
  adjustments: StaffAdjustment[]
  payments: StaffPayment[]
}) {
  const adjustmentEvents: StaffTimelineEvent[] = params.adjustments
    .filter((a) => a.staff_id === params.staffId)
    .map((a) => ({
      id: `adj:${a.id}`,
      date: a.date,
      created_at: a.created_at || null,
      kind: a.kind,
      amount: Number(a.amount || 0),
      comment: a.comment || null,
      status: a.status || 'active',
    }))
  const paymentEvents: StaffTimelineEvent[] = params.payments
    .filter((p) => p.staff_id === params.staffId)
    .map((p) => ({
      id: `pay:${p.id}`,
      date: p.pay_date,
      created_at: p.created_at || null,
      kind: 'payment',
      amount: Number(p.amount || 0),
      comment: p.comment || null,
      status: 'active',
    }))

  return [...adjustmentEvents, ...paymentEvents]
    .sort((a, b) => {
      const byDate = String(b.date || '').localeCompare(String(a.date || ''))
      if (byDate !== 0) return byDate
      return String(b.created_at || '').localeCompare(String(a.created_at || ''))
    })
    .slice(0, 12)
}

// Лейблы ролей идут из STAFF_ROLE_MATRIX. super_admin спецкейс (нет в матрице).
const formatRoleLabel = (code: string): string => code === 'super_admin' ? 'Супер-админ' : getStaffRoleLabel(code)
type WeeklyOperator = {
  operator: { id: string; name: string; short_name: string | null; full_name: string | null; is_active: boolean; telegram_chat_id: string | null; photo_url: string | null; position: string | null; documents_count: number; expiring_documents: number }
  week: { id: string; weekStart: string; weekEnd: string; grossAmount: number; bonusAmount: number; fineAmount: number; debtAmount: number; advanceAmount: number; netAmount: number; paidAmount: number; remainingAmount: number; status: 'draft' | 'partial' | 'paid'; companyAllocations: Allocation[]; payments: Payment[]; shiftsCount: number; autoBonusTotal: number; seniorityBonusTotal?: number; shifts: ShiftBreakdown[] }
  hasActivity: boolean
}
type SalaryData = { weekStart: string; weekEnd: string; companies: CompanyOption[]; operators: WeeklyOperator[]; totals: { netAmount: number; paidAmount: number; advanceAmount: number; remainingAmount: number; paidOperators: number; totalOperators: number } }
type AdjustmentKind = 'bonus' | 'fine' | 'debt'

const input = 'h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none'
const selectCls = 'h-11 w-full rounded-xl border border-white/10 bg-slate-900 px-3 text-sm text-white focus:border-emerald-400/40 focus:outline-none [color-scheme:dark]'
const textarea = 'min-h-[96px] w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none'
const money = formatMoney
const parseMoney = (v: string) => { const n = Number(v.replace(',', '.').replace(/\s/g, '')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0 }
const statusMeta = (s: WeeklyOperator['week']['status']) => s === 'paid' ? { label: 'Выплачено', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' } : s === 'partial' ? { label: 'Частично', className: 'border-amber-500/30 bg-amber-500/10 text-amber-300' } : { label: 'Не выплачено', className: 'border-slate-500/30 bg-slate-500/10 text-slate-300' }

function Modal(props: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  useModalEscape(true, props.onClose)
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-start sm:items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) props.onClose() }}
    >
      <div className="w-full max-w-xl my-8 max-h-[calc(100vh-4rem)] overflow-y-auto rounded-3xl border border-white/10 bg-[#10182b] p-6 shadow-2xl shadow-black/40">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold text-white">{props.title}</h3>
            {props.subtitle ? <p className="mt-1 text-sm text-slate-400">{props.subtitle}</p> : null}
          </div>
          <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-300 hover:bg-white/10" onClick={props.onClose}>Закрыть</Button>
        </div>
        {props.children}
      </div>
    </div>,
    document.body,
  )
}

export default function SalaryPage() {
  const cashLabels = useCashlessLabels()
  const { can } = useCapabilities()
  const canCreateAdvance = can('salary.create_advance')
  const canCreatePayment = can('salary.create_payment')
  const canCreateAdjustment = can('salary.create_adjustment')
  const canVoidPayment = can('salary.void_payment')
  const canUpdateChatId = can('salary.update_chat_id')
  // Доступ к вкладкам/действиям административных сотрудников
  const canViewStaffSalary = can('staff.view')
  const canStaffCreatePayment = can('staff.create_payment')
  const canStaffAddAdjustment = can('staff.add_adjustment')
  const canStaffAddExtraDay = can('staff.add_extra_day')

  const currentWeek = toISODateLocal(mondayOfDate(new Date()))
  const [weekStart, setWeekStart] = useState(currentWeek)
  const [data, setData] = useState<SalaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [showZero, setShowZero] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'all' | 'draft' | 'partial' | 'paid'>('all')
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [broadcastSending, setBroadcastSending] = useState(false)
  const [broadcastDone, setBroadcastDone] = useState(0)
  const [broadcastTotal, setBroadcastTotal] = useState(0)
  const [broadcastErrors, setBroadcastErrors] = useState<string[]>([])

  const [advanceTarget, setAdvanceTarget] = useState<WeeklyOperator | null>(null)
  const [advanceCompanyId, setAdvanceCompanyId] = useState('')
  const [advanceDate, setAdvanceDate] = useState(todayISO())
  const [advanceCash, setAdvanceCash] = useState('')
  const [advanceKaspi, setAdvanceKaspi] = useState('')
  const [advanceComment, setAdvanceComment] = useState('')
  const [advanceSaving, setAdvanceSaving] = useState(false)

  const [payTarget, setPayTarget] = useState<WeeklyOperator | null>(null)
  const [payDate, setPayDate] = useState(todayISO())
  const [payCash, setPayCash] = useState('')
  const [payKaspi, setPayKaspi] = useState('')
  const [payComment, setPayComment] = useState('')
  const [payAllowOverpayment, setPayAllowOverpayment] = useState(false)
  const [paySaving, setPaySaving] = useState(false)
  const [voidingPaymentId, setVoidingPaymentId] = useState<string | null>(null)

  const [chatTarget, setChatTarget] = useState<WeeklyOperator | null>(null)
  const [chatValue, setChatValue] = useState('')
  const [chatSaving, setChatSaving] = useState(false)

  const [adjOperatorId, setAdjOperatorId] = useState('')
  const [adjCompanyId, setAdjCompanyId] = useState('')
  const [adjDate, setAdjDate] = useState(todayISO())
  const [adjKind, setAdjKind] = useState<AdjustmentKind>('fine')
  const [adjAmount, setAdjAmount] = useState('')
  const [adjComment, setAdjComment] = useState('')
  const [adjSaving, setAdjSaving] = useState(false)
  const [adjSuccess, setAdjSuccess] = useState(false)
  const [broadcastConfirm, setBroadcastConfirm] = useState(false)

  const weekEnd = useMemo(() => addDaysISO(weekStart, 6), [weekStart])

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    if (!silent) setError(null)
    try {
      const res = await fetch(`/api/admin/salary?view=weekly&weekStart=${encodeURIComponent(weekStart)}`, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || `Ошибка загрузки (${res.status})`)
      setData(json.data as SalaryData)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить данные')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [weekStart])

  useEffect(() => { void load() }, [load])
  useEffect(() => { if (!error) return; const t = setTimeout(() => setError(null), 6000); return () => clearTimeout(t) }, [error])
  useEffect(() => { if (advanceTarget) { setAdvanceCompanyId(advanceTarget.week.companyAllocations[0]?.companyId || data?.companies[0]?.id || ''); setAdvanceDate(todayISO()); setAdvanceCash(''); setAdvanceKaspi(''); setAdvanceComment('') } }, [advanceTarget, data?.companies])
  useEffect(() => { if (payTarget) { setPayDate(todayISO()); setPayCash(String(Math.max(payTarget.week.remainingAmount, 0))); setPayKaspi(''); setPayComment(''); setPayAllowOverpayment(false) } }, [payTarget])
  useEffect(() => { if (chatTarget) setChatValue(chatTarget.operator.telegram_chat_id || '') }, [chatTarget])
  useEffect(() => { if (data?.operators.length) setAdjOperatorId((cur) => cur || data.operators[0].operator.id) }, [data?.operators])

  const operators = useMemo(() => {
    let list = data?.operators || []
    if (!showZero) list = list.filter((i) => i.hasActivity || i.week.remainingAmount > 0)
    if (statusFilter !== 'all') list = list.filter((i) => i.week.status === statusFilter)
    return list
  }, [data?.operators, showZero, statusFilter])
  const totalShifts = useMemo(
    () => (data?.operators || []).reduce((sum, item) => sum + item.week.shiftsCount, 0),
    [data?.operators],
  )
  const broadcastTargets = useMemo(() => (data?.operators || []).filter((i) => i.operator.is_active && i.operator.telegram_chat_id), [data?.operators])
  const summaryText = useMemo(() => { const top = [...(data?.operators || [])].sort((a, b) => b.week.remainingAmount - a.week.remainingAmount)[0]; return top && top.week.remainingAmount > 0 ? `Самый большой остаток у ${getOperatorDisplayName(top.operator)}: ${money(top.week.remainingAmount)}.` : 'На этой неделе остатки закрыты или ещё не сформированы.' }, [data?.operators])
  const [operatorEventsOperatorId, setOperatorEventsOperatorId] = useState<'all' | string>('all')
  const [operatorEventsKind, setOperatorEventsKind] = useState<'all' | OperatorTimelineEventKind>('all')
  const [operatorEventsStatus, setOperatorEventsStatus] = useState<'all' | 'active' | 'voided'>('all')
  const [operatorEventsQuery, setOperatorEventsQuery] = useState('')
  const [operatorEventsDateFrom, setOperatorEventsDateFrom] = useState('')
  const [operatorEventsDateTo, setOperatorEventsDateTo] = useState('')
  const [operatorEventsLimit, setOperatorEventsLimit] = useState(100)
  const operatorGlobalTimeline = useMemo(() => {
    const items: OperatorTimelineEvent[] = []
    for (const item of data?.operators || []) {
      const operatorName = getOperatorDisplayName(item.operator)
      items.push({
        id: `week-total:${item.operator.id}:${item.week.weekStart}`,
        operator_id: item.operator.id,
        operator_name: operatorName,
        date: item.week.weekEnd,
        kind: 'week_total',
        amount: Number(item.week.netAmount || 0),
        comment: `Итог недели ${item.week.weekStart} - ${item.week.weekEnd}`,
        status: 'active',
      })
      if (item.week.bonusAmount > 0) {
        items.push({
          id: `week-bonus:${item.operator.id}:${item.week.weekStart}`,
          operator_id: item.operator.id,
          operator_name: operatorName,
          date: item.week.weekEnd,
          kind: 'bonus',
          amount: Number(item.week.bonusAmount || 0),
          comment: `Бонусы за неделю ${item.week.weekStart} - ${item.week.weekEnd}`,
          status: 'active',
        })
      }
      if (item.week.fineAmount > 0) {
        items.push({
          id: `week-fine:${item.operator.id}:${item.week.weekStart}`,
          operator_id: item.operator.id,
          operator_name: operatorName,
          date: item.week.weekEnd,
          kind: 'fine',
          amount: Number(item.week.fineAmount || 0),
          comment: `Штрафы за неделю ${item.week.weekStart} - ${item.week.weekEnd}`,
          status: 'active',
        })
      }
      if (item.week.debtAmount > 0) {
        items.push({
          id: `week-debt:${item.operator.id}:${item.week.weekStart}`,
          operator_id: item.operator.id,
          operator_name: operatorName,
          date: item.week.weekEnd,
          kind: 'debt',
          amount: Number(item.week.debtAmount || 0),
          comment: `Долги за неделю ${item.week.weekStart} - ${item.week.weekEnd}`,
          status: 'active',
        })
      }
      if (item.week.advanceAmount > 0) {
        items.push({
          id: `week-advance:${item.operator.id}:${item.week.weekStart}`,
          operator_id: item.operator.id,
          operator_name: operatorName,
          date: item.week.weekEnd,
          kind: 'advance',
          amount: Number(item.week.advanceAmount || 0),
          comment: `Авансы за неделю ${item.week.weekStart} - ${item.week.weekEnd}`,
          status: 'active',
        })
      }
      for (const payment of item.week.payments || []) {
        items.push({
          id: `payment:${payment.id}`,
          operator_id: item.operator.id,
          operator_name: operatorName,
          date: String(payment.payment_date || item.week.weekEnd),
          created_at: payment.created_at || null,
          kind: 'payment',
          amount: Number(payment.total_amount || 0),
          comment: payment.comment || null,
          status: payment.status === 'voided' ? 'voided' : 'active',
        })
      }
    }
    return items.sort((a, b) => {
      const byDate = String(b.date || '').localeCompare(String(a.date || ''))
      if (byDate !== 0) return byDate
      return String(b.created_at || '').localeCompare(String(a.created_at || ''))
    })
  }, [data?.operators])
  const filteredOperatorGlobalTimeline = useMemo(() => {
    const query = operatorEventsQuery.trim().toLowerCase()
    return operatorGlobalTimeline
      .filter((ev) => (operatorEventsOperatorId === 'all' ? true : ev.operator_id === operatorEventsOperatorId))
      .filter((ev) => (operatorEventsKind === 'all' ? true : ev.kind === operatorEventsKind))
      .filter((ev) => {
        if (operatorEventsStatus === 'all') return true
        if (operatorEventsStatus === 'voided') return ev.status === 'voided'
        return ev.status !== 'voided'
      })
      .filter((ev) => (operatorEventsDateFrom ? ev.date >= operatorEventsDateFrom : true))
      .filter((ev) => (operatorEventsDateTo ? ev.date <= operatorEventsDateTo : true))
      .filter((ev) => {
        if (!query) return true
        return (
          ev.operator_name.toLowerCase().includes(query) ||
          String(ev.comment || '').toLowerCase().includes(query) ||
          ev.kind.toLowerCase().includes(query)
        )
      })
  }, [
    operatorGlobalTimeline,
    operatorEventsOperatorId,
    operatorEventsKind,
    operatorEventsStatus,
    operatorEventsDateFrom,
    operatorEventsDateTo,
    operatorEventsQuery,
  ])
  const visibleOperatorGlobalTimeline = useMemo(
    () => filteredOperatorGlobalTimeline.slice(0, operatorEventsLimit),
    [filteredOperatorGlobalTimeline, operatorEventsLimit],
  )
  const groupedVisibleOperatorEvents = useMemo(() => {
    const groups = new Map<string, typeof visibleOperatorGlobalTimeline>()
    for (const ev of visibleOperatorGlobalTimeline) {
      const dateKey = String(ev.date || '')
      const list = groups.get(dateKey) || []
      list.push(ev)
      groups.set(dateKey, list)
    }
    return Array.from(groups.entries())
  }, [visibleOperatorGlobalTimeline])
  const operatorEventsSummary = useMemo(() => {
    const total = filteredOperatorGlobalTimeline.length
    const payouts = filteredOperatorGlobalTimeline
      .filter((ev) => ev.kind === 'payment' && ev.status !== 'voided')
      .reduce((sum, ev) => sum + Number(ev.amount || 0), 0)
    const toPay = filteredOperatorGlobalTimeline
      .filter((ev) => ev.kind === 'week_total')
      .reduce((sum, ev) => sum + Number(ev.amount || 0), 0)
    return { total, payouts, toPay }
  }, [filteredOperatorGlobalTimeline])
  const operatorEventsByOperator = useMemo(() => {
    const map = new Map<
      string,
      { operatorName: string; events: number; toPay: number; paid: number; deductions: number; advances: number }
    >()
    for (const ev of filteredOperatorGlobalTimeline) {
      const current = map.get(ev.operator_id) || {
        operatorName: ev.operator_name,
        events: 0,
        toPay: 0,
        paid: 0,
        deductions: 0,
        advances: 0,
      }
      current.events += 1
      if (ev.kind === 'week_total') current.toPay += Number(ev.amount || 0)
      if (ev.kind === 'payment' && ev.status !== 'voided') current.paid += Number(ev.amount || 0)
      if ((ev.kind === 'debt' || ev.kind === 'fine') && ev.status !== 'voided') current.deductions += Number(ev.amount || 0)
      if (ev.kind === 'advance' && ev.status !== 'voided') current.advances += Number(ev.amount || 0)
      map.set(ev.operator_id, current)
    }
    return Array.from(map.entries())
      .map(([operatorId, stats]) => ({ operatorId, ...stats }))
      .sort((a, b) => b.toPay - a.toPay || b.events - a.events)
  }, [filteredOperatorGlobalTimeline])

  async function post(body: unknown) {
    const res = await fetch('/api/admin/salary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new Error(json?.error || `Ошибка запроса (${res.status})`)
    return json
  }

  const submitAdvance = async (e: FormEvent) => { e.preventDefault(); if (!advanceTarget) return; const cash = parseMoney(advanceCash), kaspi = parseMoney(advanceKaspi); if (!advanceCompanyId) return setError('Для аванса нужно выбрать точку'); if (cash + kaspi <= 0) return setError('Сумма аванса должна быть больше 0'); setAdvanceSaving(true); setError(null); try { await post({ action: 'createAdvance', payload: { operator_id: advanceTarget.operator.id, week_start: weekStart, company_id: advanceCompanyId, payment_date: advanceDate, cash_amount: cash, kaspi_amount: kaspi, comment: advanceComment.trim() || null } }); setAdvanceTarget(null); await load(true) } catch (e: any) { console.error(e); setError(e?.message || 'Не удалось выдать аванс') } finally { setAdvanceSaving(false) } }
  const submitPayment = async (e: FormEvent) => {
    e.preventDefault()
    if (!payTarget) return
    const cash = parseMoney(payCash), kaspi = parseMoney(payKaspi), total = cash + kaspi
    if (total <= 0) return setError('Сумма выплаты должна быть больше 0')
    const overpaymentDelta = total - payTarget.week.remainingAmount
    const isOverpayment = overpaymentDelta > 0.009
    if (isOverpayment && !payAllowOverpayment) {
      return setError('Сумма выплаты превышает остаток по неделе. Включите «выдать сверх остатка», чтобы перенести разницу авансом на следующую неделю.')
    }
    setPaySaving(true)
    setError(null)
    try {
      const action = isOverpayment ? 'createPaymentWithAdvance' : 'createWeeklyPayment'
      await post({
        action,
        payload: {
          operator_id: payTarget.operator.id,
          week_start: weekStart,
          payment_date: payDate,
          cash_amount: cash,
          kaspi_amount: kaspi,
          comment: payComment.trim() || null,
        },
      })
      setPayTarget(null)
      await load(true)
    } catch (e: any) {
      console.error(e)
      setError(e?.message || 'Не удалось провести выплату')
    } finally {
      setPaySaving(false)
    }
  }
  const submitAdjustment = async (e: FormEvent) => { e.preventDefault(); const amount = parseMoney(adjAmount); if (!adjOperatorId) return setError('Выберите оператора'); if (amount <= 0) return setError('Сумма корректировки должна быть больше 0'); setAdjSaving(true); setError(null); try { await post({ action: 'createAdjustment', payload: { operator_id: adjOperatorId, date: adjDate, amount, kind: adjKind, comment: adjComment.trim() || null, company_id: adjCompanyId || null } }); setAdjAmount(''); setAdjComment(''); setAdjSuccess(true); setTimeout(() => setAdjSuccess(false), 3000); await load(true) } catch (e: any) { console.error(e); setError(e?.message || 'Не удалось сохранить корректировку') } finally { setAdjSaving(false) } }
  const saveChatId = async (e: FormEvent) => { e.preventDefault(); if (!chatTarget) return; const trimmed = chatValue.trim(); if (trimmed && !/^-?\d+$/.test(trimmed)) return setError('telegram_chat_id должен быть числом'); setChatSaving(true); setError(null); try { await post({ action: 'updateOperatorChatId', operatorId: chatTarget.operator.id, telegram_chat_id: trimmed || null }); setChatTarget(null); await load(true) } catch (e: any) { console.error(e); setError(e?.message || 'Не удалось сохранить Telegram chat_id') } finally { setChatSaving(false) } }
  const sendOne = async (operatorId: string) => { setSendingId(operatorId); setError(null); try { const res = await fetch('/api/telegram/salary-snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operatorId, dateFrom: weekStart, dateTo: weekEnd, weekStart }) }); const json = await res.json().catch(() => null); if (!res.ok) throw new Error(json?.error || `Ошибка отправки (${res.status})`) } catch (e: any) { console.error(e); setError(e?.message || 'Не удалось отправить расчёт в Telegram') } finally { setSendingId(null) } }
  const sendAll = async () => { if (loading || broadcastSending || !broadcastTargets.length) return; setBroadcastSending(true); setBroadcastDone(0); setBroadcastTotal(broadcastTargets.length); setBroadcastErrors([]); setError(null); try { for (let i = 0; i < broadcastTargets.length; i += 1) { const item = broadcastTargets[i]; try { const res = await fetch('/api/telegram/salary-snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operatorId: item.operator.id, dateFrom: weekStart, dateTo: weekEnd, weekStart }) }); const json = await res.json().catch(() => null); if (!res.ok) setBroadcastErrors((prev) => [...prev, `${getOperatorDisplayName(item.operator)}: ${json?.error || `HTTP ${res.status}`}`]) } catch (e: any) { setBroadcastErrors((prev) => [...prev, `${getOperatorDisplayName(item.operator)}: ${e?.message || 'ошибка'}`]) } setBroadcastDone(i + 1); await new Promise((r) => setTimeout(r, 250)) } } finally { setBroadcastSending(false) } }
  const [tab, setTab] = useState<'operators' | 'operator-events' | 'staff' | 'events'>('operators')
  const [markDebtId, setMarkDebtId] = useState<string | null>(null)
  const [markDebtSaving, setMarkDebtSaving] = useState(false)
  const [payDebtModal, setPayDebtModal] = useState<{ staff: StaffMember; amount: number } | null>(null)
  const [payDebtComment, setPayDebtComment] = useState('')
  const [payDebtSaving, setPayDebtSaving] = useState(false)
  const [voidDebtPayId, setVoidDebtPayId] = useState<string | null>(null)

  // ─── Admin staff salary state ───────────────────────────────────────────
  const [staffSalary, setStaffSalary] = useState<StaffSalaryData | null>(null)
  const [staffSalaryLoading, setStaffSalaryLoading] = useState(false)
  const [staffAdjModal, setStaffAdjModal] = useState<StaffMember | null>(null)
  const [staffPayModal, setStaffPayModal] = useState<StaffMember | null>(null)
  const [staffAdjKind, setStaffAdjKind] = useState<'debt' | 'fine' | 'bonus' | 'advance'>('fine')
  const [staffAdjCompanyId, setStaffAdjCompanyId] = useState('')
  const [staffAdjAmount, setStaffAdjAmount] = useState('')
  const [staffAdjDate, setStaffAdjDate] = useState(todayISO())
  const [staffAdjComment, setStaffAdjComment] = useState('')
  const [staffAdjSaving, setStaffAdjSaving] = useState(false)
  const [staffPayDate, setStaffPayDate] = useState(todayISO())
  const [staffPaySlot, setStaffPaySlot] = useState<'first' | 'second' | 'extra'>('first')
  const [staffPayCompanyId, setStaffPayCompanyId] = useState('')
  const [staffPayCash, setStaffPayCash] = useState('')
  const [staffPayKaspi, setStaffPayKaspi] = useState('')
  const [staffPayComment, setStaffPayComment] = useState('')
  const [staffPaySaving, setStaffPaySaving] = useState(false)
  const [eventsStaffId, setEventsStaffId] = useState<'all' | string>('all')
  const [eventsKind, setEventsKind] = useState<'all' | StaffTimelineEvent['kind']>('all')
  const [eventsStatus, setEventsStatus] = useState<'all' | 'active' | 'paid' | 'voided'>('all')
  const [eventsQuery, setEventsQuery] = useState('')
  const [eventsDateFrom, setEventsDateFrom] = useState('')
  const [eventsDateTo, setEventsDateTo] = useState('')
  const [eventsLimit, setEventsLimit] = useState(100)
  const currentStaffSalarySlot = useMemo<'first' | 'second'>(() => {
    const day = Number(todayISO().slice(8, 10))
    return day <= 15 ? 'first' : 'second'
  }, [])
  const currentStaffSalaryPeriod = useMemo(() => getSalarySlotRange(todayISO(), currentStaffSalarySlot), [currentStaffSalarySlot])
  const currentStaffSalaryMonthPrefix = useMemo(() => monthPrefixFromIsoDate(todayISO()), [])
  const staffPayPreview = useMemo(() => {
    if (!staffPayModal || !staffSalary) return null
    const period = getStaffPaymentAdjustmentPeriod(staffPayDate, staffPaySlot)
    const closingAdjustments = filterStaffAdjustmentsForSlot(
      staffSalary.adjustments,
      staffPayModal.id,
      staffSalary.payments,
      period,
    )
    const calc = calcStaffToPay(staffPayModal, staffSalary.adjustments, staffSalary.payments, period)
    const payCashAmount = parseMoney(staffPayCash)
    const payKaspiAmount = parseMoney(staffPayKaspi)
    const payTotal = payCashAmount + payKaspiAmount
    const companyName =
      (data?.companies || []).find((c) => c.id === staffPayCompanyId)?.name ||
      (data?.companies || []).find((c) => c.id === staffPayCompanyId)?.code ||
      staffPayCompanyId ||
      'Не выбрана'

    return {
      period,
      closingWindow: getStaffPaymentClosingWindow(staffPayModal.id, staffSalary.payments, staffPayDate),
      calc,
      closingAdjustments,
      payCashAmount,
      payKaspiAmount,
      payTotal,
      companyName,
    }
  }, [staffPayModal, staffSalary, staffPayDate, staffPaySlot, staffPayCash, staffPayKaspi, staffPayCompanyId, data?.companies])
  const staffGlobalTimeline = useMemo(() => {
    if (!staffSalary) return [] as Array<StaffTimelineEvent & { staff_id: string; staff_name: string }>
    const staffNameById = new Map<string, string>(
      (staffSalary.staff || []).map((s) => [s.id, s.full_name || s.short_name || s.id]),
    )
    const items: Array<StaffTimelineEvent & { staff_id: string; staff_name: string }> = []
    for (const adj of staffSalary.adjustments || []) {
      items.push({
        id: `adj:${adj.id}`,
        date: adj.date,
        created_at: adj.created_at || null,
        kind: adj.kind,
        amount: Number(adj.amount || 0),
        comment: adj.comment || null,
        status: adj.status || 'active',
        staff_id: adj.staff_id,
        staff_name: staffNameById.get(adj.staff_id) || adj.staff_id,
      })
    }
    for (const pay of staffSalary.payments || []) {
      items.push({
        id: `pay:${pay.id}`,
        date: pay.pay_date,
        created_at: pay.created_at || null,
        kind: 'payment',
        amount: Number(pay.amount || 0),
        comment: pay.comment || null,
        status: 'active',
        staff_id: pay.staff_id,
        staff_name: staffNameById.get(pay.staff_id) || pay.staff_id,
      })
    }
    return items
      .sort((a, b) => {
        const byDate = String(b.date || '').localeCompare(String(a.date || ''))
        if (byDate !== 0) return byDate
        return String(b.created_at || '').localeCompare(String(a.created_at || ''))
      })
      .slice(0, 300)
  }, [staffSalary])
  const filteredStaffGlobalTimeline = useMemo(() => {
    const query = eventsQuery.trim().toLowerCase()
    return staffGlobalTimeline
      .filter((ev) => (eventsStaffId === 'all' ? true : ev.staff_id === eventsStaffId))
      .filter((ev) => (eventsKind === 'all' ? true : ev.kind === eventsKind))
      .filter((ev) => {
        if (eventsStatus === 'all') return true
        return String(ev.status || 'active') === eventsStatus
      })
      .filter((ev) => (eventsDateFrom ? ev.date >= eventsDateFrom : true))
      .filter((ev) => (eventsDateTo ? ev.date <= eventsDateTo : true))
      .filter((ev) => {
        if (!query) return true
        return (
          ev.staff_name.toLowerCase().includes(query) ||
          String(ev.comment || '').toLowerCase().includes(query) ||
          ev.kind.toLowerCase().includes(query)
        )
      })
  }, [staffGlobalTimeline, eventsStaffId, eventsKind, eventsStatus, eventsDateFrom, eventsDateTo, eventsQuery])
  const visibleStaffGlobalTimeline = useMemo(
    () => filteredStaffGlobalTimeline.slice(0, eventsLimit),
    [filteredStaffGlobalTimeline, eventsLimit],
  )
  const groupedVisibleEvents = useMemo(() => {
    const groups = new Map<string, typeof visibleStaffGlobalTimeline>()
    for (const ev of visibleStaffGlobalTimeline) {
      const dateKey = String(ev.date || '')
      const list = groups.get(dateKey) || []
      list.push(ev)
      groups.set(dateKey, list)
    }
    return Array.from(groups.entries())
  }, [visibleStaffGlobalTimeline])
  const eventsSummary = useMemo(() => {
    const total = filteredStaffGlobalTimeline.length
    const payments = filteredStaffGlobalTimeline
      .filter((ev) => ev.kind === 'payment' && ev.status !== 'voided')
      .reduce((sum, ev) => sum + Number(ev.amount || 0), 0)
    const deductions = filteredStaffGlobalTimeline
      .filter((ev) => ev.kind === 'debt' || ev.kind === 'fine' || ev.kind === 'advance')
      .filter((ev) => ev.status !== 'voided')
      .reduce((sum, ev) => sum + Number(ev.amount || 0), 0)
    return { total, payments, deductions }
  }, [filteredStaffGlobalTimeline])

  const [showStaffArchived, setShowStaffArchived] = useState(false)
  const loadStaffSalary = useCallback(async (archived?: boolean) => {
    setStaffSalaryLoading(true)
    try {
      const url = (archived ?? showStaffArchived)
        ? '/api/admin/staff-salary?include_archived=1'
        : '/api/admin/staff-salary'
      const res = await fetch(url, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (res.ok) setStaffSalary(json)
    } catch {}
    finally { setStaffSalaryLoading(false) }
  }, [showStaffArchived])
  useEffect(() => { void loadStaffSalary() }, [loadStaffSalary])
  const canEditStaffSalary = staffSalary?.can_edit === true

  const submitStaffAdjustment = async (e: FormEvent) => {
    e.preventDefault()
    if (!canEditStaffSalary) return setError('Доступ только для просмотра')
    if (!staffAdjModal) return
    const amount = parseMoney(staffAdjAmount)
    if (amount <= 0) return setError('Сумма должна быть > 0')
    if (staffAdjKind === 'advance' && !staffAdjCompanyId) return setError('Для аванса выберите компанию')
    setStaffAdjSaving(true); setError(null)
    try {
      const res = await fetch('/api/admin/staff-salary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addAdjustment', staff_id: staffAdjModal.id, kind: staffAdjKind, amount, date: staffAdjDate, company_id: staffAdjKind === 'advance' ? staffAdjCompanyId : null, comment: staffAdjComment.trim() || null }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Ошибка')
      setStaffAdjModal(null); setStaffAdjAmount(''); setStaffAdjComment(''); setStaffAdjCompanyId('')
      await loadStaffSalary()
    } catch (e: any) { setError(e?.message || 'Не удалось сохранить') }
    finally { setStaffAdjSaving(false) }
  }

  const submitStaffExtraDay = async (staffId: string) => {
    if (!canEditStaffSalary) return setError('Доступ только для просмотра')
    try {
      const res = await fetch('/api/admin/staff-salary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addExtraDay', staff_id: staffId, date: todayISO() }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Ошибка')
      await loadStaffSalary()
    } catch (e: any) { setError(e?.message || 'Не удалось добавить доп. выход') }
  }

  const submitStaffPayment = async (e: FormEvent) => {
    e.preventDefault()
    if (!canEditStaffSalary) return setError('Доступ только для просмотра')
    if (!staffPayModal) return
    if (!staffPayCompanyId) return setError('Выберите компанию для расхода по зарплате')
    const cash = parseMoney(staffPayCash), kaspi = parseMoney(staffPayKaspi)
    if (cash + kaspi <= 0) return setError('Сумма выплаты должна быть > 0')
    setStaffPaySaving(true); setError(null)
    try {
      // Доплата остатка считается ожидаемой суммой ровно по факту (без «переплаты»).
      const expectedAmount = staffPaySlot === 'extra'
        ? Math.round(cash + kaspi)
        : calcStaffToPay(
            staffPayModal,
            staffSalary?.adjustments || [],
            staffSalary?.payments || [],
            getStaffPaymentAdjustmentPeriod(staffPayDate, staffPaySlot),
          ).toPay
      const res = await fetch('/api/admin/staff-salary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'createPayment', staff_id: staffPayModal.id, pay_date: staffPayDate, slot: staffPaySlot, company_id: staffPayCompanyId, cash_amount: cash, kaspi_amount: kaspi, expected_amount: expectedAmount, comment: staffPayComment.trim() || null }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Ошибка')
      setStaffPayModal(null); setStaffPayCash(''); setStaffPayKaspi(''); setStaffPayComment(''); setStaffPayCompanyId('')
      await loadStaffSalary()
    } catch (e: any) { setError(e?.message || 'Не удалось провести выплату') }
    finally { setStaffPaySaving(false) }
  }

  const removeStaffAdjustment = async (id: string) => {
    if (!canEditStaffSalary) return setError('Доступ только для просмотра')
    if (!window.confirm('Аннулировать корректировку?')) return
    try {
      await fetch('/api/admin/staff-salary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'removeAdjustment', id }) })
      await loadStaffSalary()
    } catch (e: any) { setError(e?.message || 'Ошибка') }
  }

  const openPayDebt = (s: StaffMember, amount: number) => {
    if (!canEditStaffSalary) return setError('Доступ только для просмотра')
    setPayDebtModal({ staff: s, amount })
    setPayDebtComment('')
  }
  const confirmPayStaffDebt = async () => {
    if (!payDebtModal) return
    const staffId = payDebtModal.staff.id
    const adjs = (staffSalary?.adjustments || []) as any[]
    const synthetic = adjs.find((a) => a.id === `operator-debt:${staffId}`)
    const debt_ids = (synthetic?.debt_ids || []) as string[]
    const item_ids = (synthetic?.item_ids || []) as string[]
    const adjustment_ids = adjs
      .filter((a) => a.staff_id === staffId && a.kind === 'debt' && !String(a.id).startsWith('operator-debt:') && (a.status === 'active' || !a.status))
      .map((a) => a.id)
    setPayDebtSaving(true)
    try {
      const res = await fetch('/api/admin/staff-salary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'payStaffDebt', staff_id: staffId, debt_ids, item_ids, adjustment_ids, comment: payDebtComment.trim() || null }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Ошибка')
      setPayDebtModal(null)
      await loadStaffSalary()
    } catch (e: any) { setError(e?.message || 'Не удалось оплатить долг') }
    finally { setPayDebtSaving(false) }
  }
  const voidStaffDebtPayment = async (id: string) => {
    if (!canEditStaffSalary) return setError('Доступ только для просмотра')
    if (!window.confirm('Аннулировать оплату долга? Долг снова станет активным.')) return
    setVoidDebtPayId(id)
    try {
      const res = await fetch('/api/admin/staff-salary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'voidStaffDebtPayment', id }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Ошибка')
      await loadStaffSalary()
    } catch (e: any) { setError(e?.message || 'Не удалось аннулировать') }
    finally { setVoidDebtPayId(null) }
  }

  const deleteStaffPayment = async (id: string, amount: number) => {
    if (!canEditStaffSalary) return setError('Доступ только для просмотра')
    if (!window.confirm(`Аннулировать выплату ${money(amount)}?`)) return
    try {
      const res = await fetch('/api/admin/staff-salary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deletePayment', id }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Ошибка')
      await loadStaffSalary()
    } catch (e: any) { setError(e?.message || 'Не удалось аннулировать выплату') }
  }

  const markDebtsPaid = async (item: WeeklyOperator) => {
    if (!window.confirm(`Отметить долг ${money(item.week.debtAmount)} оператора ${getOperatorDisplayName(item.operator)} как оплаченный?`)) return
    setMarkDebtId(item.operator.id)
    setMarkDebtSaving(true)
    setError(null)
    try {
      await post({ action: 'markDebtsPaid', operatorId: item.operator.id, weekStart })
      await load(true)
    } catch (e: any) {
      console.error(e)
      setError(e?.message || 'Не удалось отметить долг как оплаченный')
    } finally {
      setMarkDebtId(null)
      setMarkDebtSaving(false)
    }
  }

  const voidPayment = async (item: WeeklyOperator, payment: Payment) => {
    if (payment.status === 'voided' || voidingPaymentId) return
    const confirmed = window.confirm(`Аннулировать выплату ${money(payment.total_amount)} для ${getOperatorDisplayName(item.operator)}?`)
    if (!confirmed) return
    setVoidingPaymentId(payment.id)
    setError(null)
    try {
      await post({
        action: 'voidPayment',
        paymentId: payment.id,
        weekStart,
        operatorId: item.operator.id,
      })
      await load(true)
    } catch (e: any) {
      console.error(e)
      setError(e?.message || 'Не удалось аннулировать выплату')
    } finally {
      setVoidingPaymentId(null)
    }
  }

  const downloadSalaryCSV = async () => {
    const opRows = (data?.operators || []).map(({ operator, week }) => ({
      name: getOperatorDisplayName(operator),
      shifts: week.shiftsCount,
      gross: Math.round(week.grossAmount),
      autoBonus: Math.round(week.autoBonusTotal),
      bonus: Math.round(week.bonusAmount),
      fine: Math.round(week.fineAmount),
      debt: Math.round(week.debtAmount),
      advance: Math.round(week.advanceAmount),
      net: Math.round(week.netAmount),
      paid: Math.round(week.paidAmount),
      remaining: Math.round(week.remainingAmount),
      status: statusMeta(week.status).label,
    }))
    const tot = opRows.reduce((a, r) => ({ gross: a.gross + r.gross, net: a.net + r.net, paid: a.paid + r.paid, remaining: a.remaining + r.remaining }), { gross: 0, net: 0, paid: 0, remaining: 0 })
    await downloadReportPdf('table', {
      meta: { title: 'Ведомость зарплат', period: `Неделя ${weekStart}`, generated: new Date().toLocaleString('ru-RU') },
      columns: [
        { key: 'name', label: 'Оператор' },
        { key: 'shifts', label: 'Смен', align: 'right' },
        { key: 'gross', label: 'Начислено', align: 'right' },
        { key: 'autoBonus', label: 'Авто-бонус', align: 'right' },
        { key: 'bonus', label: 'Бонус', align: 'right' },
        { key: 'fine', label: 'Штраф', align: 'right' },
        { key: 'debt', label: 'Долг', align: 'right' },
        { key: 'advance', label: 'Аванс', align: 'right' },
        { key: 'net', label: 'К выплате', align: 'right' },
        { key: 'paid', label: 'Выплачено', align: 'right' },
        { key: 'remaining', label: 'Остаток', align: 'right' },
        { key: 'status', label: 'Статус' },
      ],
      rows: opRows,
      total: { gross: tot.gross, net: tot.net, paid: tot.paid, remaining: tot.remaining },
    }, `Zarplata_${weekStart}`)
  }

  return (
    <>
        <div className="app-page-wide space-y-6">

          <AdminPageHeader
            title="Зарплата"
            description="Выплаты, авансы, административный персонал"
            accent="emerald"
            icon={<Wallet className="h-5 w-5" aria-hidden />}
            actions={
              tab === 'operators' ? (
                <>
                  <Button
                    type="button"
                    onClick={() => setBroadcastConfirm(true)}
                    disabled={loading || broadcastSending || !broadcastTargets.length}
                    className="h-8 gap-1.5 rounded-xl bg-blue-500 text-xs text-white hover:bg-blue-400 disabled:opacity-50"
                  >
                    {broadcastSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    {broadcastSending ? `${broadcastDone}/${broadcastTotal}` : 'Всем'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={downloadSalaryCSV}
                    disabled={loading || !data}
                    className="h-8 gap-1.5 rounded-xl border-white/10 bg-white/5 text-xs text-slate-300 hover:bg-white/10"
                  >
                    <Download className="h-3.5 w-3.5" />
                    PDF
                  </Button>
                  <div className="flex rounded-xl border border-white/10 bg-black/20 p-0.5 text-xs" role="group" aria-label="Неделя">
                    <button
                      type="button"
                      onClick={() => setWeekStart(addDaysISO(weekStart, -7))}
                      className="rounded-lg px-2.5 py-1.5 text-slate-400 transition hover:text-white"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => setWeekStart(currentWeek)}
                      className="rounded-lg px-2.5 py-1.5 text-slate-300 transition hover:text-white"
                    >
                      Сейчас
                    </button>
                    <button
                      type="button"
                      onClick={() => setWeekStart(addDaysISO(weekStart, 7))}
                      className="rounded-lg px-2.5 py-1.5 text-slate-400 transition hover:text-white"
                    >
                      →
                    </button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 w-8 rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                    onClick={() => void load()}
                    aria-label="Обновить"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 w-8 rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                  onClick={() => void loadStaffSalary()}
                  aria-label="Обновить"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              )
            }
            toolbar={
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex rounded-xl border border-white/10 bg-black/20 p-0.5" role="tablist" aria-label="Раздел зарплаты">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'operators'}
                    onClick={() => setTab('operators')}
                    className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === 'operators' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    Операторы
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'operator-events'}
                    onClick={() => setTab('operator-events')}
                    className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === 'operator-events' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    Лента операторов
                  </button>
                  {canViewStaffSalary && (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={tab === 'staff'}
                      onClick={() => setTab('staff')}
                      className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === 'staff' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                    >
                      Административные сотрудники
                    </button>
                  )}
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'events'}
                    onClick={() => setTab('events')}
                    className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === 'events' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    Лента событий
                  </button>
                </div>
                {tab === 'operators' || tab === 'operator-events' ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">
                      Неделя:{' '}
                      <span className="font-semibold text-white">
                        {formatRuDate(weekStart)} — {formatRuDate(weekEnd)}
                      </span>
                    </span>
                    {data ? (
                      <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-emerald-300">
                        Выплачено: <span className="font-semibold">{data.totals.paidOperators}</span>
                      </span>
                    ) : null}
                    {broadcastTotal > 0 && !broadcastSending ? (
                      <span
                        className={`rounded-full border px-3 py-1 ${broadcastErrors.length ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-blue-500/30 bg-blue-500/10 text-blue-300'}`}
                      >
                        {broadcastDone}/{broadcastTotal}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            }
          />

          {error ? <Card className="border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</Card> : null}

          {/* ── OPERATORS TAB ───────────────────────────────────────────────── */}
          {tab === 'operators' && (<>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <Card className="border-white/10 bg-white/[0.04] p-4"><div className="flex items-center gap-3"><div className="rounded-xl bg-violet-500/15 p-2 text-violet-300"><CalendarDays className="h-4 w-4" /></div><div><div className="text-[11px] uppercase tracking-wide text-slate-500">Смен</div><div className="mt-0.5 text-xl font-semibold text-white">{loading ? '—' : totalShifts}</div></div></div></Card>
            <Card className="border-white/10 bg-white/[0.04] p-4"><div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-500/15 p-2 text-emerald-300"><DollarSign className="h-4 w-4" /></div><div><div className="text-[11px] uppercase tracking-wide text-slate-500">К выплате</div><div className="mt-0.5 text-xl font-semibold text-white">{data ? money(data.totals.netAmount) : '—'}</div></div></div></Card>
            <Card className="border-white/10 bg-white/[0.04] p-4"><div className="flex items-center gap-3"><div className="rounded-xl bg-blue-500/15 p-2 text-blue-300"><CheckCircle2 className="h-4 w-4" /></div><div><div className="text-[11px] uppercase tracking-wide text-slate-500">Выплачено</div><div className="mt-0.5 text-xl font-semibold text-white">{data ? money(data.totals.paidAmount) : '—'}</div></div></div></Card>
            <Card className="border-white/10 bg-white/[0.04] p-4"><div className="flex items-center gap-3"><div className="rounded-xl bg-amber-500/15 p-2 text-amber-300"><CreditCard className="h-4 w-4" /></div><div><div className="text-[11px] uppercase tracking-wide text-slate-500">Авансы</div><div className="mt-0.5 text-xl font-semibold text-white">{data ? money(data.totals.advanceAmount) : '—'}</div></div></div></Card>
            <Card className="border-white/10 bg-white/[0.04] p-4"><div className="flex items-center gap-3"><div className="rounded-xl bg-red-500/15 p-2 text-red-300"><TrendingDown className="h-4 w-4" /></div><div><div className="text-[11px] uppercase tracking-wide text-slate-500">Остаток</div><div className="mt-0.5 text-xl font-semibold text-white">{data ? money(data.totals.remainingAmount) : '—'}</div></div></div></Card>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
            <div className="min-w-0 flex-1 text-xs">{summaryText}</div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-xl border border-white/10 bg-black/20 p-0.5 text-xs">
                {(['all', 'draft', 'partial', 'paid'] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setStatusFilter(s)} className={`rounded-lg px-3 py-1.5 transition ${statusFilter === s ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                    {s === 'all' ? 'Все' : s === 'draft' ? 'Не выплачено' : s === 'partial' ? 'Частично' : 'Выплачено'}
                  </button>
                ))}
              </div>
              <Button type="button" variant="outline" className="h-8 rounded-xl border-white/10 bg-white/5 text-xs text-slate-200 hover:bg-white/10" onClick={() => setShowZero((v) => !v)}>{showZero ? 'Скрыть пустые' : 'Все строки'}</Button>
            </div>
          </div>

          <AdminTableViewport maxHeight="min(70vh, 40rem)">
              <table className="min-w-[900px] text-sm">
                <thead className={adminTableStickyTheadClass}>
                  <tr>
                    <th className="px-4 py-3 text-left">Оператор</th>
                    <th className="px-4 py-3 text-center">Смен</th>
                    <th className="px-4 py-3 text-right">Начислено</th>
                    <th className="px-4 py-3 text-right">Авто-бонус</th>
                    <th className="px-4 py-3 text-right">Бонусы</th>
                    <th className="px-4 py-3 text-right">Штрафы</th>
                    <th className="px-4 py-3 text-right">Долги</th>
                    <th className="px-4 py-3 text-right">Аванс</th>
                    <th className="px-4 py-3 text-right">Выплачено</th>
                    <th className="px-4 py-3 text-right">Остаток</th>
                    <th className="px-4 py-3 text-center">Статус</th>
                    <th className="px-4 py-3 text-center">Действия</th>
                    <th className="px-4 py-3 text-center">Telegram</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && operators.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="px-4 py-6">
                        <div className="space-y-3">
                          {Array.from({ length: 6 }).map((_, idx) => (
                            <div key={idx} className="flex gap-2">
                              <Skeleton className="h-10 w-48" />
                              <Skeleton className="h-10 w-16" />
                              <Skeleton className="h-10 w-24" />
                              <Skeleton className="h-10 w-24" />
                              <Skeleton className="h-10 w-24" />
                              <Skeleton className="h-10 w-24" />
                              <Skeleton className="h-10 w-24" />
                              <Skeleton className="h-10 w-24" />
                              <Skeleton className="h-10 w-24" />
                              <Skeleton className="h-10 w-24" />
                              <Skeleton className="h-10 w-24" />
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {operators.length === 0 && !loading ? <tr><td colSpan={13} className="px-4 py-16 text-center text-slate-400">В этой неделе пока нет строк для отображения.</td></tr> : null}
                  {operators.map((item) => {
                    const st = statusMeta(item.week.status)
                    const open = Boolean(expanded[item.operator.id])
                    const canPay = item.week.remainingAmount > 0.009
                    const hasChat = Boolean(item.operator.telegram_chat_id)
                    const title = getOperatorDisplayName(item.operator)
                    return (
                      <Fragment key={item.operator.id}>
                        <tr key={item.operator.id} className="border-t border-white/5 align-top">
                          <td className="px-4 py-4">
                            <div className="flex items-start gap-3">
                              <button type="button" className="mt-1 rounded-lg border border-white/10 bg-white/5 p-1.5 text-slate-300 transition hover:bg-white/10" onClick={() => setExpanded((p) => ({ ...p, [item.operator.id]: !p[item.operator.id] }))}>
                                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </button>
                              <Link href={`/operators/${item.operator.id}/profile`} className="flex min-w-0 items-start gap-3">
                                <div className="h-11 w-11 overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-500">
                                  {item.operator.photo_url ? <Image src={item.operator.photo_url} alt={title} width={44} height={44} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-white">{title.charAt(0).toUpperCase()}</div>}
                                </div>
                                <div className="min-w-0">
                                  <div className="truncate font-medium text-white">{title}</div>
                                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                                    {item.operator.position ? <span>{item.operator.position}</span> : null}
                                    {!item.operator.is_active ? <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">неактивен</span> : null}
                                    <span>{item.operator.documents_count} док.</span>
                                    {item.operator.expiring_documents > 0 ? <span className="text-amber-300">{item.operator.expiring_documents} скоро истекут</span> : null}
                                  </div>
                                </div>
                              </Link>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-center"><div className="inline-flex flex-col items-center gap-0.5"><span className="text-base font-semibold text-white">{item.week.shiftsCount}</span><span className="text-[10px] text-slate-500">смен</span></div></td>
                          <td className="px-4 py-4 text-right font-medium text-white">{money(item.week.grossAmount)}</td>
                          <td className="px-4 py-4 text-right text-violet-300">{item.week.autoBonusTotal > 0 ? money(item.week.autoBonusTotal) : <span className="text-slate-600">—</span>}</td>
                          <td className="px-4 py-4 text-right text-emerald-300">{money(item.week.bonusAmount)}</td>
                          <td className="px-4 py-4 text-right text-rose-300">{money(item.week.fineAmount)}</td>
                          <td className="px-4 py-4 text-right text-rose-300">
                            <div className="flex flex-col items-end gap-1">
                              <span>{money(item.week.debtAmount)}</span>
                              {item.week.debtAmount > 0 ? (
                                <button
                                  type="button"
                                  disabled={markDebtSaving && markDebtId === item.operator.id}
                                  onClick={() => void markDebtsPaid(item)}
                                  className="text-[10px] rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50 whitespace-nowrap"
                                >
                                  {markDebtSaving && markDebtId === item.operator.id ? '...' : 'Оплатил долг'}
                                </button>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-4 py-4 text-right text-amber-300">{money(item.week.advanceAmount)}</td>
                          <td className="px-4 py-4 text-right text-sky-300">{money(item.week.paidAmount)}</td>
                          <td className="px-4 py-4 text-right text-lg font-semibold text-white">{money(item.week.remainingAmount)}</td>
                          <td className="px-4 py-4 text-center"><span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${st.className}`}>{st.label}</span></td>
                          <td className="px-4 py-4"><div className="flex flex-wrap items-center justify-center gap-2">{canCreateAdvance && <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setAdvanceTarget(item)}><Plus className="mr-2 h-4 w-4" />Аванс</Button>}{canCreatePayment && <Button type="button" className="rounded-xl bg-emerald-500 text-white hover:bg-emerald-400 disabled:opacity-50" disabled={!canPay} onClick={() => setPayTarget(item)}><Wallet className="mr-2 h-4 w-4" />Выплатить</Button>}<Link href={`/salary/${item.operator.id}?weekStart=${weekStart}`} className="inline-flex h-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-slate-200 transition hover:bg-white/10">Детали</Link></div></td>
                          <td className="px-4 py-4"><div className="flex flex-col items-center gap-2"><div className="flex items-center gap-2">{canUpdateChatId && <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setChatTarget(item)}><Pencil className="h-4 w-4" /></Button>}<Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 disabled:opacity-50" disabled={!hasChat || sendingId === item.operator.id || broadcastSending} onClick={() => void sendOne(item.operator.id)}>{sendingId === item.operator.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}</Button></div>{item.operator.telegram_chat_id ? <div className="max-w-[140px] truncate text-center text-[11px] text-emerald-300/70">{item.operator.telegram_chat_id}</div> : <div className="text-[11px] text-slate-500">нет chat_id</div>}</div></td>
                        </tr>
                        {open ? <tr className="border-t border-white/5 bg-slate-950/30"><td colSpan={13} className="px-4 py-5"><div className="grid gap-4 xl:grid-cols-[1fr_1fr_1fr]">
                          <Card className="border-white/10 bg-white/[0.03] p-4"><div className="mb-4 flex items-center gap-2 text-sm font-medium text-white"><Building2 className="h-4 w-4 text-emerald-300" />Разбивка по компаниям</div><div className="overflow-x-auto"><table className="min-w-[680px] text-xs"><thead className="text-slate-500"><tr><th className="pb-3 text-left font-medium">Компания</th><th className="pb-3 text-right font-medium">Начислено</th><th className="pb-3 text-right font-medium">Бонусы</th><th className="pb-3 text-right font-medium">Штрафы</th><th className="pb-3 text-right font-medium">Долги</th><th className="pb-3 text-right font-medium">Аванс</th><th className="pb-3 text-right font-medium">К выплате</th></tr></thead><tbody>{item.week.companyAllocations.map((a) => <tr key={a.companyId} className="border-t border-white/5 text-slate-200"><td className="py-3 pr-3"><div className="font-medium text-white">{a.companyName || a.companyCode || a.companyId}</div><div className="text-[11px] text-slate-500">Доля: {(a.shareRatio * 100).toFixed(1)}%</div></td><td className="py-3 text-right">{money(a.accruedAmount)}</td><td className="py-3 text-right text-emerald-300">{money(a.bonusAmount)}</td><td className="py-3 text-right text-rose-300">{money(a.fineAmount)}</td><td className="py-3 text-right text-rose-300">{money(a.debtAmount)}</td><td className="py-3 text-right text-amber-300">{money(a.advanceAmount)}</td><td className="py-3 text-right font-medium text-white">{money(a.netAmount)}</td></tr>)}</tbody></table></div></Card>
                          <Card className="border-white/10 bg-white/[0.03] p-4"><div className="mb-4 flex items-center justify-between gap-2 text-sm font-medium text-white"><span>Смены ({item.week.shiftsCount})</span><span className="text-xs text-slate-400">{item.week.seniorityBonusTotal ? `Стаж: ${money(item.week.seniorityBonusTotal)}` : item.week.autoBonusTotal > 0 ? `Авто-бонус: ${money(item.week.autoBonusTotal)}` : ''}</span></div>{item.week.shifts.length === 0 ? <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-sm text-slate-400">Смен за эту неделю нет.</div> : <div className="overflow-x-auto"><table className="min-w-[680px] text-xs"><thead className="text-slate-500"><tr><th className="pb-3 text-left font-medium">Дата</th><th className="pb-3 text-left font-medium">Смена</th><th className="pb-3 text-left font-medium">Точка</th><th className="pb-3 text-right font-medium">Выручка</th><th className="pb-3 text-right font-medium">База</th><th className="pb-3 text-right font-medium">Стаж</th><th className="pb-3 text-right font-medium">Авто</th><th className="pb-3 text-right font-medium">Роль</th><th className="pb-3 text-right font-medium">Итого</th></tr></thead><tbody>{item.week.shifts.map((s) => <tr key={s.id} className="border-t border-white/5 text-slate-200"><td className="py-2 pr-3 text-slate-300">{formatRuDate(s.date)}</td><td className="py-2 pr-3"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${s.shift === 'day' ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-blue-500/30 bg-blue-500/10 text-blue-300'}`}>{s.shift === 'day' ? 'день' : 'ночь'}</span></td><td className="py-2 pr-3 text-slate-400">{s.companyName || s.companyCode || '—'}</td><td className="py-2 text-right">{money(s.totalIncome)}</td><td className="py-2 text-right">{money(s.baseSalary)}</td><td className="py-2 text-right text-cyan-300">{(s.seniorityBonus || 0) > 0 ? money(s.seniorityBonus || 0) : <span className="text-slate-600">—</span>}</td><td className="py-2 text-right text-violet-300">{s.autoBonus > 0 ? money(s.autoBonus) : <span className="text-slate-600">—</span>}</td><td className="py-2 text-right text-cyan-300">{s.roleBonus > 0 ? money(s.roleBonus) : <span className="text-slate-600">—</span>}</td><td className="py-2 text-right font-medium text-white">{money(s.salary)}</td></tr>)}</tbody></table></div>}</Card>
                          <Card className="border-white/10 bg-white/[0.03] p-4"><div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">Платежи недели</div>{item.week.payments.length === 0 ? <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-sm text-slate-400">По этой неделе ещё нет платежей.</div> : <div className="space-y-3">{item.week.payments.map((p) => <div key={p.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"><div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium text-white">{formatRuDate(p.payment_date)}</div><div className="mt-1 text-xs text-slate-400">Нал: {money(p.cash_amount)} • {cashLabels.providerName}: {money(p.kaspi_amount)}</div></div><div className="text-right"><div className="text-sm font-semibold text-emerald-300">{money(p.total_amount)}</div><div className="text-[11px] text-slate-500">{p.status === 'voided' ? 'аннулировано' : 'активно'}</div></div></div>{p.comment ? <div className="mt-2 text-xs text-slate-400">{p.comment}</div> : null}<div className="mt-3 flex justify-end">{p.status === 'voided' ? <span className="rounded-full border border-slate-500/30 bg-slate-500/10 px-3 py-1 text-[11px] text-slate-400">Уже аннулировано</span> : <Button type="button" variant="outline" className="rounded-xl border-red-500/20 bg-red-500/10 text-red-200 hover:bg-red-500/20 disabled:opacity-50" disabled={voidingPaymentId === p.id} onClick={() => void voidPayment(item, p)}>{voidingPaymentId === p.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Аннулировать</Button>}</div></div>)}</div>}</Card>
                          </div></td></tr> : null}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
          </AdminTableViewport>

          {canCreateAdjustment && (
          <Card className="border-white/10 bg-white/[0.04] p-5">
            <div className="mb-5 flex items-center gap-3">
              <div className="rounded-2xl bg-emerald-500/15 p-3 text-emerald-300">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Ручная корректировка недели</h2>
                <p className="text-sm text-slate-400">Для бонусов, штрафов и ручных долгов. Аванс через эту форму больше не создаётся.</p>
              </div>
            </div>
            <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-6" onSubmit={submitAdjustment}>
              <select className={selectCls} value={adjOperatorId} onChange={(e) => setAdjOperatorId(e.target.value)}>
                {(data?.operators || []).map((i) => <option key={i.operator.id} value={i.operator.id}>{getOperatorDisplayName(i.operator)}</option>)}
              </select>
              <select className={selectCls} value={adjCompanyId} onChange={(e) => setAdjCompanyId(e.target.value)}>
                <option value="">Без привязки к точке</option>
                {(data?.companies || []).map((c) => <option key={c.id} value={c.id}>{c.name || c.code || c.id}</option>)}
              </select>
              <select className={selectCls} value={adjKind} onChange={(e) => setAdjKind(e.target.value as AdjustmentKind)}>
                <option value="fine">Штраф</option>
                <option value="debt">Долг</option>
                <option value="bonus">Бонус</option>
              </select>
              <input className={input} type="date" value={adjDate} onChange={(e) => setAdjDate(e.target.value)} />
              <input className={input} type="text" placeholder="Сумма" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} />
              <Button type="submit" className="h-11 rounded-xl bg-emerald-500 text-white hover:bg-emerald-400">
                {adjSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Сохранить'}
              </Button>
              <input className={`${input} md:col-span-2 xl:col-span-6`} type="text" placeholder="Комментарий" value={adjComment} onChange={(e) => setAdjComment(e.target.value)} />
            </form>
            {adjSuccess ? <div className="mt-4 flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" />Корректировка сохранена</div> : null}
          </Card>
          )}

          </>)}

          {/* ── OPERATOR EVENTS TAB ─────────────────────────────────────────── */}
          {tab === 'operator-events' && (
            <Card className="overflow-hidden border-white/10 bg-white/[0.04]">
              <div className="flex items-center justify-between gap-4 border-b border-white/10 p-5">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-blue-500/15 p-3 text-blue-300">
                    <CalendarDays className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-white">Лента событий операторов</h2>
                    <p className="text-sm text-slate-400">Недельные начисления, выплаты и удержания операторов за выбранную неделю.</p>
                  </div>
                </div>
                <div className="text-xs text-slate-400">
                  Событий: <span className="font-semibold text-white">{operatorGlobalTimeline.length}</span>
                </div>
              </div>
              <div className="p-5">
                <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                  <input
                    className={input}
                    type="text"
                    value={operatorEventsQuery}
                    onChange={(e) => setOperatorEventsQuery(e.target.value)}
                    placeholder="Поиск: оператор, комментарий, тип"
                  />
                  <select className={selectCls} value={operatorEventsOperatorId} onChange={(e) => setOperatorEventsOperatorId(e.target.value as any)}>
                    <option value="all">Все операторы</option>
                    {(data?.operators || []).map((i) => (
                      <option key={i.operator.id} value={i.operator.id}>
                        {getOperatorDisplayName(i.operator)}
                      </option>
                    ))}
                  </select>
                  <select className={selectCls} value={operatorEventsKind} onChange={(e) => setOperatorEventsKind(e.target.value as any)}>
                    <option value="all">Все типы</option>
                    <option value="week_total">Итог недели</option>
                    <option value="payment">Выплаты</option>
                    <option value="bonus">Бонусы</option>
                    <option value="fine">Штрафы</option>
                    <option value="debt">Долги</option>
                    <option value="advance">Авансы</option>
                  </select>
                  <select className={selectCls} value={operatorEventsStatus} onChange={(e) => setOperatorEventsStatus(e.target.value as any)}>
                    <option value="all">Любой статус</option>
                    <option value="active">Активные</option>
                    <option value="voided">Аннулированные</option>
                  </select>
                  <input className={input} type="date" value={operatorEventsDateFrom} onChange={(e) => setOperatorEventsDateFrom(e.target.value)} />
                  <input className={input} type="date" value={operatorEventsDateTo} onChange={(e) => setOperatorEventsDateTo(e.target.value)} />
                </div>
                <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">
                    Событий: <span className="font-semibold text-white">{operatorEventsSummary.total}</span>
                  </span>
                  <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-emerald-200">
                    К выплате за неделю: <span className="font-semibold text-white">{money(operatorEventsSummary.toPay)}</span>
                  </span>
                  <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-sky-200">
                    Выплачено: <span className="font-semibold text-white">{money(operatorEventsSummary.payouts)}</span>
                  </span>
                  <button
                    type="button"
                    className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-slate-300 hover:bg-white/[0.08]"
                    onClick={() => {
                      setOperatorEventsQuery('')
                      setOperatorEventsOperatorId('all')
                      setOperatorEventsKind('all')
                      setOperatorEventsStatus('all')
                      setOperatorEventsDateFrom('')
                      setOperatorEventsDateTo('')
                      setOperatorEventsLimit(100)
                    }}
                  >
                    Сбросить фильтры
                  </button>
                </div>
                {operatorEventsByOperator.length > 0 ? (
                  <div className="mb-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {operatorEventsByOperator.map((row) => (
                      <div key={row.operatorId} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="truncate text-sm font-medium text-white">{row.operatorName}</div>
                          <button
                            type="button"
                            className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-slate-300 hover:bg-white/[0.08]"
                            onClick={() => setOperatorEventsOperatorId(row.operatorId)}
                          >
                            Показать
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-400">
                          <span>События</span>
                          <span className="text-right text-white">{row.events}</span>
                          <span>К выплате</span>
                          <span className="text-right text-emerald-300">{money(row.toPay)}</span>
                          <span>Выплачено</span>
                          <span className="text-right text-sky-300">{money(row.paid)}</span>
                          <span>Штрафы+долги</span>
                          <span className="text-right text-rose-300">{money(row.deductions)}</span>
                          <span>Авансы</span>
                          <span className="text-right text-amber-300">{money(row.advances)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {loading && filteredOperatorGlobalTimeline.length === 0 ? (
                  <div className="space-y-2">
                    {Array.from({ length: 8 }).map((_, idx) => (
                      <Skeleton key={idx} className="h-10 rounded-xl" />
                    ))}
                  </div>
                ) : filteredOperatorGlobalTimeline.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-center text-sm text-slate-500">
                    За выбранную неделю нет событий по фильтрам.
                  </div>
                ) : (
                  <div className="max-h-[65vh] space-y-2 overflow-y-auto pr-1">
                    {groupedVisibleOperatorEvents.map(([dateKey, events]) => (
                      <div key={dateKey} className="space-y-2">
                        <div className="sticky top-0 z-10 rounded-lg bg-slate-900/90 px-2 py-1 text-[11px] text-slate-400 backdrop-blur">
                          {formatRuDate(dateKey)}
                        </div>
                        {events.map((ev) => {
                          const tone =
                            ev.kind === 'week_total'
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                              : ev.kind === 'payment'
                                ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                                : ev.kind === 'bonus'
                                  ? 'border-violet-500/30 bg-violet-500/10 text-violet-300'
                                  : ev.kind === 'advance'
                                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                                    : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                          const label =
                            ev.kind === 'week_total'
                              ? 'итог недели'
                              : ev.kind === 'payment'
                                ? 'выплата'
                                : ev.kind === 'bonus'
                                  ? 'бонус'
                                  : ev.kind === 'advance'
                                    ? 'аванс'
                                    : ev.kind === 'fine'
                                      ? 'штраф'
                                      : 'долг'
                          const kindHint =
                            ev.kind === 'week_total'
                              ? 'Финальная сумма к выплате за неделю'
                              : ev.kind === 'payment'
                                ? 'Фактическая выплата оператору'
                                : ev.kind === 'bonus'
                                  ? 'Премия за неделю'
                                  : ev.kind === 'advance'
                                    ? 'Аванс, выданный в течение недели'
                                    : ev.kind === 'fine'
                                      ? 'Штраф за неделю'
                                      : 'Долг за товары/удержания'
                          return (
                            <div key={ev.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone}`}>{label}</span>
                                  <span className="text-slate-300">{ev.operator_name}</span>
                                  {ev.status === 'voided' ? <span className="text-slate-500">(аннулировано)</span> : null}
                                </div>
                                <span className="ml-3 shrink-0 font-medium text-white">{money(ev.amount)}</span>
                              </div>
                              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                <span>{kindHint}</span>
                                <span>•</span>
                                <span>Дата: {formatRuDate(ev.date)}</span>
                              </div>
                              {ev.comment ? <div className="mt-1.5 text-[11px] text-slate-400">{ev.comment}</div> : null}
                            </div>
                          )
                        })}
                      </div>
                    ))}
                    {visibleOperatorGlobalTimeline.length < filteredOperatorGlobalTimeline.length ? (
                      <div className="flex justify-center pt-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                          onClick={() => setOperatorEventsLimit((prev) => prev + 100)}
                        >
                          Показать ещё
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* ── STAFF TAB ───────────────────────────────────────────────────── */}
          {tab === 'staff' && canViewStaffSalary && (
          <Card className="overflow-hidden border-white/10 bg-white/[0.04]">
            <div className="flex items-center justify-between gap-4 border-b border-white/10 p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-violet-500/15 p-3 text-violet-300"><Users className="h-5 w-5" /></div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Зарплатная ведомость Административных сотрудников</h2>
                  <p className="text-sm text-slate-400">Фиксированный оклад, выплата 1-го и 15-го. Бонусы, штрафы, долги, авансы, доп. выходы.</p>
                  {staffSalary?.consistency?.has_issues ? (
                    <p className="mt-2 text-xs text-amber-300">
                      Проверка консистентности: отсутствуют/лишние расходы по зарплате ({staffSalary.consistency.missing_payment_expense_count}
                      /{staffSalary.consistency.orphan_payment_expense_count}) и авансам ({staffSalary.consistency.missing_advance_expense_count}
                      /{staffSalary.consistency.orphan_advance_expense_count}).
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-emerald-300">Проверка консистентности: выплаты и авансы синхронизированы с расходами.</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className={
                    'rounded-xl border-white/10 text-xs ' +
                    (showStaffArchived ? 'bg-amber-400/20 text-amber-100 hover:bg-amber-400/30' : 'bg-white/5 text-slate-300 hover:bg-white/10')
                  }
                  onClick={() => setShowStaffArchived((v) => !v)}
                  title={showStaffArchived ? 'Скрыть уволенных' : 'Показать архив'}
                >
                  {showStaffArchived ? 'Архив открыт' : 'Архив'}
                </Button>
                <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => void loadStaffSalary()}><RefreshCw className="h-4 w-4" /></Button>
              </div>
            </div>
            {staffSalaryLoading ? (
              <div className="space-y-4 p-5">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <div key={idx} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-11 w-11 rounded-2xl" />
                        <div className="space-y-2">
                          <Skeleton className="h-4 w-40" />
                          <Skeleton className="h-3 w-28" />
                        </div>
                      </div>
                      <Skeleton className="h-9 w-28 rounded-xl" />
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                      {Array.from({ length: 5 }).map((__, i) => (
                        <Skeleton key={i} className="h-16 rounded-2xl" />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : !staffSalary || staffSalary.staff.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-500">Нет административных сотрудников. Добавьте записи в таблицу <code className="rounded bg-white/10 px-1">staff</code>.</div>
            ) : (
              <div className="divide-y divide-white/5">
                {staffSalary.staff.map((s) => {
                  const calc = calcStaffToPay(s, staffSalary.adjustments, staffSalary.payments, currentStaffSalaryPeriod)
                  const activeAdjs = filterStaffAdjustmentsForSlot(
                    staffSalary.adjustments,
                    s.id,
                    staffSalary.payments,
                    currentStaffSalaryPeriod,
                  )
                  const currentMonthPayments = staffSalary.payments.filter(
                    (p) => p.staff_id === s.id && monthPrefixFromPaymentDate(p.pay_date) === currentStaffSalaryMonthPrefix,
                  )
                  const hasFirstPayoutThisMonth = currentMonthPayments.some((p) => p.slot === 'first')
                  const hasSecondPayoutThisMonth = currentMonthPayments.some((p) => p.slot === 'second')
                  // Месячная картина: оклад с учётом корректировок месяца − выплачено за месяц.
                  const paidThisMonth = currentMonthPayments.reduce((sum, p) => sum + Math.round(Number(p.amount || 0)), 0)
                  const monthAdjs = staffSalary.adjustments.filter(
                    (a) => a.staff_id === s.id && String(a.date || '').startsWith(currentStaffSalaryMonthPrefix) && String(a.status || 'active') === 'active',
                  )
                  const sumMonthKind = (k: StaffAdjustment['kind']) => monthAdjs.filter((a) => a.kind === k).reduce((x, a) => x + Math.round(Number(a.amount || 0)), 0)
                  const mBonus = sumMonthKind('bonus')
                  const mFine = sumMonthKind('fine')
                  const mDebt = sumMonthKind('debt')
                  const mAdvance = sumMonthKind('advance')
                  const monthlyDue = Math.round(s.monthly_salary + mBonus - mFine - mDebt - mAdvance)
                  const remainingMonth = monthlyDue - paidThisMonth
                  // Оба слота (1-е и 15-е) использованы — сервер не примет 3-ю выплату.
                  const bothSlotsUsed = hasFirstPayoutThisMonth && hasSecondPayoutThisMonth
                  // Месяц «закрыт», только когда оба слота проведены И остаток покрыт.
                  const isMonthClosed = bothSlotsUsed && remainingMonth <= 0
                  const recentPayments = staffSalary.payments
                    .filter((p) => p.staff_id === s.id && String(p.pay_date || '').startsWith(currentStaffSalaryMonthPrefix))
                    .slice(0, 3)
                  const recentPaymentDetails = recentPayments.map((payment) => {
                    const closingWindow = getStaffPaymentClosingWindow(s.id, staffSalary.payments, payment.pay_date, payment.id)
                    const closedAdjustments = getStaffPaymentClosedAdjustments({
                      staffId: s.id,
                      adjustments: staffSalary.adjustments,
                      payment,
                      closingWindow,
                    })
                    const generatedAdjustments = getStaffPaymentGeneratedAdjustments({
                      staffId: s.id,
                      adjustments: staffSalary.adjustments,
                      payment,
                    })
                    return { payment, closedAdjustments, generatedAdjustments, closingWindow }
                  })
                  const recentlyClosedAdjustmentsCount = recentPaymentDetails.reduce(
                    (sum, item) => sum + item.closedAdjustments.length,
                    0,
                  )
                  const isOperatorBased = s.source_type === 'operator'
                  const isDismissed = s.is_active === false
                  const dismissedDateLabel = isDismissed
                    ? String(s.dismissal_date || s.dismissed_at || '').slice(0, 10)
                    : null
                  return (
                    <div key={s.id} className={'p-5 ' + (isDismissed ? 'opacity-60' : '')}>
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className={'flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-semibold text-white ' + (isDismissed ? 'bg-gradient-to-br from-slate-600 to-slate-700' : 'bg-gradient-to-br from-violet-500 to-purple-600')}>
                            {(s.short_name || s.full_name).charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <div className="font-semibold text-white">{s.full_name}</div>
                              {isDismissed ? (
                                <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-200">
                                  Уволен{dismissedDateLabel ? ` · ${dismissedDateLabel}` : ''}
                                </span>
                              ) : null}
                            </div>
                            <div className="text-xs text-slate-400">
                              {formatRoleLabel(s.role)}
                              {isOperatorBased ? ' · из operators' : ` · Оклад: ${money(s.monthly_salary)}/мес`}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {!isDismissed && canStaffAddAdjustment && (
                            <Button type="button" disabled={!canEditStaffSalary || isOperatorBased} variant="outline" className="h-9 rounded-xl border-white/10 bg-white/5 text-xs text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => { setStaffAdjModal(s); setStaffAdjKind('fine'); setStaffAdjCompanyId(data?.companies?.[0]?.id || ''); setStaffAdjAmount(''); setStaffAdjDate(todayISO()); setStaffAdjComment('') }}><Plus className="mr-1.5 h-3.5 w-3.5" />Корректировка</Button>
                          )}
                          {!isDismissed && canStaffAddExtraDay && (
                            <Button type="button" disabled={!canEditStaffSalary || isOperatorBased} variant="outline" className="h-9 rounded-xl border-white/10 bg-white/5 text-xs text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void submitStaffExtraDay(s.id)}><CalendarDays className="mr-1.5 h-3.5 w-3.5" />Доп. выход</Button>
                          )}
                          {!isDismissed && !isOperatorBased && canEditStaffSalary && calc.debts > 0 && (
                            <Button type="button" variant="outline" className="h-9 rounded-xl border-rose-400/30 bg-rose-500/10 text-xs text-rose-200 hover:bg-rose-500/20" onClick={() => openPayDebt(s, calc.debts)}>
                              <Wallet className="mr-1.5 h-3.5 w-3.5" />
                              Оплата долга ({money(calc.debts)})
                            </Button>
                          )}
                          {!isDismissed && canStaffCreatePayment && (
                            <Button type="button" disabled={!canEditStaffSalary || isOperatorBased || remainingMonth <= 0} className="h-9 rounded-xl bg-emerald-500 text-xs text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => { setStaffPayModal(s); setStaffPayDate(todayISO()); setStaffPaySlot(bothSlotsUsed ? 'extra' : (hasFirstPayoutThisMonth ? 'second' : 'first')); setStaffPayCash(remainingMonth > 0 ? String(remainingMonth) : ''); setStaffPayKaspi(''); setStaffPayComment(''); setStaffPayCompanyId(data?.companies?.[0]?.id || '') }}><Wallet className="mr-1.5 h-3.5 w-3.5" />Выплатить{remainingMonth > 0 ? ` (${money(remainingMonth)})` : ''}</Button>
                          )}
                        </div>
                      </div>
                      {isMonthClosed ? (
                        <div className="mt-2 text-xs text-emerald-300">Оклад за месяц закрыт: выплачено полностью.</div>
                      ) : bothSlotsUsed && remainingMonth > 0 ? (
                        <div className="mt-2 text-xs text-amber-300">Оба плановых слота проведены, остаётся {money(remainingMonth)}. Нажми «Выплатить» — проведём доплату остатка.</div>
                      ) : null}
                      <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-center"><div className="text-[11px] uppercase tracking-wide text-slate-500">Оклад / мес</div><div className="mt-1 text-sm font-semibold text-white">{money(s.monthly_salary)}</div></div>
                        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3 text-center"><div className="text-[11px] uppercase tracking-wide text-emerald-400/70">Бонусы</div><div className="mt-1 text-sm font-semibold text-emerald-300">+{money(mBonus)}</div></div>
                        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] p-3 text-center"><div className="text-[11px] uppercase tracking-wide text-rose-400/70">Штрафы / долги</div><div className="mt-1 text-sm font-semibold text-rose-300">−{money(mFine + mDebt)}</div></div>
                        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-3 text-center"><div className="text-[11px] uppercase tracking-wide text-amber-400/70">Авансы</div><div className="mt-1 text-sm font-semibold text-amber-300">−{money(mAdvance)}</div></div>
                        <div className="rounded-2xl border border-sky-500/20 bg-sky-500/[0.06] p-3 text-center"><div className="text-[11px] uppercase tracking-wide text-sky-400/70">Выплачено</div><div className="mt-1 text-sm font-semibold text-sky-300">{money(paidThisMonth)}</div></div>
                        <div className={'rounded-2xl border p-3 text-center ' + (remainingMonth > 0 ? 'border-white/15 bg-white/[0.06]' : 'border-emerald-500/30 bg-emerald-500/[0.08]')}><div className="text-[11px] uppercase tracking-wide text-slate-400">Остаток</div><div className={'mt-1 text-base font-bold ' + (remainingMonth > 0 ? 'text-white' : 'text-emerald-300')}>{remainingMonth < 0 ? `+${money(-remainingMonth)}` : money(remainingMonth)}</div></div>
                      </div>
                      {activeAdjs.length > 0 ? (
                        <div className="mt-3 space-y-1.5">
                          <div className="mb-1 text-xs text-slate-500">Активные корректировки:</div>
                          {activeAdjs.map(adj => (
                            <div key={adj.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${adj.kind === 'bonus' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : adj.kind === 'advance' ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300'}`}>
                                  {staffAdjustmentKindLabel(adj.kind)}
                                </span>
                                <span className="font-medium text-white">{money(adj.amount)}</span>
                                <span className="text-slate-500">{adj.date}</span>
                                {adj.comment ? <span className="text-slate-400">{adj.comment}</span> : null}
                              </div>
                              {!adj.id.startsWith('operator-debt:') && canEditStaffSalary ? (
                                <button type="button" className="ml-3 shrink-0 text-slate-500 transition hover:text-rose-300" onClick={() => void removeStaffAdjustment(adj.id)}><X className="h-3.5 w-3.5" /></button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : recentlyClosedAdjustmentsCount > 0 ? (
                        <div className="mt-3 rounded-xl border border-sky-500/20 bg-sky-500/[0.06] px-3 py-2 text-xs text-sky-200">
                          Долги и другие корректировки не пропали: они закрыты выплатой и показаны ниже в последних выплатах.
                        </div>
                      ) : null}
                      {(() => {
                        const debtPays = (staffSalary.debtPayments || []).filter((p) => p.staff_id === s.id)
                        if (debtPays.length === 0) return null
                        return (
                          <div className="mt-3">
                            <div className="mb-1 text-xs text-slate-500">Оплаченные долги:</div>
                            <div className="space-y-1.5">
                              {debtPays.map((p) => (
                                <div key={p.id} className="flex items-center justify-between rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 text-xs">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">оплата долга</span>
                                    <span className="font-medium text-white">{money(p.amount)}</span>
                                    <span className="text-slate-500">{String(p.paid_at || '').slice(0, 10)}</span>
                                    {p.comment ? <span className="text-slate-400">{p.comment}</span> : null}
                                  </div>
                                  {canEditStaffSalary ? (
                                    <button type="button" title="Аннулировать оплату долга" disabled={voidDebtPayId === p.id} className="ml-3 shrink-0 text-slate-500 transition hover:text-rose-300 disabled:opacity-50" onClick={() => void voidStaffDebtPayment(p.id)}>
                                      {voidDebtPayId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                                    </button>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      })()}
                      {recentPayments.length > 0 ? (
                        <div className="mt-3">
                          <div className="mb-1 text-xs text-slate-500">Последние выплаты:</div>
                          <div className="flex flex-wrap gap-2">
                            {recentPaymentDetails.map(({ payment, closedAdjustments, generatedAdjustments, closingWindow }) => (
                              <div key={payment.id} className="min-w-[260px] rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
                                <div className="flex items-center justify-between gap-2">
                                  <span>{payment.pay_date} · {money(payment.amount)} · {staffPaymentSlotLabel(payment.slot)}</span>
                                  {canEditStaffSalary ? (
                                    <button type="button" title="Аннулировать" onClick={() => void deleteStaffPayment(payment.id, payment.amount)} className="ml-1 shrink-0 text-slate-600 transition hover:text-rose-400"><X className="h-3.5 w-3.5" /></button>
                                  ) : null}
                                </div>
                                <div className="mt-1 text-[11px] text-slate-500">Период закрытия: {closingWindow.label}</div>
                                {closedAdjustments.length > 0 ? (
                                  <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
                                    {closedAdjustments.slice(0, 4).map((adj) => (
                                      <div key={adj.id} className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                                        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${staffAdjustmentTone(adj.kind)}`}>
                                          закрыто: {staffAdjustmentKindLabel(adj.kind)}
                                        </span>
                                        <span className="font-medium text-white">{money(adj.amount)}</span>
                                        <span>{adj.date}</span>
                                        {adj.comment ? <span className="truncate">{adj.comment}</span> : null}
                                      </div>
                                    ))}
                                    {closedAdjustments.length > 4 ? (
                                      <div className="text-[11px] text-slate-500">Ещё закрыто: {closedAdjustments.length - 4}</div>
                                    ) : null}
                                  </div>
                                ) : null}
                                {generatedAdjustments.length > 0 ? (
                                  <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
                                    {generatedAdjustments.map((adj) => (
                                      <div key={adj.id} className="flex flex-wrap items-center gap-1.5 text-[11px] text-amber-200">
                                        <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${staffAdjustmentTone(adj.kind)}`}>
                                          создано: {staffAdjustmentKindLabel(adj.kind)}
                                        </span>
                                        <span className="font-medium text-white">{money(adj.amount)}</span>
                                        <span>на следующую выплату</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
          )}

          {/* ── EVENTS TAB ─────────────────────────────────────────────────── */}
          {tab === 'events' && (
            <Card className="overflow-hidden border-white/10 bg-white/[0.04]">
              <div className="flex items-center justify-between gap-4 border-b border-white/10 p-5">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-cyan-500/15 p-3 text-cyan-300">
                    <CalendarDays className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-white">Лента событий</h2>
                    <p className="text-sm text-slate-400">Общий поток выплат и корректировок по административным сотрудникам.</p>
                  </div>
                </div>
                <div className="text-xs text-slate-400">
                  Событий: <span className="font-semibold text-white">{staffGlobalTimeline.length}</span>
                </div>
              </div>
              <div className="p-5">
                <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                  <input
                    className={input}
                    type="text"
                    value={eventsQuery}
                    onChange={(e) => setEventsQuery(e.target.value)}
                    placeholder="Поиск: сотрудник, комментарий, тип"
                  />
                  <select className={selectCls} value={eventsStaffId} onChange={(e) => setEventsStaffId(e.target.value as any)}>
                    <option value="all">Все сотрудники</option>
                    {(staffSalary?.staff || []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name || s.short_name || s.id}
                      </option>
                    ))}
                  </select>
                  <select className={selectCls} value={eventsKind} onChange={(e) => setEventsKind(e.target.value as any)}>
                    <option value="all">Все типы</option>
                    <option value="payment">Выплаты</option>
                    <option value="bonus">Бонусы</option>
                    <option value="fine">Штрафы</option>
                    <option value="debt">Долги</option>
                    <option value="advance">Авансы</option>
                  </select>
                  <select className={selectCls} value={eventsStatus} onChange={(e) => setEventsStatus(e.target.value as any)}>
                    <option value="all">Любой статус</option>
                    <option value="active">Активные</option>
                    <option value="paid">Закрытые выплатой</option>
                    <option value="voided">Аннулированные</option>
                  </select>
                  <input className={input} type="date" value={eventsDateFrom} onChange={(e) => setEventsDateFrom(e.target.value)} />
                  <input className={input} type="date" value={eventsDateTo} onChange={(e) => setEventsDateTo(e.target.value)} />
                </div>
                <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-300">
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">
                    Событий: <span className="font-semibold text-white">{eventsSummary.total}</span>
                  </span>
                  <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-3 py-1 text-sky-200">
                    Выплаты: <span className="font-semibold text-white">{money(eventsSummary.payments)}</span>
                  </span>
                  <span className="rounded-full border border-rose-500/20 bg-rose-500/10 px-3 py-1 text-rose-200">
                    Удержания: <span className="font-semibold text-white">{money(eventsSummary.deductions)}</span>
                  </span>
                  <button
                    type="button"
                    className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-slate-300 hover:bg-white/[0.08]"
                    onClick={() => {
                      setEventsQuery('')
                      setEventsStaffId('all')
                      setEventsKind('all')
                      setEventsStatus('all')
                      setEventsDateFrom('')
                      setEventsDateTo('')
                      setEventsLimit(100)
                    }}
                  >
                    Сбросить фильтры
                  </button>
                </div>
                {staffSalaryLoading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 8 }).map((_, idx) => (
                      <Skeleton key={idx} className="h-10 rounded-xl" />
                    ))}
                  </div>
                ) : filteredStaffGlobalTimeline.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] p-8 text-center text-sm text-slate-500">
                    Пока нет событий для отображения.
                  </div>
                ) : (
                  <div className="max-h-[65vh] space-y-2 overflow-y-auto pr-1">
                    {groupedVisibleEvents.map(([dateKey, events]) => (
                      <div key={dateKey} className="space-y-2">
                        <div className="sticky top-0 z-10 rounded-lg bg-slate-900/90 px-2 py-1 text-[11px] text-slate-400 backdrop-blur">
                          {formatRuDate(dateKey)}
                        </div>
                        {events.map((ev) => {
                          const isPayment = ev.kind === 'payment'
                          const tone = isPayment
                            ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                            : ev.kind === 'bonus'
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                              : ev.kind === 'advance'
                                ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                                : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                          const label = isPayment
                            ? 'выплата'
                            : ev.kind === 'bonus'
                              ? 'бонус'
                              : ev.kind === 'advance'
                                ? 'аванс'
                                : ev.kind === 'fine'
                                  ? 'штраф'
                                  : 'долг'
                          return (
                            <div key={ev.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone}`}>{label}</span>
                                <span className="text-slate-300">{ev.staff_name}</span>
                                {ev.status === 'paid' ? <span className="text-sky-400">(закрыто выплатой)</span> : null}
                                {ev.status === 'voided' ? <span className="text-slate-500">(аннулировано)</span> : null}
                                {ev.comment ? <span className="truncate text-slate-400">{ev.comment}</span> : null}
                              </div>
                              <span className="ml-3 shrink-0 font-medium text-white">{money(ev.amount)}</span>
                            </div>
                          )
                        })}
                      </div>
                    ))}
                    {visibleStaffGlobalTimeline.length < filteredStaffGlobalTimeline.length ? (
                      <div className="flex justify-center pt-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10"
                          onClick={() => setEventsLimit((prev) => prev + 100)}
                        >
                          Показать ещё
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </Card>
          )}

        </div>

      {advanceTarget ? (
        <Modal title="Выдать аванс" subtitle={`${getOperatorDisplayName(advanceTarget.operator)} • ${formatRuDate(weekStart)} - ${formatRuDate(weekEnd)}`} onClose={() => setAdvanceTarget(null)}>
          <form className="space-y-4" onSubmit={submitAdvance}>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-slate-300">Точка</label>
                <select className={selectCls} value={advanceCompanyId} onChange={(e) => setAdvanceCompanyId(e.target.value)}>
                  {(data?.companies || []).map((c) => <option key={c.id} value={c.id}>{c.name || c.code || c.id}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-300">Дата выплаты</label>
                <input className={input} type="date" value={advanceDate} onChange={(e) => setAdvanceDate(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-300">Наличные</label>
                <input className={input} type="text" value={advanceCash} onChange={(e) => setAdvanceCash(e.target.value)} placeholder="0" />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-300">{cashLabels.providerName}</label>
                <input className={input} type="text" value={advanceKaspi} onChange={(e) => setAdvanceKaspi(e.target.value)} placeholder="0" />
              </div>
            </div>
            <textarea className={textarea} value={advanceComment} onChange={(e) => setAdvanceComment(e.target.value)} placeholder="Комментарий" />
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">Итого аванс: <span className="font-semibold text-white">{money(parseMoney(advanceCash) + parseMoney(advanceKaspi))}</span></div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setAdvanceTarget(null)}>Отмена</Button>
              <Button type="submit" className="rounded-xl bg-emerald-500 text-white hover:bg-emerald-400">{advanceSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Выдать аванс'}</Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {payTarget ? (
        <Modal title="Выплатить зарплату" subtitle={`${getOperatorDisplayName(payTarget.operator)} • остаток ${money(payTarget.week.remainingAmount)}`} onClose={() => setPayTarget(null)}>
          <form className="space-y-4" onSubmit={submitPayment}>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-slate-300">Дата выплаты</label>
                <input className={input} type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">Эта выплата автоматически разложится по компаниям по фактическому начислению.</div>
              <div>
                <label className="mb-2 block text-sm text-slate-300">Наличные</label>
                <input className={input} type="text" value={payCash} onChange={(e) => setPayCash(e.target.value)} placeholder="0" />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-300">{cashLabels.providerName}</label>
                <input className={input} type="text" value={payKaspi} onChange={(e) => setPayKaspi(e.target.value)} placeholder="0" />
              </div>
            </div>
            <textarea className={textarea} value={payComment} onChange={(e) => setPayComment(e.target.value)} placeholder="Комментарий" />
            {(() => {
              const total = parseMoney(payCash) + parseMoney(payKaspi)
              const remaining = payTarget.week.remainingAmount
              const overpayment = Math.max(0, total - remaining)
              const showAdvanceRow = overpayment > 0.009
              return (
                <>
                  <label className="flex items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-100">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-amber-400"
                      checked={payAllowOverpayment}
                      onChange={(e) => setPayAllowOverpayment(e.target.checked)}
                    />
                    <span>
                      <span className="font-semibold text-white">Выдать сверх остатка как аванс</span>
                      <span className="block text-xs text-amber-200/80 mt-0.5">
                        Если сумма выплаты превышает {money(remaining)} — разница уйдёт авансом и вычтется со следующей недели.
                      </span>
                    </span>
                  </label>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
                    <div className="flex justify-between">
                      <span>Выплата сейчас:</span>
                      <span className="font-semibold text-white">{money(total)}</span>
                    </div>
                    <div className="mt-1 flex justify-between text-xs text-slate-400">
                      <span>В счёт текущей недели:</span>
                      <span>{money(Math.min(total, remaining))}</span>
                    </div>
                    {showAdvanceRow ? (
                      <div className="mt-1 flex justify-between text-xs text-amber-200">
                        <span>Аванс на следующую неделю:</span>
                        <span className="font-semibold">{money(overpayment)}</span>
                      </div>
                    ) : null}
                  </div>
                </>
              )
            })()}
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setPayTarget(null)}>Отмена</Button>
              <Button type="submit" className="rounded-xl bg-emerald-500 text-white hover:bg-emerald-400">{paySaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Провести выплату'}</Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {chatTarget ? (
        <Modal title="Telegram chat_id" subtitle={getOperatorDisplayName(chatTarget.operator)} onClose={() => setChatTarget(null)}>
          <form className="space-y-4" onSubmit={saveChatId}>
            <input className={input} type="text" value={chatValue} onChange={(e) => setChatValue(e.target.value)} placeholder="Например: -1001234567890" />
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setChatTarget(null)}>Отмена</Button>
              <Button type="submit" className="rounded-xl bg-emerald-500 text-white hover:bg-emerald-400">{chatSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Сохранить'}</Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {payDebtModal ? (
        <Modal title="Оплата долга" subtitle={payDebtModal.staff.full_name} onClose={() => setPayDebtModal(null)}>
          <div className="space-y-4">
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] p-4 text-center">
              <div className="text-[11px] uppercase tracking-wide text-rose-400/70">Сумма долга к оплате</div>
              <div className="mt-1 text-2xl font-bold text-rose-200">{money(payDebtModal.amount)}</div>
            </div>
            <p className="text-xs text-slate-400">
              Долг будет помечен оплаченным и убран из вычета зарплаты. Запись появится в «Оплаченные долги» — её можно аннулировать (долг вернётся активным).
            </p>
            <div>
              <label className="mb-2 block text-sm text-slate-300">Комментарий (необязательно)</label>
              <textarea className={textarea} placeholder="Например: вернул наличными" value={payDebtComment} onChange={(e) => setPayDebtComment(e.target.value)} />
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setPayDebtModal(null)}>Отмена</Button>
              <Button type="button" onClick={() => void confirmPayStaffDebt()} disabled={payDebtSaving} className="rounded-xl bg-emerald-500 text-white hover:bg-emerald-400 disabled:opacity-50">
                {payDebtSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Wallet className="mr-1.5 h-4 w-4" />Оплатить долг</>}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {staffAdjModal ? (
        <Modal title="Корректировка" subtitle={staffAdjModal.full_name} onClose={() => setStaffAdjModal(null)}>
          <form className="space-y-4" onSubmit={submitStaffAdjustment}>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-slate-300">Тип</label>
                <select className={selectCls} value={staffAdjKind} onChange={e => setStaffAdjKind(e.target.value as any)}>
                  <option value="fine">Штраф</option>
                  <option value="debt">Долг</option>
                  <option value="bonus">Бонус</option>
                  <option value="advance">Аванс</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-300">Дата</label>
                <input className={input} type="date" value={staffAdjDate} onChange={e => setStaffAdjDate(e.target.value)} />
              </div>
              {staffAdjKind === 'advance' ? (
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm text-slate-300">Компания (расход по авансу)</label>
                  <select className={selectCls} value={staffAdjCompanyId} onChange={e => setStaffAdjCompanyId(e.target.value)}>
                    <option value="">Выберите компанию</option>
                    {(data?.companies || []).map((c) => (
                      <option key={c.id} value={c.id}>{c.name || c.code || c.id}</option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="md:col-span-2">
                <label className="mb-2 block text-sm text-slate-300">Сумма</label>
                <input className={input} type="text" placeholder="0" value={staffAdjAmount} onChange={e => setStaffAdjAmount(e.target.value)} />
              </div>
            </div>
            <textarea className={textarea} placeholder="Комментарий" value={staffAdjComment} onChange={e => setStaffAdjComment(e.target.value)} />
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setStaffAdjModal(null)}>Отмена</Button>
              <Button type="submit" className="rounded-xl bg-emerald-500 text-white hover:bg-emerald-400">{staffAdjSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Сохранить'}</Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {staffPayModal ? (
        <Modal title="Выплата зарплаты" subtitle={`${staffPayModal.full_name} · ${staffPaySlot === 'extra' ? 'доплата остатка' : `к выплате ${money(calcStaffToPay(staffPayModal, staffSalary?.adjustments || [], staffSalary?.payments || [], getStaffPaymentAdjustmentPeriod(staffPayDate, staffPaySlot)).toPay)}`}`} onClose={() => setStaffPayModal(null)}>
          <form className="space-y-4" onSubmit={submitStaffPayment}>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-slate-300">Слот</label>
                {staffPaySlot === 'extra' ? (
                  <input className={input} value="Доплата остатка" readOnly />
                ) : (
                  <select className={selectCls} value={staffPaySlot} onChange={e => setStaffPaySlot(e.target.value as 'first' | 'second' | 'extra')}>
                    <option value="first">Выплата 1-го числа</option>
                    <option value="second">Выплата 15-го числа</option>
                  </select>
                )}
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-300">Дата выплаты</label>
                <input className={input} type="date" value={staffPayDate} onChange={e => setStaffPayDate(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-300">Компания (расход)</label>
                <select className={selectCls} value={staffPayCompanyId} onChange={e => setStaffPayCompanyId(e.target.value)}>
                  <option value="">Выберите компанию</option>
                  {(data?.companies || []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name || c.code || c.id}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-300">Наличные</label>
                <input className={input} type="text" placeholder="0" value={staffPayCash} onChange={e => setStaffPayCash(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-300">{cashLabels.providerName}</label>
                <input className={input} type="text" placeholder="0" value={staffPayKaspi} onChange={e => setStaffPayKaspi(e.target.value)} />
              </div>
            </div>
            {staffPayPreview ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs text-slate-300">
                <div className="mb-2 text-sm font-medium text-white">Предпросмотр проводки</div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div>Период закрытия: <span className="text-white">{staffPayPreview.closingWindow.label}</span></div>
                  <div>Очередь: <span className="text-white">{staffPaymentSlotLabel(staffPaySlot)}</span></div>
                  <div>Закроется корректировок: <span className="text-white">{staffPayPreview.closingAdjustments.length}</span></div>
                  <div>Расход (компания): <span className="text-white">{staffPayPreview.companyName}</span></div>
                  <div>Расход (нал/{cashLabels.providerName}): <span className="text-white">{money(staffPayPreview.payCashAmount)} / {money(staffPayPreview.payKaspiAmount)}</span></div>
                  <div>К выплате по расчёту: <span className="text-white">{money(staffPayPreview.calc.toPay)}</span></div>
                  <div>Сейчас будет выплачено: <span className="text-white">{money(staffPayPreview.payTotal)}</span></div>
                </div>
                {staffPayPreview.closingAdjustments.length > 0 ? (
                  <div className="mt-3 max-h-28 space-y-1 overflow-y-auto pr-1">
                    {staffPayPreview.closingAdjustments.map((adj) => (
                      <div key={adj.id} className="flex items-center justify-between rounded-lg border border-white/10 px-2 py-1">
                        <span className="text-slate-400">{adj.date} · {staffAdjustmentKindLabel(adj.kind)}</span>
                        <span className="text-white">{money(adj.amount)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <textarea className={textarea} placeholder="Комментарий" value={staffPayComment} onChange={e => setStaffPayComment(e.target.value)} />
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">Итого: <span className="font-semibold text-white">{money(parseMoney(staffPayCash) + parseMoney(staffPayKaspi))}</span></div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setStaffPayModal(null)}>Отмена</Button>
              <Button type="submit" className="rounded-xl bg-emerald-500 text-white hover:bg-emerald-400">{staffPaySaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Провести выплату'}</Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {broadcastConfirm ? (
        <Modal title="Отправить расчёт всем?" subtitle={`Рассылка Telegram для ${broadcastTargets.length} операторов с активным chat_id`} onClose={() => setBroadcastConfirm(false)}>
          <div className="space-y-4">
            <p className="text-sm text-slate-300">Каждый оператор получит сообщение со своим расчётом за неделю {formatRuDate(weekStart)} — {formatRuDate(weekEnd)}.</p>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setBroadcastConfirm(false)}>Отмена</Button>
              <Button type="button" className="rounded-xl bg-blue-500 text-white hover:bg-blue-400" onClick={() => { setBroadcastConfirm(false); void sendAll() }}><Send className="mr-2 h-4 w-4" />Отправить</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
