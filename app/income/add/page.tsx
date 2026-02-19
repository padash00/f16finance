'use client'

import { useEffect, useMemo, useState, FormEvent, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Calendar,
  Wallet,
  CreditCard,
  Gamepad2,
  Eye,
  Sun,
  Moon,
  Store,
  Building2,
  Save,
  UserCircle2,
  Smartphone,
  Brain,
  Sparkles,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  Zap,
} from 'lucide-react'

import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'

type Company = {
  id: string
  name: string
  code: string
}

type Operator = {
  id: string
  name: string
  short_name: string | null
  is_active: boolean
}

type ShiftType = 'day' | 'night'
type ZoneType = 'pc' | 'ps5' | 'vr' | 'ramen' | 'other'

// --- даты без UTC-сдвига ---
const toISODateLocal = (d: Date) => {
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}
const getTodayISO = () => toISODateLocal(new Date())

const parseAmount = (v: string) => {
  if (!v) return 0
  const n = Number(v.replace(',', '.').replace(/\s/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}

const formatMoney = (v: number) => v.toLocaleString('ru-RU') + ' ₸'

export default function AddIncomePage() {
  const router = useRouter()

  const [date, setDate] = useState(getTodayISO())

  const [companies, setCompanies] = useState<Company[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [companyId, setCompanyId] = useState('')
  const [operatorId, setOperatorId] = useState('')

  const [loadingMeta, setLoadingMeta] = useState(true)
  const [shift, setShift] = useState<ShiftType>('day')

  // Обычные компании
  const [cash, setCash] = useState('')
  const [kaspi, setKaspi] = useState('')
  const [online, setOnline] = useState('')
  const [card, setCard] = useState('')

  // Extra: PS5 и VR отдельно
  const [ps5Cash, setPs5Cash] = useState('')
  const [ps5Kaspi, setPs5Kaspi] = useState('')
  const [vrCash, setVrCash] = useState('')
  const [vrKaspi, setVrKaspi] = useState('')

  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSuccess, setShowSuccess] = useState(false)

  // ---- загрузка справочников ----
  useEffect(() => {
    const load = async () => {
      setLoadingMeta(true)
      setError(null)

      const [compRes, opRes] = await Promise.all([
        supabase.from('companies').select('id, name, code').order('name'),
        supabase.from('operators').select('id, name, short_name, is_active').eq('is_active', true).order('name'),
      ])

      if (compRes.error || opRes.error) {
        setError('Не удалось загрузить компании/операторов')
        setCompanies(compRes.data || [])
        setOperators(opRes.data || [])
      } else {
        setCompanies(compRes.data || [])
        setOperators(opRes.data || [])
        if (compRes.data?.length) setCompanyId(compRes.data[0].id)
      }

      setLoadingMeta(false)
    }

    load()
  }, [])

  const selectedCompany = useMemo(() => companies.find((c) => c.id === companyId) || null, [companies, companyId])

  const isExtra = selectedCompany?.code === 'extra'
  const isArena = selectedCompany?.code === 'arena'
  const isRamen = selectedCompany?.code === 'ramen'
  const showOnline = isArena

  const getZone = useCallback((): ZoneType => {
    if (isArena) return 'pc'
    if (isRamen) return 'ramen'
    return 'other'
  }, [isArena, isRamen])

  // ---- умный сброс полей при смене компании ----
  useEffect(() => {
    setError(null)
    setCash('')
    setKaspi('')
    setCard('')
    setOnline('')
    setPs5Cash('')
    setPs5Kaspi('')
    setVrCash('')
    setVrKaspi('')
  }, [companyId])

  // ---- расчет предварительной суммы ----
  const previewTotal = useMemo(() => {
    if (isExtra) {
      return parseAmount(ps5Cash) + parseAmount(ps5Kaspi) + parseAmount(vrCash) + parseAmount(vrKaspi)
    }
    return parseAmount(cash) + parseAmount(kaspi) + parseAmount(online) + parseAmount(card)
  }, [isExtra, ps5Cash, ps5Kaspi, vrCash, vrKaspi, cash, kaspi, online, card])

  // ---- валидация ----
  const validation = useMemo(() => {
    if (!companyId) return { ok: false, msg: 'Выберите компанию' }
    if (!operatorId) return { ok: false, msg: 'Выберите оператора смены' }
    if (!date) return { ok: false, msg: 'Выберите дату' }
    if (!operators.length) return { ok: false, msg: 'Нет активных операторов' }

    if (isExtra) {
      const ps5Total = parseAmount(ps5Cash) + parseAmount(ps5Kaspi)
      const vrTotal = parseAmount(vrCash) + parseAmount(vrKaspi)
      if (ps5Total <= 0 && vrTotal <= 0) return { ok: false, msg: 'Укажите сумму для PS5 или VR' }
      return { ok: true, msg: '' }
    }

    const c = parseAmount(cash)
    const k = parseAmount(kaspi)
    const o = showOnline ? parseAmount(online) : 0
    const cd = parseAmount(card)
    if (c <= 0 && k <= 0 && o <= 0 && cd <= 0) return { ok: false, msg: 'Введите сумму дохода' }

    return { ok: true, msg: '' }
  }, [companyId, operatorId, date, operators.length, isExtra, ps5Cash, ps5Kaspi, vrCash, vrKaspi, cash, kaspi, online, card, showOnline])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return

    setError(null)
    setSaving(true)

    try {
      if (!validation.ok) throw new Error(validation.msg)

      if (isExtra) {
        const pCash = parseAmount(ps5Cash)
        const pKaspi = parseAmount(ps5Kaspi)
        const vCash = parseAmount(vrCash)
        const vKaspi = parseAmount(vrKaspi)

        const rows: any[] = []
        const baseComment = comment.trim()

        if (pCash + pKaspi > 0) {
          rows.push({
            date,
            company_id: companyId,
            operator_id: operatorId,
            shift,
            zone: 'ps5',
            cash_amount: pCash,
            kaspi_amount: pKaspi,
            online_amount: 0,
            card_amount: 0,
            comment: baseComment ? `${baseComment} • PS5` : 'PS5',
            is_virtual: true,
          })
        }

        if (vCash + vKaspi > 0) {
          rows.push({
            date,
            company_id: companyId,
            operator_id: operatorId,
            shift,
            zone: 'vr',
            cash_amount: vCash,
            kaspi_amount: vKaspi,
            online_amount: 0,
            card_amount: 0,
            comment: baseComment ? `${baseComment} • VR` : 'VR',
            is_virtual: true,
          })
        }

        const { error } = await supabase.from('incomes').insert(rows)
        if (error) throw error
      } else {
        const { error } = await supabase.from('incomes').insert([
          {
            date,
            company_id: companyId,
            operator_id: operatorId,
            shift,
            zone: getZone(),
            cash_amount: parseAmount(cash),
            kaspi_amount: parseAmount(kaspi),
            online_amount: showOnline ? parseAmount(online) : 0,
            card_amount: parseAmount(card),
            comment: comment.trim() || null,
            is_virtual: false,
          },
        ])
        if (error) throw error
      }

      setShowSuccess(true)
      setTimeout(() => router.push('/income'), 800)
    } catch (err: any) {
      setError(err?.message || 'Ошибка при сохранении')
      setSaving(false)
    }
  }

  const CompanyCard = ({ c }: { c: Company }) => {
    const active = c.id === companyId
    let Icon = Building2
    let color = 'from-gray-500 to-gray-600'
    
    if (c.code === 'extra') {
      Icon = Gamepad2
      color = 'from-purple-500 to-pink-500'
    } else if (c.code === 'ramen') {
      Icon = Store
      color = 'from-orange-500 to-red-500'
    } else if (c.code === 'arena') {
      Icon = Eye
      color = 'from-blue-500 to-cyan-500'
    }

    return (
      <div
        onClick={() => setCompanyId(c.id)}
        className={`relative cursor-pointer rounded-xl border p-4 flex flex-col items-center justify-center gap-3 transition-all duration-300 ${
          active
            ? `bg-gradient-to-br ${color} border-transparent text-white shadow-lg shadow-purple-500/25 scale-105`
            : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:bg-gray-700/50 hover:border-gray-600'
        }`}
      >
        <div className={`p-3 rounded-xl ${active ? 'bg-white/20' : 'bg-gray-700/50'}`}>
          <Icon className={`w-6 h-6 ${active ? 'text-white' : ''}`} />
        </div>
        <span className="text-xs font-semibold text-center">{c.name}</span>
        {active && (
          <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center shadow-lg">
            <CheckCircle2 className="w-4 h-4 text-white" />
          </div>
        )}
      </div>
    )
  }

  if (showSuccess) {
    return (
      <div className="flex min-h-screen bg-gradient-to-br from-gray-900 to-gray-950">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="relative mb-6">
              <div className="w-24 h-24 bg-green-500/20 rounded-full flex items-center justify-center mx-auto animate-pulse">
                <CheckCircle2 className="w-12 h-12 text-green-400" />
              </div>
              <Sparkles className="w-6 h-6 text-yellow-400 absolute top-0 right-1/3 animate-bounce" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Успешно сохранено!</h2>
            <p className="text-gray-400">Перенаправляем в журнал доходов...</p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-900 to-gray-950 text-foreground">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-8 max-w-4xl mx-auto">
          {/* Хедер */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-purple-900/30 via-gray-900 to-blue-900/30 p-6 border border-purple-500/20 mb-6">
            <div className="absolute top-0 right-0 w-64 h-64 bg-purple-600 rounded-full blur-3xl opacity-20 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-blue-600 rounded-full blur-3xl opacity-20 pointer-events-none" />
            
            <div className="relative z-10 flex items-center gap-4">
              <Link href="/income">
                <Button variant="outline" size="icon" className="rounded-full border-gray-700 bg-gray-800/50 hover:bg-gray-700">
                  <ArrowLeft className="w-5 h-5 text-gray-300" />
                </Button>
              </Link>
              <div className="flex items-center gap-3">
                <div className="p-3 bg-purple-500/20 rounded-xl">
                  <Brain className="w-8 h-8 text-purple-400" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                    Новая запись дохода
                  </h1>
                  <p className="text-sm text-gray-400">AI-помощник внесения выручки</p>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 text-red-400 rounded-xl text-sm flex items-center gap-3">
              <AlertCircle className="w-5 h-5" />
              {error}
            </div>
          )}

          {!error && !validation.ok && (
            <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 rounded-xl text-sm flex items-center gap-3">
              <Zap className="w-5 h-5" />
              {validation.msg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 1. Настройки смены */}
            <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-blue-500/20 rounded-xl">
                  <Calendar className="w-5 h-5 text-blue-400" />
                </div>
                <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Настройки смены</h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <label className="text-xs text-gray-500 uppercase mb-2 block">Дата</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-purple-400" />
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full bg-gray-900 border border-gray-700 rounded-xl py-3 pl-10 pr-4 text-white focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-500 uppercase mb-2 block">Смена</label>
                  <div className="grid grid-cols-2 bg-gray-900 p-1 rounded-xl border border-gray-700">
                    <button
                      type="button"
                      onClick={() => setShift('day')}
                      className={`flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-medium transition-all ${
                        shift === 'day' 
                          ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg' 
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      <Sun className="w-4 h-4" /> День
                    </button>
                    <button
                      type="button"
                      onClick={() => setShift('night')}
                      className={`flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-medium transition-all ${
                        shift === 'night' 
                          ? 'bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-lg' 
                          : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      <Moon className="w-4 h-4" /> Ночь
                    </button>
                  </div>
                </div>
              </div>

              {/* Компания */}
              <div className="mt-6">
                <label className="text-xs text-gray-500 uppercase mb-3 block">Точка (Компания)</label>
                {loadingMeta ? (
                  <div className="text-sm text-gray-400 animate-pulse">Загрузка списка...</div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {companies.map((c) => (
                      <CompanyCard key={c.id} c={c} />
                    ))}
                  </div>
                )}
              </div>

              {/* Оператор */}
              <div className="mt-6">
                <label className="text-xs text-gray-500 uppercase mb-3 block">Оператор смены</label>
                {loadingMeta ? (
                  <div className="text-xs text-gray-400">Загрузка операторов...</div>
                ) : operators.length === 0 ? (
                  <p className="text-xs text-yellow-500">Операторов нет. Добавьте их в разделе «Операторы».</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {operators.map((op) => {
                      const active = op.id === operatorId
                      return (
                        <button
                          key={op.id}
                          type="button"
                          onClick={() => setOperatorId(op.id)}
                          className={`px-4 py-2.5 rounded-xl text-sm font-medium border flex items-center gap-2 transition-all ${
                            active
                              ? 'bg-gradient-to-r from-emerald-500 to-green-500 text-white border-transparent shadow-lg shadow-green-500/25'
                              : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-white'
                          }`}
                        >
                          <UserCircle2 className="w-4 h-4" />
                          {op.short_name || op.name}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </Card>

            {/* 2. Суммы */}
            <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm relative overflow-hidden">
              <div className="absolute -right-20 -top-20 opacity-[0.03] pointer-events-none">
                {isExtra ? <Gamepad2 className="w-64 h-64" /> : <Wallet className="w-64 h-64" />}
              </div>

              <div className="flex items-center gap-3 mb-6">
                <div className={`p-2 rounded-xl ${isExtra ? 'bg-pink-500/20' : 'bg-green-500/20'}`}>
                  {isExtra ? <Gamepad2 className="w-5 h-5 text-pink-400" /> : <Wallet className="w-5 h-5 text-green-400" />}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white uppercase tracking-wider">
                    {isExtra ? 'Выручка по зонам (Extra)' : 'Суммы выручки'}
                  </h3>
                  {previewTotal > 0 && (
                    <p className="text-xs text-gray-400 mt-1">
                      Предварительная сумма: <span className="text-purple-400 font-bold">{formatMoney(previewTotal)}</span>
                    </p>
                  )}
                </div>
              </div>

              {isExtra ? (
                <div className="space-y-6">
                  {/* PS5 */}
                  <div className="rounded-2xl border border-purple-500/20 bg-gradient-to-br from-purple-900/20 to-gray-900/50 p-5">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-purple-500/20 rounded-xl">
                        <Gamepad2 className="w-5 h-5 text-purple-400" />
                      </div>
                      <span className="font-semibold text-white">PlayStation 5</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs text-gray-400 flex items-center gap-2">
                          <Wallet className="w-4 h-4 text-amber-400" /> Наличные
                        </label>
                        <div className="relative">
                          <input
                            inputMode="numeric"
                            type="number"
                            placeholder="0"
                            min="0"
                            value={ps5Cash}
                            onChange={(e) => setPs5Cash(e.target.value)}
                            className="w-full text-lg bg-gray-900 border border-gray-700 rounded-xl py-4 px-4 text-white focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none transition-all"
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">₸</span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs text-gray-400 flex items-center gap-2">
                          <CreditCard className="w-4 h-4 text-blue-400" /> Kaspi QR / POS
                        </label>
                        <div className="relative">
                          <input
                            inputMode="numeric"
                            type="number"
                            placeholder="0"
                            min="0"
                            value={ps5Kaspi}
                            onChange={(e) => setPs5Kaspi(e.target.value)}
                            className="w-full text-lg bg-gray-900 border border-gray-700 rounded-xl py-4 px-4 text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">₸</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* VR */}
                  <div className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-cyan-900/20 to-gray-900/50 p-5">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-cyan-500/20 rounded-xl">
                        <Eye className="w-5 h-5 text-cyan-400" />
                      </div>
                      <span className="font-semibold text-white">VR Зона</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs text-gray-400 flex items-center gap-2">
                          <Wallet className="w-4 h-4 text-amber-400" /> Наличные
                        </label>
                        <div className="relative">
                          <input
                            inputMode="numeric"
                            type="number"
                            placeholder="0"
                            min="0"
                            value={vrCash}
                            onChange={(e) => setVrCash(e.target.value)}
                            className="w-full text-lg bg-gray-900 border border-gray-700 rounded-xl py-4 px-4 text-white focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none transition-all"
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">₸</span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs text-gray-400 flex items-center gap-2">
                          <CreditCard className="w-4 h-4 text-blue-400" /> Kaspi QR / POS
                        </label>
                        <div className="relative">
                          <input
                            inputMode="numeric"
                            type="number"
                            placeholder="0"
                            min="0"
                            value={vrKaspi}
                            onChange={(e) => setVrKaspi(e.target.value)}
                            className="w-full text-lg bg-gray-900 border border-gray-700 rounded-xl py-4 px-4 text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                          />
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">₸</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs text-gray-400 flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-amber-400" /> Наличные (Cash)
                    </label>
                    <div className="relative">
                      <input
                        inputMode="numeric"
                        type="number"
                        placeholder="0"
                        min="0"
                        value={cash}
                        onChange={(e) => setCash(e.target.value)}
                        className="w-full text-lg bg-gray-900 border border-gray-700 rounded-xl py-4 px-4 text-white focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none transition-all"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">₸</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs text-gray-400 flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-blue-400" /> Kaspi POS / переводы
                    </label>
                    <div className="relative">
                      <input
                        inputMode="numeric"
                        type="number"
                        placeholder="0"
                        min="0"
                        value={kaspi}
                        onChange={(e) => setKaspi(e.target.value)}
                        className="w-full text-lg bg-gray-900 border border-gray-700 rounded-xl py-4 px-4 text-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">₸</span>
                    </div>
                  </div>

                  {showOnline && (
                    <div className="sm:col-span-2 space-y-2">
                      <label className="text-xs text-gray-400 flex items-center gap-2">
                        <Smartphone className="w-4 h-4 text-pink-400" /> Kaspi Online (Senet)
                      </label>
                      <div className="relative">
                        <input
                          inputMode="numeric"
                          type="number"
                          placeholder="0"
                          min="0"
                          value={online}
                          onChange={(e) => setOnline(e.target.value)}
                          className="w-full text-lg bg-gray-900 border border-gray-700 rounded-xl py-4 px-4 text-white focus:border-pink-500 focus:ring-2 focus:ring-pink-500/20 outline-none transition-all"
                        />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">₸</span>
                      </div>
                    </div>
                  )}

                  <div className="sm:col-span-2 space-y-2">
                    <label className="text-xs text-gray-400 flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-purple-400" /> Карта (если используется)
                    </label>
                    <div className="relative">
                      <input
                        inputMode="numeric"
                        type="number"
                        placeholder="0"
                        min="0"
                        value={card}
                        onChange={(e) => setCard(e.target.value)}
                        className="w-full bg-gray-900 border border-gray-700 rounded-xl py-3 px-4 text-white focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none transition-all"
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 text-sm">₸</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Комментарий */}
              <div className="mt-6 space-y-2">
                <label className="text-xs text-gray-500 uppercase">Комментарий (необязательно)</label>
                <textarea
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-xl py-3 px-4 text-white focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20 outline-none transition-all resize-none"
                  placeholder="Например: предоплата за бронь, акция, скидка..."
                />
              </div>
            </Card>

            {/* Итоговая карточка */}
            {previewTotal > 0 && (
              <Card className="p-6 border-0 bg-gradient-to-br from-purple-900/30 via-gray-900 to-blue-900/30 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-purple-500/20 rounded-xl">
                      <TrendingUp className="w-6 h-6 text-purple-400" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">Итого к сохранению</p>
                      <p className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
                        {formatMoney(previewTotal)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500">{isExtra ? '2 записи (PS5 + VR)' : '1 запись'}</p>
                    <p className="text-xs text-gray-400">{date} • {shift === 'day' ? 'День' : 'Ночь'}</p>
                  </div>
                </div>
              </Card>
            )}

            {/* Кнопки */}
            <div className="flex gap-4 pt-4">
              <Link href="/income" className="flex-1">
                <Button 
                  type="button" 
                  variant="outline" 
                  className="w-full h-14 border-gray-700 bg-gray-800/50 hover:bg-gray-700 text-gray-300 rounded-xl"
                >
                  Отмена
                </Button>
              </Link>

              <Button
                type="submit"
                disabled={saving || !validation.ok}
                className="flex-[2] h-14 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-base font-semibold rounded-xl shadow-lg shadow-purple-500/25 disabled:opacity-50"
              >
                {saving ? (
                  <span className="flex items-center gap-2">
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Сохранение...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Save className="w-5 h-5" /> 
                    Сохранить доход
                    {previewTotal > 0 && ` (${formatMoney(previewTotal)})`}
                  </span>
                )}
              </Button>
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
