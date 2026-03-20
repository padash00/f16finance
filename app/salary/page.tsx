'use client'

import { FormEvent, Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, Building2, CheckCircle2, ChevronDown, ChevronRight, CreditCard, DollarSign, Loader2, MessageCircle, Pencil, Plus, RefreshCw, Send, TrendingDown, Wallet } from 'lucide-react'

import { Sidebar } from '@/components/sidebar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { addDaysISO, formatRuDate, mondayOfDate, toISODateLocal, todayISO } from '@/lib/core/date'
import { formatMoney } from '@/lib/core/format'
import { getOperatorDisplayName } from '@/lib/core/operator-name'

type CompanyOption = { id: string; code: string | null; name: string | null }
type Allocation = { companyId: string; companyCode: string | null; companyName: string | null; accruedAmount: number; bonusAmount: number; fineAmount: number; debtAmount: number; advanceAmount: number; netAmount: number; shareRatio: number }
type Payment = { id: string; payment_date: string; cash_amount: number; kaspi_amount: number; total_amount: number; comment: string | null; status: string }
type WeeklyOperator = {
  operator: { id: string; name: string; short_name: string | null; full_name: string | null; is_active: boolean; telegram_chat_id: string | null; photo_url: string | null; position: string | null; documents_count: number; expiring_documents: number }
  week: { id: string; weekStart: string; weekEnd: string; grossAmount: number; bonusAmount: number; fineAmount: number; debtAmount: number; advanceAmount: number; netAmount: number; paidAmount: number; remainingAmount: number; status: 'draft' | 'partial' | 'paid'; companyAllocations: Allocation[]; payments: Payment[] }
  hasActivity: boolean
}
type SalaryData = { weekStart: string; weekEnd: string; companies: CompanyOption[]; operators: WeeklyOperator[]; totals: { netAmount: number; paidAmount: number; advanceAmount: number; remainingAmount: number; paidOperators: number; totalOperators: number } }
type AdjustmentKind = 'bonus' | 'fine' | 'debt'

const input = 'h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none'
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

  const weekEnd = useMemo(() => addDaysISO(weekStart, 6), [weekStart])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/salary?view=weekly&weekStart=${encodeURIComponent(weekStart)}`, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || `Ошибка загрузки (${res.status})`)
      setData(json.data as SalaryData)
    } catch (e: any) {
      console.error(e)
      setError(e?.message || 'Не удалось загрузить weekly payroll')
    } finally {
      setLoading(false)
    }
  }, [weekStart])

  useEffect(() => { void load() }, [load])
  useEffect(() => { if (advanceTarget) { setAdvanceCompanyId(advanceTarget.week.companyAllocations[0]?.companyId || data?.companies[0]?.id || ''); setAdvanceDate(todayISO()); setAdvanceCash(''); setAdvanceKaspi(''); setAdvanceComment('') } }, [advanceTarget, data?.companies])
  useEffect(() => { if (payTarget) { setPayDate(todayISO()); setPayCash(String(Math.max(payTarget.week.remainingAmount, 0))); setPayKaspi(''); setPayComment('') } }, [payTarget])
  useEffect(() => { if (chatTarget) setChatValue(chatTarget.operator.telegram_chat_id || '') }, [chatTarget])
  useEffect(() => { if (data?.operators.length) setAdjOperatorId((cur) => cur || data.operators[0].operator.id) }, [data?.operators])

  const operators = useMemo(() => showZero ? (data?.operators || []) : (data?.operators || []).filter((i) => i.hasActivity || i.week.remainingAmount > 0), [data?.operators, showZero])
  const broadcastTargets = useMemo(() => (data?.operators || []).filter((i) => i.operator.is_active && i.operator.telegram_chat_id), [data?.operators])
  const summaryText = useMemo(() => { const top = [...(data?.operators || [])].sort((a, b) => b.week.remainingAmount - a.week.remainingAmount)[0]; return top && top.week.remainingAmount > 0 ? `Самый большой остаток у ${getOperatorDisplayName(top.operator)}: ${money(top.week.remainingAmount)}.` : 'На этой неделе остатки закрыты или ещё не сформированы.' }, [data?.operators])

  async function post(body: unknown) {
    const res = await fetch('/api/admin/salary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => null)
    if (!res.ok) throw new Error(json?.error || `Ошибка запроса (${res.status})`)
    return json
  }

  const submitAdvance = async (e: FormEvent) => { e.preventDefault(); if (!advanceTarget) return; const cash = parseMoney(advanceCash), kaspi = parseMoney(advanceKaspi); if (!advanceCompanyId) return setError('Для аванса нужно выбрать точку'); if (cash + kaspi <= 0) return setError('Сумма аванса должна быть больше 0'); setAdvanceSaving(true); setError(null); try { await post({ action: 'createAdvance', payload: { operator_id: advanceTarget.operator.id, week_start: weekStart, company_id: advanceCompanyId, payment_date: advanceDate, cash_amount: cash, kaspi_amount: kaspi, comment: advanceComment.trim() || null } }); setAdvanceTarget(null); await load() } catch (e: any) { console.error(e); setError(e?.message || 'Не удалось выдать аванс') } finally { setAdvanceSaving(false) } }
  const submitPayment = async (e: FormEvent) => { e.preventDefault(); if (!payTarget) return; const cash = parseMoney(payCash), kaspi = parseMoney(payKaspi), total = cash + kaspi; if (total <= 0) return setError('Сумма выплаты должна быть больше 0'); if (total - payTarget.week.remainingAmount > 0.009) return setError('Сумма выплаты превышает остаток по неделе'); setPaySaving(true); setError(null); try { await post({ action: 'createWeeklyPayment', payload: { operator_id: payTarget.operator.id, week_start: weekStart, payment_date: payDate, cash_amount: cash, kaspi_amount: kaspi, comment: payComment.trim() || null } }); setPayTarget(null); await load() } catch (e: any) { console.error(e); setError(e?.message || 'Не удалось провести выплату') } finally { setPaySaving(false) } }
  const submitAdjustment = async (e: FormEvent) => { e.preventDefault(); const amount = parseMoney(adjAmount); if (!adjOperatorId) return setError('Выберите оператора'); if (amount <= 0) return setError('Сумма корректировки должна быть больше 0'); setAdjSaving(true); setError(null); try { await post({ action: 'createAdjustment', payload: { operator_id: adjOperatorId, date: adjDate, amount, kind: adjKind, comment: adjComment.trim() || null, company_id: adjCompanyId || null } }); setAdjAmount(''); setAdjComment(''); await load() } catch (e: any) { console.error(e); setError(e?.message || 'Не удалось сохранить корректировку') } finally { setAdjSaving(false) } }
  const saveChatId = async (e: FormEvent) => { e.preventDefault(); if (!chatTarget) return; const trimmed = chatValue.trim(); if (trimmed && !/^-?\d+$/.test(trimmed)) return setError('telegram_chat_id должен быть числом'); setChatSaving(true); setError(null); try { await post({ action: 'updateOperatorChatId', operatorId: chatTarget.operator.id, telegram_chat_id: trimmed || null }); setChatTarget(null); await load() } catch (e: any) { console.error(e); setError(e?.message || 'Не удалось сохранить Telegram chat_id') } finally { setChatSaving(false) } }
  const sendOne = async (operatorId: string) => { setSendingId(operatorId); setError(null); try { const res = await fetch('/api/telegram/salary-snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operatorId, dateFrom: weekStart, dateTo: weekEnd, weekStart }) }); const json = await res.json().catch(() => null); if (!res.ok) throw new Error(json?.error || `Ошибка отправки (${res.status})`) } catch (e: any) { console.error(e); setError(e?.message || 'Не удалось отправить расчёт в Telegram') } finally { setSendingId(null) } }
  const sendAll = async () => { if (loading || broadcastSending || !broadcastTargets.length) return; setBroadcastSending(true); setBroadcastDone(0); setBroadcastTotal(broadcastTargets.length); setBroadcastErrors([]); setError(null); try { for (let i = 0; i < broadcastTargets.length; i += 1) { const item = broadcastTargets[i]; try { const res = await fetch('/api/telegram/salary-snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operatorId: item.operator.id, dateFrom: weekStart, dateTo: weekEnd, weekStart }) }); const json = await res.json().catch(() => null); if (!res.ok) setBroadcastErrors((prev) => [...prev, `${getOperatorDisplayName(item.operator)}: ${json?.error || `HTTP ${res.status}`}`]) } catch (e: any) { setBroadcastErrors((prev) => [...prev, `${getOperatorDisplayName(item.operator)}: ${e?.message || 'ошибка'}`]) } setBroadcastDone(i + 1); await new Promise((r) => setTimeout(r, 250)) } } finally { setBroadcastSending(false) } }

  return (
    <div className="flex min-h-screen bg-[#0a1220] text-white">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-x-hidden pt-20 md:pt-0">
        <div className="mx-auto max-w-[1600px] space-y-4 px-4 pb-6 pt-4 md:px-6 md:py-6 xl:px-8">
          <Card className="overflow-hidden border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.18),_transparent_35%),linear-gradient(180deg,_rgba(15,23,42,0.96),_rgba(2,6,23,0.96))] p-5 md:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-3">
                <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white">
                  <ArrowLeft className="h-4 w-4" />
                  На главную
                </Link>
                <div className="flex items-center gap-4">
                  <div className="rounded-2xl bg-emerald-500/15 p-3 text-emerald-300">
                    <Wallet className="h-8 w-8" />
                  </div>
                  <div>
                    <h1 className="text-3xl font-semibold tracking-tight text-white">Зарплата по неделям</h1>
                    <p className="mt-1 max-w-2xl text-sm text-slate-300">Недельные выплаты, авансы и автоматические расходы по компаниям.</p>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={sendAll} disabled={loading || broadcastSending || !broadcastTargets.length} className="rounded-xl bg-blue-500 text-white hover:bg-blue-400 disabled:opacity-50">
                  {broadcastSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  {broadcastSending ? `Рассылка ${broadcastDone}/${broadcastTotal}` : 'Отправить всем'}
                </Button>
                <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setWeekStart(addDaysISO(weekStart, -7))}>Прошлая неделя</Button>
                <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setWeekStart(currentWeek)}>Текущая</Button>
                <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setWeekStart(addDaysISO(weekStart, 7))}>Следующая</Button>
                <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => void load()}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Обновить
                </Button>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3 text-xs text-slate-300">
              <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">Неделя: <span className="font-semibold text-white">{formatRuDate(weekStart)} - {formatRuDate(weekEnd)}</span></div>
              {data ? <div className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-emerald-300">Выплачено операторов: <span className="font-semibold">{data.totals.paidOperators}</span></div> : null}
              {broadcastTotal > 0 && !broadcastSending ? <div className={`rounded-full border px-3 py-1.5 ${broadcastErrors.length ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-blue-500/30 bg-blue-500/10 text-blue-300'}`}>Рассылка: {broadcastDone}/{broadcastTotal}</div> : null}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">
              <div className="min-w-0 flex-1">{summaryText}</div>
              <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setShowZero((v) => !v)}>{showZero ? 'РЎРєСЂС‹С‚СЊ РїСѓСЃС‚С‹Рµ СЃС‚СЂРѕРєРё' : 'РџРѕРєР°Р·Р°С‚СЊ РІСЃРµ СЃС‚СЂРѕРєРё'}</Button>
            </div>
          </Card>

          <Card className="hidden border-white/10 bg-white/[0.04] p-4 text-sm text-slate-300">{summaryText}</Card>
          {error ? <Card className="border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</Card> : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card className="border-white/10 bg-white/[0.04] p-5"><div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-500/15 p-2.5 text-emerald-300"><DollarSign className="h-5 w-5" /></div><div><div className="text-xs uppercase tracking-wide text-slate-500">К выплате</div><div className="mt-1 text-2xl font-semibold text-white">{data ? money(data.totals.netAmount) : '—'}</div></div></div></Card>
            <Card className="border-white/10 bg-white/[0.04] p-5"><div className="flex items-center gap-3"><div className="rounded-xl bg-blue-500/15 p-2.5 text-blue-300"><CheckCircle2 className="h-5 w-5" /></div><div><div className="text-xs uppercase tracking-wide text-slate-500">Уже выплачено</div><div className="mt-1 text-2xl font-semibold text-white">{data ? money(data.totals.paidAmount) : '—'}</div></div></div></Card>
            <Card className="border-white/10 bg-white/[0.04] p-5"><div className="flex items-center gap-3"><div className="rounded-xl bg-amber-500/15 p-2.5 text-amber-300"><CreditCard className="h-5 w-5" /></div><div><div className="text-xs uppercase tracking-wide text-slate-500">Авансы</div><div className="mt-1 text-2xl font-semibold text-white">{data ? money(data.totals.advanceAmount) : '—'}</div></div></div></Card>
            <Card className="border-white/10 bg-white/[0.04] p-5"><div className="flex items-center gap-3"><div className="rounded-xl bg-red-500/15 p-2.5 text-red-300"><TrendingDown className="h-5 w-5" /></div><div><div className="text-xs uppercase tracking-wide text-slate-500">Остаток</div><div className="mt-1 text-2xl font-semibold text-white">{data ? money(data.totals.remainingAmount) : '—'}</div></div></div></Card>
          </div>

          <Card className="hidden border-white/10 bg-white/[0.04] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-slate-300">Показано операторов: <span className="font-semibold text-white">{operators.length}</span></div>
              <Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setShowZero((v) => !v)}>{showZero ? 'Скрыть пустые строки' : 'Показать все строки'}</Button>
            </div>
          </Card>

          <Card className="overflow-hidden border-white/10 bg-white/[0.04]">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-950/50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-4 text-left">Оператор</th>
                    <th className="px-4 py-4 text-right">Начислено</th>
                    <th className="px-4 py-4 text-right">Бонусы</th>
                    <th className="px-4 py-4 text-right">Штрафы</th>
                    <th className="px-4 py-4 text-right">Долги</th>
                    <th className="px-4 py-4 text-right">Аванс</th>
                    <th className="px-4 py-4 text-right">Выплачено</th>
                    <th className="px-4 py-4 text-right">Остаток</th>
                    <th className="px-4 py-4 text-center">Статус</th>
                    <th className="px-4 py-4 text-center">Действия</th>
                    <th className="px-4 py-4 text-center">Telegram</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? <tr><td colSpan={11} className="px-4 py-16 text-center text-slate-400"><div className="inline-flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" />Загрузка weekly payroll...</div></td></tr> : null}
                  {!loading && operators.length === 0 ? <tr><td colSpan={11} className="px-4 py-16 text-center text-slate-400">В этой неделе пока нет строк для отображения.</td></tr> : null}
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
                                    <span>{item.operator.documents_count} док.</span>
                                    {item.operator.expiring_documents > 0 ? <span className="text-amber-300">{item.operator.expiring_documents} скоро истекут</span> : null}
                                  </div>
                                </div>
                              </Link>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-right font-medium text-white">{money(item.week.grossAmount)}</td>
                          <td className="px-4 py-4 text-right text-emerald-300">{money(item.week.bonusAmount)}</td>
                          <td className="px-4 py-4 text-right text-rose-300">{money(item.week.fineAmount)}</td>
                          <td className="px-4 py-4 text-right text-rose-300">{money(item.week.debtAmount)}</td>
                          <td className="px-4 py-4 text-right text-amber-300">{money(item.week.advanceAmount)}</td>
                          <td className="px-4 py-4 text-right text-sky-300">{money(item.week.paidAmount)}</td>
                          <td className="px-4 py-4 text-right text-lg font-semibold text-white">{money(item.week.remainingAmount)}</td>
                          <td className="px-4 py-4 text-center"><span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${st.className}`}>{st.label}</span></td>
                          <td className="px-4 py-4"><div className="flex flex-wrap items-center justify-center gap-2"><Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setAdvanceTarget(item)}><Plus className="mr-2 h-4 w-4" />Аванс</Button><Button type="button" className="rounded-xl bg-emerald-500 text-white hover:bg-emerald-400 disabled:opacity-50" disabled={!canPay} onClick={() => setPayTarget(item)}><Wallet className="mr-2 h-4 w-4" />Выплатить</Button><Link href={`/salary/${item.operator.id}?dateFrom=${weekStart}&dateTo=${weekEnd}`} className="inline-flex h-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-slate-200 transition hover:bg-white/10">Детали</Link></div></td>
                          <td className="px-4 py-4"><div className="flex flex-col items-center gap-2"><div className="flex items-center gap-2"><Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10" onClick={() => setChatTarget(item)}><Pencil className="h-4 w-4" /></Button><Button type="button" variant="outline" className="rounded-xl border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 disabled:opacity-50" disabled={!hasChat || sendingId === item.operator.id || broadcastSending} onClick={() => void sendOne(item.operator.id)}>{sendingId === item.operator.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}</Button></div>{item.operator.telegram_chat_id ? <div className="max-w-[140px] truncate text-center text-[11px] text-emerald-300/70">{item.operator.telegram_chat_id}</div> : <div className="text-[11px] text-slate-500">нет chat_id</div>}</div></td>
                        </tr>
                        {open ? <tr className="border-t border-white/5 bg-slate-950/30"><td colSpan={11} className="px-4 py-5"><div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]"><Card className="border-white/10 bg-white/[0.03] p-4"><div className="mb-4 flex items-center gap-2 text-sm font-medium text-white"><Building2 className="h-4 w-4 text-emerald-300" />Разбивка по компаниям</div><div className="overflow-x-auto"><table className="min-w-full text-xs"><thead className="text-slate-500"><tr><th className="pb-3 text-left font-medium">Компания</th><th className="pb-3 text-right font-medium">Начислено</th><th className="pb-3 text-right font-medium">Бонусы</th><th className="pb-3 text-right font-medium">Штрафы</th><th className="pb-3 text-right font-medium">Долги</th><th className="pb-3 text-right font-medium">Аванс</th><th className="pb-3 text-right font-medium">К выплате</th></tr></thead><tbody>{item.week.companyAllocations.map((a) => <tr key={a.companyId} className="border-t border-white/5 text-slate-200"><td className="py-3 pr-3"><div className="font-medium text-white">{a.companyName || a.companyCode || a.companyId}</div><div className="text-[11px] text-slate-500">Доля: {(a.shareRatio * 100).toFixed(1)}%</div></td><td className="py-3 text-right">{money(a.accruedAmount)}</td><td className="py-3 text-right text-emerald-300">{money(a.bonusAmount)}</td><td className="py-3 text-right text-rose-300">{money(a.fineAmount)}</td><td className="py-3 text-right text-rose-300">{money(a.debtAmount)}</td><td className="py-3 text-right text-amber-300">{money(a.advanceAmount)}</td><td className="py-3 text-right font-medium text-white">{money(a.netAmount)}</td></tr>)}</tbody></table></div></Card><Card className="border-white/10 bg-white/[0.03] p-4"><div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">Платежи недели</div>{item.week.payments.length === 0 ? <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-sm text-slate-400">По этой неделе ещё нет платежей.</div> : <div className="space-y-3">{item.week.payments.map((p) => <div key={p.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"><div className="flex items-center justify-between gap-3"><div><div className="text-sm font-medium text-white">{formatRuDate(p.payment_date)}</div><div className="mt-1 text-xs text-slate-400">Нал: {money(p.cash_amount)} • Kaspi: {money(p.kaspi_amount)}</div></div><div className="text-right"><div className="text-sm font-semibold text-emerald-300">{money(p.total_amount)}</div><div className="text-[11px] text-slate-500">{p.status}</div></div></div>{p.comment ? <div className="mt-2 text-xs text-slate-400">{p.comment}</div> : null}</div>)}</div>}</Card></div></td></tr> : null}
                      </Fragment>
                    )
                  }) : null}
                </tbody>
              </table>
            </div>
          </Card>

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
              <select className={input} value={adjOperatorId} onChange={(e) => setAdjOperatorId(e.target.value)}>
                {(data?.operators || []).map((i) => <option key={i.operator.id} value={i.operator.id}>{getOperatorDisplayName(i.operator)}</option>)}
              </select>
              <select className={input} value={adjCompanyId} onChange={(e) => setAdjCompanyId(e.target.value)}>
                <option value="">Без привязки к точке</option>
                {(data?.companies || []).map((c) => <option key={c.id} value={c.id}>{c.name || c.code || c.id}</option>)}
              </select>
              <select className={input} value={adjKind} onChange={(e) => setAdjKind(e.target.value as AdjustmentKind)}>
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
          </Card>
        </div>
      </main>

      {advanceTarget ? (
        <Modal title="Выдать аванс" subtitle={`${getOperatorDisplayName(advanceTarget.operator)} • ${formatRuDate(weekStart)} - ${formatRuDate(weekEnd)}`} onClose={() => setAdvanceTarget(null)}>
          <form className="space-y-4" onSubmit={submitAdvance}>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-slate-300">Точка</label>
                <select className={input} value={advanceCompanyId} onChange={(e) => setAdvanceCompanyId(e.target.value)}>
                  {(advanceTarget.week.companyAllocations.length ? advanceTarget.week.companyAllocations.map((a) => ({ id: a.companyId, label: a.companyName || a.companyCode || a.companyId })) : (data?.companies || []).map((c) => ({ id: c.id, label: c.name || c.code || c.id }))).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
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
    </div>
  )
}
