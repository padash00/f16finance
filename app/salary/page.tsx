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
  Brain,
  Sparkles,
  TrendingUp,
  Target,
  Zap,
  ChevronDown,
  Wallet,
  Plus,
  Minus,
  Gift,
  AlertCircle,
  Clock,
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

// ================== DATE HELPERS ==================
const DateUtils = {
  toISODateLocal: (d: Date) => {
    const t = d.getTime() - d.getTimezoneOffset() * 60_000
    return new Date(t).toISOString().slice(0, 10)
  },
  
  fromISO: (iso: string): Date => {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, (m || 1) - 1, d || 1)
  },

  todayISO: () => DateUtils.toISODateLocal(new Date()),

  formatDate: (iso: string, format: 'short' | 'full' = 'short'): string => {
    if (!iso) return ''
    const d = DateUtils.fromISO(iso)
    if (format === 'short') {
      return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
    }
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
  },

  getMonday: (d: Date) => {
    const date = new Date(d)
    const day = date.getDay() || 7
    if (day !== 1) date.setDate(date.getDate() - (day - 1))
    return date
  },

  addDaysISO: (iso: string, diff: number) => {
    const d = DateUtils.fromISO(iso)
    d.setDate(d.getDate() + diff)
    return DateUtils.toISODateLocal(d)
  }
}

// ================== FORMATTERS ==================
const Formatters = {
  money: (v: number): string => {
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + ' млн ₸'
    if (v >= 1_000) return (v / 1_000).toFixed(1) + ' тыс ₸'
    return v.toLocaleString('ru-RU') + ' ₸'
  },

  moneyDetailed: (v: number): string => 
    v.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ₸'
}

const parseAmount = (raw: string) => {
  const n = Number(raw.replace(',', '.').replace(/\s/g, ''))
  return Number.isFinite(n) ? n : NaN
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export default function SalaryPage() {
  const today = new Date()
  const monday = DateUtils.getMonday(today)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)

  const [dateFrom, setDateFrom] = useState(DateUtils.toISODateLocal(monday))
  const [dateTo, setDateTo] = useState(DateUtils.toISODateLocal(sunday))

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
  const [adjDate, setAdjDate] = useState(DateUtils.todayISO())
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

  // Date picker
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false)

  // если кривой диапазон
  useEffect(() => {
    if (dateFrom && dateTo && dateFrom > dateTo) {
      setDateFrom(dateTo)
      setDateTo(dateFrom)
    }
  }, [dateFrom, dateTo])

  const setThisWeek = useCallback(() => {
    const now = new Date()
    const mon = DateUtils.getMonday(now)
    const from = DateUtils.toISODateLocal(mon)
    const to = DateUtils.addDaysISO(from, 6)
    setDateFrom(from)
    setDateTo(to)
  }, [])

  const setLastWeek = useCallback(() => {
    const now = new Date()
    const mon = DateUtils.getMonday(now)
    mon.setDate(mon.getDate() - 7)
    const from = DateUtils.toISODateLocal(mon)
    const to = DateUtils.addDaysISO(from, 6)
    setDateFrom(from)
    setDateTo(to)
  }, [])

  // неделя оплаты = понедельник от dateFrom
  const weekStartISO = useMemo(() => {
    if (!dateFrom) return DateUtils.toISODateLocal(DateUtils.getMonday(new Date()))
    return DateUtils.toISODateLocal(DateUtils.getMonday(DateUtils.fromISO(dateFrom)))
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

  const sendToAll = async () => {
    if (broadcastSending) return
    setError(null)
    setBroadcastErrors([])
    setBroadcastDone(0)

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
    return operators.some((o) => o.is_active && !!o.telegram_chat_id)
  }, [loading, broadcastSending, operators])

  const broadcastLabel = useMemo(() => {
    if (!broadcastSending) return 'Отправить всем'
    return `Отправка... ${broadcastDone}/${broadcastTotal}`
  }, [broadcastSending, broadcastDone, broadcastTotal])

  // AI Recommendation
  const aiRecommendation = useMemo(() => {
    if (stats.operators.length === 0) return null
    const avgSalary = stats.totalSalary / (stats.operators.length || 1)
    if (avgSalary > 100000) return 'Высокая средняя зарплата — проверьте бонусные пороги'
    if (totalAutoDebts > stats.totalSalary * 0.2) return 'Много долгов — рекомендуется проверить корректировки'
    return 'Расчет зарплаты в норме. Все операторы учтены.'
  }, [stats, totalAutoDebts])

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-900 to-gray-950 text-foreground">
      <Sidebar />

      {/* Мини-окно для chat_id */}
      {chatEditOperatorId && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-md p-6 border border-gray-700 bg-gray-900/95 shadow-2xl">
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-500/20 rounded-xl">
                  <MessageCircle className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <div className="font-semibold text-white">Telegram chat_id</div>
                  <div className="text-xs text-gray-400">
                    {operatorById[chatEditOperatorId]?.short_name || operatorById[chatEditOperatorId]?.name}
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="h-8 text-gray-400 hover:text-white" onClick={() => setChatEditOperatorId(null)}>
                ✕
              </Button>
            </div>

            <input
              value={chatEditValue}
              onChange={(e) => setChatEditValue(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 outline-none transition-all"
              placeholder="например: 1566833632 или -4935038728"
            />

            <div className="flex gap-3 mt-4 justify-end">
              <Button variant="outline" onClick={() => setChatEditOperatorId(null)} className="h-10 border-gray-700 text-gray-300 hover:bg-gray-800">
                Отмена
              </Button>
              <Button onClick={saveChatId} disabled={chatSaving} className="h-10 bg-gradient-to-r from-emerald-500 to-green-500 text-white">
                {chatSaving ? 'Сохранение...' : 'Сохранить'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
          {/* Хедер */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-900/30 via-gray-900 to-blue-900/30 p-6 border border-emerald-500/20 mb-6">
            <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-600 rounded-full blur-3xl opacity-20 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-600 rounded-full blur-3xl opacity-20 pointer-events-none" />
            
            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <Link href="/income">
                  <Button variant="outline" size="icon" className="rounded-full border-gray-700 bg-gray-800/50 hover:bg-gray-700">
                    <ArrowLeft className="w-5 h-5 text-gray-300" />
                  </Button>
                </Link>
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-emerald-500/20 rounded-xl">
                    <Brain className="w-8 h-8 text-emerald-400" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                      AI Расчет зарплаты
                    </h1>
                    <p className="text-sm text-gray-400">Умный расчет с автоматическими бонусами</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {/* Broadcast Button */}
                <Button
                  onClick={sendToAll}
                  disabled={!canBroadcast}
                  className="h-10 rounded-xl text-sm font-semibold gap-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white border-0 shadow-lg shadow-blue-500/25 disabled:opacity-50"
                  title={!canBroadcast ? 'Нет операторов с chat_id или идет загрузка' : 'Отправить всем активным с chat_id'}
                >
                  {broadcastSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {broadcastLabel}
                </Button>

                {/* Week Buttons */}
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={setLastWeek} className="h-10 border-gray-700 bg-gray-800/50 text-gray-300 hover:bg-gray-700 rounded-xl">
                    <Clock className="w-4 h-4 mr-1" /> Прошлая
                  </Button>
                  <Button size="sm" variant="outline" onClick={setThisWeek} className="h-10 border-gray-700 bg-gray-800/50 text-gray-300 hover:bg-gray-700 rounded-xl">
                    <CalendarDays className="w-4 h-4 mr-1" /> Эта неделя
                  </Button>
                </div>

                {/* Date Picker */}
                <div className="relative">
                  <button
                    onClick={() => setIsDatePickerOpen(!isDatePickerOpen)}
                    className="flex items-center gap-2 px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-xl text-gray-300 hover:border-emerald-500/50 transition-all"
                  >
                    <CalendarDays className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm">{DateUtils.formatDate(dateFrom)} — {DateUtils.formatDate(dateTo)}</span>
                    <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isDatePickerOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {isDatePickerOpen && (
                    <div className="absolute right-0 top-full mt-2 p-4 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-50 min-w-[280px]">
                      <div className="space-y-3">
                        <div>
                          <label className="text-xs text-gray-500 uppercase mb-1 block">От</label>
                          <input
                            type="date"
                            value={dateFrom}
                            onChange={(e) => {
                              setDateFrom(e.target.value)
                              setIsDatePickerOpen(false)
                            }}
                            className="w-full bg-gray-800 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-emerald-500 outline-none"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 uppercase mb-1 block">До</label>
                          <input
                            type="date"
                            value={dateTo}
                            onChange={(e) => {
                              setDateTo(e.target.value)
                              setIsDatePickerOpen(false)
                            }}
                            className="w-full bg-gray-800 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-emerald-500 outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Status Bar */}
            <div className="relative z-10 mt-4 flex flex-wrap items-center gap-4 text-xs text-gray-400">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800/50 rounded-lg border border-gray-700">
                <Target className="w-3.5 h-3.5 text-emerald-400" />
                Неделя оплаты: <span className="text-white font-semibold">{DateUtils.formatDate(weekStartISO, 'full')}</span>
              </div>
              {!loading && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800/50 rounded-lg border border-gray-700">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  Оплачено: <span className="text-emerald-400 font-semibold">{paidCount}/{stats.operators.length}</span>
                </div>
              )}
              {!broadcastSending && broadcastTotal > 0 && (
                <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${broadcastErrors.length > 0 ? 'bg-red-900/20 border-red-500/30 text-red-400' : 'bg-emerald-900/20 border-emerald-500/30 text-emerald-400'}`}>
                  <Send className="w-3.5 h-3.5" />
                  Рассылка: {broadcastDone}/{broadcastTotal}
                </div>
              )}
            </div>
          </div>

          {/* AI Recommendation */}
          {aiRecommendation && (
            <div className="p-4 bg-gradient-to-r from-purple-900/20 to-blue-900/20 border border-purple-500/20 rounded-xl">
              <div className="flex items-start gap-3">
                <Zap className="w-5 h-5 text-purple-400 mt-0.5" />
                <div>
                  <p className="text-xs text-purple-400 font-medium mb-1">AI Анализ</p>
                  <p className="text-sm text-gray-300">{aiRecommendation}</p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl text-sm flex items-center gap-3">
              <AlertTriangle className="w-5 h-5" />
              {error}
            </div>
          )}

          {/* Сводка */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-5 border-0 bg-gray-800/50 backdrop-blur-sm">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-blue-500/20 rounded-lg">
                  <Clock className="w-4 h-4 text-blue-400" />
                </div>
                <p className="text-xs text-gray-500 uppercase">Всего смен</p>
              </div>
              <p className="text-2xl font-bold text-white">{loading ? '—' : totalShifts}</p>
            </Card>
            
            <Card className="p-5 border-0 bg-gray-800/50 backdrop-blur-sm">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-gray-500/20 rounded-lg">
                  <Wallet className="w-4 h-4 text-gray-400" />
                </div>
                <p className="text-xs text-gray-500 uppercase">База (оклад)</p>
              </div>
              <p className="text-2xl font-bold text-white">{loading ? '—' : Formatters.money(totalBase)}</p>
            </Card>
            
            <Card className="p-5 border-0 bg-gray-800/50 backdrop-blur-sm">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-emerald-500/20 rounded-lg">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                </div>
                <p className="text-xs text-gray-500 uppercase">Авто-бонусы</p>
              </div>
              <p className="text-2xl font-bold text-emerald-400">{loading ? '—' : Formatters.money(totalBonus)}</p>
            </Card>
            
            <Card className="p-5 border-0 bg-gradient-to-br from-emerald-900/30 to-blue-900/30 backdrop-blur-sm border border-emerald-500/20">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-emerald-500/20 rounded-lg">
                  <DollarSign className="w-4 h-4 text-emerald-400" />
                </div>
                <p className="text-xs text-emerald-400/70 uppercase">К выплате</p>
              </div>
              <p className="text-2xl font-bold text-emerald-300">{loading ? '—' : Formatters.money(stats.totalSalary)}</p>
              {!loading && totalAutoDebts > 0 && (
                <p className="mt-1 text-[11px] text-red-400">Включая долги: {Formatters.money(totalAutoDebts)}</p>
              )}
            </Card>
          </div>

          {/* Таблица */}
          <Card className="border-0 bg-gray-800/50 backdrop-blur-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1280px] text-xs md:text-sm border-collapse">
                <thead className="sticky top-0 z-10 bg-gray-900/95 backdrop-blur border-b border-gray-700">
                  <tr className="text-[11px] uppercase tracking-wide text-gray-500">
                    <th className="py-4 px-4 text-left font-medium">Оператор</th>
                    <th className="py-4 px-4 text-center font-medium">Смен</th>
                    <th className="py-4 px-4 text-right font-medium">Оклад</th>
                    <th className="py-4 px-4 text-right font-medium">База</th>
                    <th className="py-4 px-4 text-right font-medium text-emerald-400">Бонус</th>
                    <th className="py-4 px-4 text-right font-medium text-red-400">Долги</th>
                    <th className="py-4 px-4 text-right font-medium text-red-400">Штрафы</th>
                    <th className="py-4 px-4 text-right font-medium text-amber-400">Аванс</th>
                    <th className="py-4 px-4 text-right font-medium text-emerald-400">Премия</th>
                    <th className="py-4 px-4 text-right font-medium">К выплате</th>
                    <th className="py-4 px-4 text-center font-medium">Статус</th>
                    <th className="py-4 px-4 text-center font-medium">Telegram</th>
                  </tr>
                </thead>

                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={12} className="py-12 text-center text-gray-400">
                        <div className="flex items-center justify-center gap-2">
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Загрузка данных...
                        </div>
                      </td>
                    </tr>
                  )}

                  {!loading && stats.operators.length === 0 && (
                    <tr>
                      <td colSpan={12} className="py-12 text-center text-gray-400">
                        Нет данных в выбранном периоде
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
                          className="border-t border-gray-700/50 hover:bg-white/[0.03] transition-colors"
                        >
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-3">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold ${isPaid ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-700/50 text-gray-400'}`}>
                                {op.operatorName.charAt(0).toUpperCase()}
                              </div>
                              <span className="font-semibold text-white">{op.operatorName}</span>
                            </div>
                          </td>
                          <td className="py-4 px-4 text-center text-gray-400">{op.shifts}</td>
                          <td className="py-4 px-4 text-right text-gray-300">{Formatters.money(op.basePerShift)}</td>
                          <td className="py-4 px-4 text-right text-white">{Formatters.money(op.baseSalary)}</td>
                          <td className="py-4 px-4 text-right text-emerald-400">{Formatters.money(op.bonusSalary)}</td>
                          <td className="py-4 px-4 text-right text-red-400">{Formatters.money(op.autoDebts)}</td>
                          <td className="py-4 px-4 text-right text-red-400">{Formatters.money(op.manualMinus)}</td>
                          <td className="py-4 px-4 text-right text-amber-400">{Formatters.money(op.advances)}</td>
                          <td className="py-4 px-4 text-right text-emerald-400">{Formatters.money(op.manualPlus)}</td>

                          <td className={`py-4 px-4 text-right font-bold ${isNeg ? 'text-red-400' : 'text-white'}`}>
                            {Formatters.money(op.finalSalary)}
                          </td>

                          <td className="py-4 px-4 text-center">
                            <Button
                              size="sm"
                              onClick={() => togglePaid(op.operatorId)}
                              disabled={payingOperatorId === op.operatorId}
                              className={`h-9 px-4 rounded-xl text-xs font-semibold gap-2 transition-all ${
                                isPaid
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30'
                                  : 'bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30'
                              }`}
                              variant="outline"
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
                              <div className="text-[10px] text-gray-500 mt-1">
                                {new Date(payout.paid_at).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                              </div>
                            )}
                          </td>

                          <td className="py-4 px-4">
                            <div className="flex items-center justify-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-9 px-3 rounded-xl text-xs border-gray-700 text-gray-400 hover:text-white hover:bg-gray-700"
                                onClick={() => openChatEditor(op.operatorId)}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>

                              <Button
                                size="sm"
                                className={`h-9 px-3 rounded-xl text-xs font-semibold gap-1 ${
                                  hasChat
                                    ? 'bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-lg shadow-emerald-500/25'
                                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                }`}
                                disabled={!hasChat || sendingOperatorId === op.operatorId || broadcastSending}
                                onClick={() => sendToTelegram(op.operatorId)}
                                title={!hasChat ? 'Сначала добавьте telegram_chat_id' : 'Отправить расчёт в Telegram'}
                              >
                                {sendingOperatorId === op.operatorId ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Send className="w-3.5 h-3.5" />
                                )}
                              </Button>
                            </div>

                            <div className="text-[10px] text-center mt-1">
                              {hasChat ? (
                                <span className="inline-flex items-center gap-1 text-emerald-400">
                                  <MessageCircle className="w-3 h-3" />
                                  {opMeta.telegram_chat_id}
                                </span>
                              ) : (
                                <span className="text-red-400">нет chat_id</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}

                  {!loading && stats.operators.length > 0 && (
                    <tr className="border-t border-gray-700 bg-gray-800/30">
                      <td className="py-4 px-4 font-bold text-white" colSpan={2}>Итого:</td>
                      <td className="py-4 px-4 text-right font-bold text-gray-400">—</td>
                      <td className="py-4 px-4 text-right font-bold text-white">{Formatters.money(totalBase)}</td>
                      <td className="py-4 px-4 text-right font-bold text-emerald-400">{Formatters.money(totalBonus)}</td>
                      <td className="py-4 px-4 text-right font-bold text-red-400">{Formatters.money(totalAutoDebts)}</td>
                      <td className="py-4 px-4 text-right font-bold text-red-400">{Formatters.money(totalMinus)}</td>
                      <td className="py-4 px-4 text-right font-bold text-amber-400">{Formatters.money(totalAdvances)}</td>
                      <td className="py-4 px-4 text-right font-bold text-emerald-400">{Formatters.money(totalPlus)}</td>
                      <td className="py-4 px-4 text-right font-bold text-emerald-300">{Formatters.money(stats.totalSalary)}</td>
                      <td className="py-4 px-4 text-center text-xs text-gray-500">
                        {paidCount}/{stats.operators.length}
                      </td>
                      <td className="py-4 px-4 text-center text-xs text-gray-500">—</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Форма корректировок */}
          {operatorOptions.length > 0 && (
            <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-orange-500/20 rounded-xl">
                  <Sparkles className="w-5 h-5 text-orange-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Корректировки</h3>
                  <p className="text-xs text-gray-400">Добавьте долг, штраф, премию или аванс</p>
                </div>
              </div>

              <form onSubmit={handleAddAdjustment} className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
                <div className="md:col-span-1">
                  <label className="text-xs text-gray-500 uppercase mb-2 block">Оператор</label>
                  <select
                    value={adjOperatorId}
                    onChange={(e) => setAdjOperatorId(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition-all"
                  >
                    <option value="">Выберите...</option>
                    {operatorOptions.map((op) => (
                      <option key={op.id} value={op.id}>
                        {op.short_name || op.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-1">
                  <label className="text-xs text-gray-500 uppercase mb-2 block">Дата</label>
                  <input
                    type="date"
                    value={adjDate}
                    onChange={(e) => setAdjDate(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition-all"
                  />
                </div>

                <div className="md:col-span-1">
                  <label className="text-xs text-gray-500 uppercase mb-2 block">Тип</label>
                  <select
                    value={adjKind}
                    onChange={(e) => setAdjKind(e.target.value as AdjustmentKind)}
                    className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition-all"
                  >
                    <option value="debt">Долг (минус)</option>
                    <option value="fine">Штраф (минус)</option>
                    <option value="advance">Аванс (минус)</option>
                    <option value="bonus">Премия (плюс)</option>
                  </select>
                </div>

                <div className="md:col-span-1">
                  <label className="text-xs text-gray-500 uppercase mb-2 block">Сумма</label>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      value={adjAmount}
                      onChange={(e) => setAdjAmount(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition-all"
                      placeholder="0"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs">₸</span>
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="text-xs text-gray-500 uppercase mb-2 block">Комментарий</label>
                  <div className="flex gap-2">
                    <input
                      value={adjComment}
                      onChange={(e) => setAdjComment(e.target.value)}
                      className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 outline-none transition-all"
                      placeholder="Например: аванс за оборудование..."
                    />
                    <Button 
                      type="submit" 
                      disabled={adjSaving} 
                      className="h-10 px-4 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-medium"
                    >
                      {adjSaving ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </form>

              {/* Quick Amounts */}
              <div className="flex flex-wrap gap-2 mt-4">
                {[5000, 10000, 20000, 50000].map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => setAdjAmount(String((parseInt(adjAmount) || 0) + amount))}
                    className="px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-900 text-xs text-gray-400 hover:border-orange-500/50 hover:text-orange-400 transition-colors"
                  >
                    <Plus className="w-3 h-3 inline mr-1" /> {Formatters.moneyDetailed(amount)}
                  </button>
                ))}
              </div>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}
