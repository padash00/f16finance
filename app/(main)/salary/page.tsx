'use client'

import { FormEvent, Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { buildStyledSheet, createWorkbook, downloadWorkbook } from '@/lib/excel/styled-export'
import Image from 'next/image'
import Link from 'next/link'
import { Building2, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, CreditCard, DollarSign, Download, Loader2, MessageCircle, Pencil, Plus, RefreshCw, Send, TrendingDown, Users, Wallet, X } from 'lucide-react'

import { AdminPageHeader, AdminTableViewport, adminTableStickyTheadClass } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { addDaysISO, formatRuDate, mondayOfDate, toISODateLocal, todayISO } from '@/lib/core/date'
import { formatMoney } from '@/lib/core/format'
import { getOperatorDisplayName } from '@/lib/core/operator-name'

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
type ShiftBreakdown = { id: string; date: string; shift: string; companyCode: string | null; companyName: string | null; totalIncome: number; baseSalary: number; autoBonus: number; roleBonus: number; salary: number }

// ─── Admin staff salary types ─────────────────────────────────────────────────
type StaffMember = { id: string; full_name: string; short_name: string | null; role: string; monthly_salary: number; extra_day_company_code: string | null; extra_day_shift_type: string | null; telegram_chat_id: string | null }
type StaffAdjustment = { id: string; staff_id: string; kind: 'debt' | 'fine' | 'bonus' | 'advance'; amount: number; date: string; comment: string | null; status: string }
type StaffPayment = { id: string; staff_id: string; pay_date: string; slot: string; amount: number; comment: string | null }
type StaffSalaryData = { staff: StaffMember[]; adjustments: StaffAdjustment[]; payments: StaffPayment[]; salaryRules: { company_code: string; shift_type: string; base_per_shift: number }[] }

function calcStaffToPay(s: StaffMember, adjs: StaffAdjustment[]) {
  const active = adjs.filter(a => a.staff_id === s.id && a.status === 'active')
  const half = Math.round(s.monthly_salary / 2)
  const bonuses = active.filter(a => a.kind === 'bonus').reduce((sum, a) => sum + a.amount, 0)
  const debts = active.filter(a => a.kind === 'debt').reduce((sum, a) => sum + a.amount, 0)
  const fines = active.filter(a => a.kind === 'fine').reduce((sum, a) => sum + a.amount, 0)
  const advances = active.filter(a => a.kind === 'advance').reduce((sum, a) => sum + a.amount, 0)
  return { half, bonuses, debts, fines, advances, toPay: half + bonuses - debts - fines - advances }
}

const roleLabel: Record<string, string> = { owner: 'Владелец', manager: 'Руководитель', marketer: 'Маркетолог', super_admin: 'Супер-админ', other: 'Сотрудник' }
type WeeklyOperator = {
  operator: { id: string; name: string; short_name: string | null; full_name: string | null; is_active: boolean; telegram_chat_id: string | null; photo_url: string | null; position: string | null; documents_count: number; expiring_documents: number }
  week: { id: string; weekStart: string; weekEnd: string; grossAmount: number; bonusAmount: number; fineAmount: number; debtAmount: number; advanceAmount: number; netAmount: number; paidAmount: number; remainingAmount: number; status: 'draft' | 'partial' | 'paid'; companyAllocations: Allocation[]; payments: Payment[]; shiftsCount: number; autoBonusTotal: number; shifts: ShiftBreakdown[] }
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
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"><div className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#10182b] p-6 shadow-2xl shadow-black/40"><div className="mb-6 flex items-start justify-between gap-4"><div><h3 className="text-xl font-semibold text-white">{props.title}</h3>{props.subtitle ? <p className="mt-1 text-sm text-slate-400">{props.subtitle}</p> : null}</div><Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-300 hover:bg-white/10" onClick={props.onClose}>Закрыть</Button></div>{props.children}</div></div>
}

export default function SalaryPage() {
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
  useEffect(() => { if (payTarget) { setPayDate(todayISO()); setPayCash(String(Math.max(payTarget.week.remainingAmount, 0))); setPayKaspi(''); setPayComment('') } }, [payTarget])
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

  async function post(body: unknown) {
    const res = await fetch('/api/admin/salary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new Error(json?.error || `Ошибка запроса (${res.status})`)
    return json
  }

  const submitAdvance = async (e: FormEvent) => { e.preventDefault(); if (!advanceTarget) return; const cash = parseMoney(advanceCash), kaspi = parseMoney(advanceKaspi); if (!advanceCompanyId) return setError('Для аванса нужно выбрать точку'); if (cash + kaspi <= 0) return setError('Сумма аванса должна быть больше 0'); setAdvanceSaving(true); setError(null); try { await post({ action: 'createAdvance', payload: { operator_id: advanceTarget.operator.id, week_start: weekStart, company_id: advanceCompanyId, payment_date: advanceDate, cash_amount: cash, kaspi_amount: kaspi, comment: advanceComment.trim() || null } }); setAdvanceTarget(null); await load(true) } catch (e: any) { console.error(e); setError(e?.message || 'Не удалось выдать аванс') } finally { setAdvanceSaving(false) } }
  const submitPayment = async (e: FormEvent) => { e.preventDefault(); if (!payTarget) return; const cash = parseMoney(payCash), kaspi = parseMoney(payKaspi), total = cash + kaspi; if (total <= 0) return setError('Сумма выплаты должна быть больше 0'); if (total - payTarget.week.remainingAmount > 0.009) return setError('Сумма выплаты превышает остаток по неделе'); setPaySaving(true); setError(null); try { await post({ action: 'createWeeklyPayment', payload: { operator_id: payTarget.operator.id, week_start: weekStart, payment_date: payDate, cash_amount: cash, kaspi_amount: kaspi, comment: payComment.trim() || null } }); setPayTarget(null); await load(true) } catch (e: any) { console.error(e); setError(e?.message || 'Не удалось провести выплату') } finally { setPaySaving(false) } }
  const submitAdjustment = async (e: FormEvent) => { e.preventDefault(); const amount = parseMoney(adjAmount); if (!adjOperatorId) return setError('Выберите оператора'); if (amount <= 0) return setError('Сумма корректировки должна быть больше 0'); setAdjSaving(true); setError(null); try { await post({ action: 'createAdjustment', payload: { operator_id: adjOperatorId, date: adjDate, amount, kind: adjKind, comment: adjComment.trim() || null, company_id: adjCompanyId || null } }); setAdjAmount(''); setAdjComment(''); setAdjSuccess(true); setTimeout(() => setAdjSuccess(false), 3000); await load(true) } catch (e: any) { console.error(e); setError(e?.message || 'Не удалось сохранить корректировку') } finally { setAdjSaving(false) } }
  const saveChatId = async (e: FormEvent) => { e.preventDefault(); if (!chatTarget) return; const trimmed = chatValue.trim(); if (trimmed && !/^-?\d+$/.test(trimmed)) return setError('telegram_chat_id должен быть числом'); setChatSaving(true); setError(null); try { await post({ action: 'updateOperatorChatId', operatorId: chatTarget.operator.id, telegram_chat_id: trimmed || null }); setChatTarget(null); await load(true) } catch (e: any) { console.error(e); setError(e?.message || 'Не удалось сохранить Telegram chat_id') } finally { setChatSaving(false) } }
  const sendOne = async (operatorId: string) => { setSendingId(operatorId); setError(null); try { const res = await fetch('/api/telegram/salary-snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operatorId, dateFrom: weekStart, dateTo: weekEnd, weekStart }) }); const json = await res.json().catch(() => null); if (!res.ok) throw new Error(json?.error || `Ошибка отправки (${res.status})`) } catch (e: any) { console.error(e); setError(e?.message || 'Не удалось отправить расчёт в Telegram') } finally { setSendingId(null) } }
  const sendAll = async () => { if (loading || broadcastSending || !broadcastTargets.length) return; setBroadcastSending(true); setBroadcastDone(0); setBroadcastTotal(broadcastTargets.length); setBroadcastErrors([]); setError(null); try { for (let i = 0; i < broadcastTargets.length; i += 1) { const item = broadcastTargets[i]; try { const res = await fetch('/api/telegram/salary-snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operatorId: item.operator.id, dateFrom: weekStart, dateTo: weekEnd, weekStart }) }); const json = await res.json().catch(() => null); if (!res.ok) setBroadcastErrors((prev) => [...prev, `${getOperatorDisplayName(item.operator)}: ${json?.error || `HTTP ${res.status}`}`]) } catch (e: any) { setBroadcastErrors((prev) => [...prev, `${getOperatorDisplayName(item.operator)}: ${e?.message || 'ошибка'}`]) } setBroadcastDone(i + 1); await new Promise((r) => setTimeout(r, 250)) } } finally { setBroadcastSending(false) } }
  const [tab, setTab] = useState<'operators' | 'staff'>('operators')
  const [markDebtId, setMarkDebtId] = useState<string | null>(null)
  const [markDebtSaving, setMarkDebtSaving] = useState(false)

  // ─── Admin staff salary state ───────────────────────────────────────────
  const [staffSalary, setStaffSalary] = useState<StaffSalaryData | null>(null)
  const [staffSalaryLoading, setStaffSalaryLoading] = useState(false)
  const [staffAdjModal, setStaffAdjModal] = useState<StaffMember | null>(null)
  const [staffPayModal, setStaffPayModal] = useState<StaffMember | null>(null)
  const [staffAdjKind, setStaffAdjKind] = useState<'debt' | 'fine' | 'bonus' | 'advance'>('fine')
  const [staffAdjAmount, setStaffAdjAmount] = useState('')
  const [staffAdjDate, setStaffAdjDate] = useState(todayISO())
  const [staffAdjComment, setStaffAdjComment] = useState('')
  const [staffAdjSaving, setStaffAdjSaving] = useState(false)
  const [staffPayDate, setStaffPayDate] = useState(todayISO())
  const [staffPaySlot, setStaffPaySlot] = useState<'first' | 'second'>('first')
  const [staffPayCash, setStaffPayCash] = useState('')
  const [staffPayKaspi, setStaffPayKaspi] = useState('')
  const [staffPayComment, setStaffPayComment] = useState('')
  const [staffPaySaving, setStaffPaySaving] = useState(false)

  const loadStaffSalary = useCallback(async () => {
    setStaffSalaryLoading(true)
    try {
      const res = await fetch('/api/admin/staff-salary', { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (res.ok) setStaffSalary(json)
    } catch {}
    finally { setStaffSalaryLoading(false) }
  }, [])
  useEffect(() => { void loadStaffSalary() }, [loadStaffSalary])

  const submitStaffAdjustment = async (e: FormEvent) => {
    e.preventDefault()
    if (!staffAdjModal) return
    const amount = parseMoney(staffAdjAmount)
    if (amount <= 0) return setError('Сумма должна быть > 0')
    setStaffAdjSaving(true); setError(null)
    try {
      const res = await fetch('/api/admin/staff-salary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addAdjustment', staff_id: staffAdjModal.id, kind: staffAdjKind, amount, date: staffAdjDate, comment: staffAdjComment.trim() || null }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Ошибка')
      setStaffAdjModal(null); setStaffAdjAmount(''); setStaffAdjComment('')
      await loadStaffSalary()
    } catch (e: any) { setError(e?.message || 'Не удалось сохранить') }
    finally { setStaffAdjSaving(false) }
  }

  const submitStaffExtraDay = async (staffId: string) => {
    try {
      const res = await fetch('/api/admin/staff-salary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'addExtraDay', staff_id: staffId, date: todayISO() }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Ошибка')
      await loadStaffSalary()
    } catch (e: any) { setError(e?.message || 'Не удалось добавить доп. выход') }
  }

  const submitStaffPayment = async (e: FormEvent) => {
    e.preventDefault()
    if (!staffPayModal) return
    const cash = parseMoney(staffPayCash), kaspi = parseMoney(staffPayKaspi)
    if (cash + kaspi <= 0) return setError('Сумма выплаты должна быть > 0')
    setStaffPaySaving(true); setError(null)
    try {
      const res = await fetch('/api/admin/staff-salary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'createPayment', staff_id: staffPayModal.id, pay_date: staffPayDate, slot: staffPaySlot, cash_amount: cash, kaspi_amount: kaspi, comment: staffPayComment.trim() || null }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Ошибка')
      setStaffPayModal(null); setStaffPayCash(''); setStaffPayKaspi(''); setStaffPayComment('')
      await loadStaffSalary()
    } catch (e: any) { setError(e?.message || 'Не удалось провести выплату') }
    finally { setStaffPaySaving(false) }
  }

  const removeStaffAdjustment = async (id: string) => {
    if (!window.confirm('Аннулировать корректировку?')) return
    try {
      await fetch('/api/admin/staff-salary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'removeAdjustment', id }) })
      await loadStaffSalary()
    } catch (e: any) { setError(e?.message || 'Ошибка') }
  }

  const deleteStaffPayment = async (id: string, amount: number) => {
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
    const wb = createWorkbook()
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
    opRows.push({ _isTotals: true, name: 'ИТОГО', shifts: opRows.length, gross: tot.gross, autoBonus: 0, bonus: 0, fine: 0, debt: 0, advance: 0, net: tot.net, paid: tot.paid, remaining: tot.remaining, status: '' } as any)
    buildStyledSheet(wb, 'Зарплаты', 'Ведомость зарплат', `Неделя: ${weekStart} | Операторов: ${(data?.operators || []).length}`, [
      { header: 'Оператор', key: 'name', width: 26, type: 'text' },
      { header: 'Смен', key: 'shifts', width: 8, type: 'number', align: 'right' },
      { header: 'Начислено', key: 'gross', width: 15, type: 'money' },
      { header: 'Авто-бонус', key: 'autoBonus', width: 14, type: 'money' },
      { header: 'Бонус', key: 'bonus', width: 13, type: 'money' },
      { header: 'Штраф', key: 'fine', width: 13, type: 'money' },
      { header: 'Долг', key: 'debt', width: 13, type: 'money' },
      { header: 'Аванс', key: 'advance', width: 13, type: 'money' },
      { header: 'К выплате', key: 'net', width: 14, type: 'money' },
      { header: 'Выплачено', key: 'paid', width: 14, type: 'money' },
      { header: 'Остаток', key: 'remaining', width: 14, type: 'money' },
      { header: 'Статус', key: 'status', width: 12, type: 'text' },
    ], opRows)
    await downloadWorkbook(wb, `salary_${weekStart}.xlsx`)
  }

  return (
    <>
        <div className="mx-auto max-w-[1600px] space-y-4 px-4 pb-6 pt-4 md:px-6 md:py-6 xl:px-8">

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
                    Excel
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
                    aria-selected={tab === 'staff'}
                    onClick={() => setTab('staff')}
                    className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${tab === 'staff' ? 'bg-white/10 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    Административные сотрудники
                  </button>
                </div>
                {tab === 'operators' ? (
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
              <table className="min-w-full text-sm">
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
                  {loading ? <tr><td colSpan={13} className="px-4 py-16 text-center text-slate-400"><div className="inline-flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" />Загрузка данных...</div></td></tr> : null}
                  {!loading && operators.length === 0 ? <tr><td colSpan={13} className="px-4 py-16 text-center text-slate-400">В этой неделе пока нет строк для отображения.</td></tr> : null}
                  {!loading ? operators.map((item) => {
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
                          <td className="px-4 py-4"><div className="flex flex-wrap items-center justify-center gap-2"><Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setAdvanceTarget(item)}><Plus className="mr-2 h-4 w-4" />Аванс</Button><Button type="button" className="rounded-xl bg-emerald-500 text-white hover:bg-emerald-400 disabled:opacity-50" disabled={!canPay} onClick={() => setPayTarget(item)}><Wallet className="mr-2 h-4 w-4" />Выплатить</Button><Link href={`/salary/${item.operator.id}?weekStart=${weekStart}`} className="inline-flex h-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-slate-200 transition hover:bg-white/10">Детали</Link></div></td>
                          <td className="px-4 py-4"><div className="flex flex-col items-center gap-2"><div className="flex items-center gap-2"><Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setChatTarget(item)}><Pencil className="h-4 w-4" /></Button><Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 disabled:opacity-50" disabled={!hasChat || sendingId === item.operator.id || broadcastSending} onClick={() => void sendOne(item.operator.id)}>{sendingId === item.operator.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}</Button></div>{item.operator.telegram_chat_id ? <div className="max-w-[140px] truncate text-center text-[11px] text-emerald-300/70">{item.operator.telegram_chat_id}</div> : <div className="text-[11px] text-slate-500">нет chat_id</div>}</div></td>
                        </tr>
                        {open ? <tr className="border-t border-white/5 bg-slate-950/30"><td colSpan={13} className="px-4 py-5"><div className="grid gap-4 xl:grid-cols-[1fr_1fr_1fr]">
                          <Card className="border-white/10 bg-white/[0.03] p-4"><div className="mb-4 flex items-center gap-2 text-sm font-medium text-white"><Building2 className="h-4 w-4 text-emerald-300" />Разбивка по компаниям</div><div className="overflow-x-auto"><table className="min-w-full text-xs"><thead className="text-slate-500"><tr><th className="pb-3 text-left font-medium">Компания</th><th className="pb-3 text-right font-medium">Начислено</th><th className="pb-3 text-right font-medium">Бонусы</th><th className="pb-3 text-right font-medium">Штрафы</th><th className="pb-3 text-right font-medium">Долги</th><th className="pb-3 text-right font-medium">Аванс</th><th className="pb-3 text-right font-medium">К выплате</th></tr></thead><tbody>{item.week.companyAllocations.map((a) => <tr key={a.companyId} className="border-t border-white/5 text-slate-200"><td className="py-3 pr-3"><div className="font-medium text-white">{a.companyName || a.companyCode || a.companyId}</div><div className="text-[11px] text-slate-500">Доля: {(a.shareRatio * 100).toFixed(1)}%</div></td><td className="py-3 text-right">{money(a.accruedAmount)}</td><td className="py-3 text-right text-emerald-300">{money(a.bonusAmount)}</td><td className="py-3 text-right text-rose-300">{money(a.fineAmount)}</td><td className="py-3 text-right text-rose-300">{money(a.debtAmount)}</td><td className="py-3 text-right text-amber-300">{money(a.advanceAmount)}</td><td className="py-3 text-right font-medium text-white">{money(a.netAmount)}</td></tr>)}</tbody></table></div></Card>
                          <Card className="border-white/10 bg-white/[0.03] p-4"><div className="mb-4 flex items-center justify-between gap-2 text-sm font-medium text-white"><span>Смены ({item.week.shiftsCount})</span>{item.week.autoBonusTotal > 0 ? <span className="text-xs text-violet-300">Авто-бонус: {money(item.week.autoBonusTotal)}</span> : null}</div>{item.week.shifts.length === 0 ? <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-sm text-slate-400">Смен за эту неделю нет.</div> : <div className="overflow-x-auto"><table className="min-w-full text-xs"><thead className="text-slate-500"><tr><th className="pb-3 text-left font-medium">Дата</th><th className="pb-3 text-left font-medium">Смена</th><th className="pb-3 text-left font-medium">Точка</th><th className="pb-3 text-right font-medium">Выручка</th><th className="pb-3 text-right font-medium">База</th><th className="pb-3 text-right font-medium">Авто</th><th className="pb-3 text-right font-medium">Роль</th><th className="pb-3 text-right font-medium">Итого</th></tr></thead><tbody>{item.week.shifts.map((s) => <tr key={s.id} className="border-t border-white/5 text-slate-200"><td className="py-2 pr-3 text-slate-300">{formatRuDate(s.date)}</td><td className="py-2 pr-3"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${s.shift === 'day' ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-blue-500/30 bg-blue-500/10 text-blue-300'}`}>{s.shift === 'day' ? 'день' : 'ночь'}</span></td><td className="py-2 pr-3 text-slate-400">{s.companyName || s.companyCode || '—'}</td><td className="py-2 text-right">{money(s.totalIncome)}</td><td className="py-2 text-right">{money(s.baseSalary)}</td><td className="py-2 text-right text-violet-300">{s.autoBonus > 0 ? money(s.autoBonus) : <span className="text-slate-600">—</span>}</td><td className="py-2 text-right text-cyan-300">{s.roleBonus > 0 ? money(s.roleBonus) : <span className="text-slate-600">—</span>}</td><td className="py-2 text-right font-medium text-white">{money(s.salary)}</td></tr>)}</tbody></table></div>}</Card>
                          <Card className="border-white/10 bg-white/[0.03] p-4"><div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">Платежи недели</div>{item.week.payments.length === 0 ? <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-sm text-slate-400">По этой неделе ещё нет платежей.</div> : <div className="space-y-3">{item.week.payments.map((p) => <div key={p.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"><div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium text-white">{formatRuDate(p.payment_date)}</div><div className="mt-1 text-xs text-slate-400">Нал: {money(p.cash_amount)} • Kaspi: {money(p.kaspi_amount)}</div></div><div className="text-right"><div className="text-sm font-semibold text-emerald-300">{money(p.total_amount)}</div><div className="text-[11px] text-slate-500">{p.status === 'voided' ? 'аннулировано' : 'активно'}</div></div></div>{p.comment ? <div className="mt-2 text-xs text-slate-400">{p.comment}</div> : null}<div className="mt-3 flex justify-end">{p.status === 'voided' ? <span className="rounded-full border border-slate-500/30 bg-slate-500/10 px-3 py-1 text-[11px] text-slate-400">Уже аннулировано</span> : <Button type="button" variant="outline" className="rounded-xl border-red-500/20 bg-red-500/10 text-red-200 hover:bg-red-500/20 disabled:opacity-50" disabled={voidingPaymentId === p.id} onClick={() => void voidPayment(item, p)}>{voidingPaymentId === p.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Аннулировать</Button>}</div></div>)}</div>}</Card>
                          </div></td></tr> : null}
                      </Fragment>
                    )
                  }) : null}
                </tbody>
              </table>
          </AdminTableViewport>

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

          </>)}

          {/* ── STAFF TAB ───────────────────────────────────────────────────── */}
          {tab === 'staff' && (
          <Card className="overflow-hidden border-white/10 bg-white/[0.04]">
            <div className="flex items-center justify-between gap-4 border-b border-white/10 p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-violet-500/15 p-3 text-violet-300"><Users className="h-5 w-5" /></div>
                <div>
                  <h2 className="text-lg font-semibold text-white">Зарплатная ведомость Административных сотрудников</h2>
                  <p className="text-sm text-slate-400">Фиксированный оклад, выплата 1-го и 15-го. Бонусы, штрафы, долги, авансы, доп. выходы.</p>
                </div>
              </div>
              <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => void loadStaffSalary()}><RefreshCw className="h-4 w-4" /></Button>
            </div>
            {staffSalaryLoading ? (
              <div className="flex items-center justify-center p-12 text-slate-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Загрузка...</div>
            ) : !staffSalary || staffSalary.staff.length === 0 ? (
              <div className="p-10 text-center text-sm text-slate-500">Нет административных сотрудников. Добавьте записи в таблицу <code className="rounded bg-white/10 px-1">staff</code>.</div>
            ) : (
              <div className="divide-y divide-white/5">
                {staffSalary.staff.map((s) => {
                  const calc = calcStaffToPay(s, staffSalary.adjustments)
                  const activeAdjs = staffSalary.adjustments.filter(a => a.staff_id === s.id && a.status === 'active')
                  const recentPayments = staffSalary.payments.filter(p => p.staff_id === s.id).slice(0, 3)
                  return (
                    <div key={s.id} className="p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 text-sm font-semibold text-white">
                            {(s.short_name || s.full_name).charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-semibold text-white">{s.full_name}</div>
                            <div className="text-xs text-slate-400">{roleLabel[s.role] || s.role} · Оклад: {money(s.monthly_salary)}/мес</div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button type="button" variant="outline" className="h-9 rounded-xl border-white/10 bg-white/5 text-xs text-slate-200 hover:bg-white/10" onClick={() => { setStaffAdjModal(s); setStaffAdjKind('fine'); setStaffAdjAmount(''); setStaffAdjDate(todayISO()); setStaffAdjComment('') }}><Plus className="mr-1.5 h-3.5 w-3.5" />Корректировка</Button>
                          <Button type="button" variant="outline" className="h-9 rounded-xl border-white/10 bg-white/5 text-xs text-slate-200 hover:bg-white/10" onClick={() => void submitStaffExtraDay(s.id)}><CalendarDays className="mr-1.5 h-3.5 w-3.5" />Доп. выход</Button>
                          <Button type="button" className="h-9 rounded-xl bg-emerald-500 text-xs text-white hover:bg-emerald-400" onClick={() => { setStaffPayModal(s); setStaffPayDate(todayISO()); setStaffPayCash(calc.toPay > 0 ? String(calc.toPay) : ''); setStaffPayKaspi(''); setStaffPayComment('') }}><Wallet className="mr-1.5 h-3.5 w-3.5" />Выплатить</Button>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-center"><div className="text-[11px] uppercase tracking-wide text-slate-500">Пол-оклада</div><div className="mt-1 text-sm font-semibold text-white">{money(calc.half)}</div></div>
                        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] p-3 text-center"><div className="text-[11px] uppercase tracking-wide text-emerald-400/70">Бонусы</div><div className="mt-1 text-sm font-semibold text-emerald-300">+{money(calc.bonuses)}</div></div>
                        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] p-3 text-center"><div className="text-[11px] uppercase tracking-wide text-rose-400/70">Штрафы / долги</div><div className="mt-1 text-sm font-semibold text-rose-300">−{money(calc.fines + calc.debts)}</div></div>
                        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] p-3 text-center"><div className="text-[11px] uppercase tracking-wide text-amber-400/70">Авансы</div><div className="mt-1 text-sm font-semibold text-amber-300">−{money(calc.advances)}</div></div>
                        <div className="rounded-2xl border border-white/15 bg-white/[0.06] p-3 text-center"><div className="text-[11px] uppercase tracking-wide text-slate-400">К выплате</div><div className="mt-1 text-base font-bold text-white">{money(calc.toPay)}</div></div>
                      </div>
                      {activeAdjs.length > 0 ? (
                        <div className="mt-3 space-y-1.5">
                          <div className="mb-1 text-xs text-slate-500">Активные корректировки:</div>
                          {activeAdjs.map(adj => (
                            <div key={adj.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${adj.kind === 'bonus' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : adj.kind === 'advance' ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-rose-500/30 bg-rose-500/10 text-rose-300'}`}>
                                  {adj.kind === 'bonus' ? 'бонус' : adj.kind === 'advance' ? 'аванс' : adj.kind === 'fine' ? 'штраф' : 'долг'}
                                </span>
                                <span className="font-medium text-white">{money(adj.amount)}</span>
                                <span className="text-slate-500">{adj.date}</span>
                                {adj.comment ? <span className="text-slate-400">{adj.comment}</span> : null}
                              </div>
                              <button type="button" className="ml-3 shrink-0 text-slate-500 transition hover:text-rose-300" onClick={() => void removeStaffAdjustment(adj.id)}><X className="h-3.5 w-3.5" /></button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {recentPayments.length > 0 ? (
                        <div className="mt-3">
                          <div className="mb-1 text-xs text-slate-500">Последние выплаты:</div>
                          <div className="flex flex-wrap gap-2">
                            {recentPayments.map(p => (
                              <div key={p.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-300">
                                <span>{p.pay_date} · {money(p.amount)} · {p.slot === 'first' ? '1–15' : p.slot === 'second' ? '16–конец' : 'разово'}</span>
                                <button type="button" title="Аннулировать" onClick={() => void deleteStaffPayment(p.id, p.amount)} className="ml-1 text-slate-600 hover:text-rose-400 transition"><X className="h-3.5 w-3.5" /></button>
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
                <label className="mb-2 block text-sm text-slate-300">Kaspi</label>
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
                <label className="mb-2 block text-sm text-slate-300">Kaspi</label>
                <input className={input} type="text" value={payKaspi} onChange={(e) => setPayKaspi(e.target.value)} placeholder="0" />
              </div>
            </div>
            <textarea className={textarea} value={payComment} onChange={(e) => setPayComment(e.target.value)} placeholder="Комментарий" />
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">Выплата сейчас: <span className="font-semibold text-white">{money(parseMoney(payCash) + parseMoney(payKaspi))}</span></div>
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
        <Modal title="Выплата зарплаты" subtitle={`${staffPayModal.full_name} · к выплате ${money(calcStaffToPay(staffPayModal, staffSalary?.adjustments || []).toPay)}`} onClose={() => setStaffPayModal(null)}>
          <form className="space-y-4" onSubmit={submitStaffPayment}>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-slate-300">Слот</label>
                <select className={selectCls} value={staffPaySlot} onChange={e => setStaffPaySlot(e.target.value as 'first' | 'second')}>
                  <option value="first">1–15 числа</option>
                  <option value="second">16 — конец месяца</option>
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-300">Дата выплаты</label>
                <input className={input} type="date" value={staffPayDate} onChange={e => setStaffPayDate(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-300">Наличные</label>
                <input className={input} type="text" placeholder="0" value={staffPayCash} onChange={e => setStaffPayCash(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-300">Kaspi</label>
                <input className={input} type="text" placeholder="0" value={staffPayKaspi} onChange={e => setStaffPayKaspi(e.target.value)} />
              </div>
            </div>
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
