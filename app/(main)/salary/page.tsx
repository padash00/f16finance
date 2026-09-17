'use client'

import { FormEvent, Fragment, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { downloadReportPdf } from '@/lib/client/download-pdf'
import { useApiCache } from '@/lib/client/use-api-cache'
import { useToday } from '@/lib/client/use-today'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { useCashlessLabels } from '@/lib/client/use-cashless-labels'
import { useTableSort } from '@/lib/client/use-table-sort'
import type { SortColumns } from '@/lib/core/table-sort'
import { SortableTh } from '@/components/ui/sortable-th'
import { useModalEscape } from '@/lib/client/use-modal-escape'
import Image from 'next/image'
import Link from 'next/link'
import { Building2, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, CreditCard, DollarSign, Download, Loader2, MessageCircle, Pencil, Plus, RefreshCw, Send, TrendingDown, Users, Wallet, X } from 'lucide-react'

import { AdminPageHeader, AdminTableViewport, adminTableStickyTheadClass } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { confirmDialog } from '@/components/ui/confirm-dialog'
import { DatePicker } from '@/components/ui/date-picker'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/use-toast'
import { addDaysISO, formatRuDate, mondayOfDate, toISODateLocal, todayISO } from '@/lib/core/date'
import { formatMoney } from '@/lib/core/format'
import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { getStaffRoleLabel } from '@/lib/core/access'
import {
  calcStaffToPay,
  filterStaffAdjustmentsForSlot,
  getSalarySlotRange,
  getStaffPaymentAdjustmentPeriod,
} from '@/lib/domain/staff-salary-slot'

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
/** Событие ленты операторов — только настоящие записи: выплата, корректировка, позиция долга из кассы. */
type OperatorTimelineEventKind = 'payment' | 'advance' | 'bonus' | 'fine' | 'debt' | 'debt_item'
type OperatorTimelineEvent = {
  id: string
  operator_id: string
  operator_name: string
  date: string
  /** Точное время, где оно есть (выплаты, позиции из кассы) — порядок внутри дня */
  created_at?: string | null
  kind: OperatorTimelineEventKind
  amount: number
  comment: string | null
  /** closed — позиция долга из кассы закрыта выплатой недели (это не аннулирование) */
  status: 'active' | 'voided' | 'closed'
}
/** Корректировка недели поштучно (API /api/admin/salary, view=weekly). */
type OperatorAdjustmentItem = { id: string; date: string; amount: number; kind: string; comment: string | null; companyId: string | null; status: string }
type ShiftBreakdown = { id: string; date: string; shift: string; companyCode: string | null; companyName: string | null; totalIncome: number; baseSalary: number; seniorityBonus?: number; seniorityPercent?: number; autoBonus: number; roleBonus: number; salary: number }

/** Позиция долга из кассы за неделю (API /api/admin/salary, view=weekly). После выплаты недели status='deleted'. */
type OperatorDebtItem = { id: string; name: string; quantity: number; unitPrice: number; amount: number; createdAt: string; companyId: string | null; comment: string | null; status: string }

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
/**
 * Событие ленты административных сотрудников.
 * remainder / overpayment — авто-корректировки выплаты (bonus/advance с source_payment_id);
 * debt_item — позиция долга из кассы; debt_payment — оплата/удержание/аннулирование долга.
 */
type StaffTimelineKind = 'payment' | 'advance' | 'bonus' | 'remainder' | 'fine' | 'debt' | 'overpayment' | 'debt_item' | 'debt_payment'
type StaffTimelineEvent = {
  id: string
  staff_id: string
  staff_name: string
  date: string
  created_at?: string | null
  kind: StaffTimelineKind
  amount: number
  comment: string | null
  /** paid — корректировка закрыта выплатой (это не аннулирование) */
  status: 'active' | 'paid' | 'voided'
}
type StaffEventSortKey = 'date' | 'staff' | 'kind' | 'amount' | 'status' | 'comment'
const STAFF_EVENT_SORT_INITIAL = { key: 'date' as StaffEventSortKey, dir: 'desc' as const }
const STAFF_EVENT_KINDS: StaffTimelineKind[] = ['payment', 'advance', 'bonus', 'remainder', 'fine', 'debt', 'overpayment', 'debt_item', 'debt_payment']
const STAFF_EVENT_KIND_RANK = Object.fromEntries(STAFF_EVENT_KINDS.map((kind, idx) => [kind, idx])) as Record<StaffTimelineKind, number>
const STAFF_EVENT_KIND_META: Record<StaffTimelineKind, { label: string; plural: string; tone: string }> = {
  payment: { label: 'выплата', plural: 'Выплаты', tone: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  advance: { label: 'аванс', plural: 'Авансы', tone: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  bonus: { label: 'бонус', plural: 'Бонусы', tone: 'border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300' },
  remainder: { label: 'остаток по выплате', plural: 'Остатки по выплатам', tone: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  fine: { label: 'штраф', plural: 'Штрафы', tone: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300' },
  debt: { label: 'долг', plural: 'Долги', tone: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300' },
  overpayment: { label: 'переплата по выплате', plural: 'Переплаты', tone: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300' },
  debt_item: { label: 'из кассы', plural: 'Долги из кассы', tone: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300' },
  debt_payment: { label: 'оплата долга', plural: 'Оплаты долгов', tone: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300' },
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

function monthPrefixFromIsoDate(isoDate: string) {
  return isoDate.slice(0, 7)
}

function monthPrefixFromPaymentDate(paymentDate: string | null | undefined) {
  return String(paymentDate || '').slice(0, 7)
}

function staffPaymentSlotLabel(slot: string | null | undefined) {
  if (slot === 'first') return 'выплата 1-го числа'
  if (slot === 'second') return 'выплата 15-го числа'
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

function staffAdjustmentKindLabel(kind: StaffAdjustment['kind']) {
  if (kind === 'bonus') return 'бонус'
  if (kind === 'advance') return 'аванс'
  if (kind === 'fine') return 'штраф'
  return 'долг'
}

function staffAdjustmentTone(kind: StaffAdjustment['kind']) {
  if (kind === 'bonus') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (kind === 'advance') return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  return 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
}

// Лейблы ролей идут из STAFF_ROLE_MATRIX. super_admin спецкейс (нет в матрице).
const formatRoleLabel = (code: string): string => code === 'super_admin' ? 'Супер-админ' : getStaffRoleLabel(code)
type WeeklyOperator = {
  operator: { id: string; name: string; short_name: string | null; full_name: string | null; is_active: boolean; telegram_chat_id: string | null; photo_url: string | null; position: string | null; documents_count: number; expiring_documents: number }
  week: { id: string; weekStart: string; weekEnd: string; grossAmount: number; bonusAmount: number; fineAmount: number; debtAmount: number; debtActiveAmount?: number; advanceAmount: number; netAmount: number; paidAmount: number; remainingAmount: number; status: 'draft' | 'partial' | 'paid'; companyAllocations: Allocation[]; payments: Payment[]; shiftsCount: number; autoBonusTotal: number; seniorityBonusTotal?: number; shifts: ShiftBreakdown[]; debtItems?: OperatorDebtItem[]; adjustments?: OperatorAdjustmentItem[] }
  hasActivity: boolean
}
type SalaryData = { weekStart: string; weekEnd: string; companies: CompanyOption[]; operators: WeeklyOperator[]; totals: { netAmount: number; paidAmount: number; advanceAmount: number; remainingAmount: number; paidOperators: number; totalOperators: number } }
type AdjustmentKind = 'bonus' | 'fine' | 'debt'

const input = 'h-11 w-full rounded-xl border border-border bg-white dark:bg-white/5 px-3 text-sm text-foreground placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none'
const selectCls = 'h-11 w-full rounded-xl border border-border bg-card px-3 text-sm text-foreground focus:border-emerald-400/40 focus:outline-none [color-scheme:light] dark:[color-scheme:dark]'
const textarea = 'min-h-[96px] w-full rounded-2xl border border-border bg-white dark:bg-white/5 px-3 py-3 text-sm text-foreground placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none'
const money = formatMoney
const parseMoney = (v: string) => { const n = Number(v.replace(',', '.').replace(/\s/g, '')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0 }
/**
 * Долг, который ещё можно закрыть кнопкой «Оплатил долг».
 *
 * В колонке «Долги» стоит вся сумма, вычтенная из зарплаты, — включая уже
 * удержанную. Предлагать закрыть удержанный долг нельзя: это те же деньги
 * вторым заходом.
 */
const openDebtAmount = (week: WeeklyOperator['week']) =>
  week.debtActiveAmount === undefined ? week.debtAmount : week.debtActiveAmount

const statusMeta = (s: WeeklyOperator['week']['status']) => s === 'paid' ? { label: 'Выплачено', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' } : s === 'partial' ? { label: 'Частично', className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300' } : { label: 'Не выплачено', className: 'border-slate-500/30 bg-slate-500/10 text-body' }

// ─── Ведомость операторов: сортировка по нажатию на заголовок ─────────────────
type OperatorSortKey = 'name' | 'shifts' | 'accrued' | 'bonuses' | 'deductions' | 'advance' | 'net' | 'paid' | 'remaining' | 'status'
// По смыслу, а не по алфавиту: сначала те, кому ещё платить
const OPERATOR_STATUS_RANK: Record<string, number> = { draft: 0, partial: 1, paid: 2 }
// Как сервер сортировал раньше: сначала самый большой остаток
const OPERATOR_SORT_INITIAL = { key: 'remaining', dir: 'desc' } as const

// ─── Лента операторов ─────────────────────────────────────────────────────────
type OperatorEventSortKey = 'date' | 'operator' | 'kind' | 'amount' | 'status' | 'comment'
const OPERATOR_EVENT_SORT_INITIAL = { key: 'date', dir: 'desc' } as const
// Порядок типов при сортировке по «Тип» и в итогах: деньги оператору → удержания
const OPERATOR_EVENT_KIND_RANK: Record<OperatorTimelineEventKind, number> = { payment: 0, advance: 1, bonus: 2, fine: 3, debt: 4, debt_item: 5 }
const OPERATOR_EVENT_KIND_META: Record<OperatorTimelineEventKind, { label: string; plural: string; tone: string }> = {
  payment: { label: 'выплата', plural: 'Выплаты', tone: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300' },
  advance: { label: 'аванс', plural: 'Авансы', tone: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  bonus: { label: 'бонус', plural: 'Бонусы', tone: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  fine: { label: 'штраф', plural: 'Штрафы', tone: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300' },
  debt: { label: 'долг', plural: 'Долги (корректировки)', tone: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300' },
  debt_item: { label: 'долг из кассы', plural: 'Долги из кассы', tone: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300' },
}

function Modal(props: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  useModalEscape(true, props.onClose)
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-start sm:items-center justify-center bg-white/80 dark:bg-slate-950/80 p-4 backdrop-blur-sm overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) props.onClose() }}
    >
      <div className="w-full max-w-xl my-8 max-h-[calc(100vh-4rem)] overflow-y-auto rounded-3xl border border-border bg-white dark:bg-[#10182b] p-6 shadow-2xl shadow-black/40">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold text-foreground">{props.title}</h3>
            {props.subtitle ? <p className="mt-1 text-sm text-muted-foreground">{props.subtitle}</p> : null}
          </div>
          <Button type="button" variant="outline" className="rounded-xl border-border bg-white dark:bg-white/5 text-body hover:bg-surface-hover" onClick={props.onClose}>Закрыть</Button>
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
  const canStaffCreatePayment = can('salary.create_payment')
  const canStaffAddAdjustment = can('staff.add_adjustment')
  const canStaffAddExtraDay = can('staff.add_extra_day')

  // Текущая неделя — после гидрации, а не при отрисовке.
  //
  // Страница готовится заранее, во время сборки: вычисленная здесь неделя
  // попадала в готовый HTML как неделя сборки. Браузер считал настоящую,
  // разметка расходилась, и React перерисовывал страницу целиком — отсюда
  // мигание при открытии зарплаты. Подробности в useToday.
  const today = useToday()
  const currentWeek = useMemo(
    () => (today ? toISODateLocal(mondayOfDate(new Date(`${today}T12:00:00`))) : ''),
    [today],
  )
  const [weekStart, setWeekStart] = useState('')

  // Первая неделя — текущая; дальше человек листает сам.
  useEffect(() => {
    if (currentWeek && !weekStart) setWeekStart(currentWeek)
  }, [currentWeek, weekStart])
  // error — только для ошибок мутаций; ошибки загрузки отдаёт useApiCache (loadError)
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

  const weekEnd = useMemo(() => (weekStart ? addDaysISO(weekStart, 6) : ''), [weekStart])

  // SWR-кэш: повторное открытие страницы мгновенно показывает прошлые данные,
  // свежие подтягиваются фоном. После мутаций зовём load() (refresh — тихая перезагрузка при наличии кэша).
  const salaryUrl = `/api/admin/salary?view=weekly&weekStart=${encodeURIComponent(weekStart)}`
  // Без недели запрашивать нечего: она появится сразу после гидрации.
  const { data, loading, error: loadError, refreshing, refresh: load } = useApiCache<SalaryData>(salaryUrl, {
    enabled: !!weekStart,
  })

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

  // Ведомость операторов: сортировка по заголовку (общий хук), выбранная строка
  // раскрывает карточку, корректировка открывается у конкретного оператора
  const operatorSortColumns = useMemo<SortColumns<WeeklyOperator, OperatorSortKey>>(
    () => ({
      name: { get: (i) => getOperatorDisplayName(i.operator) },
      shifts: { get: (i) => i.week.shiftsCount || null, defaultDir: 'desc' },
      accrued: { get: (i) => i.week.grossAmount || null, defaultDir: 'desc' },
      bonuses: { get: (i) => i.week.bonusAmount + i.week.autoBonusTotal || null, defaultDir: 'desc' },
      deductions: { get: (i) => i.week.fineAmount + i.week.debtAmount || null, defaultDir: 'desc' },
      advance: { get: (i) => i.week.advanceAmount || null, defaultDir: 'desc' },
      net: { get: (i) => i.week.netAmount, defaultDir: 'desc' },
      paid: { get: (i) => i.week.paidAmount || null, defaultDir: 'desc' },
      remaining: { get: (i) => i.week.remainingAmount || null, defaultDir: 'desc' },
      status: { get: (i) => OPERATOR_STATUS_RANK[i.week.status] ?? 0 },
    }),
    [],
  )
  const { sort: operatorSort, toggle: toggleOperatorSort, sortedRows: sortedOperators } = useTableSort<WeeklyOperator, OperatorSortKey>({
    storageKey: 'salary.operatorsSort',
    columns: operatorSortColumns,
    initial: OPERATOR_SORT_INITIAL,
    rows: operators,
  })
  const [selectedOperatorId, setSelectedOperatorId] = useState<string | null>(null)
  const [operatorAdjTarget, setOperatorAdjTarget] = useState<WeeklyOperator | null>(null)
  const totalShifts = useMemo(
    () => (data?.operators || []).reduce((sum, item) => sum + item.week.shiftsCount, 0),
    [data?.operators],
  )
  const broadcastTargets = useMemo(() => (data?.operators || []).filter((i) => i.operator.is_active && i.operator.telegram_chat_id), [data?.operators])
  const summaryText = useMemo(() => { const top = [...(data?.operators || [])].sort((a, b) => b.week.remainingAmount - a.week.remainingAmount)[0]; return top && top.week.remainingAmount > 0 ? `Самый большой остаток у ${getOperatorDisplayName(top.operator)}: ${money(top.week.remainingAmount)}.` : 'На этой неделе остатки закрыты или ещё не сформированы.' }, [data?.operators])
  // ─── Лента операторов: настоящие события недели ─────────────────────────────
  const [operatorEventsOperatorId, setOperatorEventsOperatorId] = useState<'all' | string>('all')
  const [operatorEventsKind, setOperatorEventsKind] = useState<'all' | OperatorTimelineEventKind>('all')
  const [operatorEventsStatus, setOperatorEventsStatus] = useState<'all' | 'active' | 'voided' | 'closed'>('all')
  const [operatorEventsQuery, setOperatorEventsQuery] = useState('')
  // Лента собирается только из настоящих записей: выплаты, корректировки поштучно
  // и позиции долгов из кассы. Итоговые суммы недели («Бонусы за неделю …») сюда
  // больше не попадают: они есть в ведомости, а в ленте выглядели событиями,
  // которых на самом деле не было.
  const operatorGlobalTimeline = useMemo(() => {
    const items: OperatorTimelineEvent[] = []
    const companyTitle = (id: string | null | undefined) => (data?.companies || []).find((c) => c.id === id)?.name || ''
    for (const item of data?.operators || []) {
      const operatorName = getOperatorDisplayName(item.operator)
      for (const payment of item.week.payments || []) {
        const parts = [`нал ${money(payment.cash_amount)}`, `безнал ${money(payment.kaspi_amount)}`, payment.comment].filter(Boolean)
        items.push({
          id: `payment:${payment.id}`,
          operator_id: item.operator.id,
          operator_name: operatorName,
          date: String(payment.payment_date || item.week.weekEnd),
          created_at: payment.created_at || null,
          kind: 'payment',
          amount: Number(payment.total_amount || 0),
          comment: parts.join(' · '),
          status: payment.status === 'voided' ? 'voided' : 'active',
        })
      }
      for (const adj of item.week.adjustments || []) {
        const kind = (['advance', 'bonus', 'fine', 'debt'] as const).find((k) => k === adj.kind)
        if (!kind) continue
        items.push({
          id: `adj:${adj.id}`,
          operator_id: item.operator.id,
          operator_name: operatorName,
          date: adj.date,
          kind,
          amount: Number(adj.amount || 0),
          comment: [adj.comment, companyTitle(adj.companyId)].filter(Boolean).join(' · ') || null,
          status: adj.status === 'voided' ? 'voided' : 'active',
        })
      }
      for (const d of item.week.debtItems || []) {
        const what = [d.name, d.quantity ? `${d.quantity} шт. × ${money(d.unitPrice)}` : '', companyTitle(d.companyId), d.comment].filter(Boolean).join(' · ')
        items.push({
          id: `debt-item:${d.id}`,
          operator_id: item.operator.id,
          operator_name: operatorName,
          date: String(d.createdAt || '').slice(0, 10),
          created_at: d.createdAt || null,
          kind: 'debt_item',
          amount: Number(d.amount || 0),
          comment: what || null,
          // После выплаты недели позиции закрываются (не аннулируются!)
          status: d.status === 'active' ? 'active' : 'closed',
        })
      }
    }
    return items
  }, [data?.operators, data?.companies])
  const filteredOperatorGlobalTimeline = useMemo(() => {
    const query = operatorEventsQuery.trim().toLowerCase()
    return operatorGlobalTimeline
      .filter((ev) => operatorEventsOperatorId === 'all' || ev.operator_id === operatorEventsOperatorId)
      .filter((ev) => operatorEventsKind === 'all' || ev.kind === operatorEventsKind)
      .filter((ev) => operatorEventsStatus === 'all' || ev.status === operatorEventsStatus)
      .filter(
        (ev) =>
          !query ||
          ev.operator_name.toLowerCase().includes(query) ||
          String(ev.comment || '').toLowerCase().includes(query) ||
          OPERATOR_EVENT_KIND_META[ev.kind].label.includes(query),
      )
  }, [operatorGlobalTimeline, operatorEventsOperatorId, operatorEventsKind, operatorEventsStatus, operatorEventsQuery])
  // Сортировка ленты по заголовку — общий хук, как в ведомости
  const operatorEventSortColumns = useMemo<SortColumns<OperatorTimelineEvent, OperatorEventSortKey>>(
    () => ({
      // Дата вместе со временем: внутри одного дня — по порядку
      date: { get: (ev) => `${ev.date}|${ev.created_at || ''}`, defaultDir: 'desc' },
      operator: { get: (ev) => ev.operator_name },
      kind: { get: (ev) => OPERATOR_EVENT_KIND_RANK[ev.kind] ?? 9 },
      amount: { get: (ev) => ev.amount || null, defaultDir: 'desc' },
      status: { get: (ev) => (ev.status === 'active' ? 0 : ev.status === 'closed' ? 1 : 2) },
      comment: { get: (ev) => ev.comment || null },
    }),
    [],
  )
  const { sort: operatorEventSort, toggle: toggleOperatorEventSort, sortedRows: sortedOperatorEvents } = useTableSort<OperatorTimelineEvent, OperatorEventSortKey>({
    storageKey: 'salary.operatorEventsSort',
    columns: operatorEventSortColumns,
    initial: OPERATOR_EVENT_SORT_INITIAL,
    rows: filteredOperatorGlobalTimeline,
  })
  // Итоги по типам без аннулированных: аннулированное — уже не деньги
  const operatorEventsTotals = useMemo(() => {
    const totals: Record<OperatorTimelineEventKind, number> = { payment: 0, advance: 0, bonus: 0, fine: 0, debt: 0, debt_item: 0 }
    for (const ev of filteredOperatorGlobalTimeline) {
      if (ev.status !== 'voided') totals[ev.kind] += Number(ev.amount || 0)
    }
    return totals
  }, [filteredOperatorGlobalTimeline])

  async function post(body: unknown) {
    const res = await fetch('/api/admin/salary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new Error(json?.error || `Ошибка запроса (${res.status})`)
    return json
  }

  const submitAdvance = async (e: FormEvent) => { e.preventDefault(); if (!advanceTarget) return; const cash = parseMoney(advanceCash), kaspi = parseMoney(advanceKaspi); if (!advanceCompanyId) return setError('Для аванса нужно выбрать точку'); if (cash + kaspi <= 0) return setError('Сумма аванса должна быть больше 0'); setAdvanceSaving(true); setError(null); try { await post({ action: 'createAdvance', payload: { operator_id: advanceTarget.operator.id, week_start: weekStart, company_id: advanceCompanyId, payment_date: advanceDate, cash_amount: cash, kaspi_amount: kaspi, comment: advanceComment.trim() || null } }); setAdvanceTarget(null); await load() } catch (e: any) { console.error(e); setError(e?.message || 'Не удалось выдать аванс') } finally { setAdvanceSaving(false) } }
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
    // Недоплата проходила молча, и это било по долгам: неделя оставалась
    // незакрытой, а вместе с ней оставался открытым и долг. Чаще всего сумма
    // отстаёт не по замыслу, а потому что вкладку открыли давно и остаток с
    // тех пор изменился.
    const shortfall = payTarget.week.remainingAmount - total
    if (shortfall > 0.009) {
      const ok = await confirmDialog({
        title: 'Это частичная выплата',
        description:
          `Сумма меньше остатка на ${money(shortfall)}. Неделя останется «Частично», ` +
          `и долг недели не закроется — он закрывается только при полной выплате.`,
        confirmLabel: 'Выплатить частично',
      })
      if (!ok) return
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
      await load()
    } catch (e: any) {
      console.error(e)
      setError(e?.message || 'Не удалось провести выплату')
    } finally {
      setPaySaving(false)
    }
  }
  // Корректировка оператора — из окна в его карточке. Итог показываем уведомлением:
  // карточка ошибок висит вверху страницы, за открытым окном её не видно
  const submitAdjustment = async (e: FormEvent) => {
    e.preventDefault()
    const amount = parseMoney(adjAmount)
    if (!adjOperatorId) {
      toast({ title: 'Выберите оператора', variant: 'destructive' })
      return
    }
    if (amount <= 0) {
      toast({ title: 'Сумма корректировки должна быть больше 0', variant: 'destructive' })
      return
    }
    setAdjSaving(true)
    try {
      await post({ action: 'createAdjustment', payload: { operator_id: adjOperatorId, date: adjDate, amount, kind: adjKind, comment: adjComment.trim() || null, company_id: adjCompanyId || null } })
      setAdjAmount('')
      setAdjComment('')
      setOperatorAdjTarget(null)
      toast({ title: 'Корректировка сохранена' })
      await load()
    } catch (e: any) {
      console.error(e)
      toast({ title: 'Не удалось сохранить корректировку', description: e?.message, variant: 'destructive' })
    } finally {
      setAdjSaving(false)
    }
  }
  const saveChatId = async (e: FormEvent) => { e.preventDefault(); if (!chatTarget) return; const trimmed = chatValue.trim(); if (trimmed && !/^-?\d+$/.test(trimmed)) return setError('telegram_chat_id должен быть числом'); setChatSaving(true); setError(null); try { await post({ action: 'updateOperatorChatId', operatorId: chatTarget.operator.id, telegram_chat_id: trimmed || null }); setChatTarget(null); await load() } catch (e: any) { console.error(e); setError(e?.message || 'Не удалось сохранить Telegram chat_id') } finally { setChatSaving(false) } }
  // Отправка расчёта одному оператору — кнопка в его карточке. Уведомляем и об
  // успехе: раньше отправка проходила молча, и было непонятно, ушло ли сообщение
  const sendOne = async (operatorId: string) => {
    setSendingId(operatorId)
    try {
      const res = await fetch('/api/telegram/salary-snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operatorId, dateFrom: weekStart, dateTo: weekEnd, weekStart }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || `Ошибка отправки (${res.status})`)
      toast({ title: 'Расчёт отправлен в Telegram' })
    } catch (e: any) {
      console.error(e)
      toast({ title: 'Не удалось отправить расчёт в Telegram', description: e?.message, variant: 'destructive' })
    } finally {
      setSendingId(null)
    }
  }
  const sendAll = async () => { if (loading || broadcastSending || !broadcastTargets.length) return; setBroadcastSending(true); setBroadcastDone(0); setBroadcastTotal(broadcastTargets.length); setBroadcastErrors([]); setError(null); try { for (let i = 0; i < broadcastTargets.length; i += 1) { const item = broadcastTargets[i]; try { const res = await fetch('/api/telegram/salary-snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operatorId: item.operator.id, dateFrom: weekStart, dateTo: weekEnd, weekStart }) }); const json = await res.json().catch(() => null); if (!res.ok) setBroadcastErrors((prev) => [...prev, `${getOperatorDisplayName(item.operator)}: ${json?.error || `HTTP ${res.status}`}`]) } catch (e: any) { setBroadcastErrors((prev) => [...prev, `${getOperatorDisplayName(item.operator)}: ${e?.message || 'ошибка'}`]) } setBroadcastDone(i + 1); await new Promise((r) => setTimeout(r, 250)) } } finally { setBroadcastSending(false) } }
  const [tab, setTab] = useState<'operators' | 'operator-events' | 'staff' | 'events'>('operators')
  const [markDebtId, setMarkDebtId] = useState<string | null>(null)
  const [markDebtSaving, setMarkDebtSaving] = useState(false)
  const [payDebtModal, setPayDebtModal] = useState<{ staff: StaffMember; amount: number } | null>(null)
  const [payDebtComment, setPayDebtComment] = useState('')
  const [payDebtSaving, setPayDebtSaving] = useState(false)
  const [voidDebtPayId, setVoidDebtPayId] = useState<string | null>(null)

  // ─── Admin staff salary state ───────────────────────────────────────────
  const [showStaffArchived, setShowStaffArchived] = useState(false)
  // SWR-кэш ЗП админ-состава: повторное открытие — мгновенно из кэша, свежие данные фоном.
  // После мутаций зовём loadStaffSalary() (refresh). API отдаёт плоский объект — хук вернёт его целиком.
  const staffSalaryUrl = showStaffArchived ? '/api/admin/staff-salary?include_archived=1' : '/api/admin/staff-salary'
  const { data: staffSalary, loading: staffSalaryLoading, refreshing: staffRefreshing, refresh: loadStaffSalary } = useApiCache<StaffSalaryData>(staffSalaryUrl)
  const [staffAdjModal, setStaffAdjModal] = useState<StaffMember | null>(null)
  const [staffPayModal, setStaffPayModal] = useState<StaffMember | null>(null)
  const [staffAdjKind, setStaffAdjKind] = useState<'debt' | 'fine' | 'bonus' | 'advance'>('fine')
  const [staffAdjCompanyId, setStaffAdjCompanyId] = useState('')
  const [staffAdjAmount, setStaffAdjAmount] = useState('')
  const [staffAdjDate, setStaffAdjDate] = useState(todayISO())
  const [staffAdjComment, setStaffAdjComment] = useState('')
  const [staffAdjSaving, setStaffAdjSaving] = useState(false)
  // Ошибка сохранения — в самом окне: общая карточка ошибок висит наверху
  // страницы, за открытым окном её не видно, и отказ выглядел как «не работает».
  const [staffAdjError, setStaffAdjError] = useState<string | null>(null)
  // Ведомость: какой месяц и половину смотрим и чья карточка раскрыта
  const [staffMonth, setStaffMonth] = useState<string>(() => todayISO().slice(0, 7))
  const [staffSlot, setStaffSlot] = useState<'first' | 'second'>(() => (Number(todayISO().slice(8, 10)) <= 15 ? 'first' : 'second'))
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null)
  const [staffPayDate, setStaffPayDate] = useState(todayISO())
  const [staffPaySlot, setStaffPaySlot] = useState<'first' | 'second'>('first')
  const [staffPayCompanyId, setStaffPayCompanyId] = useState('')
  const [staffPayCash, setStaffPayCash] = useState('')
  const [staffPayKaspi, setStaffPayKaspi] = useState('')
  const [staffPayComment, setStaffPayComment] = useState('')
  const [staffPaySaving, setStaffPaySaving] = useState(false)
  const [eventsStaffId, setEventsStaffId] = useState<'all' | string>('all')
  const [eventsKind, setEventsKind] = useState<'all' | StaffTimelineKind>('all')
  const [eventsStatus, setEventsStatus] = useState<'all' | 'active' | 'paid' | 'voided'>('all')
  const [eventsQuery, setEventsQuery] = useState('')
  const [eventsMonth, setEventsMonth] = useState<string>(() => todayISO().slice(0, 7))
  const staffPayPreview = useMemo(() => {
    if (!staffPayModal || !staffSalary) return null
    // Отсечка «по сегодня» — как на сервере: выплату проводят и задним числом,
    // но считают всё, что накопилось к моменту выплаты.
    const period = getStaffPaymentAdjustmentPeriod(staffPayDate, staffPaySlot, todayISO())
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
  // ─── Лента событий административных сотрудников ─────────────────────────────
  // Настоящие записи поштучно: выплаты, корректировки (остаток и переплата по
  // выплате — отдельными типами, а не «бонус» и «аванс»), оплаты долгов и позиции
  // долгов из кассы со временем. Синтетическая строка «Долги из операторской
  // программы» (сумма позиций с сегодняшней датой) событием не считается — вместо
  // неё сами позиции. Раньше лента резалась до 300 событий ДО фильтров, и фильтр
  // по старому периоду молча терял события — теперь режется только фильтрами.
  const staffGlobalTimeline = useMemo(() => {
    if (!staffSalary) return [] as StaffTimelineEvent[]
    const staffNameById = new Map<string, string>((staffSalary.staff || []).map((s) => [s.id, s.full_name || s.short_name || s.id]))
    const nameOf = (id: string) => staffNameById.get(id) || id
    const companyTitle = (id: string | null | undefined) => (data?.companies || []).find((c) => c.id === id)?.name || ''
    const items: StaffTimelineEvent[] = []

    for (const adj of staffSalary.adjustments || []) {
      if (String(adj.id).startsWith('operator-debt:')) {
        const debtItems = ((adj as any).items || []) as Array<{ id: string; name: string; quantity: number; unitPrice: number; amount: number; createdAt: string; companyId: string | null; comment: string | null }>
        for (const d of debtItems) {
          items.push({
            id: `debt-item:${d.id}`,
            staff_id: adj.staff_id,
            staff_name: nameOf(adj.staff_id),
            date: String(d.createdAt || '').slice(0, 10),
            created_at: d.createdAt || null,
            kind: 'debt_item',
            amount: Number(d.amount || 0),
            comment: [d.name, d.quantity ? `${d.quantity} шт. × ${money(d.unitPrice)}` : '', companyTitle(d.companyId), d.comment].filter(Boolean).join(' · ') || null,
            status: 'active',
          })
        }
        continue
      }
      const kind: StaffTimelineKind =
        adj.kind === 'bonus' && adj.source_payment_id ? 'remainder' : adj.kind === 'advance' && adj.source_payment_id ? 'overpayment' : adj.kind
      items.push({
        id: `adj:${adj.id}`,
        staff_id: adj.staff_id,
        staff_name: nameOf(adj.staff_id),
        date: adj.date,
        created_at: adj.created_at || null,
        kind,
        amount: Number(adj.amount || 0),
        comment: adj.comment || null,
        status: adj.status === 'voided' ? 'voided' : adj.status === 'paid' ? 'paid' : 'active',
      })
    }

    for (const pay of staffSalary.payments || []) {
      items.push({
        id: `pay:${pay.id}`,
        staff_id: pay.staff_id,
        staff_name: nameOf(pay.staff_id),
        date: pay.pay_date,
        created_at: pay.created_at || null,
        kind: 'payment',
        amount: Number(pay.amount || 0),
        comment: [staffPaymentSlotLabel(pay.slot), pay.comment].filter(Boolean).join(' · ') || null,
        status: 'active',
      })
    }

    for (const dp of staffSalary.debtPayments || []) {
      items.push({
        id: `debt-pay:${dp.id}`,
        staff_id: dp.staff_id,
        staff_name: nameOf(dp.staff_id),
        date: String(dp.paid_at || '').slice(0, 10),
        created_at: dp.paid_at || null,
        kind: 'debt_payment',
        amount: Number(dp.amount || 0),
        comment: dp.comment || null,
        status: dp.status === 'voided' ? 'voided' : 'active',
      })
    }

    return items
  }, [staffSalary, data?.companies])
  const filteredStaffGlobalTimeline = useMemo(() => {
    const query = eventsQuery.trim().toLowerCase()
    return staffGlobalTimeline
      .filter((ev) => eventsStaffId === 'all' || ev.staff_id === eventsStaffId)
      .filter((ev) => eventsKind === 'all' || ev.kind === eventsKind)
      .filter((ev) => eventsStatus === 'all' || ev.status === eventsStatus)
      .filter((ev) => eventsMonth === 'all' || ev.date.startsWith(eventsMonth))
      .filter(
        (ev) =>
          !query ||
          ev.staff_name.toLowerCase().includes(query) ||
          String(ev.comment || '').toLowerCase().includes(query) ||
          STAFF_EVENT_KIND_META[ev.kind].label.includes(query),
      )
  }, [staffGlobalTimeline, eventsStaffId, eventsKind, eventsStatus, eventsMonth, eventsQuery])
  // Сортировка по заголовку — общий хук, как в остальных таблицах зарплаты
  const staffEventSortColumns = useMemo<SortColumns<StaffTimelineEvent, StaffEventSortKey>>(
    () => ({
      date: { get: (ev) => `${ev.date}|${ev.created_at || ''}`, defaultDir: 'desc' },
      staff: { get: (ev) => ev.staff_name },
      kind: { get: (ev) => STAFF_EVENT_KIND_RANK[ev.kind] ?? 99 },
      amount: { get: (ev) => ev.amount || null, defaultDir: 'desc' },
      status: { get: (ev) => (ev.status === 'active' ? 0 : ev.status === 'paid' ? 1 : 2) },
      comment: { get: (ev) => ev.comment || null },
    }),
    [],
  )
  const { sort: staffEventSort, toggle: toggleStaffEventSort, sortedRows: sortedStaffEvents } = useTableSort<StaffTimelineEvent, StaffEventSortKey>({
    storageKey: 'salary.staffEventsSort',
    columns: staffEventSortColumns,
    initial: STAFF_EVENT_SORT_INITIAL,
    rows: filteredStaffGlobalTimeline,
  })
  // Итоги по типам без аннулированных: аннулированное — уже не деньги
  const staffEventsTotals = useMemo(() => {
    const totals = Object.fromEntries(STAFF_EVENT_KINDS.map((kind) => [kind, 0])) as Record<StaffTimelineKind, number>
    for (const ev of filteredStaffGlobalTimeline) {
      if (ev.status !== 'voided') totals[ev.kind] += Number(ev.amount || 0)
    }
    return totals
  }, [filteredStaffGlobalTimeline])
  // Месяцы, в которых есть события — для выбора периода (свежие сверху)
  const staffEventMonths = useMemo(
    () => Array.from(new Set([todayISO().slice(0, 7), ...staffGlobalTimeline.map((ev) => ev.date.slice(0, 7))].filter(Boolean))).sort().reverse(),
    [staffGlobalTimeline],
  )

  const canEditStaffSalary = staffSalary?.can_edit === true

  /** Аннулировать долг из кассы: позиции сканера убираются без оплаты */
  const voidOperatorDebt = async (adj: { staff_id: string; item_ids?: string[]; amount: number }) => {
    if (!canEditStaffSalary) return setError('Доступ только для просмотра')
    const items = adj.item_ids || []
    if (items.length === 0) return setError('Нечего аннулировать: позиции долга не найдены')
    const ok = await confirmDialog({
      title: 'Аннулировать долг из кассы?',
      description: `${money(adj.amount)} уйдут из расчёта зарплаты, позиции уберутся со сканера — как записанные по ошибке. Деньги при этом не считаются возвращёнными. Отменить можно в «Оплаченных долгах».`,
      confirmLabel: 'Аннулировать',
      destructive: true,
    })
    if (!ok) return
    try {
      const res = await fetch('/api/admin/staff-salary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'voidOperatorDebt', staff_id: adj.staff_id, item_ids: items }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || json?.message || `Ошибка ${res.status}`)
      await loadStaffSalary()
      toast({ title: 'Долг из кассы аннулирован' })
    } catch (e: any) {
      toast({ title: 'Не удалось аннулировать долг', description: e?.message, variant: 'destructive' })
    }
  }

  const submitStaffAdjustment = async (e: FormEvent) => {
    e.preventDefault()
    if (!canEditStaffSalary) return setStaffAdjError('Доступ только для просмотра')
    if (!staffAdjModal) return
    const amount = parseMoney(staffAdjAmount)
    if (amount <= 0) return setStaffAdjError('Сумма должна быть > 0')
    if (staffAdjKind === 'advance' && !staffAdjCompanyId) return setStaffAdjError('Для аванса выберите компанию')
    setStaffAdjSaving(true); setError(null); setStaffAdjError(null)
    try {
      const res = await fetch('/api/admin/staff-salary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addAdjustment', staff_id: staffAdjModal.id, kind: staffAdjKind, amount, date: staffAdjDate, company_id: staffAdjKind === 'advance' ? staffAdjCompanyId : null, comment: staffAdjComment.trim() || null }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Ошибка')
      setStaffAdjModal(null); setStaffAdjAmount(''); setStaffAdjComment(''); setStaffAdjCompanyId('')
      await loadStaffSalary()
    } catch (e: any) { setStaffAdjError(e?.message || 'Не удалось сохранить') }
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
      const expectedAmount = calcStaffToPay(
        staffPayModal,
        staffSalary?.adjustments || [],
        staffSalary?.payments || [],
        getStaffPaymentAdjustmentPeriod(staffPayDate, staffPaySlot, todayISO()),
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
    const ok = await confirmDialog({
      title: 'Аннулировать корректировку?',
      description: 'Корректировка будет исключена из расчёта зарплаты.',
      confirmLabel: 'Аннулировать',
      destructive: true,
    })
    if (!ok) return
    try {
      // Ответ обязательно проверяем: раньше отказ сервера (нет права, чужая
      // организация) молча проглатывался, список перезагружался, строка
      // оставалась на месте — и выглядело это как «кнопка не работает».
      const res = await fetch('/api/admin/staff-salary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'removeAdjustment', id }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || json?.message || `Ошибка ${res.status}`)
      await loadStaffSalary()
      // Показываем, что именно изменилось: «успех» без изменений уже вводил в
      // заблуждение — строка оставалась на экране
      const changed = json?.data
      toast({
        title: 'Корректировка аннулирована',
        description: changed ? `${staffAdjustmentKindLabel(changed.kind)} ${money(Number(changed.amount || 0))} · статус ${changed.status}` : undefined,
      })
    } catch (e: any) {
      toast({ title: 'Не удалось аннулировать корректировку', description: e?.message, variant: 'destructive' })
    }
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
    const ok = await confirmDialog({
      title: 'Аннулировать оплату долга?',
      description: 'Долг снова станет активным.',
      confirmLabel: 'Аннулировать',
      destructive: true,
    })
    if (!ok) return
    setVoidDebtPayId(id)
    try {
      const res = await fetch('/api/admin/staff-salary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'voidStaffDebtPayment', id }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || json?.message || `Ошибка ${res.status}`)
      await loadStaffSalary()
      toast({ title: 'Оплата долга аннулирована', description: 'Долг снова активен' })
    } catch (e: any) {
      toast({ title: 'Не удалось аннулировать оплату долга', description: e?.message, variant: 'destructive' })
    }
    finally { setVoidDebtPayId(null) }
  }

  const deleteStaffPayment = async (id: string, amount: number) => {
    if (!canEditStaffSalary) return setError('Доступ только для просмотра')
    const ok = await confirmDialog({
      title: `Аннулировать выплату ${money(amount)}?`,
      description: 'Выплата будет исключена из ведомости.',
      confirmLabel: 'Аннулировать',
      destructive: true,
    })
    if (!ok) return
    try {
      const res = await fetch('/api/admin/staff-salary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'deletePayment', id }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || json?.message || `Ошибка ${res.status}`)
      await loadStaffSalary()
      toast({ title: 'Выплата аннулирована' })
    } catch (e: any) {
      toast({ title: 'Не удалось аннулировать выплату', description: e?.message, variant: 'destructive' })
    }
  }

  const markDebtsPaid = async (item: WeeklyOperator) => {
    // Кнопка — про деньги, занесённые мимо зарплаты. Такой долг перестаёт
    // вычитаться, и сумма к выплате вырастает на его величину: человек
    // рассчитался сам, удерживать больше нечего. Если неделю уже выплатили,
    // долг из неё удержан — тогда это сбор тех же денег вторым заходом.
    const open = openDebtAmount(item.week)
    const ok = await confirmDialog({
      title: 'Долг закрыт деньгами мимо зарплаты?',
      description:
        `Долг ${money(open)} оператора ${getOperatorDisplayName(item.operator)} будет закрыт, ` +
        `и сумма к выплате за неделю вырастет на ${money(open)} — удерживать его больше не из чего.` +
        (item.week.status === 'paid'
          ? '\n\nВНИМАНИЕ: неделя уже выплачена полностью, то есть долг из неё удержан. Закрывать его деньгами — значит взять эти деньги дважды.'
          : ''),
      confirmLabel: 'Долг занесли деньгами',
    })
    if (!ok) return
    setMarkDebtId(item.operator.id)
    setMarkDebtSaving(true)
    setError(null)
    try {
      await post({ action: 'markDebtsPaid', operatorId: item.operator.id, weekStart })
      await load()
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
    const confirmed = await confirmDialog({
      title: `Аннулировать выплату ${money(payment.total_amount)}?`,
      description: `Выплата для ${getOperatorDisplayName(item.operator)} будет аннулирована.`,
      confirmLabel: 'Аннулировать',
      destructive: true,
    })
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
      await load()
    } catch (e: any) {
      console.error(e)
      setError(e?.message || 'Не удалось аннулировать выплату')
    } finally {
      setVoidingPaymentId(null)
    }
  }

  const downloadSalaryCSV = async () => {
    const generated = new Date().toLocaleString('ru-RU')
    const nf = (v: number) => Math.round(v || 0).toLocaleString('ru-RU')
    const meta = { title: 'Ведомость зарплат', period: `Неделя ${weekStart}`, generated, brandNote: 'дашборд зарплат' }
    const ops = (data?.operators || []).map(({ operator, week }) => {
      const paid = Math.round(week.paidAmount), remaining = Math.round(week.remainingAmount), net = Math.round(week.netAmount)
      const tone: 'good' | 'warn' | 'mut' = remaining <= 0 && net > 0 ? 'good' : paid > 0 && remaining > 0 ? 'warn' : 'mut'
      return {
        name: getOperatorDisplayName(operator), shifts: week.shiftsCount, gross: Math.round(week.grossAmount),
        autoBonus: Math.round(week.autoBonusTotal), bonus: Math.round(week.bonusAmount), fine: Math.round(week.fineAmount),
        debt: Math.round(week.debtAmount), advance: Math.round(week.advanceAmount), net, paid, remaining,
        statusLabel: statusMeta(week.status).label, tone,
      }
    })

    const cols = [
      { key: 'name', label: 'Оператор', w: '15%' }, { key: 'shifts', label: 'Смен', align: 'right' as const, w: '5%' },
      { key: 'gross', label: 'Начислено', align: 'right' as const, w: '9%' }, { key: 'autoBonus', label: 'Авто-бонус', align: 'right' as const, w: '8%' },
      { key: 'bonus', label: 'Бонус', align: 'right' as const, w: '6%' }, { key: 'fine', label: 'Штраф', align: 'right' as const, w: '6%' },
      { key: 'debt', label: 'Долг', align: 'right' as const, w: '6%' }, { key: 'advance', label: 'Аванс', align: 'right' as const, w: '7%' },
      { key: 'net', label: 'К выплате', align: 'right' as const, w: '9%' }, { key: 'paid', label: 'Выплачено', align: 'right' as const, w: '9%' },
      { key: 'remaining', label: 'Остаток', align: 'right' as const, signed: true, w: '8%' }, { key: 'status', label: 'Статус', w: '8%' },
    ]

    if (ops.length === 0) {
      await downloadReportPdf('premium', {
        meta, kpis: [{ label: 'Начислено', value: '—' }, { label: 'К выплате', value: '—' }, { label: 'Выплачено', value: '—' }, { label: 'Остаток', value: '—' }],
        empty: { columns: cols, message: 'Нет данных за неделю', hint: 'Выберите неделю с операторами.' },
      }, `Zarplata_${weekStart}`)
      return
    }

    const sum = (k: keyof typeof ops[0]) => ops.reduce((a, r) => a + (typeof r[k] === 'number' ? (r[k] as number) : 0), 0)
    const grossT = sum('gross'), netT = sum('net'), paidT = sum('paid'), remT = sum('remaining'), fineT = sum('fine'), debtT = sum('debt')
    const maxGross = Math.max(1, ...ops.map((o) => o.gross))
    const owed = ops.filter((o) => o.remaining > 0).sort((a, b) => b.remaining - a.remaining)
    const paidPct = netT > 0 ? Math.round((paidT / netT) * 100) : 0
    const byStatus = new Map<string, number>()
    for (const o of ops) byStatus.set(o.statusLabel, (byStatus.get(o.statusLabel) || 0) + 1)

    await downloadReportPdf('premium', {
      meta,
      kpis: [
        { label: 'Начислено', value: `${nf(grossT)} тг`, sub: `${ops.length} операторов`, badge: 'итог' },
        { label: 'К выплате', value: `${nf(netT)} тг`, sub: `выплачено ${paidPct}%` },
        { label: 'Выплачено', value: `${nf(paidT)} тг`, sub: `${ops.length - owed.length} закрыто` },
        { label: 'Остаток', value: `${nf(remT)} тг`, sub: `штрафы ${nf(fineT)} · долги ${nf(debtT)}`, tone: remT > 0 ? 'bad' : undefined },
      ],
      sections: [
        { type: 'bars', title: 'Начислено по операторам', hint: 'топ по сумме', items: ops.slice().sort((a, b) => b.gross - a.gross).slice(0, 6).map((o) => ({ label: o.name, amount: o.gross, ratio: o.gross / maxGross })) },
        { type: 'split', title: 'Выплачено / Остаток', parts: [{ label: 'Выплачено', pct: paidPct, amount: paidT, color: '#16a34a' }, { label: 'Остаток', pct: 100 - paidPct, amount: remT, color: '#f97316' }], accent: { title: 'Кому осталось выплатить', text: owed.length ? `${owed.length} операторов · ${nf(remT)} тг` : 'все выплаты закрыты' } },
        { type: 'previewTable', title: 'Статусы выплат', hint: 'по статусу', columns: [{ key: 'status', label: 'Статус' }, { key: 'count', label: 'Операторов', align: 'right' }], rows: Array.from(byStatus.entries()).map(([status, count]) => ({ status, count })) },
        { type: 'previewTable', title: 'Кому осталось выплатить', hint: 'топ по остатку', columns: [{ key: 'name', label: 'Оператор' }, { key: 'remaining', label: 'Остаток', align: 'right' }], rows: owed.slice(0, 7).map((o) => ({ name: o.name, remaining: o.remaining })), moreNote: owed.length > 7 ? `+ ещё ${owed.length - 7}` : '' },
      ],
      detail: {
        title: 'Ведомость зарплат',
        subtitle: `неделя ${weekStart} · по операторам`,
        columns: cols,
        rows: ops.map((o) => ({
          name: o.name, shifts: o.shifts, gross: o.gross, autoBonus: o.autoBonus, bonus: o.bonus, fine: o.fine,
          debt: o.debt, advance: o.advance, net: o.net, paid: o.paid, remaining: o.remaining,
          status: { text: o.statusLabel, tone: o.tone },
        })),
        total: { name: null, gross: grossT, net: netT, paid: paidT, remaining: remT },
      },
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
                  {can('salary.send_telegram') && (
                  <Button
                    type="button"
                    onClick={() => setBroadcastConfirm(true)}
                    disabled={loading || broadcastSending || !broadcastTargets.length}
                    className="h-8 gap-1.5 rounded-xl bg-blue-500 text-xs text-white hover:bg-blue-400 disabled:opacity-50"
                  >
                    {broadcastSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    {broadcastSending ? `${broadcastDone}/${broadcastTotal}` : 'Всем'}
                  </Button>
                  )}
                  {can('salary.export') && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={downloadSalaryCSV}
                      disabled={loading || !data}
                      className="h-8 gap-1.5 rounded-xl border-border bg-white dark:bg-white/5 text-xs text-body hover:bg-surface-hover"
                    >
                      <Download className="h-3.5 w-3.5" />
                      PDF
                    </Button>
                  )}
                  <div className="flex rounded-xl border border-border bg-slate-100 dark:bg-black/20 p-0.5 text-xs" role="group" aria-label="Неделя">
                    <button
                      type="button"
                      onClick={() => setWeekStart(addDaysISO(weekStart, -7))}
                      className="rounded-lg px-2.5 py-1.5 text-muted-foreground transition hover:text-slate-900 dark:hover:text-white"
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      onClick={() => setWeekStart(currentWeek)}
                      className="rounded-lg px-2.5 py-1.5 text-body transition hover:text-slate-900 dark:hover:text-white"
                    >
                      Сейчас
                    </button>
                    <button
                      type="button"
                      onClick={() => setWeekStart(addDaysISO(weekStart, 7))}
                      className="rounded-lg px-2.5 py-1.5 text-muted-foreground transition hover:text-slate-900 dark:hover:text-white"
                    >
                      →
                    </button>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 w-8 rounded-xl border-border bg-white dark:bg-white/5 text-body hover:bg-surface-hover"
                    onClick={() => void load()}
                    disabled={refreshing}
                    title="Обновить"
                    aria-label="Обновить"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 w-8 rounded-xl border-border bg-white dark:bg-white/5 text-body hover:bg-surface-hover"
                  onClick={() => void loadStaffSalary()}
                  disabled={staffRefreshing}
                  title="Обновить"
                  aria-label="Обновить"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${staffRefreshing ? 'animate-spin' : ''}`} />
                </Button>
              )
            }
            toolbar={
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap rounded-xl border border-border bg-slate-100 dark:bg-black/20 p-0.5" role="tablist" aria-label="Раздел зарплаты">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'operators'}
                    onClick={() => setTab('operators')}
                    className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === 'operators' ? 'bg-white dark:bg-white/10 text-foreground' : 'text-muted-foreground hover:text-slate-700 dark:hover:text-slate-200'}`}
                  >
                    Операторы
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'operator-events'}
                    onClick={() => setTab('operator-events')}
                    className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === 'operator-events' ? 'bg-white dark:bg-white/10 text-foreground' : 'text-muted-foreground hover:text-slate-700 dark:hover:text-slate-200'}`}
                  >
                    Лента операторов
                  </button>
                  {canViewStaffSalary && (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={tab === 'staff'}
                      onClick={() => setTab('staff')}
                      className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === 'staff' ? 'bg-white dark:bg-white/10 text-foreground' : 'text-muted-foreground hover:text-slate-700 dark:hover:text-slate-200'}`}
                    >
                      Административные сотрудники
                    </button>
                  )}
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'events'}
                    onClick={() => setTab('events')}
                    className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === 'events' ? 'bg-white dark:bg-white/10 text-foreground' : 'text-muted-foreground hover:text-slate-700 dark:hover:text-slate-200'}`}
                  >
                    Лента событий
                  </button>
                </div>
                {tab === 'operators' || tab === 'operator-events' ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="rounded-full border border-border bg-white dark:bg-white/5 px-3 py-1">
                      Неделя:{' '}
                      <span className="font-semibold text-foreground">
                        {/* До гидрации недели ещё нет — показываем прочерк, а
                            не «NaN.NaN.NaN» из разбора пустой даты. */}
                        {weekStart ? `${formatRuDate(weekStart)} — ${formatRuDate(weekEnd)}` : '—'}
                      </span>
                    </span>
                    {data ? (
                      <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-emerald-700 dark:text-emerald-300">
                        Выплачено: <span className="font-semibold">{data.totals.paidOperators}</span>
                      </span>
                    ) : null}
                    {broadcastTotal > 0 && !broadcastSending ? (
                      <span
                        className={`rounded-full border px-3 py-1 ${broadcastErrors.length ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300' : 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300'}`}
                      >
                        {broadcastDone}/{broadcastTotal}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            }
          />

          {(error || loadError) ? <Card className="border-red-500/30 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-200">{error || loadError}</Card> : null}

          {/* ── OPERATORS TAB ───────────────────────────────────────────────── */}
          {/* Ведомость операторов за неделю — как у административных сотрудников: */}
          {/* таблица с сортировкой по заголовкам и строкой «Итого», по клику — карточка */}
          {/* оператора: расчёт построчно, долги из кассы позициями, смены, выплаты. */}
          {tab === 'operators' && (() => {
            const selectedOperator = sortedOperators.find((i) => i.operator.id === selectedOperatorId) || null
            const selectRow = (id: string) => setSelectedOperatorId(selectedOperatorId === id ? null : id)
            const weekTotals = sortedOperators.reduce(
              (acc, i) => ({
                shifts: acc.shifts + i.week.shiftsCount,
                accrued: acc.accrued + i.week.grossAmount,
                bonuses: acc.bonuses + i.week.bonusAmount + i.week.autoBonusTotal,
                deductions: acc.deductions + i.week.fineAmount + i.week.debtAmount,
                advance: acc.advance + i.week.advanceAmount,
                net: acc.net + i.week.netAmount,
                paid: acc.paid + i.week.paidAmount,
                remaining: acc.remaining + i.week.remainingAmount,
              }),
              { shifts: 0, accrued: 0, bonuses: 0, deductions: 0, advance: 0, net: 0, paid: 0, remaining: 0 },
            )
            const muted = 'text-slate-300 dark:text-white/20'
            // Ноль — серый прочерк: цветной прочерк читался как «тут что-то есть»
            const moneyCell = (value: number, cls: string, sign = '') =>
              Math.round(value) ? <span className={cls}>{sign}{money(value)}</span> : <span className={muted}>—</span>
            const companyTitle = (id: string | null) => (data?.companies || []).find((c) => c.id === id)?.name || ''
            const dateTime = (iso: string) => {
              const d = new Date(String(iso || ''))
              if (Number.isNaN(d.getTime())) return String(iso || '').slice(0, 16).replace('T', ' ')
              return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
            }
            const sortHead = (label: string, key: OperatorSortKey, align: 'left' | 'right' | 'center' = 'right', cls = 'px-3 py-2') => (
              <SortableTh label={label} sortKey={key} sort={operatorSort} onSort={toggleOperatorSort} align={align} className={cls} />
            )

            return (
              <div className="space-y-4">
                <Card className="overflow-hidden border-border bg-white dark:bg-white/[0.04]">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 sm:p-5">
                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl bg-emerald-500/15 p-2.5 text-emerald-700 dark:text-emerald-300"><Users className="h-5 w-5" /></div>
                      <div>
                        <h2 className="text-base font-semibold text-foreground">Ведомость операторов за неделю</h2>
                        <p className="text-xs text-muted-foreground">Оплата за смены. {summaryText}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex flex-wrap rounded-xl border border-border bg-slate-100 dark:bg-black/20 p-0.5 text-xs">
                        {(['all', 'draft', 'partial', 'paid'] as const).map((s) => (
                          <button key={s} type="button" onClick={() => setStatusFilter(s)} className={`rounded-lg px-3 py-1.5 transition ${statusFilter === s ? 'bg-white dark:bg-white/10 text-foreground' : 'text-muted-foreground hover:text-slate-700 dark:hover:text-slate-200'}`}>
                            {s === 'all' ? 'Все' : s === 'draft' ? 'Не выплачено' : s === 'partial' ? 'Частично' : 'Выплачено'}
                          </button>
                        ))}
                      </div>
                      <Button type="button" variant="outline" className="h-8 rounded-xl border-border bg-white dark:bg-white/5 text-xs text-body hover:bg-surface-hover" onClick={() => setShowZero((v) => !v)}>{showZero ? 'Скрыть пустые' : 'Все строки'}</Button>
                    </div>
                  </div>

                  {/* Компьютер: таблица с сортировкой */}
                  <div className="hidden overflow-x-auto sm:block">
                    <table className="w-full min-w-[1040px]">
                      <thead className="bg-surface-muted">
                        <tr className="text-[11px] font-medium text-muted-foreground">
                          {sortHead('Оператор', 'name', 'left', 'px-4 py-2')}
                          {sortHead('Смен', 'shifts')}
                          {sortHead('Начислено', 'accrued')}
                          {sortHead('Бонусы', 'bonuses')}
                          {sortHead('Штрафы и долги', 'deductions')}
                          {sortHead('Аванс', 'advance')}
                          {sortHead('К выплате', 'net')}
                          {sortHead('Выплачено', 'paid')}
                          {sortHead('Остаток', 'remaining')}
                          {sortHead('Статус', 'status', 'center')}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {loading && sortedOperators.length === 0
                          ? Array.from({ length: 6 }).map((_, idx) => (
                              <tr key={`skeleton-${idx}`}>
                                <td colSpan={10} className="px-4 py-2"><Skeleton className="h-9 w-full rounded-xl" /></td>
                              </tr>
                            ))
                          : null}
                        {!loading && sortedOperators.length === 0 ? (
                          <tr><td colSpan={10} className="px-4 py-12 text-center text-sm text-slate-400">В этой неделе пока нет строк для отображения.</td></tr>
                        ) : null}
                        {sortedOperators.map((item) => {
                          const w = item.week
                          const st = statusMeta(w.status)
                          const title = getOperatorDisplayName(item.operator)
                          const active = selectedOperatorId === item.operator.id
                          return (
                            <tr
                              key={item.operator.id}
                              onClick={() => selectRow(item.operator.id)}
                              className={`cursor-pointer transition hover:bg-surface-muted ${active ? 'bg-emerald-500/[0.06]' : ''} ${item.operator.is_active ? '' : 'opacity-60'}`}
                            >
                              <td className="px-4 py-2.5 text-sm">
                                <div className="flex items-center gap-2">
                                  <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${active ? 'rotate-90' : ''}`} />
                                  <div className="min-w-0">
                                    <div className="truncate font-medium text-foreground">{title}</div>
                                    <div className="truncate text-[11px] text-slate-400">
                                      {item.operator.position || 'оператор'}
                                      {!item.operator.is_active ? ' · неактивен' : ''}
                                      {item.operator.expiring_documents > 0 ? <span className="text-amber-700 dark:text-amber-300"> · документы истекают</span> : null}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-right text-sm tabular-nums">{w.shiftsCount || <span className={muted}>—</span>}</td>
                              <td className="px-3 py-2.5 text-right text-sm tabular-nums">{moneyCell(w.grossAmount, 'text-foreground')}</td>
                              <td className="px-3 py-2.5 text-right text-sm tabular-nums">{moneyCell(w.bonusAmount + w.autoBonusTotal, 'text-emerald-700 dark:text-emerald-300', '+')}</td>
                              <td className="px-3 py-2.5 text-right text-sm tabular-nums">{moneyCell(w.fineAmount + w.debtAmount, 'text-rose-600 dark:text-rose-300', '−')}</td>
                              <td className="px-3 py-2.5 text-right text-sm tabular-nums">{moneyCell(w.advanceAmount, 'text-amber-700 dark:text-amber-300', '−')}</td>
                              <td className="px-3 py-2.5 text-right text-sm font-semibold tabular-nums text-foreground">{money(w.netAmount)}</td>
                              <td className="px-3 py-2.5 text-right text-sm tabular-nums">{moneyCell(w.paidAmount, 'text-sky-700 dark:text-sky-300')}</td>
                              <td className="px-3 py-2.5 text-right text-sm font-semibold tabular-nums">{moneyCell(w.remainingAmount, 'text-foreground')}</td>
                              <td className="px-3 py-2.5 text-center"><span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${st.className}`}>{st.label}</span></td>
                            </tr>
                          )
                        })}
                        {sortedOperators.length > 0 ? (
                          <tr className="bg-surface-muted/60 font-semibold">
                            <td className="px-4 py-2.5 text-sm">Итого · {sortedOperators.length}</td>
                            <td className="px-3 py-2.5 text-right text-sm tabular-nums">{weekTotals.shifts}</td>
                            <td className="px-3 py-2.5 text-right text-sm tabular-nums">{money(weekTotals.accrued)}</td>
                            <td className="px-3 py-2.5 text-right text-sm tabular-nums">{weekTotals.bonuses ? `+${money(weekTotals.bonuses)}` : '—'}</td>
                            <td className="px-3 py-2.5 text-right text-sm tabular-nums">{weekTotals.deductions ? `−${money(weekTotals.deductions)}` : '—'}</td>
                            <td className="px-3 py-2.5 text-right text-sm tabular-nums">{weekTotals.advance ? `−${money(weekTotals.advance)}` : '—'}</td>
                            <td className="px-3 py-2.5 text-right text-sm tabular-nums">{money(weekTotals.net)}</td>
                            <td className="px-3 py-2.5 text-right text-sm tabular-nums">{money(weekTotals.paid)}</td>
                            <td className="px-3 py-2.5 text-right text-sm tabular-nums">{money(weekTotals.remaining)}</td>
                            <td />
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>

                  {/* Телефон: та же ведомость короткими строками */}
                  <div className="divide-y divide-border sm:hidden">
                    {loading && sortedOperators.length === 0
                      ? Array.from({ length: 4 }).map((_, idx) => (
                          <div key={`m-skeleton-${idx}`} className="px-4 py-3"><Skeleton className="h-10 w-full rounded-xl" /></div>
                        ))
                      : null}
                    {!loading && sortedOperators.length === 0 ? (
                      <div className="px-4 py-8 text-center text-sm text-slate-400">В этой неделе пока нет строк для отображения.</div>
                    ) : null}
                    {sortedOperators.map((item) => {
                      const w = item.week
                      const active = selectedOperatorId === item.operator.id
                      return (
                        <button
                          key={item.operator.id}
                          type="button"
                          onClick={() => selectRow(item.operator.id)}
                          className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left ${item.operator.is_active ? '' : 'opacity-60'}`}
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-foreground">{getOperatorDisplayName(item.operator)}</div>
                            <div className="truncate text-[11px] text-slate-400">{w.shiftsCount} смен · {statusMeta(w.status).label}</div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <div className="text-right">
                              <div className="text-sm font-semibold tabular-nums text-foreground">{money(w.remainingAmount)}</div>
                              <div className="text-[10px] text-slate-400">остаток</div>
                            </div>
                            <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${active ? 'rotate-90' : ''}`} />
                          </div>
                        </button>
                      )
                    })}
                    {sortedOperators.length > 0 ? (
                      <div className="flex items-center justify-between px-4 py-3 text-sm font-semibold">
                        <span>Итого остаток</span>
                        <span className="tabular-nums">{money(weekTotals.remaining)}</span>
                      </div>
                    ) : null}
                  </div>
                </Card>

                {selectedOperator ? (() => {
                  const item = selectedOperator
                  const w = item.week
                  const title = getOperatorDisplayName(item.operator)
                  const canPay = w.remainingAmount > 0.009
                  const openDebt = openDebtAmount(w)
                  const debtItems = w.debtItems || []
                  const debtItemsTotal = debtItems.reduce((sum, d) => sum + Number(d.amount || 0), 0)
                  const line = (label: string, value: string, cls = '') => (
                    <div className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
                      <span className="text-muted-foreground">{label}</span>
                      <span className={`shrink-0 tabular-nums ${cls}`}>{value}</span>
                    </div>
                  )
                  const outlineBtn = 'h-9 rounded-xl border-border bg-white dark:bg-white/5 text-xs text-body hover:bg-surface-hover disabled:opacity-50'
                  return (
                    <Card className="overflow-hidden border-border bg-white dark:bg-white/[0.04]">
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
                        <Link href={`/operators/${item.operator.id}/profile`} className="flex min-w-0 items-center gap-3">
                          <div className="h-11 w-11 shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 to-cyan-500">
                            {item.operator.photo_url ? (
                              <Image src={item.operator.photo_url} alt={title} width={44} height={44} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-white">{title.charAt(0).toUpperCase()}</div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-foreground">{title}</div>
                            <div className="text-xs text-slate-400">
                              {item.operator.position || 'оператор'} · {w.shiftsCount} смен · {item.operator.documents_count} док.
                              {item.operator.expiring_documents > 0 ? <span className="text-amber-700 dark:text-amber-300"> · {item.operator.expiring_documents} скоро истекут</span> : null}
                            </div>
                          </div>
                        </Link>
                        <div className="flex flex-wrap gap-2">
                          {canCreateAdvance ? (
                            <Button type="button" variant="outline" className={outlineBtn} onClick={() => setAdvanceTarget(item)}><Plus className="mr-1.5 h-3.5 w-3.5" />Аванс</Button>
                          ) : null}
                          {canCreateAdjustment ? (
                            <Button
                              type="button"
                              variant="outline"
                              className={outlineBtn}
                              onClick={() => {
                                setAdjOperatorId(item.operator.id)
                                setAdjCompanyId('')
                                setAdjKind('fine')
                                setAdjDate(todayISO())
                                setAdjAmount('')
                                setAdjComment('')
                                setOperatorAdjTarget(item)
                              }}
                            >
                              <Plus className="mr-1.5 h-3.5 w-3.5" />Корректировка
                            </Button>
                          ) : null}
                          {openDebt > 0 && can('salary.mark_debt_paid') ? (
                            <Button
                              type="button"
                              variant="outline"
                              className="h-9 rounded-xl border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
                              disabled={markDebtSaving && markDebtId === item.operator.id}
                              onClick={() => void markDebtsPaid(item)}
                            >
                              {markDebtSaving && markDebtId === item.operator.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                              Оплатил долг ({money(openDebt)})
                            </Button>
                          ) : null}
                          {can('salary.send_telegram') && item.operator.telegram_chat_id ? (
                            <Button type="button" variant="outline" className={outlineBtn} disabled={sendingId === item.operator.id} onClick={() => void sendOne(item.operator.id)}>
                              {sendingId === item.operator.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                              Telegram
                            </Button>
                          ) : null}
                          {canUpdateChatId ? (
                            <Button type="button" variant="outline" className={outlineBtn} onClick={() => setChatTarget(item)} title="Telegram chat_id оператора">
                              <Pencil className="mr-1.5 h-3.5 w-3.5" />{item.operator.telegram_chat_id ? 'chat_id' : 'Привязать Telegram'}
                            </Button>
                          ) : null}
                          <Link href={`/salary/${item.operator.id}?weekStart=${weekStart}`} className="inline-flex h-9 items-center justify-center rounded-xl border border-border bg-white dark:bg-white/5 px-3 text-xs text-body transition hover:bg-surface-hover">
                            Детали
                          </Link>
                          {canCreatePayment ? (
                            <Button type="button" className="h-9 rounded-xl bg-emerald-500 text-xs text-white hover:bg-emerald-400 disabled:opacity-50" disabled={!canPay} onClick={() => setPayTarget(item)}>
                              <Wallet className="mr-1.5 h-3.5 w-3.5" />Выплатить
                            </Button>
                          ) : null}
                        </div>
                      </div>

                      <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-2">
                        <div className="space-y-4">
                          {/* Откуда сумма — та же формула, что в lib/domain/salary.ts */}
                          <div>
                            <div className="mb-2 text-sm font-medium text-foreground">
                              Как получилась сумма · {weekStart ? `${formatRuDate(weekStart)} — ${formatRuDate(weekEnd)}` : 'неделя'}
                            </div>
                            <div className="divide-y divide-border rounded-xl border border-border">
                              {line(`Смены (${w.shiftsCount})${w.seniorityBonusTotal ? `, в т.ч. стаж ${money(w.seniorityBonusTotal)}` : ''}`, money(w.grossAmount))}
                              {w.autoBonusTotal ? line('Авто-бонус', `+${money(w.autoBonusTotal)}`, 'text-violet-700 dark:text-violet-300') : null}
                              {w.bonusAmount ? line('Бонусы', `+${money(w.bonusAmount)}`, 'text-emerald-700 dark:text-emerald-300') : null}
                              {w.fineAmount ? line('Штрафы', `−${money(w.fineAmount)}`, 'text-rose-600 dark:text-rose-300') : null}
                              {w.debtAmount ? line('Долги', `−${money(w.debtAmount)}`, 'text-rose-600 dark:text-rose-300') : null}
                              {w.advanceAmount ? line('Аванс', `−${money(w.advanceAmount)}`, 'text-amber-700 dark:text-amber-300') : null}
                              <div className="flex items-baseline justify-between gap-3 bg-surface-muted/60 px-3 py-2 text-sm font-semibold">
                                <span>К выплате</span>
                                <span className="shrink-0 tabular-nums">{money(w.netAmount)}</span>
                              </div>
                              {w.paidAmount ? line('Уже выплачено', `−${money(w.paidAmount)}`, 'text-sky-700 dark:text-sky-300') : null}
                              <div className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm font-semibold">
                                <span>Остаток</span>
                                <span className={`shrink-0 tabular-nums ${w.remainingAmount > 0.009 ? 'text-foreground' : 'text-emerald-700 dark:text-emerald-300'}`}>{money(w.remainingAmount)}</span>
                              </div>
                            </div>
                          </div>

                          <div>
                            <div className="mb-2 text-sm font-medium text-foreground">Смены · {w.shiftsCount}</div>
                            {w.shifts.length === 0 ? (
                              <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">Смен за эту неделю нет.</div>
                            ) : (
                              <div className="overflow-x-auto rounded-xl border border-border">
                                <table className="w-full min-w-[520px] text-xs">
                                  <thead className="bg-surface-muted text-muted-foreground">
                                    <tr>
                                      <th className="px-3 py-2 text-left font-medium">Дата</th>
                                      <th className="px-3 py-2 text-left font-medium">Точка</th>
                                      <th className="px-3 py-2 text-right font-medium">Выручка</th>
                                      <th className="px-3 py-2 text-right font-medium">База</th>
                                      <th className="px-3 py-2 text-right font-medium">Надбавки</th>
                                      <th className="px-3 py-2 text-right font-medium">Итого</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border">
                                    {w.shifts.map((s) => {
                                      const extras = (s.seniorityBonus || 0) + s.autoBonus + s.roleBonus
                                      return (
                                        <tr key={s.id}>
                                          <td className="whitespace-nowrap px-3 py-2">
                                            <span className="tabular-nums">{formatRuDate(s.date)}</span>
                                            <span className={`ml-1.5 rounded-full border px-1.5 py-0.5 text-[10px] ${s.shift === 'day' ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300'}`}>{s.shift === 'day' ? 'день' : 'ночь'}</span>
                                          </td>
                                          <td className="px-3 py-2 text-muted-foreground">{s.companyName || s.companyCode || '—'}</td>
                                          <td className="px-3 py-2 text-right tabular-nums">{money(s.totalIncome)}</td>
                                          <td className="px-3 py-2 text-right tabular-nums">{money(s.baseSalary)}</td>
                                          <td
                                            className="px-3 py-2 text-right tabular-nums text-violet-700 dark:text-violet-300"
                                            title={`стаж ${money(s.seniorityBonus || 0)} · авто ${money(s.autoBonus)} · роль ${money(s.roleBonus)}`}
                                          >
                                            {extras ? `+${money(extras)}` : <span className={muted}>—</span>}
                                          </td>
                                          <td className="px-3 py-2 text-right font-medium tabular-nums">{money(s.salary)}</td>
                                        </tr>
                                      )
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="space-y-4">
                          {/* Что взял в долг и когда */}
                          <div>
                            <div className="mb-2 text-sm font-medium text-foreground">
                              Долги из кассы {debtItems.length ? <span className="font-normal text-muted-foreground">· {debtItems.length} шт. на {money(debtItemsTotal)}</span> : null}
                            </div>
                            {debtItems.length === 0 ? (
                              <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">За эту неделю долгов из кассы нет.</div>
                            ) : (
                              <div className="divide-y divide-border rounded-xl border border-border">
                                {debtItems.map((d) => {
                                  // После выплаты недели позиции закрываются — показываем их приглушённо
                                  const closed = d.status !== 'active'
                                  return (
                                    <div key={d.id} className={`flex items-start justify-between gap-3 px-3 py-2 ${closed ? 'opacity-60' : ''}`}>
                                      <div className="min-w-0">
                                        <div className="truncate text-sm text-foreground">
                                          {d.name}
                                          {closed ? <span className="ml-2 rounded-full border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">закрыта</span> : null}
                                        </div>
                                        <div className="truncate text-[11px] text-slate-500">
                                          {dateTime(d.createdAt)}
                                          {d.quantity ? ` · ${d.quantity} шт. × ${money(d.unitPrice)}` : ''}
                                          {companyTitle(d.companyId) ? ` · ${companyTitle(d.companyId)}` : ''}
                                          {d.comment ? ` · ${d.comment}` : ''}
                                        </div>
                                      </div>
                                      <span className={`shrink-0 text-sm font-medium tabular-nums ${closed ? 'text-muted-foreground' : 'text-rose-600 dark:text-rose-300'}`}>{money(d.amount)}</span>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>

                          <div>
                            <div className="mb-2 text-sm font-medium text-foreground">Выплаты недели</div>
                            {w.payments.length === 0 ? (
                              <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">По этой неделе ещё нет выплат.</div>
                            ) : (
                              <div className="space-y-2">
                                {w.payments.map((p) => (
                                  <div key={p.id} className={`rounded-xl border border-border px-3 py-2 text-xs ${p.status === 'voided' ? 'opacity-60' : ''}`}>
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-body">{formatRuDate(p.payment_date)} · нал {money(p.cash_amount)} · {cashLabels.providerName} {money(p.kaspi_amount)}</span>
                                      <span className={`shrink-0 font-semibold tabular-nums ${p.status === 'voided' ? 'text-slate-400 line-through' : 'text-emerald-700 dark:text-emerald-300'}`}>{money(p.total_amount)}</span>
                                    </div>
                                    {p.comment ? <div className="mt-1 text-[11px] text-muted-foreground">{p.comment}</div> : null}
                                    <div className="mt-1 flex justify-end">
                                      {p.status === 'voided' ? (
                                        <span className="text-[11px] text-slate-400">аннулировано</span>
                                      ) : canVoidPayment ? (
                                        <button
                                          type="button"
                                          disabled={voidingPaymentId === p.id}
                                          onClick={() => void voidPayment(item, p)}
                                          className="inline-flex items-center gap-1 text-[11px] text-rose-600 hover:underline disabled:opacity-50 dark:text-rose-300"
                                        >
                                          {voidingPaymentId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                                          Аннулировать
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {w.companyAllocations.length > 1 ? (
                            <details className="group">
                              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
                                <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
                                По точкам · {w.companyAllocations.length}
                              </summary>
                              <div className="mt-2 overflow-x-auto rounded-xl border border-border">
                                <table className="w-full min-w-[520px] text-xs">
                                  <thead className="bg-surface-muted text-muted-foreground">
                                    <tr>
                                      <th className="px-3 py-2 text-left font-medium">Точка</th>
                                      <th className="px-3 py-2 text-right font-medium">Начислено</th>
                                      <th className="px-3 py-2 text-right font-medium">Бонусы</th>
                                      <th className="px-3 py-2 text-right font-medium">Штрафы и долги</th>
                                      <th className="px-3 py-2 text-right font-medium">Аванс</th>
                                      <th className="px-3 py-2 text-right font-medium">К выплате</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border">
                                    {w.companyAllocations.map((a) => (
                                      <tr key={a.companyId}>
                                        <td className="px-3 py-2">
                                          <div className="text-foreground">{a.companyName || a.companyCode || a.companyId}</div>
                                          <div className="text-[10px] text-slate-500">доля {(a.shareRatio * 100).toFixed(1)}%</div>
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">{money(a.accruedAmount)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-300">{money(a.bonusAmount)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-rose-600 dark:text-rose-300">{money(a.fineAmount + a.debtAmount)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-amber-700 dark:text-amber-300">{money(a.advanceAmount)}</td>
                                        <td className="px-3 py-2 text-right font-medium tabular-nums">{money(a.netAmount)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </details>
                          ) : null}
                        </div>
                      </div>
                    </Card>
                  )
                })() : (
                  <Card className="border-dashed border-border bg-transparent p-6 text-center text-sm text-muted-foreground">
                    Нажмите на оператора, чтобы увидеть расчёт, долги из кассы, смены и выплаты недели.
                  </Card>
                )}

                {/* Корректировка у конкретного оператора — вместо общей формы внизу страницы */}
                {operatorAdjTarget ? (
                  <Modal title="Корректировка недели" subtitle={getOperatorDisplayName(operatorAdjTarget.operator)} onClose={() => setOperatorAdjTarget(null)}>
                    <form className="space-y-4" onSubmit={submitAdjustment}>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-sm text-body">Тип</label>
                          <select className={selectCls} value={adjKind} onChange={(e) => setAdjKind(e.target.value as AdjustmentKind)}>
                            <option value="fine">Штраф</option>
                            <option value="debt">Долг</option>
                            <option value="bonus">Бонус</option>
                          </select>
                        </div>
                        <div>
                          <label className="mb-2 block text-sm text-body">Дата</label>
                          <DatePicker className="h-11" value={adjDate} onChange={setAdjDate} />
                        </div>
                        <div>
                          <label className="mb-2 block text-sm text-body">Точка</label>
                          <select className={selectCls} value={adjCompanyId} onChange={(e) => setAdjCompanyId(e.target.value)}>
                            <option value="">Без привязки к точке</option>
                            {(data?.companies || []).map((c) => (
                              <option key={c.id} value={c.id}>{c.name || c.code || c.id}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-2 block text-sm text-body">Сумма</label>
                          <input className={input} type="text" placeholder="0" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} />
                        </div>
                      </div>
                      <textarea className={textarea} placeholder="Комментарий" value={adjComment} onChange={(e) => setAdjComment(e.target.value)} />
                      <p className="text-xs text-muted-foreground">Аванс выдаётся отдельной кнопкой «Аванс» — через корректировку он не создаётся.</p>
                      <div className="flex justify-end gap-3">
                        <Button type="button" variant="outline" className="rounded-xl border-border bg-white dark:bg-white/5 text-body hover:bg-surface-hover" onClick={() => setOperatorAdjTarget(null)}>Отмена</Button>
                        <Button type="submit" className="rounded-xl bg-emerald-500 text-white hover:bg-emerald-400">{adjSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Сохранить'}</Button>
                      </div>
                    </form>
                  </Modal>
                ) : null}
              </div>
            )
          })()}

          {/* ── OPERATOR EVENTS TAB ─────────────────────────────────────────── */}
          {/* Лента операторов: настоящие события недели — выплаты, корректировки и */}
          {/* позиции долгов из кассы. Таблица с сортировкой; клик — карточка оператора. */}
          {tab === 'operator-events' && (() => {
            const hasFilters =
              operatorEventsOperatorId !== 'all' || operatorEventsKind !== 'all' || operatorEventsStatus !== 'all' || operatorEventsQuery.trim() !== ''
            const eventDate = (ev: OperatorTimelineEvent) => {
              // У позиций из кассы есть точное время — показываем его
              if (ev.kind === 'debt_item' && ev.created_at) {
                const d = new Date(ev.created_at)
                if (!Number.isNaN(d.getTime())) {
                  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                }
              }
              return formatRuDate(ev.date)
            }
            const statusLabel = (ev: OperatorTimelineEvent) => (ev.status === 'voided' ? 'аннулировано' : ev.status === 'closed' ? 'закрыто' : 'активно')
            const openOperator = (ev: OperatorTimelineEvent) => {
              setSelectedOperatorId(ev.operator_id)
              setTab('operators')
            }
            const head = (label: string, key: OperatorEventSortKey, align: 'left' | 'right' | 'center' = 'left', cls = 'px-3 py-2') => (
              <SortableTh label={label} sortKey={key} sort={operatorEventSort} onSort={toggleOperatorEventSort} align={align} className={cls} />
            )

            return (
              <Card className="overflow-hidden border-border bg-white dark:bg-white/[0.04]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 sm:p-5">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-blue-500/15 p-2.5 text-blue-700 dark:text-blue-300"><CalendarDays className="h-5 w-5" /></div>
                    <div>
                      <h2 className="text-base font-semibold text-foreground">Лента операторов</h2>
                      <p className="text-xs text-muted-foreground">
                        Все события недели по отдельности: выплаты, авансы, бонусы, штрафы, долги и позиции из кассы. Нажмите на строку — откроется карточка оператора.
                      </p>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Событий: <span className="font-semibold text-foreground">{sortedOperatorEvents.length}</span>
                    {sortedOperatorEvents.length !== operatorGlobalTimeline.length ? ` из ${operatorGlobalTimeline.length}` : ''}
                  </div>
                </div>

                <div className="space-y-3 border-b border-border p-4 sm:p-5">
                  {/* Итоги по типам — нажатие оставляет в ленте только этот тип */}
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(OPERATOR_EVENT_KIND_META) as OperatorTimelineEventKind[]).map((kind) => {
                      const meta = OPERATOR_EVENT_KIND_META[kind]
                      const active = operatorEventsKind === kind
                      return (
                        <button
                          key={kind}
                          type="button"
                          onClick={() => setOperatorEventsKind(active ? 'all' : kind)}
                          className={`rounded-full border px-3 py-1 text-xs transition ${active ? meta.tone : 'border-border bg-white dark:bg-white/[0.03] text-body hover:bg-surface-hover'}`}
                        >
                          {meta.plural}: <span className="font-semibold tabular-nums">{money(operatorEventsTotals[kind])}</span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <select className={selectCls} value={operatorEventsOperatorId} onChange={(e) => setOperatorEventsOperatorId(e.target.value)} aria-label="Оператор">
                      <option value="all">Все операторы</option>
                      {(data?.operators || []).map((i) => (
                        <option key={i.operator.id} value={i.operator.id}>{getOperatorDisplayName(i.operator)}</option>
                      ))}
                    </select>
                    <select className={selectCls} value={operatorEventsKind} onChange={(e) => setOperatorEventsKind(e.target.value as 'all' | OperatorTimelineEventKind)} aria-label="Тип">
                      <option value="all">Все типы</option>
                      {(Object.keys(OPERATOR_EVENT_KIND_META) as OperatorTimelineEventKind[]).map((kind) => (
                        <option key={kind} value={kind}>{OPERATOR_EVENT_KIND_META[kind].plural}</option>
                      ))}
                    </select>
                    <select className={selectCls} value={operatorEventsStatus} onChange={(e) => setOperatorEventsStatus(e.target.value as 'all' | 'active' | 'voided' | 'closed')} aria-label="Статус">
                      <option value="all">Любой статус</option>
                      <option value="active">Активные</option>
                      <option value="closed">Закрытые выплатой</option>
                      <option value="voided">Аннулированные</option>
                    </select>
                    <input className={input} type="text" value={operatorEventsQuery} onChange={(e) => setOperatorEventsQuery(e.target.value)} placeholder="Поиск: оператор, товар, комментарий" />
                  </div>
                  {hasFilters ? (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      onClick={() => {
                        setOperatorEventsOperatorId('all')
                        setOperatorEventsKind('all')
                        setOperatorEventsStatus('all')
                        setOperatorEventsQuery('')
                      }}
                    >
                      Сбросить фильтры
                    </button>
                  ) : null}
                </div>

                {loading && operatorGlobalTimeline.length === 0 ? (
                  <div className="space-y-2 p-4 sm:p-5">
                    {Array.from({ length: 8 }).map((_, idx) => <Skeleton key={idx} className="h-9 rounded-xl" />)}
                  </div>
                ) : sortedOperatorEvents.length === 0 ? (
                  <div className="p-10 text-center text-sm text-slate-500">
                    {operatorGlobalTimeline.length === 0 ? 'За эту неделю событий нет.' : 'По фильтрам ничего не найдено.'}
                  </div>
                ) : (
                  <>
                    {/* Компьютер: таблица */}
                    <div className="hidden max-h-[70vh] overflow-auto sm:block">
                      <table className="w-full min-w-[900px]">
                        <thead className="sticky top-0 z-10 bg-surface-muted">
                          <tr className="text-[11px] font-medium text-muted-foreground">
                            {head('Дата', 'date', 'left', 'px-4 py-2')}
                            {head('Оператор', 'operator')}
                            {head('Тип', 'kind')}
                            {head('Сумма', 'amount', 'right')}
                            {head('Статус', 'status', 'center')}
                            {head('Комментарий', 'comment')}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {sortedOperatorEvents.map((ev) => {
                            const meta = OPERATOR_EVENT_KIND_META[ev.kind]
                            return (
                              <tr
                                key={ev.id}
                                onClick={() => openOperator(ev)}
                                title="Открыть карточку оператора"
                                className={`cursor-pointer transition hover:bg-surface-muted ${ev.status === 'active' ? '' : 'opacity-60'}`}
                              >
                                <td className="whitespace-nowrap px-4 py-2 text-xs tabular-nums text-body">{eventDate(ev)}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-sm text-foreground">{ev.operator_name}</td>
                                <td className="px-3 py-2">
                                  <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.tone}`}>{meta.label}</span>
                                </td>
                                <td className={`whitespace-nowrap px-3 py-2 text-right text-sm font-medium tabular-nums ${ev.status === 'voided' ? 'text-slate-400 line-through' : 'text-foreground'}`}>
                                  {money(ev.amount)}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 text-center text-[11px] text-muted-foreground">{statusLabel(ev)}</td>
                                <td className="max-w-[380px] truncate px-3 py-2 text-xs text-muted-foreground" title={ev.comment || undefined}>{ev.comment || '—'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Телефон: короткие строки в том же порядке */}
                    <div className="max-h-[70vh] divide-y divide-border overflow-y-auto sm:hidden">
                      {sortedOperatorEvents.map((ev) => {
                        const meta = OPERATOR_EVENT_KIND_META[ev.kind]
                        return (
                          <button
                            key={ev.id}
                            type="button"
                            onClick={() => openOperator(ev)}
                            className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left ${ev.status === 'active' ? '' : 'opacity-60'}`}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.tone}`}>{meta.label}</span>
                                <span className="truncate text-sm text-foreground">{ev.operator_name}</span>
                              </div>
                              <div className="mt-0.5 truncate text-[11px] text-slate-500">
                                {eventDate(ev)}
                                {ev.status !== 'active' ? ` · ${statusLabel(ev)}` : ''}
                                {ev.comment ? ` · ${ev.comment}` : ''}
                              </div>
                            </div>
                            <span className={`shrink-0 text-sm font-medium tabular-nums ${ev.status === 'voided' ? 'text-slate-400 line-through' : 'text-foreground'}`}>{money(ev.amount)}</span>
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}
              </Card>
            )
          })()}

          {/* ── STAFF TAB ───────────────────────────────────────────────────── */}
          {/* Ведомость: месяц + половина, все сотрудники строками, под таблицей — */}
          {/* карточка выбранного человека с расчётом, долгами и историей. */}
          {tab === 'staff' && canViewStaffSalary && (() => {
            const sal = staffSalary
            if (staffSalaryLoading && !sal) {
              return (
                <Card className="overflow-hidden border-border bg-white dark:bg-white/[0.04] p-5">
                  <div className="space-y-2">
                    {Array.from({ length: 6 }).map((_, idx) => <Skeleton key={idx} className="h-11 w-full rounded-xl" />)}
                  </div>
                </Card>
              )
            }
            if (!sal || (sal.staff || []).length === 0) {
              return (
                <Card className="overflow-hidden border-border bg-white dark:bg-white/[0.04] p-10 text-center text-sm text-slate-500">
                  Нет административных сотрудников. Добавьте их в «Кадрах».
                </Card>
              )
            }

            const monthNames = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
            const monthLabel = (prefix: string) => {
              const [y, m] = prefix.split('-').map(Number)
              const name = monthNames[(m || 1) - 1] || prefix
              return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`
            }
            const months = Array.from({ length: 18 }, (_, i) => {
              const d = new Date()
              d.setDate(1)
              d.setMonth(d.getMonth() - i)
              return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
            })
            const period = getSalarySlotRange(`${staffMonth}-10`, staffSlot)
            const companyName = (id: string | null | undefined) =>
              (data?.companies || []).find((c) => c.id === String(id || ''))?.name || ''
            const dateTime = (iso: string) => {
              const d = new Date(String(iso || ''))
              if (Number.isNaN(d.getTime())) return String(iso || '').slice(0, 16).replace('T', ' ')
              return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
            }

            const rows = (sal.staff || []).map((s) => {
              const calc = calcStaffToPay(s, sal.adjustments, sal.payments, period)
              const monthPayments = sal.payments.filter(
                (p) => p.staff_id === s.id && monthPrefixFromPaymentDate(p.pay_date) === staffMonth,
              )
              return {
                s,
                calc,
                monthPayments,
                activeAdjs: filterStaffAdjustmentsForSlot(sal.adjustments, s.id, sal.payments, period),
                paid: monthPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0),
                hasFirst: monthPayments.some((p) => p.slot === 'first'),
                hasSecond: monthPayments.some((p) => p.slot === 'second'),
                dismissed: s.is_active === false,
                fromOperators: s.source_type === 'operator',
              }
            })
            const totals = rows.reduce(
              (acc, r) => ({
                half: acc.half + r.calc.half,
                bonuses: acc.bonuses + r.calc.bonuses,
                deductions: acc.deductions + r.calc.fines + r.calc.debts,
                advances: acc.advances + r.calc.advances,
                toPay: acc.toPay + r.calc.toPay,
                paid: acc.paid + r.paid,
              }),
              { half: 0, bonuses: 0, deductions: 0, advances: 0, toPay: 0, paid: 0 },
            )
            const selected = rows.find((r) => r.s.id === selectedStaffId) || null
            const slotButton = (value: 'first' | 'second', label: string) => (
              <button
                type="button"
                onClick={() => setStaffSlot(value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${staffSlot === value ? 'bg-white dark:bg-white/10 text-foreground shadow-sm' : 'text-muted-foreground hover:text-slate-700 dark:hover:text-slate-200'}`}
              >
                {label}
              </button>
            )
            const payMark = (paid: boolean) => (
              <span className={`inline-block h-2 w-2 rounded-full ${paid ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-white/20'}`} />
            )

            return (
              <div className="space-y-4">
                <Card className="overflow-hidden border-border bg-white dark:bg-white/[0.04]">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 sm:p-5">
                    <div className="flex items-center gap-3">
                      <div className="rounded-2xl bg-violet-500/15 p-2.5 text-violet-700 dark:text-violet-300"><Users className="h-5 w-5" /></div>
                      <div>
                        <h2 className="text-base font-semibold text-foreground">Ведомость административных сотрудников</h2>
                        <p className="text-xs text-muted-foreground">
                          Оклад пополам: 1–15 и 16–конец месяца. {sal.consistency?.has_issues ? (
                            <span className="text-amber-700 dark:text-amber-300">
                              Расходы по зарплате разошлись с выплатами ({sal.consistency.missing_payment_expense_count}/{sal.consistency.orphan_payment_expense_count}).
                            </span>
                          ) : 'Выплаты и авансы сходятся с расходами.'}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        className="h-9 rounded-xl border border-border bg-card px-3 text-sm text-foreground focus:border-emerald-400/40 focus:outline-none [color-scheme:light] dark:[color-scheme:dark]"
                        value={staffMonth}
                        onChange={(e) => setStaffMonth(e.target.value)}
                        aria-label="Месяц"
                      >
                        {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
                      </select>
                      <div className="flex items-center gap-1 rounded-xl bg-slate-100 dark:bg-white/5 p-1">
                        {slotButton('first', '1–15')}
                        {slotButton('second', '16–конец')}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className={'h-9 rounded-xl border-border text-xs ' + (showStaffArchived ? 'bg-amber-400/20 text-amber-700 dark:text-amber-100 hover:bg-amber-400/30' : 'bg-white dark:bg-white/5 text-body hover:bg-surface-hover')}
                        onClick={() => setShowStaffArchived((v) => !v)}
                      >
                        {showStaffArchived ? 'Архив открыт' : 'Архив'}
                      </Button>
                      <Button type="button" variant="outline" className="h-9 rounded-xl border-border bg-white dark:bg-white/5 text-body hover:bg-surface-hover" onClick={() => void loadStaffSalary()} disabled={staffRefreshing} aria-label="Обновить">
                        <RefreshCw className={`h-4 w-4 ${staffRefreshing ? 'animate-spin' : ''}`} />
                      </Button>
                    </div>
                  </div>

                  {/* Таблица — основной вид */}
                  <div className="hidden overflow-x-auto sm:block">
                    <table className="w-full min-w-[860px]">
                      <thead className="bg-surface-muted">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Сотрудник</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Пол-оклада</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Бонусы</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Штрафы и долги</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Авансы</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">К выплате</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Выплачено за месяц</th>
                          <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground">1-е · 15-е</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {rows.map((r) => (
                          <tr
                            key={r.s.id}
                            onClick={() => setSelectedStaffId(selectedStaffId === r.s.id ? null : r.s.id)}
                            className={`cursor-pointer transition hover:bg-surface-muted ${selectedStaffId === r.s.id ? 'bg-violet-500/[0.06]' : ''} ${r.dismissed ? 'opacity-60' : ''}`}
                          >
                            <td className="px-4 py-2.5 text-sm">
                              <div className="flex items-center gap-2">
                                <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${selectedStaffId === r.s.id ? 'rotate-90' : ''}`} />
                                <div className="min-w-0">
                                  <div className="truncate font-medium text-foreground">{r.s.full_name}</div>
                                  <div className="truncate text-[11px] text-slate-400">
                                    {formatRoleLabel(r.s.role)}
                                    {r.fromOperators ? ' · из операторов' : ` · ${money(r.s.monthly_salary)}/мес`}
                                    {r.dismissed ? ' · уволен' : ''}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-right text-sm tabular-nums">{money(r.calc.half)}</td>
                            {/* Пусто — серый прочерк: цветной прочерк читался как «тут что-то есть» */}
                            <td className={`px-3 py-2.5 text-right text-sm tabular-nums ${r.calc.bonuses ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-300 dark:text-white/20'}`}>{r.calc.bonuses ? `+${money(r.calc.bonuses)}` : '—'}</td>
                            <td className={`px-3 py-2.5 text-right text-sm tabular-nums ${r.calc.fines + r.calc.debts ? 'text-rose-600 dark:text-rose-300' : 'text-slate-300 dark:text-white/20'}`}>{r.calc.fines + r.calc.debts ? `−${money(r.calc.fines + r.calc.debts)}` : '—'}</td>
                            <td className={`px-3 py-2.5 text-right text-sm tabular-nums ${r.calc.advances ? 'text-amber-700 dark:text-amber-300' : 'text-slate-300 dark:text-white/20'}`}>{r.calc.advances ? `−${money(r.calc.advances)}` : '—'}</td>
                            <td className="px-3 py-2.5 text-right text-sm font-semibold tabular-nums text-foreground">{money(r.calc.toPay)}</td>
                            <td className="px-3 py-2.5 text-right text-sm tabular-nums text-sky-700 dark:text-sky-300">{r.paid ? money(r.paid) : '—'}</td>
                            <td className="px-3 py-2.5 text-center">
                              <span className="inline-flex items-center gap-1.5">{payMark(r.hasFirst)}{payMark(r.hasSecond)}</span>
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-surface-muted/60 font-semibold">
                          <td className="px-4 py-2.5 text-sm">Итого · {rows.length}</td>
                          <td className="px-3 py-2.5 text-right text-sm tabular-nums">{money(totals.half)}</td>
                          <td className="px-3 py-2.5 text-right text-sm tabular-nums">{totals.bonuses ? `+${money(totals.bonuses)}` : '—'}</td>
                          <td className="px-3 py-2.5 text-right text-sm tabular-nums">{totals.deductions ? `−${money(totals.deductions)}` : '—'}</td>
                          <td className="px-3 py-2.5 text-right text-sm tabular-nums">{totals.advances ? `−${money(totals.advances)}` : '—'}</td>
                          <td className="px-3 py-2.5 text-right text-sm tabular-nums">{money(totals.toPay)}</td>
                          <td className="px-3 py-2.5 text-right text-sm tabular-nums">{money(totals.paid)}</td>
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Телефон: та же ведомость короткими строками */}
                  <div className="divide-y divide-border sm:hidden">
                    {rows.map((r) => (
                      <button
                        key={r.s.id}
                        type="button"
                        onClick={() => setSelectedStaffId(selectedStaffId === r.s.id ? null : r.s.id)}
                        className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left ${r.dismissed ? 'opacity-60' : ''}`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{r.s.full_name}</div>
                          <div className="truncate text-[11px] text-slate-400">
                            {formatRoleLabel(r.s.role)} · выплачено {money(r.paid)}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <div className="text-right">
                            <div className="text-sm font-semibold tabular-nums text-foreground">{money(r.calc.toPay)}</div>
                            <div className="flex items-center justify-end gap-1">{payMark(r.hasFirst)}{payMark(r.hasSecond)}</div>
                          </div>
                          <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${selectedStaffId === r.s.id ? 'rotate-90' : ''}`} />
                        </div>
                      </button>
                    ))}
                    <div className="flex items-center justify-between px-4 py-3 text-sm font-semibold">
                      <span>Итого</span>
                      <span className="tabular-nums">{money(totals.toPay)}</span>
                    </div>
                  </div>
                </Card>

                {selected ? (() => {
                  const s = selected.s
                  const calc = selected.calc
                  const debtAdj = (sal.adjustments as any[]).find((a) => a.id === `operator-debt:${s.id}`)
                  const allDebtItems = (debtAdj?.items || []) as Array<{ id: string; name: string; quantity: number; unitPrice: number; amount: number; createdAt: string; companyId: string | null; comment: string | null }>
                  // Только позиции выбранной половины месяца: иначе в августе
                  // показывались сентябрьские долги, да ещё с суммой 0 ₸
                  const debtItems = period
                    ? allDebtItems.filter((i) => {
                        const day = String(i.createdAt || '').slice(0, 10)
                        return day >= period.from && day <= period.to
                      })
                    : allDebtItems
                  const debtItemsTotal = debtItems.reduce((sum, i) => sum + Number(i.amount || 0), 0)
                  const debtPays = (sal.debtPayments || []).filter((p) => p.staff_id === s.id)
                  const isMonthClosed = selected.hasFirst && selected.hasSecond
                  const line = (label: string, value: string, cls = '') => (
                    <div className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
                      <span className="text-muted-foreground">{label}</span>
                      <span className={`shrink-0 tabular-nums ${cls}`}>{value}</span>
                    </div>
                  )
                  return (
                    <Card className="overflow-hidden border-border bg-white dark:bg-white/[0.04]">
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4 sm:p-5">
                        <div className="flex items-center gap-3">
                          <div className={'flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-semibold ' + (selected.dismissed ? 'bg-gradient-to-br from-slate-300 to-slate-400 text-slate-700 dark:from-slate-600 dark:to-slate-700 dark:text-white' : 'bg-gradient-to-br from-violet-500 to-purple-600 text-white')}>
                            {(s.short_name || s.full_name).charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold text-foreground">{s.full_name}</div>
                            <div className="text-xs text-slate-400">
                              {formatRoleLabel(s.role)}
                              {selected.fromOperators ? ' · из операторов' : ` · Оклад: ${money(s.monthly_salary)}/мес`}
                              {selected.dismissed ? ' · уволен' : ''}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {!selected.dismissed && canStaffAddAdjustment && (
                            <Button type="button" disabled={!canEditStaffSalary || selected.fromOperators} variant="outline" className="h-9 rounded-xl border-border bg-white dark:bg-white/5 text-xs text-body hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50" onClick={() => { setStaffAdjModal(s); setStaffAdjKind('fine'); setStaffAdjCompanyId(data?.companies?.[0]?.id || ''); setStaffAdjAmount(''); setStaffAdjDate(todayISO()); setStaffAdjComment(''); setStaffAdjError(null) }}><Plus className="mr-1.5 h-3.5 w-3.5" />Корректировка</Button>
                          )}
                          {!selected.dismissed && canStaffAddExtraDay && (
                            <Button type="button" disabled={!canEditStaffSalary || selected.fromOperators} variant="outline" className="h-9 rounded-xl border-border bg-white dark:bg-white/5 text-xs text-body hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void submitStaffExtraDay(s.id)}><CalendarDays className="mr-1.5 h-3.5 w-3.5" />Доп. выход</Button>
                          )}
                          {!selected.dismissed && !selected.fromOperators && canEditStaffSalary && calc.debts > 0 && (
                            <Button type="button" variant="outline" className="h-9 rounded-xl border-rose-400/30 bg-rose-500/10 text-xs text-rose-700 dark:text-rose-200 hover:bg-rose-500/20" onClick={() => openPayDebt(s, calc.debts)}><Wallet className="mr-1.5 h-3.5 w-3.5" />Оплата долга ({money(calc.debts)})</Button>
                          )}
                          {!selected.dismissed && canStaffCreatePayment && (
                            <Button type="button" disabled={!canEditStaffSalary || selected.fromOperators || isMonthClosed} className="h-9 rounded-xl bg-emerald-500 text-xs text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50" onClick={() => { setStaffPayModal(s); setStaffPayDate(todayISO()); setStaffPaySlot(selected.hasFirst ? 'second' : 'first'); setStaffPayCash(calc.toPay > 0 ? String(calc.toPay) : ''); setStaffPayKaspi(''); setStaffPayComment(''); setStaffPayCompanyId(data?.companies?.[0]?.id || '') }}><Wallet className="mr-1.5 h-3.5 w-3.5" />Выплатить</Button>
                          )}
                        </div>
                      </div>

                      {isMonthClosed ? (
                        <div className="border-b border-border bg-amber-500/[0.06] px-4 py-2 text-xs text-amber-700 dark:text-amber-300 sm:px-5">
                          {monthLabel(staffMonth)}: обе выплаты проведены. Следующая — в следующем месяце.
                        </div>
                      ) : null}

                      <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-2">
                        {/* Откуда сумма */}
                        <div>
                          <div className="mb-2 text-sm font-medium text-foreground">Как получилась сумма · {staffSlot === 'first' ? '1–15' : '16–конец'} {monthLabel(staffMonth).toLowerCase()}</div>
                          <div className="divide-y divide-border rounded-xl border border-border">
                            {line('Половина оклада', money(calc.half))}
                            {calc.bonuses ? line('Бонусы', `+${money(calc.bonuses)}`, 'text-emerald-700 dark:text-emerald-300') : null}
                            {calc.fines ? line('Штрафы', `−${money(calc.fines)}`, 'text-rose-600 dark:text-rose-300') : null}
                            {calc.debts ? line('Долги', `−${money(calc.debts)}`, 'text-rose-600 dark:text-rose-300') : null}
                            {calc.advances ? line('Авансы выданы', `−${money(calc.advances)}`, 'text-amber-700 dark:text-amber-300') : null}
                            {calc.remainder ? line('Остаток прошлой выплаты (доплата)', `+${money(calc.remainder)}`, 'text-sky-700 dark:text-sky-300') : null}
                            <div className="flex items-baseline justify-between gap-3 bg-surface-muted/60 px-3 py-2 text-sm font-semibold">
                              <span>К выплате</span>
                              <span className="shrink-0 tabular-nums">{money(calc.toPay)}</span>
                            </div>
                          </div>

                          {selected.activeAdjs.length > 0 ? (
                            <div className="mt-4">
                              <div className="mb-2 text-sm font-medium text-foreground">Активные корректировки</div>
                              <div className="space-y-1.5">
                                {selected.activeAdjs.map((adj) => (
                                  <div key={adj.id} className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-xs">
                                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${staffAdjustmentTone(adj.kind)}`}>{staffAdjustmentKindLabel(adj.kind)}</span>
                                      <span className="font-medium text-foreground">{money(adj.amount)}</span>
                                      <span className="text-slate-500">{adj.date}</span>
                                      {adj.comment ? <span className="truncate text-muted-foreground">{adj.comment}</span> : null}
                                    </div>
                                    {canEditStaffSalary ? (
                                      adj.id.startsWith('operator-debt:') ? (
                                        <button type="button" title="Аннулировать долг из кассы" className="shrink-0 text-slate-500 transition hover:text-rose-600 dark:hover:text-rose-300" onClick={() => void voidOperatorDebt(adj as any)}><X className="h-3.5 w-3.5" /></button>
                                      ) : adj.kind === 'advance' && (adj as any).source_payment_id ? (
                                        // Переплату ведёт расчётный регистр (staff_salary_settlements): триггер
                                        // пересчитывает её из выплаты и возвращает активной. Крестик здесь
                                        // всегда упирался в отказ базы — вместо него объяснение.
                                        <span className="shrink-0 text-[10px] text-muted-foreground" title="Эту строку ведёт расчётный регистр: она считается из выплаты. Убрать её можно, аннулировав саму выплату.">из выплаты</span>
                                      ) : (
                                        <button type="button" title="Аннулировать" className="shrink-0 text-slate-500 transition hover:text-rose-600 dark:hover:text-rose-300" onClick={() => void removeStaffAdjustment(adj.id)}><X className="h-3.5 w-3.5" /></button>
                                      )
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>

                        {/* Что взял в долг и когда */}
                        <div>
                          <div className="mb-2 text-sm font-medium text-foreground">
                            Долги из кассы {debtItems.length ? <span className="font-normal text-muted-foreground">· {debtItems.length} шт. на {money(debtItemsTotal)}</span> : null}
                          </div>
                          {debtItems.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                              За этот период долгов из кассы нет.
                            </div>
                          ) : (
                            <div className="divide-y divide-border rounded-xl border border-border">
                              {debtItems.map((item) => (
                                <div key={item.id} className="flex items-start justify-between gap-3 px-3 py-2">
                                  <div className="min-w-0">
                                    <div className="truncate text-sm text-foreground">{item.name}</div>
                                    <div className="truncate text-[11px] text-slate-500">
                                      {dateTime(item.createdAt)}
                                      {item.quantity ? ` · ${item.quantity} шт. × ${money(item.unitPrice)}` : ''}
                                      {companyName(item.companyId) ? ` · ${companyName(item.companyId)}` : ''}
                                      {item.comment ? ` · ${item.comment}` : ''}
                                    </div>
                                  </div>
                                  <span className="shrink-0 text-sm font-medium tabular-nums text-rose-600 dark:text-rose-300">{money(item.amount)}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {selected.monthPayments.length > 0 ? (
                            <div className="mt-4">
                              <div className="mb-2 text-sm font-medium text-foreground">Выплаты · {monthLabel(staffMonth).toLowerCase()}</div>
                              <div className="space-y-2">
                                {selected.monthPayments.map((payment) => {
                                  const closingWindow = getStaffPaymentClosingWindow(s.id, sal.payments, payment.pay_date, payment.id)
                                  const closedAdjustments = getStaffPaymentClosedAdjustments({ staffId: s.id, adjustments: sal.adjustments, payment, closingWindow })
                                  const generatedAdjustments = getStaffPaymentGeneratedAdjustments({ staffId: s.id, adjustments: sal.adjustments, payment })
                                  return (
                                    <div key={payment.id} className="rounded-xl border border-border px-3 py-2 text-xs">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-body">{payment.pay_date} · {money(payment.amount)} · {staffPaymentSlotLabel(payment.slot)}</span>
                                        {canEditStaffSalary ? (
                                          <button type="button" title="Аннулировать выплату" onClick={() => void deleteStaffPayment(payment.id, payment.amount)} className="shrink-0 text-slate-500 transition hover:text-rose-600 dark:hover:text-rose-300"><X className="h-3.5 w-3.5" /></button>
                                        ) : null}
                                      </div>
                                      <div className="mt-1 text-[11px] text-slate-500">Период закрытия: {closingWindow.label}</div>
                                      {closedAdjustments.slice(0, 4).map((adj) => (
                                        <div key={adj.id} className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                          <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${staffAdjustmentTone(adj.kind)}`}>закрыто: {staffAdjustmentKindLabel(adj.kind)}</span>
                                          <span className="font-medium text-foreground">{money(adj.amount)}</span>
                                          <span>{adj.date}</span>
                                        </div>
                                      ))}
                                      {closedAdjustments.length > 4 ? <div className="mt-1 text-[11px] text-slate-500">Ещё закрыто: {closedAdjustments.length - 4}</div> : null}
                                      {generatedAdjustments.map((adj) => (
                                        <div key={adj.id} className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-200">
                                          <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${staffAdjustmentTone(adj.kind)}`}>создано: {staffAdjustmentKindLabel(adj.kind)}</span>
                                          <span className="font-medium text-foreground">{money(adj.amount)}</span>
                                          <span>на следующую выплату</span>
                                        </div>
                                      ))}
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          ) : null}

                          {debtPays.length > 0 ? (
                            <details className="group mt-4">
                              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
                                <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
                                Погашенные и аннулированные долги · {debtPays.length}
                              </summary>
                              <div className="mt-2 space-y-1.5">
                                {debtPays.map((p) => (
                                  <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-xs">
                                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                                      <span className="font-medium tabular-nums text-foreground">{money(p.amount)}</span>
                                      <span className="text-slate-500">{String(p.paid_at || '').slice(0, 10)}</span>
                                      {p.comment ? <span className="truncate text-muted-foreground">{p.comment}</span> : null}
                                    </div>
                                    {canEditStaffSalary ? (
                                      <button type="button" title="Вернуть долг активным" disabled={voidDebtPayId === p.id} className="shrink-0 text-slate-500 transition hover:text-rose-600 dark:hover:text-rose-300 disabled:opacity-50" onClick={() => void voidStaffDebtPayment(p.id)}>
                                        {voidDebtPayId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                                      </button>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            </details>
                          ) : null}
                        </div>
                      </div>
                    </Card>
                  )
                })() : (
                  <Card className="border-dashed border-border bg-transparent p-6 text-center text-sm text-muted-foreground">
                    Нажмите на сотрудника, чтобы увидеть расчёт, долги из кассы и историю выплат.
                  </Card>
                )}
              </div>
            )
          })()}

          {/* ── EVENTS TAB ─────────────────────────────────────────────────── */}
          {/* Лента событий административных сотрудников: настоящие записи поштучно, */}
          {/* таблица с сортировкой; клик — карточка сотрудника в ведомости. */}
          {tab === 'events' && (() => {
            const monthNames = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь']
            const monthLabel = (prefix: string) => {
              const [y, m] = prefix.split('-').map(Number)
              const name = monthNames[(m || 1) - 1] || prefix
              return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${y}`
            }
            const hasFilters = eventsStaffId !== 'all' || eventsKind !== 'all' || eventsStatus !== 'all' || eventsQuery.trim() !== ''
            const eventDate = (ev: StaffTimelineEvent) => {
              // У позиций из кассы и оплат долгов есть точное время — показываем его
              if ((ev.kind === 'debt_item' || ev.kind === 'debt_payment') && ev.created_at) {
                const d = new Date(ev.created_at)
                if (!Number.isNaN(d.getTime())) {
                  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                }
              }
              return formatRuDate(ev.date)
            }
            const statusLabel = (ev: StaffTimelineEvent) => (ev.status === 'voided' ? 'аннулировано' : ev.status === 'paid' ? 'закрыто выплатой' : 'активно')
            const openStaff = (ev: StaffTimelineEvent) => {
              setSelectedStaffId(ev.staff_id)
              if (/^\d{4}-\d{2}/.test(ev.date)) {
                setStaffMonth(ev.date.slice(0, 7))
                setStaffSlot(Number(ev.date.slice(8, 10)) <= 15 ? 'first' : 'second')
              }
              setTab('staff')
            }
            const head = (label: string, key: StaffEventSortKey, align: 'left' | 'right' | 'center' = 'left', cls = 'px-3 py-2') => (
              <SortableTh label={label} sortKey={key} sort={staffEventSort} onSort={toggleStaffEventSort} align={align} className={cls} />
            )
            // В итогах только типы, по которым что-то есть, — девять пустых плашек не нужны
            const visibleKinds = STAFF_EVENT_KINDS.filter((kind) => staffEventsTotals[kind] > 0 || eventsKind === kind)

            return (
              <Card className="overflow-hidden border-border bg-white dark:bg-white/[0.04]">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4 sm:p-5">
                  <div className="flex items-center gap-3">
                    <div className="rounded-2xl bg-cyan-500/15 p-2.5 text-cyan-700 dark:text-cyan-300"><CalendarDays className="h-5 w-5" /></div>
                    <div>
                      <h2 className="text-base font-semibold text-foreground">Лента событий административных сотрудников</h2>
                      <p className="text-xs text-muted-foreground">
                        Все события по отдельности: выплаты, авансы, бонусы, штрафы, долги, оплаты долгов и позиции из кассы. Нажмите на строку — откроется карточка сотрудника.
                      </p>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Событий: <span className="font-semibold text-foreground">{sortedStaffEvents.length}</span>
                  </div>
                </div>

                <div className="space-y-3 border-b border-border p-4 sm:p-5">
                  {visibleKinds.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {visibleKinds.map((kind) => {
                        const meta = STAFF_EVENT_KIND_META[kind]
                        const active = eventsKind === kind
                        return (
                          <button
                            key={kind}
                            type="button"
                            onClick={() => setEventsKind(active ? 'all' : kind)}
                            className={`rounded-full border px-3 py-1 text-xs transition ${active ? meta.tone : 'border-border bg-white dark:bg-white/[0.03] text-body hover:bg-surface-hover'}`}
                          >
                            {meta.plural}: <span className="font-semibold tabular-nums">{money(staffEventsTotals[kind])}</span>
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                    <select className={selectCls} value={eventsMonth} onChange={(e) => setEventsMonth(e.target.value)} aria-label="Месяц">
                      <option value="all">Все месяцы</option>
                      {staffEventMonths.map((m) => (
                        <option key={m} value={m}>{monthLabel(m)}</option>
                      ))}
                    </select>
                    <select className={selectCls} value={eventsStaffId} onChange={(e) => setEventsStaffId(e.target.value)} aria-label="Сотрудник">
                      <option value="all">Все сотрудники</option>
                      {(staffSalary?.staff || []).map((s) => (
                        <option key={s.id} value={s.id}>{s.full_name || s.short_name || s.id}</option>
                      ))}
                    </select>
                    <select className={selectCls} value={eventsKind} onChange={(e) => setEventsKind(e.target.value as 'all' | StaffTimelineKind)} aria-label="Тип">
                      <option value="all">Все типы</option>
                      {STAFF_EVENT_KINDS.map((kind) => (
                        <option key={kind} value={kind}>{STAFF_EVENT_KIND_META[kind].plural}</option>
                      ))}
                    </select>
                    <select className={selectCls} value={eventsStatus} onChange={(e) => setEventsStatus(e.target.value as 'all' | 'active' | 'paid' | 'voided')} aria-label="Статус">
                      <option value="all">Любой статус</option>
                      <option value="active">Активные</option>
                      <option value="paid">Закрытые выплатой</option>
                      <option value="voided">Аннулированные</option>
                    </select>
                    <input className={input} type="text" value={eventsQuery} onChange={(e) => setEventsQuery(e.target.value)} placeholder="Поиск: сотрудник, товар, комментарий" />
                  </div>
                  {hasFilters ? (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                      onClick={() => {
                        setEventsStaffId('all')
                        setEventsKind('all')
                        setEventsStatus('all')
                        setEventsQuery('')
                      }}
                    >
                      Сбросить фильтры
                    </button>
                  ) : null}
                </div>

                {staffSalaryLoading && !staffSalary ? (
                  <div className="space-y-2 p-4 sm:p-5">
                    {Array.from({ length: 8 }).map((_, idx) => <Skeleton key={idx} className="h-9 rounded-xl" />)}
                  </div>
                ) : sortedStaffEvents.length === 0 ? (
                  <div className="p-10 text-center text-sm text-slate-500">
                    {staffGlobalTimeline.length === 0 ? 'Событий пока нет.' : 'По фильтрам ничего не найдено — попробуйте другой месяц.'}
                  </div>
                ) : (
                  <>
                    {/* Компьютер: таблица */}
                    <div className="hidden max-h-[70vh] overflow-auto sm:block">
                      <table className="w-full min-w-[900px]">
                        <thead className="sticky top-0 z-10 bg-surface-muted">
                          <tr className="text-[11px] font-medium text-muted-foreground">
                            {head('Дата', 'date', 'left', 'px-4 py-2')}
                            {head('Сотрудник', 'staff')}
                            {head('Тип', 'kind')}
                            {head('Сумма', 'amount', 'right')}
                            {head('Статус', 'status', 'center')}
                            {head('Комментарий', 'comment')}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {sortedStaffEvents.map((ev) => {
                            const meta = STAFF_EVENT_KIND_META[ev.kind]
                            return (
                              <tr
                                key={ev.id}
                                onClick={() => openStaff(ev)}
                                title="Открыть карточку сотрудника"
                                className={`cursor-pointer transition hover:bg-surface-muted ${ev.status === 'active' ? '' : 'opacity-60'}`}
                              >
                                <td className="whitespace-nowrap px-4 py-2 text-xs tabular-nums text-body">{eventDate(ev)}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-sm text-foreground">{ev.staff_name}</td>
                                <td className="px-3 py-2">
                                  <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.tone}`}>{meta.label}</span>
                                </td>
                                <td className={`whitespace-nowrap px-3 py-2 text-right text-sm font-medium tabular-nums ${ev.status === 'voided' ? 'text-slate-400 line-through' : 'text-foreground'}`}>
                                  {money(ev.amount)}
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 text-center text-[11px] text-muted-foreground">{statusLabel(ev)}</td>
                                <td className="max-w-[380px] truncate px-3 py-2 text-xs text-muted-foreground" title={ev.comment || undefined}>{ev.comment || '—'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Телефон: короткие строки в том же порядке */}
                    <div className="max-h-[70vh] divide-y divide-border overflow-y-auto sm:hidden">
                      {sortedStaffEvents.map((ev) => {
                        const meta = STAFF_EVENT_KIND_META[ev.kind]
                        return (
                          <button
                            key={ev.id}
                            type="button"
                            onClick={() => openStaff(ev)}
                            className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left ${ev.status === 'active' ? '' : 'opacity-60'}`}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.tone}`}>{meta.label}</span>
                                <span className="truncate text-sm text-foreground">{ev.staff_name}</span>
                              </div>
                              <div className="mt-0.5 truncate text-[11px] text-slate-500">
                                {eventDate(ev)}
                                {ev.status !== 'active' ? ` · ${statusLabel(ev)}` : ''}
                                {ev.comment ? ` · ${ev.comment}` : ''}
                              </div>
                            </div>
                            <span className={`shrink-0 text-sm font-medium tabular-nums ${ev.status === 'voided' ? 'text-slate-400 line-through' : 'text-foreground'}`}>{money(ev.amount)}</span>
                          </button>
                        )
                      })}
                    </div>
                  </>
                )}
              </Card>
            )
          })()}

        </div>

      {advanceTarget ? (
        <Modal title="Выдать аванс" subtitle={`${getOperatorDisplayName(advanceTarget.operator)} • ${formatRuDate(weekStart)} - ${formatRuDate(weekEnd)}`} onClose={() => setAdvanceTarget(null)}>
          <form className="space-y-4" onSubmit={submitAdvance}>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-body">Точка</label>
                <select className={selectCls} value={advanceCompanyId} onChange={(e) => setAdvanceCompanyId(e.target.value)}>
                  {(data?.companies || []).map((c) => <option key={c.id} value={c.id}>{c.name || c.code || c.id}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm text-body">Дата выплаты</label>
                <DatePicker className="h-11" value={advanceDate} onChange={setAdvanceDate} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-body">Наличные</label>
                <input className={input} type="text" value={advanceCash} onChange={(e) => setAdvanceCash(e.target.value)} placeholder="0" />
              </div>
              <div>
                <label className="mb-2 block text-sm text-body">{cashLabels.providerName}</label>
                <input className={input} type="text" value={advanceKaspi} onChange={(e) => setAdvanceKaspi(e.target.value)} placeholder="0" />
              </div>
            </div>
            <textarea className={textarea} value={advanceComment} onChange={(e) => setAdvanceComment(e.target.value)} placeholder="Комментарий" />
            <div className="rounded-2xl border border-border bg-white dark:bg-white/[0.03] p-4 text-sm text-body">Итого аванс: <span className="font-semibold text-foreground">{money(parseMoney(advanceCash) + parseMoney(advanceKaspi))}</span></div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" className="rounded-xl border-border bg-white dark:bg-white/5 text-body hover:bg-surface-hover" onClick={() => setAdvanceTarget(null)}>Отмена</Button>
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
                <label className="mb-2 block text-sm text-body">Дата выплаты</label>
                <DatePicker className="h-11" value={payDate} onChange={setPayDate} />
              </div>
              <div className="rounded-2xl border border-border bg-white dark:bg-white/[0.03] p-4 text-sm text-body">Эта выплата автоматически разложится по компаниям по фактическому начислению.</div>
              <div>
                <label className="mb-2 block text-sm text-body">Наличные</label>
                <input className={input} type="text" value={payCash} onChange={(e) => setPayCash(e.target.value)} placeholder="0" />
              </div>
              <div>
                <label className="mb-2 block text-sm text-body">{cashLabels.providerName}</label>
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
                  <label className="flex items-start gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm text-amber-700 dark:text-amber-100">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-amber-400"
                      checked={payAllowOverpayment}
                      onChange={(e) => setPayAllowOverpayment(e.target.checked)}
                    />
                    <span>
                      <span className="font-semibold text-foreground">Выдать сверх остатка как аванс</span>
                      <span className="block text-xs text-amber-700 dark:text-amber-200/80 mt-0.5">
                        Если сумма выплаты превышает {money(remaining)} — разница уйдёт авансом и вычтется со следующей недели.
                      </span>
                    </span>
                  </label>
                  <div className="rounded-2xl border border-border bg-white dark:bg-white/[0.03] p-4 text-sm text-body">
                    <div className="flex justify-between">
                      <span>Выплата сейчас:</span>
                      <span className="font-semibold text-foreground">{money(total)}</span>
                    </div>
                    <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                      <span>В счёт текущей недели:</span>
                      <span>{money(Math.min(total, remaining))}</span>
                    </div>
                    {showAdvanceRow ? (
                      <div className="mt-1 flex justify-between text-xs text-amber-700 dark:text-amber-200">
                        <span>Аванс на следующую неделю:</span>
                        <span className="font-semibold">{money(overpayment)}</span>
                      </div>
                    ) : null}
                  </div>
                </>
              )
            })()}
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" className="rounded-xl border-border bg-white dark:bg-white/5 text-body hover:bg-surface-hover" onClick={() => setPayTarget(null)}>Отмена</Button>
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
              <Button type="button" variant="outline" className="rounded-xl border-border bg-white dark:bg-white/5 text-body hover:bg-surface-hover" onClick={() => setChatTarget(null)}>Отмена</Button>
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
              <div className="mt-1 text-2xl font-bold text-rose-700 dark:text-rose-200">{money(payDebtModal.amount)}</div>
            </div>
            <p className="text-xs text-muted-foreground">
              Долг будет помечен оплаченным и убран из вычета зарплаты. Запись появится в «Оплаченные долги» — её можно аннулировать (долг вернётся активным).
            </p>
            <div>
              <label className="mb-2 block text-sm text-body">Комментарий (необязательно)</label>
              <textarea className={textarea} placeholder="Например: вернул наличными" value={payDebtComment} onChange={(e) => setPayDebtComment(e.target.value)} />
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" className="rounded-xl border-border bg-white dark:bg-white/5 text-body hover:bg-surface-hover" onClick={() => setPayDebtModal(null)}>Отмена</Button>
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
                <label className="mb-2 block text-sm text-body">Тип</label>
                <select className={selectCls} value={staffAdjKind} onChange={e => setStaffAdjKind(e.target.value as any)}>
                  <option value="fine">Штраф</option>
                  <option value="debt">Долг</option>
                  <option value="bonus">Бонус</option>
                  <option value="advance">Аванс</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm text-body">Дата</label>
                <DatePicker className="h-11" value={staffAdjDate} onChange={setStaffAdjDate} />
              </div>
              {staffAdjKind === 'advance' ? (
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm text-body">Компания (расход по авансу)</label>
                  <select className={selectCls} value={staffAdjCompanyId} onChange={e => setStaffAdjCompanyId(e.target.value)}>
                    <option value="">Выберите компанию</option>
                    {(data?.companies || []).map((c) => (
                      <option key={c.id} value={c.id}>{c.name || c.code || c.id}</option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="md:col-span-2">
                <label className="mb-2 block text-sm text-body">Сумма</label>
                <input className={input} type="text" placeholder="0" value={staffAdjAmount} onChange={e => setStaffAdjAmount(e.target.value)} />
              </div>
            </div>
            <textarea className={textarea} placeholder="Комментарий" value={staffAdjComment} onChange={e => setStaffAdjComment(e.target.value)} />
            {staffAdjError ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">{staffAdjError}</div>
            ) : null}
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" className="rounded-xl border-border bg-white dark:bg-white/5 text-body hover:bg-surface-hover" onClick={() => setStaffAdjModal(null)}>Отмена</Button>
              <Button type="submit" className="rounded-xl bg-emerald-500 text-white hover:bg-emerald-400">{staffAdjSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Сохранить'}</Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {staffPayModal ? (
        <Modal title="Выплата зарплаты" subtitle={`${staffPayModal.full_name} · к выплате ${money(calcStaffToPay(staffPayModal, staffSalary?.adjustments || [], staffSalary?.payments || [], getStaffPaymentAdjustmentPeriod(staffPayDate, staffPaySlot)).toPay)}`} onClose={() => setStaffPayModal(null)}>
          <form className="space-y-4" onSubmit={submitStaffPayment}>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-body">Слот</label>
                <select className={selectCls} value={staffPaySlot} onChange={e => setStaffPaySlot(e.target.value as 'first' | 'second')}>
                  <option value="first">Выплата 1-го числа</option>
                  <option value="second">Выплата 15-го числа</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm text-body">Дата выплаты</label>
                <DatePicker className="h-11" value={staffPayDate} onChange={setStaffPayDate} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-body">Компания (расход)</label>
                <select className={selectCls} value={staffPayCompanyId} onChange={e => setStaffPayCompanyId(e.target.value)}>
                  <option value="">Выберите компанию</option>
                  {(data?.companies || []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name || c.code || c.id}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm text-body">Наличные</label>
                <input className={input} type="text" placeholder="0" value={staffPayCash} onChange={e => setStaffPayCash(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-body">{cashLabels.providerName}</label>
                <input className={input} type="text" placeholder="0" value={staffPayKaspi} onChange={e => setStaffPayKaspi(e.target.value)} />
              </div>
            </div>
            {staffPayPreview ? (
              <div className="rounded-2xl border border-border bg-white dark:bg-white/[0.03] p-4 text-xs text-body">
                <div className="mb-2 text-sm font-medium text-foreground">Предпросмотр проводки</div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div>Период закрытия: <span className="text-foreground">{staffPayPreview.closingWindow.label}</span></div>
                  <div>Очередь: <span className="text-foreground">{staffPaymentSlotLabel(staffPaySlot)}</span></div>
                  <div>Закроется корректировок: <span className="text-foreground">{staffPayPreview.closingAdjustments.length}</span></div>
                  <div>Расход (компания): <span className="text-foreground">{staffPayPreview.companyName}</span></div>
                  <div>Расход (нал/{cashLabels.providerName}): <span className="text-foreground">{money(staffPayPreview.payCashAmount)} / {money(staffPayPreview.payKaspiAmount)}</span></div>
                  <div>К выплате по расчёту: <span className="text-foreground">{money(staffPayPreview.calc.toPay)}</span></div>
                  <div>Сейчас будет выплачено: <span className="text-foreground">{money(staffPayPreview.payTotal)}</span></div>
                </div>
                {staffPayPreview.closingAdjustments.length > 0 ? (
                  <div className="mt-3 max-h-28 space-y-1 overflow-y-auto pr-1">
                    {staffPayPreview.closingAdjustments.map((adj) => (
                      <div key={adj.id} className="flex items-center justify-between rounded-lg border border-border px-2 py-1">
                        <span className="text-muted-foreground">{adj.date} · {staffAdjustmentKindLabel(adj.kind)}</span>
                        <span className="text-foreground">{money(adj.amount)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <textarea className={textarea} placeholder="Комментарий" value={staffPayComment} onChange={e => setStaffPayComment(e.target.value)} />
            <div className="rounded-2xl border border-border bg-white dark:bg-white/[0.03] p-4 text-sm text-body">Итого: <span className="font-semibold text-foreground">{money(parseMoney(staffPayCash) + parseMoney(staffPayKaspi))}</span></div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" className="rounded-xl border-border bg-white dark:bg-white/5 text-body hover:bg-surface-hover" onClick={() => setStaffPayModal(null)}>Отмена</Button>
              <Button type="submit" className="rounded-xl bg-emerald-500 text-white hover:bg-emerald-400">{staffPaySaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Провести выплату'}</Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {broadcastConfirm ? (
        <Modal title="Отправить расчёт всем?" subtitle={`Рассылка Telegram для ${broadcastTargets.length} операторов с активным chat_id`} onClose={() => setBroadcastConfirm(false)}>
          <div className="space-y-4">
            <p className="text-sm text-body">Каждый оператор получит сообщение со своим расчётом за неделю {formatRuDate(weekStart)} — {formatRuDate(weekEnd)}.</p>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" className="rounded-xl border-border bg-white dark:bg-white/5 text-body hover:bg-surface-hover" onClick={() => setBroadcastConfirm(false)}>Отмена</Button>
              <Button type="button" className="rounded-xl bg-blue-500 text-white hover:bg-blue-400" onClick={() => { setBroadcastConfirm(false); void sendAll() }}><Send className="mr-2 h-4 w-4" />Отправить</Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  )
}
