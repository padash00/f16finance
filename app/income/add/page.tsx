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
  const [card, setCard] = useState('')

  // Extra: PS5 и VR отдельно по НАЛ и KASPI
  const [ps5Cash, setPs5Cash] = useState('')
  const [ps5Kaspi, setPs5Kaspi] = useState('')
  const [vrCash, setVrCash] = useState('')
  const [vrKaspi, setVrKaspi] = useState('')

  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ---- загрузка справочников ----
  useEffect(() => {
    const load = async () => {
      setLoadingMeta(true)
      setError(null)

      const [compRes, opRes] = await Promise.all([
        supabase.from('companies').select('id, name, code').order('name'),
        supabase
          .from('operators')
          .select('id, name, short_name, is_active')
          .eq('is_active', true)
          .order('name'),
      ])

      if (compRes.error || opRes.error) {
        console.error('Income add load error', {
          compErr: compRes.error,
          opErr: opRes.error,
        })
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

  const selectedCompany = useMemo(
    () => companies.find((c) => c.id === companyId) || null,
    [companies, companyId],
  )

  const isExtra = selectedCompany?.code === 'extra'
  const isArena = selectedCompany?.code === 'arena'
  const isRamen = selectedCompany?.code === 'ramen'

  const getZone = useCallback((): ZoneType => {
    if (isArena) return 'pc'
    if (isRamen) return 'ramen'
    return 'other'
  }, [isArena, isRamen])

  // ---- умный сброс полей при смене компании ----
  useEffect(() => {
    setError(null)
    setComment((v) => v)

    setCash('')
    setKaspi('')
    setCard('')

    setPs5Cash('')
    setPs5Kaspi('')
    setVrCash('')
    setVrKaspi('')
  }, [companyId])

  // ---- валидация ----
  const validation = useMemo(() => {
    if (!companyId) return { ok: false, msg: 'Выберите компанию' }
    if (!operatorId) return { ok: false, msg: 'Выберите оператора смены' }
    if (!date) return { ok: false, msg: 'Выберите дату' }
    if (!operators.length) return { ok: false, msg: 'Нет активных операторов' }

    if (isExtra) {
      const ps5Total = parseAmount(ps5Cash) + parseAmount(ps5Kaspi)
      const vrTotal = parseAmount(vrCash) + parseAmount(vrKaspi)
      if (ps5Total <= 0 && vrTotal <= 0) return { ok: false, msg: 'Укажите сумму (Нал или Kaspi) для PS5 или VR' }
      return { ok: true, msg: '' }
    }

    const c = parseAmount(cash)
    const k = parseAmount(kaspi)
    const cd = parseAmount(card)
    if (c <= 0 && k <= 0 && cd <= 0) return { ok: false, msg: 'Введите сумму дохода' }

    return { ok: true, msg: '' }
  }, [companyId, operatorId, date, operators.length, isExtra, ps5Cash, ps5Kaspi, vrCash, vrKaspi, cash, kaspi, card])

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
            card_amount: parseAmount(card),
            comment: comment.trim() || null,
            is_virtual: false,
          },
        ])
        if (error) throw error
      }

      router.push('/income')
    } catch (err: any) {
      console.error(err)
      setError(err?.message || 'Ошибка при сохранении')
      setSaving(false)
    }
  }

  const CompanyCard = ({ c }: { c: Company }) => {
    const active = c.id === companyId
    let Icon = Building2
    if (c.code === 'extra') Icon = Gamepad2
    else if (c.code === 'ramen') Icon = Store

    return (
      <div
        onClick={() => setCompanyId(c.id)}
        className={`relative cursor-pointer rounded-xl border p-4 flex flex-col items-center justify-center gap-2 transition-all duration-200 ${
          active
            ? 'bg-accent/20 border-accent text-white shadow-[0_0_15px_rgba(168,85,247,0.3)]'
            : 'bg-card/50 border-border/50 text-muted-foreground hover:bg-white/5'
        }`}
      >
        <Icon className={`w-6 h-6 ${active ? 'text-accent' : ''}`} />
        <span className="text-xs font-bold text-center">{c.name}</span>
        {active && <div className="absolute top-2 right-2 w-2 h-2 bg-accent rounded-full animate-pulse" />}
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-8 max-w-3xl mx-auto">
          {/* Хедер */}
          <div className="flex items-center gap-4 mb-6">
            <Link href="/income">
              <Button variant="ghost" size="icon" className="rounded-full">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Новая запись</h1>
              <p className="text-xs text-muted-foreground">Внесение выручки в кассу</p>
            </div>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg text-sm flex items-center gap-2">
              <span className="text-lg">⚠️</span> {error}
            </div>
          )}

          {!error && !validation.ok && (
            <div className="mb-6 p-4 bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 rounded-lg text-sm flex items-center gap-2">
              <span className="text-lg">⚠️</span> {validation.msg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 1. Настройки смены */}
            <Card className="p-5 border-border bg-card neon-glow space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Настройки смены
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="relative">
                  <label className="text-xs text-muted-foreground mb-1.5 block ml-1">Дата</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      className="w-full bg-input border border-border rounded-lg py-2.5 pl-10 pr-4 text-sm focus:border-accent transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block ml-1">Смена</label>
                  <div className="grid grid-cols-2 bg-input/50 p-1 rounded-lg border border-border">
                    <button
                      type="button"
                      onClick={() => setShift('day')}
                      className={`flex items-center justify-center gap-2 py-1.5 rounded-md text-sm transition-all ${
                        shift === 'day'
                          ? 'bg-yellow-500/20 text-yellow-400 shadow-sm'
                          : 'text-muted-foreground hover:text-white'
                      }`}
                    >
                      <Sun className="w-4 h-4" /> День
                    </button>
                    <button
                      type="button"
                      onClick={() => setShift('night')}
                      className={`flex items-center justify-center gap-2 py-1.5 rounded-md text-sm transition-all ${
                        shift === 'night'
                          ? 'bg-blue-500/20 text-blue-400 shadow-sm'
                          : 'text-muted-foreground hover:text-white'
                      }`}
                    >
                      <Moon className="w-4 h-4" /> Ночь
                    </button>
                  </div>
                </div>
              </div>

              {/* Компания */}
              <div>
                <label className="text-xs text-muted-foreground mb-2 block ml-1">Точка (Компания)</label>
                {loadingMeta ? (
                  <div className="text-sm text-muted-foreground animate-pulse">Загрузка списка...</div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {companies.map((c) => (
                      <CompanyCard key={c.id} c={c} />
                    ))}
                  </div>
                )}
              </div>

              {/* Оператор */}
              <div>
                <label className="text-xs text-muted-foreground mb-2 block ml-1">Оператор смены</label>
                {loadingMeta ? (
                  <div className="text-xs text-muted-foreground">Загрузка операторов...</div>
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
                          className={`px-3 py-1.5 rounded-full text-[11px] font-medium border flex items-center gap-1 transition-all ${
                            active
                              ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.35)]'
                              : 'bg-input/30 border-border/50 text-muted-foreground hover:bg-white/5 hover:text-foreground'
                          }`}
                        >
                          <UserCircle2 className="w-3 h-3" />
                          {op.short_name || op.name}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </Card>

            {/* 2. Суммы */}
            <Card className="p-5 border-border bg-card neon-glow relative overflow-hidden">
              <div className="absolute -right-6 -top-6 opacity-[0.03] pointer-events-none">
                {isExtra ? <Gamepad2 className="w-48 h-48" /> : <Wallet className="w-48 h-48" />}
              </div>

              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                {isExtra ? 'Выручка по зонам (Extra)' : 'Суммы выручки'}
              </h3>

              {isExtra ? (
                <div className="space-y-6">
                  {/* PS5 */}
                  <div className="rounded-xl border border-border/60 bg-background/20 p-4">
                    <div className="flex items-center gap-2 mb-3 text-xs text-foreground">
                      <Gamepad2 className="w-4 h-4 text-purple-500" />
                      <span className="font-semibold">PlayStation 5</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs text-foreground mb-1.5 flex items-center gap-2">
                          <Wallet className="w-4 h-4 text-green-500" /> Наличные
                        </label>
                        <input
                          inputMode="numeric"
                          type="number"
                          placeholder="0"
                          min="0"
                          value={ps5Cash}
                          onChange={(e) => setPs5Cash(e.target.value)}
                          className="w-full text-lg bg-input border border-border rounded-lg py-3 px-4 focus:border-green-500 focus:ring-1 focus:ring-green-500/50 transition-all"
                        />
                      </div>

                      <div>
                        <label className="text-xs text-foreground mb-1.5 flex items-center gap-2">
                          <CreditCard className="w-4 h-4 text-red-500" /> Kaspi QR
                        </label>
                        <input
                          inputMode="numeric"
                          type="number"
                          placeholder="0"
                          min="0"
                          value={ps5Kaspi}
                          onChange={(e) => setPs5Kaspi(e.target.value)}
                          className="w-full text-lg bg-input border border-border rounded-lg py-3 px-4 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 transition-all"
                        />
                      </div>
                    </div>
                  </div>

                  {/* VR */}
                  <div className="rounded-xl border border-border/60 bg-background/20 p-4">
                    <div className="flex items-center gap-2 mb-3 text-xs text-foreground">
                      <Eye className="w-4 h-4 text-cyan-500" />
                      <span className="font-semibold">VR Зона</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs text-foreground mb-1.5 flex items-center gap-2">
                          <Wallet className="w-4 h-4 text-green-500" /> Наличные
                        </label>
                        <input
                          inputMode="numeric"
                          type="number"
                          placeholder="0"
                          min="0"
                          value={vrCash}
                          onChange={(e) => setVrCash(e.target.value)}
                          className="w-full text-lg bg-input border border-border rounded-lg py-3 px-4 focus:border-green-500 focus:ring-1 focus:ring-green-500/50 transition-all"
                        />
                      </div>

                      <div>
                        <label className="text-xs text-foreground mb-1.5 flex items-center gap-2">
                          <CreditCard className="w-4 h-4 text-red-500" /> Kaspi QR
                        </label>
                        <input
                          inputMode="numeric"
                          type="number"
                          placeholder="0"
                          min="0"
                          value={vrKaspi}
                          onChange={(e) => setVrKaspi(e.target.value)}
                          className="w-full text-lg bg-input border border-border rounded-lg py-3 px-4 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 transition-all"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <label className="text-xs text-foreground mb-1.5 flex items-center gap-2">
                      <Wallet className="w-4 h-4 text-green-500" /> Наличные (Cash)
                    </label>
                    <input
                      inputMode="numeric"
                      type="number"
                      placeholder="0"
                      min="0"
                      value={cash}
                      onChange={(e) => setCash(e.target.value)}
                      className="w-full text-lg bg-input border border-border rounded-lg py-3 px-4 focus:border-green-500 focus:ring-1 focus:ring-green-500/50 transition-all"
                    />
                  </div>

                  <div>
                    <label className="text-xs text-foreground mb-1.5 flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-red-500" /> Kaspi QR
                    </label>
                    <input
                      inputMode="numeric"
                      type="number"
                      placeholder="0"
                      min="0"
                      value={kaspi}
                      onChange={(e) => setKaspi(e.target.value)}
                      className="w-full text-lg bg-input border border-border rounded-lg py-3 px-4 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 transition-all"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="text-xs text-muted-foreground mb-1.5 block">
                      Карта (если используете) — можно оставить 0
                    </label>
                    <input
                      inputMode="numeric"
                      type="number"
                      placeholder="0"
                      min="0"
                      value={card}
                      onChange={(e) => setCard(e.target.value)}
                      className="w-full bg-input border border-border rounded-lg py-2.5 px-4 text-sm focus:border-accent transition-colors"
                    />
                  </div>
                </div>
              )}

              <div className="mt-6">
                <label className="text-xs text-muted-foreground mb-1.5 block">Комментарий (необязательно)</label>
                <textarea
                  rows={2}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  className="w-full bg-input border border-border rounded-lg py-2 px-3 text-sm focus:border-accent transition-colors resize-none"
                  placeholder="Например: предоплата за бронь..."
                />
              </div>
            </Card>

            {/* Кнопки */}
            <div className="flex gap-4 pt-2">
              <Link href="/income" className="flex-1">
                <Button type="button" variant="outline" className="w-full h-12 border-border hover:bg-white/5">
                  Отмена
                </Button>
              </Link>

              <Button
                type="submit"
                disabled={saving || !validation.ok}
                className="flex-[2] h-12 bg-accent text-accent-foreground hover:bg-accent/90 text-base font-medium shadow-[0_0_20px_rgba(168,85,247,0.4)] disabled:opacity-60"
                title={!validation.ok ? validation.msg : ''}
              >
                {saving ? (
                  'Сохранение...'
                ) : (
                  <span className="flex items-center gap-2">
                    <Save className="w-4 h-4" /> Сохранить доход
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
