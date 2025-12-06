'use client'

import { useEffect, useState, useMemo, FormEvent } from 'react'
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
  role?: string | null
  is_active?: boolean | null
}

type ShiftType = 'day' | 'night'
type ZoneType = 'pc' | 'ps5' | 'vr' | 'ramen' | 'other'

const getToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(d.getDate()).padStart(2, '0')}`
}

const parseAmount = (v: string) => {
  if (!v) return 0
  const n = Number(v.replace(',', '.').replace(/\s/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}

export default function AddIncomePage() {
  const router = useRouter()

  const today = useMemo(() => getToday(), [])
  const [date, setDate] = useState(today)

  const [companies, setCompanies] = useState<Company[]>([])
  const [operators, setOperators] = useState<Operator[]>([])

  const [companyId, setCompanyId] = useState('')
  const [operatorId, setOperatorId] = useState('')

  const [loadingRefs, setLoadingRefs] = useState(true)

  const [shift, setShift] = useState<ShiftType>('day')

  // Поля для обычных компаний
  const [cash, setCash] = useState('')
  const [kaspi, setKaspi] = useState('')
  const [card, setCard] = useState('')

  // Поля для Extra
  const [ps5Amount, setPs5Amount] = useState('')
  const [vrAmount, setVrAmount] = useState('')

  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // --- Загрузка компаний + операторов ---
  useEffect(() => {
    const load = async () => {
      setLoadingRefs(true)
      setError(null)

      const [compRes, opRes] = await Promise.all([
        supabase.from('companies').select('id,name,code').order('name'),
        supabase
          .from('operators')
          .select('id,name,role,is_active')
          .eq('is_active', true)
          .order('name'),
      ])

      if (compRes.error || opRes.error) {
        console.error('Load refs error', compRes.error, opRes.error)
        setError('Не удалось загрузить справочники')
        setLoadingRefs(false)
        return
      }

      const comps = (compRes.data || []) as Company[]
      const ops = (opRes.data || []) as Operator[]

      setCompanies(comps)
      setOperators(ops)

      if (comps.length > 0) {
        setCompanyId(comps[0].id)
      }
      if (ops.length > 0) {
        setOperatorId(ops[0].id)
      }

      setLoadingRefs(false)
    }

    load()
  }, [])

  const selectedCompany = useMemo(
    () => companies.find((c) => c.id === companyId) || null,
    [companies, companyId],
  )

  const selectedOperator = useMemo(
    () => operators.find((o) => o.id === operatorId) || null,
    [operators, operatorId],
  )

  const isExtra = selectedCompany?.code === 'extra'
  const isArena = selectedCompany?.code === 'arena'
  const isRamen = selectedCompany?.code === 'ramen'
  const isF16Point = isExtra || isArena || isRamen

  const getZone = (): ZoneType => {
    if (isArena) return 'pc'
    if (isRamen) return 'ramen'
    return 'other'
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)

    try {
      if (!companyId) throw new Error('Выберите компанию')

      // Для F16-точек оператор обязателен
      if (isF16Point && !operatorId) {
        throw new Error('Выберите оператора смены')
      }

      // --- EXTRA: PS5 / VR отдельными строками ---
      if (isExtra) {
        const ps5 = parseAmount(ps5Amount)
        const vr = parseAmount(vrAmount)

        if (ps5 <= 0 && vr <= 0) {
          throw new Error('Укажите сумму для PS5 или VR')
        }

        const rows: any[] = []

        if (ps5 > 0) {
          rows.push({
            date,
            company_id: companyId,
            shift,
            zone: 'ps5',
            cash_amount: ps5,
            kaspi_amount: 0,
            card_amount: 0,
            comment: comment ? `${comment} (PS5)` : 'PS5',
            is_virtual: true,
            operator_id: operatorId || null,
            operator_name: selectedOperator?.name || null,
          })
        }

        if (vr > 0) {
          rows.push({
            date,
            company_id: companyId,
            shift,
            zone: 'vr',
            cash_amount: vr,
            kaspi_amount: 0,
            card_amount: 0,
            comment: comment ? `${comment} (VR)` : 'VR',
            is_virtual: true,
            operator_id: operatorId || null,
            operator_name: selectedOperator?.name || null,
          })
        }

        const { error } = await supabase.from('incomes').insert(rows)
        if (error) throw error
      } else {
        // --- Остальные компании: обычные деньги ---
        const cashVal = parseAmount(cash)
        const kaspiVal = parseAmount(kaspi)
        const cardVal = parseAmount(card)

        if (cashVal <= 0 && kaspiVal <= 0 && cardVal <= 0) {
          throw new Error('Введите сумму дохода')
        }

        const { error } = await supabase.from('incomes').insert([
          {
            date,
            company_id: companyId,
            shift,
            zone: getZone(),
            cash_amount: cashVal,
            kaspi_amount: kaspiVal,
            card_amount: cardVal,
            comment: comment || null,
            is_virtual: false,
            operator_id: operatorId || null,
            operator_name: selectedOperator?.name || null,
          },
        ])
        if (error) throw error
      }

      router.push('/income')
    } catch (err: any) {
      console.error(err)
      setError(err.message || 'Ошибка при сохранении')
      setSaving(false)
    }
  }

  // --- UI-компоненты ---

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
        {active && (
          <div className="absolute top-2 right-2 w-2 h-2 bg-accent rounded-full animate-pulse" />
        )}
      </div>
    )
  }

  const OperatorPill = ({ o }: { o: Operator }) => {
    const active = o.id === operatorId
    return (
      <button
        type="button"
        onClick={() => setOperatorId(o.id)}
        className={`px-3 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1 transition-all ${
          active
            ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.4)]'
            : 'bg-input/30 border-border/50 text-muted-foreground hover:bg-white/5 hover:text-foreground'
        }`}
      >
        <UserCircle2 className="w-3.5 h-3.5" />
        <span className="truncate max-w-[120px]">{o.name}</span>
      </button>
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
              <p className="text-xs text-muted-foreground">
                Внесение выручки в кассу + оператор смены
              </p>
            </div>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg text-sm flex items-center gap-2">
              <span className="text-lg">⚠️</span> {error}
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
                  <label className="text-xs text-muted-foreground mb-1.5 block ml-1">
                    Дата
                  </label>
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
                  <label className="text-xs text-muted-foreground mb-1.5 block ml-1">
                    Смена
                  </label>
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
                <label className="text-xs text-muted-foreground mb-2 block ml-1">
                  Точка (Компания)
                </label>
                {loadingRefs ? (
                  <div className="text-sm text-muted-foreground animate-pulse">
                    Загрузка списка...
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {companies.map((c) => (
                      <CompanyCard key={c.id} c={c} />
                    ))}
                  </div>
                )}
              </div>

              {/* Оператор смены */}
              <div>
                <label className="text-xs text-muted-foreground mb-2 block ml-1">
                  Оператор смены
                </label>
                {loadingRefs ? (
                  <div className="text-sm text-muted-foreground animate-pulse">
                    Загрузка операторов...
                  </div>
                ) : operators.length === 0 ? (
                  <p className="text-xs text-yellow-400">
                    Операторы не созданы. Добавьте их в таблицу operators.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {operators.map((o) => (
                      <OperatorPill key={o.id} o={o} />
                    ))}
                  </div>
                )}
              </div>
            </Card>

            {/* 2. Сумма выручки */}
            <Card className="p-5 border-border bg-card neon-glow relative overflow-hidden">
              <div className="absolute -right-6 -top-6 opacity-[0.03] pointer-events-none">
                {isExtra ? (
                  <Gamepad2 className="w-48 h-48" />
                ) : (
                  <Wallet className="w-48 h-48" />
                )}
              </div>

              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                {isExtra ? 'Выручка по зонам (Extra)' : 'Суммы выручки'}
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {isExtra ? (
                  <>
                    <div>
                      <label className="text-xs text-foreground mb-1.5 flex items-center gap-2">
                        <Gamepad2 className="w-4 h-4 text-purple-500" /> PlayStation 5
                      </label>
                      <input
                        type="number"
                        placeholder="0"
                        min="0"
                        value={ps5Amount}
                        onChange={(e) => setPs5Amount(e.target.value)}
                        className="w-full text-lg bg-input border border-border rounded-lg py-3 px-4 focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50 transition-all"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-foreground mb-1.5 flex items-center gap-2">
                        <Eye className="w-4 h-4 text-cyan-500" /> VR Зона
                      </label>
                      <input
                        type="number"
                        placeholder="0"
                        min="0"
                        value={vrAmount}
                        onChange={(e) => setVrAmount(e.target.value)}
                        className="w-full text-lg bg-input border border-border rounded-lg py-3 px-4 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 transition-all"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="text-xs text-foreground mb-1.5 flex items-center gap-2">
                        <Wallet className="w-4 h-4 text-green-500" /> Наличные (Cash)
                      </label>
                      <input
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
                        type="number"
                        placeholder="0"
                        min="0"
                        value={kaspi}
                        onChange={(e) => setKaspi(e.target.value)}
                        className="w-full text-lg bg-input border border-border rounded-lg py-3 px-4 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 transition-all"
                      />
                    </div>
                    {/* если карта понадобится – просто раскомментируешь */}
                    {/* <div>
                      <label className="text-xs text-foreground mb-1.5 flex items-center gap-2">
                        <CreditCard className="w-4 h-4 text-blue-500" /> Карта
                      </label>
                      <input
                        type="number"
                        placeholder="0"
                        min="0"
                        value={card}
                        onChange={(e) => setCard(e.target.value)}
                        className="w-full text-lg bg-input border border-border rounded-lg py-3 px-4 focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all"
                      />
                    </div> */}
                  </>
                )}
              </div>

              <div className="mt-6">
                <label className="text-xs text-muted-foreground mb-1.5 block">
                  Комментарий (необязательно)
                </label>
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
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-12 border-border hover:bg-white/5"
                >
                  Отмена
                </Button>
              </Link>
              <Button
                type="submit"
                disabled={saving}
                className="flex-[2] h-12 bg-accent text-accent-foreground hover:bg-accent/90 text-base font-medium shadow-[0_0_20px_rgba(168,85,247,0.4)]"
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
