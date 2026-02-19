'use client'

import { useEffect, useMemo, useState, useCallback, FormEvent, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Calendar,
  Wallet,
  CreditCard,
  Tag,
  Building2,
  FileText,
  Save,
  UserCircle2,
  Sparkles,
  Plus,
  Brain,
  TrendingDown,
  AlertCircle,
  CheckCircle2,
  Target,
  Zap,
  Clock,
  ChevronDown,
} from 'lucide-react'

import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'

type ExpenseCategory = { id: string; name: string }
type Company = { id: string; name: string; code?: string | null }
type Operator = { id: string; name: string; short_name: string | null; is_active: boolean }

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

const parseAmount = (v: string) => {
  if (!v) return 0
  const cleaned = v.replace(/\s/g, '').replace(',', '.')
  const n = Number(cleaned)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

export default function AddExpensePage() {
  const router = useRouter()

  // catalogs
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [operators, setOperators] = useState<Operator[]>([])

  // form
  const [date, setDate] = useState(DateUtils.todayISO())
  const [companyId, setCompanyId] = useState('')
  const [operatorId, setOperatorId] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [cash, setCash] = useState('')
  const [kaspi, setKaspi] = useState('')
  const [comment, setComment] = useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSuccess, setShowSuccess] = useState(false)
  const [isCalendarOpen, setIsCalendarOpen] = useState(false)

  const savingRef = useRef(false)

  // load catalogs
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)

      const [catRes, compRes, opRes] = await Promise.all([
        supabase.from('expense_categories').select('id, name').order('name'),
        supabase.from('companies').select('id, name, code').order('name'),
        supabase.from('operators').select('id, name, short_name, is_active').eq('is_active', true).order('name'),
      ])

      if (catRes.error || compRes.error || opRes.error) {
        setError('Ошибка загрузки справочников')
        setLoading(false)
        return
      }

      const cats = (catRes.data || []) as ExpenseCategory[]
      const comps = (compRes.data || []) as Company[]
      const ops = (opRes.data || []) as Operator[]

      setCategories(cats)
      setCompanies(comps)
      setOperators(ops)

      // авто-выбор
      if (!companyId) {
        const preferred = comps.find((c) => c.code === 'arena') || comps[0]
        if (preferred) setCompanyId(preferred.id)
      }
      if (!operatorId && ops.length === 1) setOperatorId(ops[0].id)
      if (!categoryName && cats.length === 1) setCategoryName(cats[0].name)

      setLoading(false)
    }

    load()
  }, [])

  const cashVal = useMemo(() => parseAmount(cash), [cash])
  const kaspiVal = useMemo(() => parseAmount(kaspi), [kaspi])
  const total = useMemo(() => cashVal + kaspiVal, [cashVal, kaspiVal])

  // AI рекомендация на основе выбранной категории
  const aiRecommendation = useMemo(() => {
    if (!categoryName) return null
    
    const recommendations: Record<string, string> = {
      'Зарплата': 'Регулярный расход. Рекомендуется планировать на начало месяца.',
      'Аренда': 'Фиксированный расход. Убедитесь в наличии договора.',
      'Закупка': 'Проверьте остатки на складе перед закупкой.',
      'Ремонт': 'Внеплановый расход. Зафиксируйте причину для аналитики.',
      'Коммунальные': 'Проверьте счета за предыдущие месяцы для сравнения.',
      'Маркетинг': 'Отслеживайте ROI от рекламных кампаний.',
    }

    return recommendations[categoryName] || 'Зафиксируйте комментарий для будущего анализа.'
  }, [categoryName])

  const canSubmit = useMemo(() => {
    if (loading) return false
    if (!companyId) return false
    if (!operatorId) return false
    if (!categoryName) return false
    if (total <= 0) return false
    if (saving) return false
    return true
  }, [loading, companyId, operatorId, categoryName, total, saving])

  const quickAdd = (field: 'cash' | 'kaspi', amount: number) => {
    if (field === 'cash') {
      const next = parseAmount(cash) + amount
      setCash(next ? String(next) : '')
    } else {
      const next = parseAmount(kaspi) + amount
      setKaspi(next ? String(next) : '')
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (savingRef.current) return

    setError(null)

    try {
      if (!companyId) throw new Error('Выберите компанию')
      if (!operatorId) throw new Error('Выберите оператора')
      if (!categoryName) throw new Error('Выберите категорию')
      if (cashVal <= 0 && kaspiVal <= 0) throw new Error('Введите сумму')

      savingRef.current = true
      setSaving(true)

      const payload = {
        date: date || DateUtils.todayISO(),
        company_id: companyId,
        operator_id: operatorId,
        category: categoryName,
        cash_amount: cashVal,
        kaspi_amount: kaspiVal,
        comment: comment.trim() || null,
      }

      const { error: insertError } = await supabase.from('expenses').insert([payload])
      if (insertError) throw insertError

      setShowSuccess(true)
      setTimeout(() => router.push('/expenses'), 800)
    } catch (err: any) {
      setError(err?.message || 'Ошибка при сохранении')
      setSaving(false)
      savingRef.current = false
    }
  }

  const CompanyCard = ({ c }: { c: Company }) => {
    const active = c.id === companyId
    let color = 'from-gray-500 to-gray-600'
    
    if (c.code === 'arena') color = 'from-blue-500 to-cyan-500'
    else if (c.code === 'extra') color = 'from-purple-500 to-pink-500'
    else if (c.code === 'ramen') color = 'from-orange-500 to-red-500'

    return (
      <button
        type="button"
        onClick={() => setCompanyId(c.id)}
        className={`relative rounded-xl border p-4 flex flex-col items-center justify-center gap-3 transition-all duration-300 ${
          active
            ? `bg-gradient-to-br ${color} border-transparent text-white shadow-lg scale-105`
            : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:bg-gray-700/50'
        }`}
      >
        <div className={`p-3 rounded-xl ${active ? 'bg-white/20' : 'bg-gray-700/50'}`}>
          <Building2 className={`w-6 h-6 ${active ? 'text-white' : ''}`} />
        </div>
        <span className="text-xs font-semibold text-center">{c.name}</span>
        {active && (
          <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center shadow-lg">
            <CheckCircle2 className="w-4 h-4 text-white" />
          </div>
        )}
      </button>
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
            <h2 className="text-2xl font-bold text-white mb-2">Расход сохранен!</h2>
            <p className="text-gray-400">Перенаправляем в журнал...</p>
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
          {/* Header */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-red-900/30 via-gray-900 to-orange-900/30 p-6 border border-red-500/20 mb-6">
            <div className="absolute top-0 right-0 w-64 h-64 bg-red-600 rounded-full blur-3xl opacity-20 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-orange-600 rounded-full blur-3xl opacity-20 pointer-events-none" />
            
            <div className="relative z-10 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Link href="/expenses">
                  <Button variant="outline" size="icon" className="rounded-full border-gray-700 bg-gray-800/50 hover:bg-gray-700">
                    <ArrowLeft className="w-5 h-5 text-gray-300" />
                  </Button>
                </Link>
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-red-500/20 rounded-xl">
                    <Brain className="w-8 h-8 text-red-400" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                      AI Запись расхода
                    </h1>
                    <p className="text-sm text-gray-400">Умная фиксация затрат</p>
                  </div>
                </div>
              </div>

              {/* Total pill */}
              <div className="hidden sm:flex flex-col items-end">
                <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Итого к списанию</div>
                <div className={`px-4 py-2 rounded-xl border font-bold font-mono text-lg transition-all ${
                  total > 0 
                    ? 'border-red-500/30 bg-red-500/10 text-red-400 shadow-lg shadow-red-500/20' 
                    : 'border-gray-700 bg-gray-800/50 text-gray-500'
                }`}>
                  {total > 0 ? Formatters.moneyDetailed(total) : '—'}
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

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 1. Details */}
            <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-blue-500/20 rounded-xl">
                  <Calendar className="w-5 h-5 text-blue-400" />
                </div>
                <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Детали операции</h3>
              </div>

              {/* Date */}
              <div className="mb-6">
                <label className="text-xs text-gray-500 uppercase mb-2 block">Дата расхода</label>
                <button
                  type="button"
                  onClick={() => setIsCalendarOpen(!isCalendarOpen)}
                  className="flex items-center gap-2 px-4 py-3 bg-gray-900 border border-gray-700 rounded-xl text-gray-300 hover:border-red-500/50 transition-colors w-full sm:w-auto"
                >
                  <Calendar className="w-4 h-4 text-red-400" />
                  <span>{DateUtils.formatDate(date, 'full')}</span>
                  <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isCalendarOpen ? 'rotate-180' : ''}`} />
                </button>

                {isCalendarOpen && (
                  <div className="mt-2 p-3 bg-gray-900 border border-gray-700 rounded-xl">
                    <input
                      type="date"
                      value={date}
                      onChange={(e) => {
                        setDate(e.target.value)
                        setIsCalendarOpen(false)
                      }}
                      className="w-full bg-gray-800 text-white px-3 py-2 rounded-lg border border-gray-700 focus:border-red-500 outline-none"
                    />
                  </div>
                )}
              </div>

              {/* Company */}
              <div className="mb-6">
                <label className="text-xs text-gray-500 uppercase mb-3 block">Кто платит?</label>
                {loading ? (
                  <div className="text-sm text-gray-400 animate-pulse">Загрузка...</div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                    {companies.map((c) => (
                      <CompanyCard key={c.id} c={c} />
                    ))}
                  </div>
                )}
              </div>

              {/* Operator */}
              <div>
                <label className="text-xs text-gray-500 uppercase mb-3 block">Оператор смены</label>
                {loading ? (
                  <div className="text-sm text-gray-400">Загрузка...</div>
                ) : operators.length === 0 ? (
                  <p className="text-sm text-yellow-500">Операторов нет. Добавьте их в разделе «Операторы».</p>
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

            {/* 2. Category */}
            <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-500/20 rounded-xl">
                    <Tag className="w-5 h-5 text-orange-400" />
                  </div>
                  <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Категория</h3>
                </div>

                {categoryName && (
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <Sparkles className="w-4 h-4 text-yellow-400" />
                    Выбрано: <span className="text-white font-semibold">{categoryName}</span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {loading && <div className="text-sm text-gray-400 animate-pulse">Загрузка...</div>}

                {!loading && categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategoryName(cat.name)}
                    className={`px-4 py-3 rounded-xl text-sm font-medium border transition-all ${
                      categoryName === cat.name
                        ? 'bg-gradient-to-r from-red-500 to-orange-500 text-white border-transparent shadow-lg shadow-red-500/25'
                        : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-white'
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}

                {categories.length === 0 && !loading && (
                  <p className="text-sm text-yellow-500">Категории не созданы.</p>
                )}
              </div>

              {/* AI Recommendation */}
              {aiRecommendation && (
                <div className="mt-4 p-4 bg-gradient-to-r from-purple-900/20 to-blue-900/20 border border-purple-500/20 rounded-xl">
                  <div className="flex items-start gap-3">
                    <Zap className="w-5 h-5 text-purple-400 mt-0.5" />
                    <div>
                      <p className="text-xs text-purple-400 font-medium mb-1">AI Рекомендация</p>
                      <p className="text-sm text-gray-300">{aiRecommendation}</p>
                    </div>
                  </div>
                </div>
              )}
            </Card>

            {/* 3. Amount */}
            <Card className="p-6 border-0 bg-gray-800/50 backdrop-blur-sm">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-red-500/20 rounded-xl">
                  <TrendingDown className="w-5 h-5 text-red-400" />
                </div>
                <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Сумма расхода</h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {/* Cash */}
                <div className="space-y-3">
                  <label className="text-sm text-gray-400 flex items-center gap-2">
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
                      className="w-full text-2xl font-bold bg-gray-900 border border-gray-700 rounded-xl py-4 px-4 text-white focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none transition-all"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">₸</span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {[1000, 5000, 10000, 20000, 50000].map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => quickAdd('cash', a)}
                        className="px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-900 text-xs text-gray-400 hover:border-amber-500/50 hover:text-amber-400 transition-colors"
                      >
                        <Plus className="w-3 h-3 inline mr-1" /> {Formatters.moneyDetailed(a)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Kaspi */}
                <div className="space-y-3">
                  <label className="text-sm text-gray-400 flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-red-400" /> Kaspi / Карта
                  </label>
                  <div className="relative">
                    <input
                      inputMode="numeric"
                      type="number"
                      placeholder="0"
                      min="0"
                      value={kaspi}
                      onChange={(e) => setKaspi(e.target.value)}
                      className="w-full text-2xl font-bold bg-gray-900 border border-gray-700 rounded-xl py-4 px-4 text-white focus:border-red-500 focus:ring-2 focus:ring-red-500/20 outline-none transition-all"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 font-medium">₸</span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {[1000, 5000, 10000, 20000, 50000].map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => quickAdd('kaspi', a)}
                        className="px-3 py-1.5 rounded-lg border border-gray-700 bg-gray-900 text-xs text-gray-400 hover:border-red-500/50 hover:text-red-400 transition-colors"
                      >
                        <Plus className="w-3 h-3 inline mr-1" /> {Formatters.moneyDetailed(a)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Mobile Total */}
              <div className="mt-6 sm:hidden p-4 bg-gradient-to-r from-red-500/10 to-orange-500/10 border border-red-500/20 rounded-xl">
                <div className="text-xs text-gray-400 uppercase mb-1">Итого</div>
                <div className="text-2xl font-bold text-red-400 font-mono">
                  {total > 0 ? Formatters.moneyDetailed(total) : '—'}
                </div>
              </div>

              {/* Comment */}
              <div className="mt-6 space-y-2">
                <label className="text-xs text-gray-500 uppercase flex items-center gap-2">
                  <FileText className="w-3 h-3" /> Комментарий
                </label>
                <textarea
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-xl py-3 px-4 text-white focus:border-red-500 focus:ring-2 focus:ring-red-500/20 outline-none transition-all resize-none"
                  placeholder="Например: закупка продуктов, ремонт оборудования..."
                />
              </div>
            </Card>

            {/* Summary Card */}
            {total > 0 && (
              <Card className="p-6 border-0 bg-gradient-to-br from-red-900/30 via-gray-900 to-orange-900/30 backdrop-blur-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-red-500/20 rounded-xl">
                      <Target className="w-6 h-6 text-red-400" />
                    </div>
                    <div>
                      <p className="text-sm text-gray-400">Подтвердите расход</p>
                      <p className="text-2xl font-bold text-white">{Formatters.moneyDetailed(total)}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {categoryName} • {DateUtils.formatDate(date)} • {operators.find(o => o.id === operatorId)?.short_name || 'Оператор'}
                      </p>
                    </div>
                  </div>
                </div>
              </Card>
            )}

            {/* Actions */}
            <div className="flex gap-4 pt-4">
              <Link href="/expenses" className="flex-1">
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
                disabled={!canSubmit}
                className="flex-[2] h-14 bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 text-white text-base font-semibold rounded-xl shadow-lg shadow-red-500/25 disabled:opacity-50"
              >
                {saving ? (
                  <span className="flex items-center gap-2">
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Сохранение...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Save className="w-5 h-5" /> 
                    Подтвердить расход
                    {total > 0 && ` (${Formatters.moneyDetailed(total)})`}
                  </span>
                )}
              </Button>
            </div>

            <p className="text-xs text-gray-500 text-center">
              Суммы округляются до целых тенге. Дата по локальному времени.
            </p>
          </form>
        </div>
      </main>
    </div>
  )
}
