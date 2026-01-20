'use client'

import { useEffect, useMemo, useState, FormEvent, useCallback } from 'react'
import Link from 'next/link'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import {
  CalendarDays,
  ArrowLeft,
  DollarSign,
  Users2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Send,
  MessageCircle,
  Pencil,
} from 'lucide-react'

type Company = { id: string; name: string; code: string | null }

type IncomeRow = {
  id: string
  date: string
  company_id: string
  shift: 'day' | 'night' | null
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
  operator_id: string | null
  operator_name: string | null
}

type SalaryRule = {
  id: number
  company_code: string
  shift_type: 'day' | 'night'
  base_per_shift: number
  threshold1_turnover: number | null
  threshold1_bonus: number | null
  threshold2_turnover: number | null
  threshold2_bonus: number | null
}

type Operator = {
  id: string
  name: string
  short_name: string | null
  is_active: boolean
  telegram_chat_id: string | null
}

type AggregatedShift = {
  operatorId: string
  operatorName: string
  companyCode: string
  date: string
  shift: 'day' | 'night'
  turnover: number
}

type AdjustmentKind = 'debt' | 'fine' | 'bonus' | 'advance'

type AdjustmentRow = {
  id: number
  operator_id: string
  date: string
  amount: number
  kind: AdjustmentKind
  comment: string | null
}

type DebtRow = {
  id: string
  operator_id: string | null
  amount: number | null
  week_start: string | null
  status: string | null
}

// выплаты — это оператор + неделя (+ shift фиксированный)
type PayoutRow = {
  id: number
  operator_id: string
  week_start: string
  shift: string
  is_paid: boolean
  paid_at: string | null
  comment: string | null
  created_at: string
}

type OperatorWeekStat = {
  operatorId: string
  operatorName: string
  shifts: number
  basePerShift: number
  baseSalary: number
  bonusSalary: number
  totalSalary: number
  autoDebts: number
  manualPlus: number
  manualMinus: number
  advances: number
  finalSalary: number
}

const formatMoney = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

// --- Даты: локальный ISO без UTC-сдвигов ---
const toISODateLocal = (d: Date) => {
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

const fromISO = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

const getMonday = (d: Date) => {
  const date = new Date(d)
  const day = date.getDay() || 7 // 1..7 (Пн..Вс)
  if (day !== 1) date.setDate(date.getDate() - (day - 1))
  return date
}

const addDaysISO = (iso: string, diff: number) => {
  const d = fromISO(iso)
  d.setDate(d.getDate() + diff)
  return toISODateLocal(d)
}

const parseAmount = (raw: string) => {
  const n = Number(raw.replace(',', '.').replace(/\s/g, ''))
  return Number.isFinite(n) ? n : NaN
}

const formatIsoRu = (iso: string) => {
  const d = fromISO(iso)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function SalaryPage() {
  const today = new Date()
  const monday = getMonday(today)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  const [dateFrom, setDateFrom] = useState(toISODateLocal(monday))
  const [dateTo, setDateTo] = useState(toISODateLocal(sunday))

  // Статика
  const [companies, setCompanies] = useState<Company[]>([])
  const [rules, setRules] = useState<SalaryRule[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [staticLoading, setStaticLoading] = useState(true)

  // Динамика
  const [incomes, setIncomes] = useState<IncomeRow[]>([])
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([])
  const [debts, setDebts] = useState<DebtRow[]>([])
  const [payouts, setPayouts] = useState<PayoutRow[]>([])
  const [rangeLoading, setRangeLoading] = useState(true)

  const [error, setError] = useState<string | null>(null)

  // Форма корректировок
  const [adjOperatorId, setAdjOperatorId] = useState('')
  const [adjDate, setAdjDate] = useState(toISODateLocal(today))
  const [adjKind, setAdjKind] = useState<AdjustmentKind>('debt')
  const [adjAmount, setAdjAmount] = useState('')
  const [adjComment, setAdjComment] = useState('')
  const [adjSaving, setAdjSaving] = useState(false)

  // Оплата
  const [payingOperatorId, setPayingOperatorId] = useState<string | null>(null)

  // Telegram отправка (одному)
  const [sendingOperatorId, setSendingOperatorId] = useState<string | null>(null)

  // Telegram отправка всем
  const [broadcastSending, setBroadcastSending] = useState(false)
  const [broadcastDone, setBroadcastDone] = useState(0)
  const [broadcastTotal, setBroadcastTotal] = useState(0)
  const [broadcastErrors, setBroadcastErrors] = useState<string[]>([])

  // Telegram chat_id редактирование
  const [chatEditOperatorId, setChatEditOperatorId] = useState<string | null>(null)
  const [chatEditValue, setChatEditValue] = useState('')
  const [chatSaving, setChatSaving] = useState(false)

  // если кривой диапазон
  useEffect(() => {
    if (dateFrom && dateTo && dateFrom > dateTo) {
      setDateFrom(dateTo)
      setDateTo(dateFrom)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFrom, dateTo])

  const setThisWeek = useCallback(() => {
    const now = new Date()
    const mon = getMonday(now)
    const from = toISODateLocal(mon)
    const to = addDaysISO(from, 6)
    setDateFrom(from)
    setDateTo(to)
  }, [])

  const setLastWeek = useCallback(() => {
    const now = new Date()
    const mon = getMonday(now)
    mon.setDate(mon.getDate() - 7)
    const from = toISODateLocal(mon)
    const to = addDaysISO(from, 6)
    setDateFrom(from)
    setDateTo(to)
  }, [])

  // неделя оплаты = понедельник от dateFrom
  const weekStartISO = useMemo(() => {
    if (!dateFrom) return toISODateLocal(getMonday(new Date()))
    return toISODateLocal(getMonday(fromISO(dateFrom)))
  }, [dateFrom])

  const loading = staticLoading || rangeLoading

  // 1) Статика
  useEffect(() => {
    let alive = true

    const loadStatic = async () => {
      setStaticLoading(true)
      setError(null)

      const [compRes, rulesRes, opsRes] = await Promise.all([
        supabase.from('companies').select('id,name,code'),
        supabase
          .from('operator_salary_rules')
          .select(
            'id,company_code,shift_type,base_per_shift,threshold1_turnover,threshold1_bonus,threshold2_turnover,threshold2_bonus',
          )
          .eq('is_active', true),
        supabase.from('operators').select('id,name,short_name,is_active,telegram_chat_id'),
      ])

      if (!alive) return

      if (compRes.error || rulesRes.error || opsRes.error) {
        console.error('Salary static load error', compRes.error, rulesRes.error, opsRes.error)
        setError('Ошибка загрузки справочников (компании/правила/операторы)')
        setStaticLoading(false)
        return
      }

      setCompanies((compRes.data || []) as Company[])
      setRules((rulesRes.data || []) as SalaryRule[])
      setOperators((opsRes.data || []) as Operator[])
      setStaticLoading(false)
    }

    loadStatic()
    return () => {
      alive = false
    }
  }, [])

  const companyById = useMemo(() => {
    const map: Record<string, Company> = {}
    for (const c of companies) map[c.id] = c
    return map
  }, [companies])

  const rulesMap = useMemo(() => {
    const map: Record<string, SalaryRule> = {}
    for (const r of rules) map[`${r.company_code}_${r.shift_type}`] = r
    return map
  }, [rules])

  // 2) Диапазон
  useEffect(() => {
    let alive = true

    const loadRange = async () => {
      setRangeLoading(true)
      setError(null)

      const [incRes, adjRes, debtsRes, payoutsRes] = await Promise.all([
        supabase
          .from('incomes')
          .select('id,date,company_id,shift,cash_amount,kaspi_amount,card_amount,operator_id,operator_name')
          .gte('date', dateFrom)
          .lte('date', dateTo),

        supabase
          .from('operator_salary_adjustments')
          .select('id,operator_id,date,amount,kind,comment')
          .gte('date', dateFrom)
          .lte('date', dateTo),

        supabase
          .from('debts')
          .select('id,operator_id,amount,week_start,status')
          .gte('week_start', dateFrom)
          .lte('week_start', dateTo)
          .eq('status', 'active'),

        // выплаты за неделю
        supabase
          .from('operator_salary_payouts')
          .select('id,operator_id,week_start,shift,is_paid,paid_at,comment,created_at')
          .eq('week_start', weekStartISO)
          .eq('shift', 'all'),
      ])

      if (!alive) return

      if (incRes.error || adjRes.error || debtsRes.error || payoutsRes.error) {
        console.error('Salary range load error', incRes.error, adjRes.error, debtsRes.error, payoutsRes.error)
        setError('Ошибка загрузки данных для расчёта зарплаты')
        setRangeLoading(false)
        return
      }

      setIncomes((incRes.data || []) as IncomeRow[])
      setAdjustments((adjRes.data || []) as AdjustmentRow[])
      setDebts((debtsRes.data || []) as DebtRow[])
      setPayouts((payoutsRes.data || []) as PayoutRow[])
      setRangeLoading(false)
    }

    loadRange()
    return () => {
      alive = false
    }
  }, [dateFrom, dateTo, weekStartISO])

  // Статус оплаты по оператору
  const payoutByOperator = useMemo(() => {
    const map = new Map<string, PayoutRow>()
    for (const p of payouts) map.set(p.operator_id, p)
    return map
  }, [payouts])

  const operatorById = useMemo(() => {
    const map: Record<string, Operator> = {}
    for (const o of operators) map[o.id] = o
    return map
  }, [operators])

  // Список операторов для селекта
  const operatorOptions = useMemo(
    () =>
      operators
        .filter((o) => o.is_active)
        .sort((a, b) => (a.short_name || a.name).localeCompare(b.short_name || b.name, 'ru')),
    [operators],
  )

  // Основная математика
  const stats = useMemo(() => {
    const aggregated = new Map<string, AggregatedShift>()
    const byOperator = new Map<string, OperatorWeekStat>()

    const DEFAULT_BASE = 8000

    const ensureOperator = (id: string | null): OperatorWeekStat | null => {
      if (!id) return null

      let op = byOperator.get(id)
      if (!op) {
        const meta = operatorById[id]
        const displayName = meta?.short_name || meta?.name || 'Без имени'

        op = {
          operatorId: id,
          operatorName: displayName,
          shifts: 0,
          basePerShift: DEFAULT_BASE,
          baseSalary: 0,
          bonusSalary: 0,
          totalSalary: 0,
          autoDebts: 0,
          manualPlus: 0,
          manualMinus: 0,
          advances: 0,
          finalSalary: 0,
        }
        byOperator.set(id, op)
      }
      return op
    }

    // 1) Смены (агрегация)
    for (const row of incomes) {
      if (!row.operator_id) continue

      const company = companyById[row.company_id]
      const code = company?.code?.toLowerCase() || null
      if (!code) continue
      if (!['arena', 'ramen', 'extra'].includes(code)) continue

      const shift: 'day' | 'night' = row.shift === 'night' ? 'night' : 'day'

      const total = Number(row.cash_amount || 0) + Number(row.kaspi_amount || 0) + Number(row.card_amount || 0)
      if (total <= 0) continue

      const meta = operatorById[row.operator_id]
      const displayName = meta?.short_name || meta?.name || row.operator_name || 'Без имени'

      const key = `${row.operator_id}_${code}_${row.date}_${shift}`

      const ex =
        aggregated.get(key) || {
          operatorId: row.operator_id,
          operatorName: displayName,
          companyCode: code,
          date: row.date,
          shift,
          turnover: 0,
        }

      ex.turnover += total
      aggregated.set(key, ex)
    }

    // 2) База + авто-бонусы
    for (const sh of aggregated.values()) {
      const rule = rulesMap[`${sh.companyCode}_${sh.shift}`]
      const basePerShift = rule?.base_per_shift ?? DEFAULT_BASE

      let bonus = 0
      if (rule?.threshold1_turnover && sh.turnover >= rule.threshold1_turnover) bonus += rule.threshold1_bonus || 0
      if (rule?.threshold2_turnover && sh.turnover >= rule.threshold2_turnover) bonus += rule.threshold2_bonus || 0

      const op = ensureOperator(sh.operatorId)
      if (!op) continue

      op.basePerShift = basePerShift
      op.shifts += 1
      op.baseSalary += basePerShift
      op.bonusSalary += bonus
      op.totalSalary += basePerShift + bonus
    }

    // 2a) Все активные операторы — в таблицу
    for (const o of operators) {
      if (!o.is_active) continue
      ensureOperator(o.id)
    }

    // 3) Ручные корректировки
    for (const adj of adjustments) {
      const op = ensureOperator(adj.operator_id)
      if (!op) continue

      const amount = Number(adj.amount || 0)
      if (!Number.isFinite(amount) || amount <= 0) continue

      if (adj.kind === 'bonus') op.manualPlus += amount
      else if (adj.kind === 'advance') op.advances += amount
      else op.manualMinus += amount
    }

    // 4) Долги недели (авто)
    for (const d of debts) {
      const op = ensureOperator(d.operator_id)
      if (!op) continue

      const amount = Number(d.amount || 0)
      if (!Number.isFinite(amount) || amount <= 0) continue

      op.autoDebts += amount
    }

    // 5) Итог
    let totalSalary = 0
    for (const op of byOperator.values()) {
      op.finalSalary = op.totalSalary + op.manualPlus - op.manualMinus - op.autoDebts - op.advances
      totalSalary += op.finalSalary
    }

    const operatorsStats = Array.from(byOperator.values()).sort((a, b) => a.operatorName.localeCompare(b.operatorName, 'ru'))
    return { operators: operatorsStats, totalSalary }
  }, [incomes, companyById, rulesMap, adjustments, operators, debts, operatorById])

  const totalShifts = stats.operators.reduce((s, o) => s + o.shifts, 0)
  const totalBase = stats.operators.reduce((s, o) => s + o.baseSalary, 0)
  const totalBonus = stats.operators.reduce((s, o) => s + o.bonusSalary, 0)
  const totalAutoDebts = stats.operators.reduce((s, o) => s + o.autoDebts, 0)
  const totalMinus = stats.operators.reduce((s, o) => s + o.manualMinus, 0)
  const totalPlus = stats.operators.reduce((s, o) => s + o.manualPlus, 0)
  const totalAdvances = stats.operators.reduce((s, o) => s + o.advances, 0)

  const paidCount = useMemo(() => {
    let n = 0
    for (const op of stats.operators) {
      const p = payoutByOperator.get(op.operatorId)
      if (p?.is_paid) n++
    }
    return n
  }, [stats.operators, payoutByOperator])

  const handleAddAdjustment = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)

    try {
      if (!adjOperatorId) throw new Error('Выберите оператора')
      if (!adjDate) throw new Error('Выберите дату корректировки')

      const amountNum = parseAmount(adjAmount)
      if (!Number.isFinite(amountNum) || amountNum <= 0) throw new Error('Введите сумму корректировки')

      setAdjSaving(true)

      const payload = {
        operator_id: adjOperatorId,
        date: adjDate,
        amount: Math.round(amountNum),
        kind: adjKind,
        comment: adjComment.trim() || null,
      }

      const { data, error } = await supabase
        .from('operator_salary_adjustments')
        .insert([payload])
        .select('id,operator_id,date,amount,kind,comment')
        .single()

      if (error) throw error

      setAdjustments((prev) => [...prev, data as AdjustmentRow])
      setAdjAmount('')
      setAdjComment('')
      setAdjKind('debt')
      setAdjSaving(false)
    } catch (err: any) {
      console.error(err)
      setError(err.message || 'Ошибка при добавлении корректировки')
      setAdjSaving(false)
    }
  }

  const togglePaid = async (operatorId: string) => {
    setError(null)
    setPayingOperatorId(operatorId)

    try {
      const existing = payoutByOperator.get(operatorId)
      const nextPaid = !Boolean(existing?.is_paid)

      const payload = {
        operator_id: operatorId,
        week_start: weekStartISO,
        shift: 'all',
        is_paid: nextPaid,
        paid_at: nextPaid ? new Date().toISOString() : null,
      }

      const { data, error } = await supabase
        .from('operator_salary_payouts')
        .upsert([payload], { onConflict: 'operator_id,week_start,shift' })
        .select('id,operator_id,week_start,shift,is_paid,paid_at,comment,created_at')
        .single()

      if (error) throw error

      setPayouts((prev) => {
        const next = [...prev]
        const idx = next.findIndex((p) => p.operator_id === operatorId)
        if (idx >= 0) next[idx] = data as PayoutRow
        else next.push(data as PayoutRow)
        return next
      })
    } catch (e: any) {
      console.error(e)
      setError(e.message || 'Ошибка при обновлении статуса оплаты')
    } finally {
      setPayingOperatorId(null)
    }
  }

  const sendToTelegram = async (operatorId: string) => {
    setError(null)
    setSendingOperatorId(operatorId)
    try {
      const resp = await fetch('/api/telegram/salary-snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operatorId, dateFrom, dateTo, weekStart: weekStartISO }),
      })

      const raw = await resp.text().catch(() => '')
      let json: any = null
      try {
        json = raw ? JSON.parse(raw) : null
      } catch {}

      if (!resp.ok) {
        const msg = json?.error || `Ошибка отправки в Telegram (HTTP ${resp.status})`
        throw new Error(msg)
      }
    } catch (e: any) {
      console.error(e)
      setError(e?.message || 'Ошибка отправки в Telegram')
    } finally {
      setSendingOperatorId(null)
    }
  }

  // ✅ МАССОВАЯ ОТПРАВКА ВСЕМ
  const sendToAll = async () => {
    if (broadcastSending) return
    setError(null)
    setBroadcastErrors([])
    setBroadcastDone(0)

    // берем только активных у кого есть chat_id
    const target = operators
      .filter((o) => o.is_active && o.telegram_chat_id)
      .sort((a, b) => (a.short_name || a.name).localeCompare(b.short_name || b.name, 'ru'))

    if (target.length === 0) {
      setError('Нет операторов с telegram_chat_id для отправки')
      return
    }

    setBroadcastTotal(target.length)
    setBroadcastSending(true)

    try {
      for (let i = 0; i < target.length; i++) {
        const op = target[i]

        try {
          const resp = await fetch('/api/telegram/salary-snapshot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              operatorId: op.id,
              dateFrom,
              dateTo,
              weekStart: weekStartISO,
            }),
          })

          const raw = await resp.text().catch(() => '')
          let json: any = null
          try {
            json = raw ? JSON.parse(raw) : null
          } catch {}

          if (!resp.ok) {
            const msg = json?.error || `HTTP ${resp.status}`
            setBroadcastErrors((prev) => [...prev, `${op.short_name || op.name}: ${msg}`])
          }
        } catch (e: any) {
          setBroadcastErrors((prev) => [...prev, `${op.short_name || op.name}: ${e?.message || 'ошибка'}`])
        }

        setBroadcastDone(i + 1)
        // маленькая пауза чтобы Telegram не банил (и серверу легче)
        await sleep(350)
      }
    } finally {
      setBroadcastSending(false)
    }
  }

  const openChatEditor = (operatorId: string) => {
    const op = operatorById[operatorId]
    setChatEditOperatorId(operatorId)
    setChatEditValue(op?.telegram_chat_id || '')
  }

  const saveChatId = async () => {
    setError(null)
    if (!chatEditOperatorId) return

    const v = chatEditValue.trim()
    if (v && !/^\-?\d+$/.test(v)) {
      setError('telegram_chat_id должен быть числом (может быть с минусом для группы)')
      return
    }

    setChatSaving(true)
    try {
      const { data, error } = await supabase
        .from('operators')
        .update({ telegram_chat_id: v || null })
        .eq('id', chatEditOperatorId)
        .select('id,name,short_name,is_active,telegram_chat_id')
        .single()

      if (error) throw error

      setOperators((prev) => prev.map((o) => (o.id === chatEditOperatorId ? (data as Operator) : o)))
      setChatEditOperatorId(null)
      setChatEditValue('')
    } catch (e: any) {
      console.error(e)
      setError(e?.message || 'Ошибка сохранения telegram_chat_id')
    } finally {
      setChatSaving(false)
    }
  }

  const canBroadcast = useMemo(() => {
    if (loading) return false
    if (broadcastSending) return false
    // хотя бы один активный с chat_id
    return operators.some((o) => o.is_active && !!o.telegram_chat_id)
  }, [loading, broadcastSending, operators])

  const broadcastLabel = useMemo(() => {
    if (!broadcastSending) return 'Отправить всем'
    return `Отправка... ${broadcastDone}/${broadcastTotal}`
  }, [broadcastSending, broadcastDone, broadcastTotal])

  return (
    <div className="flex min-h-screen bg-[#050505] text-foreground">
      <Sidebar />

      {/* Мини-окно для chat_id */}
      {chatEditOperatorId && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <Card className="w-full max-w-md p-4 border-border bg-card/90">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-4 h-4 text-emerald-400" />
                <div className="font-semibold text-sm">Telegram chat_id</div>
              </div>
              <Button variant="ghost" size="sm" className="h-8" onClick={() => setChatEditOperatorId(null)}>
                Закрыть
              </Button>
            </div>

            <div className="text-xs text-muted-foreground mb-2">
              Оператор:{' '}
              <span className="font-semibold">
                {operatorById[chatEditOperatorId]?.short_name || operatorById[chatEditOperatorId]?.name}
              </span>
            </div>

            <input
              value={chatEditValue}
              onChange={(e) => setChatEditValue(e.target.value)}
              className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm"
              placeholder="например: 1566833632 или -4935038728"
            />

            <div className="flex gap-2 mt-3 justify-end">
              <Button variant="outline" onClick={() => setChatEditOperatorId(null)} className="h-9">
                Отмена
              </Button>
              <Button onClick={saveChatId} disabled={chatSaving} className="h-9">
                {chatSaving ? 'Сохранение...' : 'Сохранить'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
          {/* Хедер */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link href="/income">
                <Button variant="ghost" size="icon" className="rounded-full">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold flex items-center gap-2">
                    <Users2 className="w-6 h-6 text-emerald-400" />
                    Зарплата операторов
                  </h1>

                  {/* ✅ КНОПКА ОТПРАВИТЬ ВСЕМ */}
                  <Button
                    onClick={sendToAll}
                    disabled={!canBroadcast}
                    className="h-9 rounded-full text-[12px] font-semibold gap-2"
                    variant="outline"
                    title={!canBroadcast ? 'Нет операторов с chat_id или идет загрузка' : 'Отправить всем активным с chat_id'}
                  >
                    {broadcastSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    {broadcastLabel}
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">База + авто-бонусы + корректировки − долги − авансы</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Неделя оплаты: <span className="font-semibold">{formatIsoRu(weekStartISO)}</span>
                  {!loading && (
                    <>
                      {'  '}• Оплачено:{' '}
                      <span className="font-semibold text-emerald-300">
                        {paidCount}/{stats.operators.length}
                      </span>
                    </>
                  )}
                </p>

                {/* ✅ РЕЗУЛЬТАТ МАССОВОЙ ОТПРАВКИ */}
                {!broadcastSending && broadcastTotal > 0 && (
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    Рассылка: <span className="font-semibold">{broadcastDone}/{broadcastTotal}</span>
                    {broadcastErrors.length > 0 ? (
                      <span className="text-red-300"> • ошибок: {broadcastErrors.length}</span>
                    ) : (
                      <span className="text-emerald-300"> • без ошибок</span>
                    )}
                  </div>
                )}

                {!broadcastSending && broadcastErrors.length > 0 && (
                  <div className="mt-2 text-[11px] text-red-200 whitespace-pre-wrap">
                    {broadcastErrors.slice(0, 8).map((e, i) => (
                      <div key={i}>• {e}</div>
                    ))}
                    {broadcastErrors.length > 8 && <div>… и ещё {broadcastErrors.length - 8}</div>}
                  </div>
                )}
              </div>
            </div>

            {/* Быстрый выбор недели + даты */}
            <div className="flex flex-col items-end gap-2">
              <div className="flex gap-2">
                <Button size="xs" variant="outline" onClick={setLastWeek} className="h-7 text-[11px]">
                  Прошлая неделя
                </Button>
                <Button size="xs" variant="outline" onClick={setThisWeek} className="h-7 text-[11px]">
                  Эта неделя
                </Button>
              </div>
              <div className="flex items-center gap-2 bg-card/40 border border-border/60 rounded-lg px-2 py-1">
                <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="bg-transparent text-xs px-1 py-0.5 rounded outline-none"
                />
                <span className="text-[10px] text-muted-foreground">—</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="bg-transparent text-xs px-1 py-0.5 rounded outline-none"
                />
              </div>
            </div>
          </div>

          {error && (
            <Card className="p-4 border border-red-500/40 bg-red-950/30 text-sm text-red-200 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {error}
            </Card>
          )}

          {/* Сводка */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="p-4 border-border bg-card/70">
              <p className="text-xs text-muted-foreground mb-1">Всего смен</p>
              <p className="text-2xl font-bold">{loading ? '—' : totalShifts}</p>
            </Card>
            <Card className="p-4 border-border bg-card/70">
              <p className="text-xs text-muted-foreground mb-1">База (оклад)</p>
              <p className="text-2xl font-bold">{loading ? '—' : formatMoney(totalBase)}</p>
            </Card>
            <Card className="p-4 border-border bg-card/70">
              <p className="text-xs text-muted-foreground mb-1">Авто-бонусы</p>
              <p className="text-2xl font-bold text-emerald-400">{loading ? '—' : formatMoney(totalBonus)}</p>
            </Card>
            <Card className="p-4 border-border bg-card/70">
              <p className="text-xs text-muted-foreground mb-1">К выплате (итог)</p>
              <p className="text-2xl font-bold text-sky-400">{loading ? '—' : formatMoney(stats.totalSalary)}</p>
              {!loading && totalAutoDebts > 0 && (
                <p className="mt-1 text-[11px] text-red-300">Включая долги недели: {formatMoney(totalAutoDebts)}</p>
              )}
            </Card>
          </div>

          {/* Таблица */}
          <Card className="border-border bg-card/80 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1280px] text-xs md:text-sm border-collapse">
                <thead className="sticky top-0 z-10 bg-[#0b0b0b]/95 backdrop-blur border-b border-border">
                  <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-3 px-3 text-left">Оператор</th>
                    <th className="py-3 px-3 text-center">Смен</th>
                    <th className="py-3 px-3 text-right">Оклад</th>
                    <th className="py-3 px-3 text-right">База</th>
                    <th className="py-3 px-3 text-right">Авто-бонус</th>
                    <th className="py-3 px-3 text-right text-red-300">Долги за неделю</th>
                    <th className="py-3 px-3 text-right text-red-300">Долги</th>
                    <th className="py-3 px-3 text-right text-amber-300">Аванс</th>
                    <th className="py-3 px-3 text-right text-emerald-300">Премия</th>
                    <th className="py-3 px-3 text-right">К выплате</th>
                    <th className="py-3 px-3 text-center">Оплата</th>
                    <th className="py-3 px-3 text-center">Telegram</th>
                  </tr>
                </thead>

                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={12} className="py-8 text-center text-muted-foreground text-xs">
                        Загрузка...
                      </td>
                    </tr>
                  )}

                  {!loading && stats.operators.length === 0 && (
                    <tr>
                      <td colSpan={12} className="py-8 text-center text-muted-foreground text-xs">
                        Нет данных в выбранном периоде.
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    stats.operators.map((op, idx) => {
                      const payout = payoutByOperator.get(op.operatorId)
                      const isPaid = Boolean(payout?.is_paid)
                      const isNeg = op.finalSalary < 0
                      const opMeta = operatorById[op.operatorId]
                      const hasChat = Boolean(opMeta?.telegram_chat_id)

                      return (
                        <tr
                          key={op.operatorId}
                          className={[
                            'border-t border-border/40',
                            idx % 2 === 0 ? 'bg-white/[0.02]' : 'bg-transparent',
                            'hover:bg-white/[0.05] transition-colors',
                          ].join(' ')}
                        >
                          <td className="py-3 px-3 font-semibold">{op.operatorName}</td>
                          <td className="py-3 px-3 text-center">{op.shifts}</td>

                          <td className="py-3 px-3 text-right font-medium">{formatMoney(op.basePerShift)}</td>
                          <td className="py-3 px-3 text-right">{formatMoney(op.baseSalary)}</td>
                          <td className="py-3 px-3 text-right text-emerald-300">{formatMoney(op.bonusSalary)}</td>
                          <td className="py-3 px-3 text-right text-red-300">{formatMoney(op.autoDebts)}</td>
                          <td className="py-3 px-3 text-right text-red-300">{formatMoney(op.manualMinus)}</td>
                          <td className="py-3 px-3 text-right text-amber-300">{formatMoney(op.advances)}</td>
                          <td className="py-3 px-3 text-right text-emerald-300">{formatMoney(op.manualPlus)}</td>

                          <td
                            className={[
                              'py-3 px-3 text-right font-bold',
                              isNeg ? 'text-red-200' : 'text-foreground',
                            ].join(' ')}
                          >
                            {formatMoney(op.finalSalary)}
                          </td>

                          <td className="py-3 px-3 text-center">
                            <Button
                              size="xs"
                              onClick={() => togglePaid(op.operatorId)}
                              disabled={payingOperatorId === op.operatorId}
                              className={[
                                'h-8 px-3 rounded-full text-[11px] font-semibold gap-1 shadow-sm',
                                isPaid
                                  ? 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/30 hover:bg-emerald-500/20'
                                  : 'bg-yellow-400/20 text-yellow-200 border border-yellow-400/35 hover:bg-yellow-400/25',
                              ].join(' ')}
                              variant="ghost"
                            >
                              {payingOperatorId === op.operatorId ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : isPaid ? (
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              ) : (
                                <XCircle className="w-3.5 h-3.5" />
                              )}
                              {isPaid ? 'Оплачено' : 'Не оплачено'}
                            </Button>

                            {isPaid && payout?.paid_at && (
                              <div className="text-[10px] text-muted-foreground mt-1">
                                {new Date(payout.paid_at).toLocaleString('ru-RU')}
                              </div>
                            )}
                          </td>

                          <td className="py-3 px-3 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <Button
                                size="xs"
                                variant="ghost"
                                className="h-8 px-3 rounded-full text-[11px] border border-border/60"
                                onClick={() => openChatEditor(op.operatorId)}
                              >
                                <Pencil className="w-3.5 h-3.5 mr-1" />
                                chat_id
                              </Button>

                              <Button
                                size="xs"
                                variant="ghost"
                                className={[
                                  'h-8 px-3 rounded-full text-[11px] font-semibold gap-1 shadow-sm border',
                                  hasChat
                                    ? 'border-emerald-500/30 text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/15'
                                    : 'border-red-500/30 text-red-200 bg-red-500/10 hover:bg-red-500/15',
                                ].join(' ')}
                                disabled={!hasChat || sendingOperatorId === op.operatorId || broadcastSending}
                                onClick={() => sendToTelegram(op.operatorId)}
                                title={!hasChat ? 'Сначала добавь telegram_chat_id' : 'Отправить расчёт в Telegram'}
                              >
                                {sendingOperatorId === op.operatorId ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Send className="w-3.5 h-3.5" />
                                )}
                                Отправить
                              </Button>
                            </div>

                            <div className="text-[10px] text-muted-foreground mt-1">
                              {hasChat ? (
                                <span className="inline-flex items-center gap-1">
                                  <MessageCircle className="w-3 h-3" />
                                  {opMeta.telegram_chat_id}
                                </span>
                              ) : (
                                <span className="text-red-300">нет chat_id</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}

                  {!loading && stats.operators.length > 0 && (
                    <tr className="border-t border-border bg-white/[0.03]">
                      <td className="py-3 px-3 font-bold text-right" colSpan={2}>
                        Итого:
                      </td>
                      <td className="py-3 px-3 text-right font-bold">—</td>
                      <td className="py-3 px-3 text-right font-bold">{formatMoney(totalBase)}</td>
                      <td className="py-3 px-3 text-right font-bold text-emerald-300">{formatMoney(totalBonus)}</td>
                      <td className="py-3 px-3 text-right font-bold text-red-300">{formatMoney(totalAutoDebts)}</td>
                      <td className="py-3 px-3 text-right font-bold text-red-300">{formatMoney(totalMinus)}</td>
                      <td className="py-3 px-3 text-right font-bold text-amber-300">{formatMoney(totalAdvances)}</td>
                      <td className="py-3 px-3 text-right font-bold text-emerald-300">{formatMoney(totalPlus)}</td>
                      <td className="py-3 px-3 text-right font-bold text-sky-200">{formatMoney(stats.totalSalary)}</td>
                      <td className="py-3 px-3 text-center text-[11px] text-muted-foreground">
                        {paidCount}/{stats.operators.length}
                      </td>
                      <td className="py-3 px-3 text-center text-[11px] text-muted-foreground">—</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Форма корректировок */}
          {operatorOptions.length > 0 && (
            <Card className="p-4 border-border bg-card/80">
              <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                Добавить долг / штраф / премию / аванс
              </h3>

              <form onSubmit={handleAddAdjustment} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Оператор</label>
                  <select
                    value={adjOperatorId}
                    onChange={(e) => setAdjOperatorId(e.target.value)}
                    className="w-full bg-input border border-border rounded-md px-2 py-1.5 text-xs"
                  >
                    <option value="">Не выбран</option>
                    {operatorOptions.map((op) => (
                      <option key={op.id} value={op.id}>
                        {op.short_name || op.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Дата</label>
                  <input
                    type="date"
                    value={adjDate}
                    onChange={(e) => setAdjDate(e.target.value)}
                    className="w-full bg-input border border-border rounded-md px-2 py-1.5 text-xs"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Тип</label>
                  <select
                    value={adjKind}
                    onChange={(e) => setAdjKind(e.target.value as AdjustmentKind)}
                    className="w-full bg-input border border-border rounded-md px-2 py-1.5 text-xs"
                  >
                    <option value="debt">Долг (минус)</option>
                    <option value="fine">Штраф (минус)</option>
                    <option value="advance">Аванс (минус из выплаты)</option>
                    <option value="bonus">Премия (плюс)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] text-muted-foreground mb-1 block">Сумма</label>
                  <input
                    type="number"
                    min="0"
                    value={adjAmount}
                    onChange={(e) => setAdjAmount(e.target.value)}
                    className="w-full bg-input border border-border rounded-md px-2 py-1.5 text-xs"
                    placeholder="0"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="text-[11px] text-muted-foreground mb-1 block">Комментарий</label>
                  <div className="flex gap-2">
                    <input
                      value={adjComment}
                      onChange={(e) => setAdjComment(e.target.value)}
                      className="flex-1 bg-input border border-border rounded-md px-2 py-1.5 text-xs"
                      placeholder="Аванс −20k / штраф −10k / премия..."
                    />
                    <Button type="submit" disabled={adjSaving} className="whitespace-nowrap h-9 text-xs">
                      {adjSaving ? 'Сохранение...' : 'Добавить'}
                    </Button>
                  </div>
                </div>
              </form>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}
