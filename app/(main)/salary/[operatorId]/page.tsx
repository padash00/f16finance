'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { useParams, useSearchParams } from 'next/navigation'
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  CreditCard,
  DollarSign,
  Loader2,
  MessageCircle,
  Moon,
  Plus,
  RefreshCw,
  Send,
  Sun,
  TrendingDown,
  Trash2,
  UserCircle2,
  Wallet,
} from 'lucide-react'

import { AdminPageHeader, AdminTableViewport, adminTableStickyTheadClass } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { addDaysISO, formatRuDate, mondayOfDate, toISODateLocal, todayISO } from '@/lib/core/date'
import { formatMoney } from '@/lib/core/format'
import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { calculateOperatorShiftBreakdown } from '@/lib/domain/salary'

type Shift = 'day' | 'night'
type IncomeRow = { id: string; date: string; company_id: string; operator_id: string | null; shift: Shift; zone: string | null; cash_amount: number | null; kaspi_amount: number | null; card_amount: number | null; comment: string | null }
type CompanyOption = { id: string; name: string | null; code: string | null }
type Allocation = { companyId: string; companyCode: string | null; companyName: string | null; accruedAmount: number; bonusAmount: number; fineAmount: number; debtAmount: number; advanceAmount: number; netAmount: number; shareRatio: number }
type Payment = { id: string; payment_date: string; cash_amount: number; kaspi_amount: number; total_amount: number; comment: string | null; status: string }
type Operator = { id: string; name: string; short_name: string | null; full_name: string | null; is_active: boolean; photo_url: string | null; position: string | null; telegram_chat_id?: string | null }
type WeekData = { id: string; weekStart: string; weekEnd: string; grossAmount: number; bonusAmount: number; fineAmount: number; debtAmount: number; advanceAmount: number; netAmount: number; paidAmount: number; remainingAmount: number; status: 'draft' | 'partial' | 'paid'; companyAllocations: Allocation[]; payments: Payment[] }
type RecentWeek = { id: string; weekStart: string; weekEnd: string; netAmount: number; paidAmount: number; remainingAmount: number; status: 'draft' | 'partial' | 'paid' }
type PageData = { operator: Operator; companies: CompanyOption[]; week: WeekData; incomes: IncomeRow[]; recentWeeks: RecentWeek[]; adjustments: AdjustmentRow[] }
type AdjKind = 'bonus' | 'fine' | 'debt'
type AdjustmentRow = { id: string; date: string; amount: number; kind: string; comment: string | null; company_id: string | null; status: string; salary_week_id: string | null; linked_expense_id: string | null }
type VoidTarget = { type: 'payment' | 'adjustment'; id: string; label: string }

const input = 'h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none'
const selectCls = 'h-11 w-full rounded-xl border border-white/10 bg-slate-900 px-3 text-sm text-white focus:border-emerald-400/40 focus:outline-none [color-scheme:dark]'
const textarea = 'min-h-[80px] w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none'
const money = formatMoney
const parseMoney = (v: string) => { const n = Number(v.replace(',', '.').replace(/\s/g, '')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0 }
const statusMeta = (s: WeekData['status']) => s === 'paid' ? { label: 'Выплачено', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' } : s === 'partial' ? { label: 'Частично', className: 'border-amber-500/30 bg-amber-500/10 text-amber-300' } : { label: 'Не выплачено', className: 'border-slate-500/30 bg-slate-500/10 text-slate-300' }

function Modal(props: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"><div className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#10182b] p-6 shadow-2xl shadow-black/40"><div className="mb-6 flex items-start justify-between gap-4"><div><h3 className="text-xl font-semibold text-white">{props.title}</h3>{props.subtitle ? <p className="mt-1 text-sm text-slate-400">{props.subtitle}</p> : null}</div><Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-300 hover:bg-white/10" onClick={props.onClose}>Закрыть</Button></div>{props.children}</div></div>
}

export default function OperatorSalaryDetailPage() {
  const params = useParams<{ operatorId?: string | string[] }>()
  const searchParams = useSearchParams()

  const operatorId = useMemo(() => {
    const raw = params?.operatorId
    const value = Array.isArray(raw) ? raw[0] || '' : raw || ''
    return value === 'undefined' || value === 'null' ? '' : value
  }, [params])

  const currentWeek = toISODateLocal(mondayOfDate(new Date()))
  const initialWeek = useMemo(() => {
    const fromParam = searchParams?.get('dateFrom') || searchParams?.get('weekStart') || ''
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(fromParam.trim()) ? fromParam.trim() : ''
    return normalized || currentWeek
  }, [searchParams, currentWeek])

  const [weekStart, setWeekStart] = useState(initialWeek)
  const [data, setData] = useState<PageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [advanceOpen, setAdvanceOpen] = useState(false)
  const [advanceCompanyId, setAdvanceCompanyId] = useState('')
  const [advanceDate, setAdvanceDate] = useState(todayISO())
  const [advanceCash, setAdvanceCash] = useState('')
  const [advanceKaspi, setAdvanceKaspi] = useState('')
  const [advanceComment, setAdvanceComment] = useState('')
  const [advanceSaving, setAdvanceSaving] = useState(false)

  const [payOpen, setPayOpen] = useState(false)
  const [payDate, setPayDate] = useState(todayISO())
  const [payCash, setPayCash] = useState('')
  const [payKaspi, setPayKaspi] = useState('')
  const [payComment, setPayComment] = useState('')
  const [paySaving, setPaySaving] = useState(false)

  const [tgSending, setTgSending] = useState(false)

  const [adjKind, setAdjKind] = useState<AdjKind>('fine')
  const [adjCompanyId, setAdjCompanyId] = useState('')
  const [adjDate, setAdjDate] = useState(todayISO())
  const [adjAmount, setAdjAmount] = useState('')
  const [adjComment, setAdjComment] = useState('')
  const [adjSaving, setAdjSaving] = useState(false)
  const [adjSuccess, setAdjSuccess] = useState(false)

  const [voidConfirm, setVoidConfirm] = useState<VoidTarget | null>(null)
  const [voidSaving, setVoidSaving] = useState(false)

  const weekEnd = useMemo(() => addDaysISO(weekStart, 6), [weekStart])

  const load = useCallback(async (silent = false) => {
    if (!operatorId) return
    if (!silent) setLoading(true)
    if (!silent) setError(null)
    try {
      const res = await fetch(`/api/admin/salary?view=operatorWeekly&operatorId=${encodeURIComponent(operatorId)}&weekStart=${encodeURIComponent(weekStart)}`, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || `Ошибка загрузки (${res.status})`)
      setData(json.data as PageData)
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить данные')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [operatorId, weekStart])

  useEffect(() => { void load() }, [load])
  useEffect(() => { if (!error) return; const t = setTimeout(() => setError(null), 6000); return () => clearTimeout(t) }, [error])
  useEffect(() => { if (advanceOpen) { setAdvanceCompanyId(data?.week.companyAllocations[0]?.companyId || data?.companies[0]?.id || ''); setAdvanceDate(todayISO()); setAdvanceCash(''); setAdvanceKaspi(''); setAdvanceComment('') } }, [advanceOpen, data])
  useEffect(() => { if (payOpen && data) { setPayDate(todayISO()); setPayCash(String(Math.max(data.week.remainingAmount, 0))); setPayKaspi(''); setPayComment('') } }, [payOpen, data])

  async function post(body: unknown) {
    const res = await fetch('/api/admin/salary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new Error(json?.error || `Ошибка запроса (${res.status})`)
    return json
  }

  const submitAdvance = async (e: FormEvent) => {
    e.preventDefault()
    const cash = parseMoney(advanceCash), kaspi = parseMoney(advanceKaspi)
    if (!advanceCompanyId) return setError('Выберите точку для аванса')
    if (cash + kaspi <= 0) return setError('Сумма аванса должна быть больше 0')
    setAdvanceSaving(true); setError(null)
    try {
      await post({ action: 'createAdvance', payload: { operator_id: operatorId, week_start: weekStart, company_id: advanceCompanyId, payment_date: advanceDate, cash_amount: cash, kaspi_amount: kaspi, comment: advanceComment.trim() || null } })
      setAdvanceOpen(false); await load(true)
    } catch (e: any) { setError(e?.message || 'Не удалось выдать аванс') } finally { setAdvanceSaving(false) }
  }

  const submitPayment = async (e: FormEvent) => {
    e.preventDefault()
    if (!data) return
    const cash = parseMoney(payCash), kaspi = parseMoney(payKaspi), total = cash + kaspi
    if (total <= 0) return setError('Сумма выплаты должна быть больше 0')
    if (total - data.week.remainingAmount > 0.009) return setError('Сумма выплаты превышает остаток по неделе')
    setPaySaving(true); setError(null)
    try {
      await post({ action: 'createWeeklyPayment', payload: { operator_id: operatorId, week_start: weekStart, payment_date: payDate, cash_amount: cash, kaspi_amount: kaspi, comment: payComment.trim() || null } })
      setPayOpen(false); await load(true)
    } catch (e: any) { setError(e?.message || 'Не удалось провести выплату') } finally { setPaySaving(false) }
  }

  const sendTelegram = async () => {
    if (!data?.operator.telegram_chat_id) return setError('У оператора не задан Telegram chat_id')
    setTgSending(true); setError(null)
    try {
      const res = await fetch('/api/telegram/salary-snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operatorId, dateFrom: weekStart, dateTo: weekEnd, weekStart }) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || `Ошибка отправки (${res.status})`)
    } catch (e: any) { setError(e?.message || 'Не удалось отправить расчёт') } finally { setTgSending(false) }
  }

  const submitAdjustment = async (e: FormEvent) => {
    e.preventDefault()
    const amount = parseMoney(adjAmount)
    if (amount <= 0) return setError('Сумма корректировки должна быть больше 0')
    setAdjSaving(true); setError(null)
    try {
      await post({ action: 'createAdjustment', payload: { operator_id: operatorId, date: adjDate, amount, kind: adjKind, comment: adjComment.trim() || null, company_id: adjCompanyId || null } })
      setAdjAmount(''); setAdjComment(''); setAdjSuccess(true); setTimeout(() => setAdjSuccess(false), 3000); await load(true)
    } catch (e: any) { setError(e?.message || 'Не удалось сохранить корректировку') } finally { setAdjSaving(false) }
  }

  const voidItem = async () => {
    if (!voidConfirm) return
    setVoidSaving(true); setError(null)
    try {
      if (voidConfirm.type === 'payment') {
        await post({ action: 'voidPayment', paymentId: voidConfirm.id, weekStart, operatorId })
      } else {
        await post({ action: 'voidAdjustment', adjustmentId: voidConfirm.id, weekStart, operatorId })
      }
      setVoidConfirm(null); await load(true)
    } catch (e: any) { setError(e?.message || 'Не удалось аннулировать') } finally { setVoidSaving(false) }
  }

  const shifts = useMemo(() => {
    if (!data || !operatorId) return []
    return calculateOperatorShiftBreakdown({
      operatorId,
      companies: data.companies,
      rules: [],
      assignments: [],
      incomes: data.incomes,
    })
  }, [data, operatorId])

  if (!operatorId) {
    return (
      <>
      </>
    )
  }

  const st = data ? statusMeta(data.week.status) : null
  const canPay = data ? data.week.remainingAmount > 0.009 : false
  const title = data ? getOperatorDisplayName(data.operator) : '...'

  return (
    <>
        <div className="mx-auto max-w-[1400px] space-y-4 px-4 pb-6 pt-4 md:px-6 md:py-6 xl:px-8">

          <AdminPageHeader
            backHref="/salary"
            title={title}
            description={data?.operator.position || undefined}
            accent="emerald"
            icon={
              data?.operator.photo_url ? (
                <span className="relative -m-1 block h-9 w-9 overflow-hidden rounded-lg">
                  <Image src={data.operator.photo_url} alt={title} width={36} height={36} className="h-full w-full object-cover" />
                </span>
              ) : (
                <UserCircle2 className="h-6 w-6" aria-hidden />
              )
            }
            actions={
              <>
                <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setWeekStart(addDaysISO(weekStart, -7))}>
                  Прошлая неделя
                </Button>
                <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setWeekStart(currentWeek)}>
                  Текущая
                </Button>
                <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setWeekStart(addDaysISO(weekStart, 7))}>
                  Следующая
                </Button>
                <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => void load()}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Обновить
                </Button>
              </>
            }
            toolbar={
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                  Неделя: <span className="font-semibold text-white">{formatRuDate(weekStart)} — {formatRuDate(weekEnd)}</span>
                </div>
                {st ? <span className={`rounded-full border px-3 py-1.5 text-xs font-medium ${st.className}`}>{st.label}</span> : null}
                {data && !data.operator.is_active ? (
                  <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[10px] font-medium text-red-400">неактивен</span>
                ) : null}
              </div>
            }
          />

          {error ? <Card className="border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</Card> : null}

          {/* Weekly summary */}
          {loading ? (
            <Card className="flex items-center justify-center gap-2 border-white/10 bg-white/[0.04] p-16 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />Загрузка данных...
            </Card>
          ) : data ? (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Card className="border-white/10 bg-white/[0.04] p-5"><div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-500/15 p-2.5 text-emerald-300"><DollarSign className="h-5 w-5" /></div><div><div className="text-xs uppercase tracking-wide text-slate-500">Начислено</div><div className="mt-1 text-2xl font-semibold text-white">{money(data.week.grossAmount)}</div><div className="mt-0.5 text-xs text-slate-500">бонусы: <span className="text-emerald-300">+{money(data.week.bonusAmount)}</span></div></div></div></Card>
                <Card className="border-white/10 bg-white/[0.04] p-5"><div className="flex items-center gap-3"><div className="rounded-xl bg-rose-500/15 p-2.5 text-rose-300"><TrendingDown className="h-5 w-5" /></div><div><div className="text-xs uppercase tracking-wide text-slate-500">Удержания</div><div className="mt-1 text-2xl font-semibold text-white">{money(data.week.fineAmount + data.week.debtAmount + data.week.advanceAmount)}</div><div className="mt-0.5 text-xs text-slate-500">штрафы {money(data.week.fineAmount)} · долги {money(data.week.debtAmount)} · авансы {money(data.week.advanceAmount)}</div></div></div></Card>
                <Card className="border-white/10 bg-white/[0.04] p-5"><div className="flex items-center gap-3"><div className="rounded-xl bg-blue-500/15 p-2.5 text-blue-300"><CheckCircle2 className="h-5 w-5" /></div><div><div className="text-xs uppercase tracking-wide text-slate-500">Выплачено</div><div className="mt-1 text-2xl font-semibold text-white">{money(data.week.paidAmount)}</div></div></div></Card>
                <Card className="border-white/10 bg-white/[0.04] p-5"><div className="flex items-center gap-3"><div className="rounded-xl bg-amber-500/15 p-2.5 text-amber-300"><CreditCard className="h-5 w-5" /></div><div><div className="text-xs uppercase tracking-wide text-slate-500">Остаток</div><div className="mt-1 text-2xl font-semibold text-white">{money(data.week.remainingAmount)}</div></div></div></Card>
              </div>

              {/* History of weeks */}
              {data.recentWeeks.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {data.recentWeeks.map((w) => {
                    const wst = statusMeta(w.status)
                    const isCurrent = w.weekStart === weekStart
                    return (
                      <button key={w.id} type="button" onClick={() => setWeekStart(w.weekStart)} className={`shrink-0 rounded-2xl border p-3 text-left text-xs transition ${isCurrent ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}>
                        <div className="font-medium text-white">{formatRuDate(w.weekStart)}</div>
                        <div className="mt-1 text-slate-400">{formatRuDate(w.weekEnd)}</div>
                        <div className={`mt-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${wst.className}`}>{wst.label}</div>
                        <div className="mt-1 text-slate-300">Остаток: {money(w.remainingAmount)}</div>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-3">
                <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setAdvanceOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />Выдать аванс
                </Button>
                <Button type="button" className="rounded-xl bg-emerald-500 text-white hover:bg-emerald-400 disabled:opacity-50" disabled={!canPay} onClick={() => setPayOpen(true)}>
                  <Wallet className="mr-2 h-4 w-4" />Выплатить
                </Button>
                <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 disabled:opacity-40" disabled={!data.operator.telegram_chat_id || tgSending} onClick={() => void sendTelegram()}>
                  {tgSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MessageCircle className="mr-2 h-4 w-4" />}
                  {data.operator.telegram_chat_id ? 'Отправить в Telegram' : 'Нет Telegram'}
                </Button>
              </div>

              {/* Company allocations */}
              {data.week.companyAllocations.length > 0 && (
                <Card className="border-white/10 bg-white/[0.04] p-5">
                  <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">
                    <Building2 className="h-4 w-4 text-emerald-300" />Разбивка по точкам
                  </div>
                  <AdminTableViewport maxHeight="min(45vh, 22rem)" className="rounded-xl border border-white/10 bg-transparent">
                    <table className="min-w-full text-xs">
                      <thead className={adminTableStickyTheadClass}>
                        <tr>
                          <th className="pb-3 text-left font-medium">Точка</th>
                          <th className="pb-3 text-right font-medium">Начислено</th>
                          <th className="pb-3 text-right font-medium">Бонусы</th>
                          <th className="pb-3 text-right font-medium">Штрафы</th>
                          <th className="pb-3 text-right font-medium">Долги</th>
                          <th className="pb-3 text-right font-medium">Авансы</th>
                          <th className="pb-3 text-right font-medium">К выплате</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.week.companyAllocations.map((a) => (
                          <tr key={a.companyId} className="border-t border-white/5 text-slate-200">
                            <td className="py-3 pr-3">
                              <div className="font-medium text-white">{a.companyName || a.companyCode || a.companyId}</div>
                              <div className="text-[11px] text-slate-500">Доля: {(a.shareRatio * 100).toFixed(1)}%</div>
                            </td>
                            <td className="py-3 text-right">{money(a.accruedAmount)}</td>
                            <td className="py-3 text-right text-emerald-300">{money(a.bonusAmount)}</td>
                            <td className="py-3 text-right text-rose-300">{money(a.fineAmount)}</td>
                            <td className="py-3 text-right text-rose-300">{money(a.debtAmount)}</td>
                            <td className="py-3 text-right text-amber-300">{money(a.advanceAmount)}</td>
                            <td className="py-3 text-right font-medium text-white">{money(a.netAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </AdminTableViewport>
                </Card>
              )}

              {/* Payments */}
              <Card className="border-white/10 bg-white/[0.04] p-5">
                <div className="mb-4 text-sm font-medium text-white">Платежи недели</div>
                {data.week.payments.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-sm text-slate-400">По этой неделе ещё нет платежей.</div>
                ) : (
                  <div className="space-y-3">
                    {data.week.payments.map((p) => (
                      <div key={p.id} className={`rounded-2xl border p-4 ${p.status === 'voided' ? 'border-red-500/20 bg-red-500/5 opacity-60' : 'border-white/10 bg-white/[0.03]'}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <div className={`text-sm font-medium ${p.status === 'voided' ? 'line-through text-slate-500' : 'text-white'}`}>{formatRuDate(p.payment_date)}</div>
                              {p.status === 'voided' && <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-400">аннулирован</span>}
                            </div>
                            <div className="mt-1 text-xs text-slate-400">Нал: {money(p.cash_amount)} · Kaspi: {money(p.kaspi_amount)}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="text-right">
                              <div className={`text-sm font-semibold ${p.status === 'voided' ? 'line-through text-slate-500' : 'text-emerald-300'}`}>{money(p.total_amount)}</div>
                            </div>
                            {p.status === 'active' && (
                              <button type="button" onClick={() => setVoidConfirm({ type: 'payment', id: p.id, label: `Выплата ${money(p.total_amount)} от ${formatRuDate(p.payment_date)}` })} className="rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-red-400 hover:bg-red-500/20">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </div>
                        {p.comment ? <div className="mt-2 text-xs text-slate-400">{p.comment}</div> : null}
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Adjustments list */}
              {data.adjustments.length > 0 && (
                <Card className="border-white/10 bg-white/[0.04] p-5">
                  <div className="mb-4 text-sm font-medium text-white">Корректировки за неделю</div>
                  <div className="space-y-2">
                    {data.adjustments.map((a) => {
                      const kindLabel = a.kind === 'bonus' ? 'Бонус' : a.kind === 'fine' ? 'Штраф' : a.kind === 'debt' ? 'Долг' : 'Аванс'
                      const kindCls = a.kind === 'bonus' ? 'text-emerald-300' : 'text-rose-300'
                      const company = a.company_id ? data.companies.find((c) => c.id === a.company_id) : null
                      const isVoided = a.status === 'voided'
                      return (
                        <div key={a.id} className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 ${isVoided ? 'border-red-500/20 bg-red-500/5 opacity-60' : 'border-white/10 bg-white/[0.03]'}`}>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-xs font-semibold ${isVoided ? 'text-slate-500' : kindCls}`}>{kindLabel}</span>
                              <span className={`text-sm font-medium ${isVoided ? 'line-through text-slate-500' : 'text-white'}`}>{money(a.amount)}</span>
                              {isVoided && <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-400">аннулировано</span>}
                              <span className="text-xs text-slate-500">{formatRuDate(a.date)}</span>
                              {company && <span className="text-xs text-slate-500">{company.name || company.code}</span>}
                            </div>
                            {a.comment ? <div className="mt-1 truncate text-xs text-slate-500">{a.comment}</div> : null}
                          </div>
                          {!isVoided && (
                            <button type="button" onClick={() => setVoidConfirm({ type: 'adjustment', id: a.id, label: `${kindLabel} ${money(a.amount)} от ${formatRuDate(a.date)}` })} className="shrink-0 rounded-xl border border-red-500/30 bg-red-500/10 p-2 text-red-400 hover:bg-red-500/20">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </Card>
              )}

              {/* Adjustment form */}
              <Card className="border-white/10 bg-white/[0.04] p-5">
                <div className="mb-4 text-sm font-medium text-white">Ручная корректировка</div>
                <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-5" onSubmit={submitAdjustment}>
                  <select className={selectCls} value={adjKind} onChange={(e) => setAdjKind(e.target.value as AdjKind)}>
                    <option value="fine">Штраф</option>
                    <option value="debt">Долг</option>
                    <option value="bonus">Бонус</option>
                  </select>
                  <select className={selectCls} value={adjCompanyId} onChange={(e) => setAdjCompanyId(e.target.value)}>
                    <option value="">Без привязки к точке</option>
                    {data.companies.map((c) => <option key={c.id} value={c.id}>{c.name || c.code || c.id}</option>)}
                  </select>
                  <input className={input} type="date" value={adjDate} onChange={(e) => setAdjDate(e.target.value)} />
                  <input className={input} type="text" placeholder="Сумма" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} />
                  <Button type="submit" className="h-11 rounded-xl bg-emerald-500 text-white hover:bg-emerald-400">
                    {adjSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Сохранить'}
                  </Button>
                  <input className={`${input} md:col-span-2 xl:col-span-5`} type="text" placeholder="Комментарий" value={adjComment} onChange={(e) => setAdjComment(e.target.value)} />
                </form>
                {adjSuccess ? <div className="mt-3 flex items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"><CheckCircle2 className="h-4 w-4 shrink-0" />Корректировка сохранена</div> : null}
              </Card>

              {/* Shifts table */}
              <Card className="overflow-hidden border-white/10 bg-white/[0.04] p-0">
                <div className="border-b border-white/10 px-5 py-4 text-sm font-medium text-white">
                  Смены за неделю <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-400">{shifts.length}</span>
                </div>
                <AdminTableViewport maxHeight="min(60vh, 36rem)" className="rounded-none border-0 bg-transparent">
                  <table className="min-w-full text-sm">
                    <thead className={adminTableStickyTheadClass}>
                      <tr>
                        <th className="px-4 py-3 text-left">Дата</th>
                        <th className="px-4 py-3 text-center">Смена</th>
                        <th className="px-4 py-3 text-left">Точка</th>
                        <th className="px-4 py-3 text-right text-green-400">Нал</th>
                        <th className="px-4 py-3 text-right text-blue-400">Kaspi</th>
                        <th className="px-4 py-3 text-right text-purple-400">Карта</th>
                        <th className="px-4 py-3 text-right">Выручка</th>
                        <th className="px-4 py-3 text-left">Комментарий</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shifts.length === 0 ? (
                        <tr><td colSpan={8} className="px-4 py-12 text-center text-slate-400">Нет смен за эту неделю.</td></tr>
                      ) : shifts.map((shift) => (
                        <tr key={shift.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                          <td className="px-4 py-3 font-mono text-xs text-slate-300">{formatRuDate(shift.date)}</td>
                          <td className="px-4 py-3 text-center">
                            {shift.shift === 'day' ? <Sun className="inline h-4 w-4 text-yellow-400" /> : <Moon className="inline h-4 w-4 text-blue-400" />}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-400">{shift.companyName || shift.companyCode || '—'}</td>
                          <td className={`px-4 py-3 text-right font-mono text-xs ${shift.cash ? 'text-white' : 'text-slate-600'}`}>{shift.cash ? money(shift.cash) : '—'}</td>
                          <td className={`px-4 py-3 text-right font-mono text-xs ${shift.kaspi ? 'text-white' : 'text-slate-600'}`}>{shift.kaspi ? money(shift.kaspi) : '—'}</td>
                          <td className={`px-4 py-3 text-right font-mono text-xs ${shift.card ? 'text-white' : 'text-slate-600'}`}>{shift.card ? money(shift.card) : '—'}</td>
                          <td className="px-4 py-3 text-right font-mono text-xs text-white">{money(shift.totalIncome)}</td>
                          <td className="max-w-[200px] truncate px-4 py-3 text-xs text-slate-400">{shift.comments.length ? shift.comments.join(' · ') : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </AdminTableViewport>
              </Card>
            </>
          ) : null}
        </div>

      {advanceOpen ? (
        <Modal title="Выдать аванс" subtitle={`${title} · ${formatRuDate(weekStart)} — ${formatRuDate(weekEnd)}`} onClose={() => setAdvanceOpen(false)}>
          <form className="space-y-4" onSubmit={submitAdvance}>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-slate-300">Точка</label>
                <select className={selectCls} value={advanceCompanyId} onChange={(e) => setAdvanceCompanyId(e.target.value)}>
                  {(data?.week.companyAllocations.length ? data.week.companyAllocations.map((a) => ({ id: a.companyId, label: a.companyName || a.companyCode || a.companyId })) : (data?.companies || []).map((c) => ({ id: c.id, label: c.name || c.code || c.id }))).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-300">Дата</label>
                <input className={input} type="date" value={advanceDate} onChange={(e) => setAdvanceDate(e.target.value)} />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-300">Наличные</label>
                <Input className="border-white/10 bg-slate-900/60 text-white" type="text" value={advanceCash} onChange={(e) => setAdvanceCash(e.target.value)} placeholder="0" />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-300">Kaspi</label>
                <Input className="border-white/10 bg-slate-900/60 text-white" type="text" value={advanceKaspi} onChange={(e) => setAdvanceKaspi(e.target.value)} placeholder="0" />
              </div>
            </div>
            <textarea className={textarea} value={advanceComment} onChange={(e) => setAdvanceComment(e.target.value)} placeholder="Комментарий" />
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">Итого: <span className="font-semibold text-white">{money(parseMoney(advanceCash) + parseMoney(advanceKaspi))}</span></div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setAdvanceOpen(false)}>Отмена</Button>
              <Button type="submit" className="rounded-xl bg-emerald-500 text-white hover:bg-emerald-400">{advanceSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Выдать аванс'}</Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {voidConfirm ? (
        <Modal title="Аннулировать?" subtitle={voidConfirm.label} onClose={() => !voidSaving && setVoidConfirm(null)}>
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
              <div>
                {voidConfirm.type === 'payment'
                  ? 'Выплата будет аннулирована, а связанные расходы — удалены. Это действие нельзя отменить.'
                  : 'Корректировка будет аннулирована. Если это аванс — связанный расход тоже будет удалён.'}
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setVoidConfirm(null)} disabled={voidSaving}>Отмена</Button>
              <Button type="button" className="rounded-xl bg-red-500 text-white hover:bg-red-400" onClick={() => void voidItem()} disabled={voidSaving}>
                {voidSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Trash2 className="mr-2 h-4 w-4" />Аннулировать</>}
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      {payOpen && data ? (
        <Modal title="Выплатить зарплату" subtitle={`${title} · остаток ${money(data.week.remainingAmount)}`} onClose={() => setPayOpen(false)}>
          <form className="space-y-4" onSubmit={submitPayment}>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-slate-300">Дата выплаты</label>
                <input className={input} type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </div>
              <div className="flex items-center rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-400">Выплата разложится по точкам пропорционально начислению</div>
              <div>
                <label className="mb-2 block text-sm text-slate-300">Наличные</label>
                <Input className="border-white/10 bg-slate-900/60 text-white" type="text" value={payCash} onChange={(e) => setPayCash(e.target.value)} placeholder="0" />
              </div>
              <div>
                <label className="mb-2 block text-sm text-slate-300">Kaspi</label>
                <Input className="border-white/10 bg-slate-900/60 text-white" type="text" value={payKaspi} onChange={(e) => setPayKaspi(e.target.value)} placeholder="0" />
              </div>
            </div>
            <textarea className={textarea} value={payComment} onChange={(e) => setPayComment(e.target.value)} placeholder="Комментарий" />
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">Выплата: <span className="font-semibold text-white">{money(parseMoney(payCash) + parseMoney(payKaspi))}</span></div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setPayOpen(false)}>Отмена</Button>
              <Button type="submit" className="rounded-xl bg-emerald-500 text-white hover:bg-emerald-400">{paySaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Провести выплату'}</Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  )
}
