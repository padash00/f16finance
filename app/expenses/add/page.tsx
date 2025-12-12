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
} from 'lucide-react'

import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'

type ExpenseCategory = { id: string; name: string }
type Company = { id: string; name: string; code?: string | null }
type Operator = { id: string; name: string; short_name: string | null; is_active: boolean }

const toISODateLocal = (d: Date) => {
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}
const parseISODateSafe = (iso: string) => new Date(`${iso}T12:00:00`)

const getToday = () => toISODateLocal(new Date())

const clampAmount = (n: number) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0)

const parseAmount = (v: string) => {
  if (!v) return 0
  const cleaned = v.replace(/\s/g, '').replace(',', '.')
  const n = Number(cleaned)
  return clampAmount(n)
}

const fmt = (n: number) => n.toLocaleString('ru-RU')

export default function AddExpensePage() {
  const router = useRouter()

  // catalogs
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [operators, setOperators] = useState<Operator[]>([])

  // form
  const [date, setDate] = useState(getToday())
  const [companyId, setCompanyId] = useState('')
  const [operatorId, setOperatorId] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [cash, setCash] = useState('')
  const [kaspi, setKaspi] = useState('')
  const [comment, setComment] = useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // защита от двойного сабмита + гонок
  const savingRef = useRef(false)

  // load catalogs
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError(null)

      const [catRes, compRes, opRes] = await Promise.all([
        supabase.from('expense_categories').select('id, name').order('name'),
        supabase.from('companies').select('id, name, code').order('name'),
        supabase
          .from('operators')
          .select('id, name, short_name, is_active')
          .eq('is_active', true)
          .order('name'),
      ])

      if (catRes.error || compRes.error || opRes.error) {
        console.error('Expense add load error', {
          catErr: catRes.error,
          compErr: compRes.error,
          opErr: opRes.error,
        })
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

      // авто-выбор компании (prefer main if есть)
      if (!companyId) {
        const preferred =
          comps.find((c) => c.code === 'arena') ||
          comps.find((c) => c.name.toLowerCase().includes('arena')) ||
          comps[0]
        if (preferred) setCompanyId(preferred.id)
      }

      // авто-выбор оператора (если один)
      if (!operatorId) {
        if (ops.length === 1) setOperatorId(ops[0].id)
      }

      // авто-выбор категории (если одна)
      if (!categoryName) {
        if (cats.length === 1) setCategoryName(cats[0].name)
      }

      setLoading(false)
    }

    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cashVal = useMemo(() => parseAmount(cash), [cash])
  const kaspiVal = useMemo(() => parseAmount(kaspi), [kaspi])
  const total = useMemo(() => cashVal + kaspiVal, [cashVal, kaspiVal])

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
      const next = clampAmount(parseAmount(cash) + amount)
      setCash(next ? String(next) : '')
      return
    }
    const next = clampAmount(parseAmount(kaspi) + amount)
    setKaspi(next ? String(next) : '')
  }

  const normalizeDate = (iso: string) => {
    // просто защита от пустого
    if (!iso) return getToday()
    const d = parseISODateSafe(iso)
    if (Number.isNaN(d.getTime())) return getToday()
    return toISODateLocal(d)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (savingRef.current) return

    setError(null)

    try {
      if (!companyId) throw new Error('Выберите компанию (кто платит?)')
      if (!operatorId) throw new Error('Выберите оператора смены')
      if (!categoryName) throw new Error('Выберите категорию расхода')

      const cashAmount = cashVal
      const kaspiAmount = kaspiVal
      if (cashAmount <= 0 && kaspiAmount <= 0) throw new Error('Введите сумму расхода')

      savingRef.current = true
      setSaving(true)

      const payload = {
        date: normalizeDate(date),
        company_id: companyId,
        operator_id: operatorId,
        category: categoryName,
        cash_amount: cashAmount,
        kaspi_amount: kaspiAmount,
        comment: comment.trim() || null,
      }

      const { error: insertError } = await supabase.from('expenses').insert([payload])
      if (insertError) throw insertError

      router.push('/expenses')
    } catch (err: any) {
      console.error(err)
      setError(err?.message || 'Ошибка при сохранении')
      setSaving(false)
      savingRef.current = false
    }
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-8 max-w-3xl mx-auto">
          {/* Header */}
          <div className="flex items-center gap-4 mb-6">
            <Link href="/expenses">
              <Button variant="ghost" size="icon" className="rounded-full">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-foreground">Записать расход</h1>
              <p className="text-xs text-muted-foreground">Фиксация затрат бизнеса</p>
            </div>

            {/* Total pill */}
            <div className="hidden sm:flex flex-col items-end">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Итого</div>
              <div className="px-3 py-1 rounded-full border border-red-500/30 bg-red-500/10 text-red-300 font-bold font-mono">
                {total > 0 ? `${fmt(total)} ₸` : '—'}
              </div>
            </div>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg text-sm flex items-center gap-2 animate-in slide-in-from-top-2">
              <span className="text-lg">⚠️</span> {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* 1. Details */}
            <Card className="p-5 border-border bg-card neon-glow space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Детали операции
                </h3>

                <div className="relative">
                  <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="bg-input border border-border rounded-md py-1.5 pl-8 pr-3 text-xs font-medium focus:border-accent transition-colors"
                  />
                </div>
              </div>

              {/* Company */}
              <div>
                <label className="text-xs text-muted-foreground mb-2 block ml-1">Кто платит?</label>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {loading ? (
                    <div className="text-xs text-muted-foreground">Загрузка...</div>
                  ) : (
                    companies.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setCompanyId(c.id)}
                        className={`rounded-lg border p-3 flex flex-col items-center justify-center gap-2 transition-all duration-200 ${
                          companyId === c.id
                            ? 'bg-accent/20 border-accent text-white'
                            : 'bg-card/50 border-border/50 text-muted-foreground hover:bg-white/5'
                        }`}
                        title={c.name}
                      >
                        <Building2 className={`w-4 h-4 ${companyId === c.id ? 'text-accent' : ''}`} />
                        <span className="text-[10px] font-bold text-center truncate w-full">{c.name}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* Operator */}
              <div>
                <label className="text-xs text-muted-foreground mb-2 block ml-1">Оператор смены</label>

                {loading ? (
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

            {/* 2. Category */}
            <Card className="p-5 border-border bg-card neon-glow">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  <Tag className="w-4 h-4" /> Категория
                </h3>

                {!!categoryName && (
                  <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5" />
                    Выбрано: <span className="text-foreground font-semibold">{categoryName}</span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {loading && <div className="text-xs text-muted-foreground">Загрузка категорий...</div>}

                {!loading &&
                  categories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setCategoryName(cat.name)}
                      className={`px-4 py-2 rounded-full text-xs font-medium border transition-all ${
                        categoryName === cat.name
                          ? 'bg-red-500/20 border-red-500 text-red-400 shadow-[0_0_10px_rgba(239,68,68,0.3)]'
                          : 'bg-input/30 border-border/50 text-muted-foreground hover:bg-white/5 hover:text-foreground'
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}

                {categories.length === 0 && !loading && (
                  <p className="text-xs text-yellow-500">Категории не созданы. Добавьте их в настройках.</p>
                )}
              </div>
            </Card>

            {/* 3. Amount */}
            <Card className="p-5 border-border bg-card neon-glow">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
                Сумма расхода
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <label className="text-xs text-foreground mb-1.5 flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-red-400" /> Наличные (Cash)
                  </label>
                  <input
                    inputMode="numeric"
                    type="number"
                    placeholder="0"
                    min="0"
                    value={cash}
                    onChange={(e) => setCash(e.target.value)}
                    className="w-full text-lg bg-input border border-border rounded-lg py-3 px-4 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 transition-all"
                  />

                  <div className="mt-2 flex flex-wrap gap-2">
                    {[500, 1000, 2000, 5000, 10000].map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => quickAdd('cash', a)}
                        className="text-[10px] px-2 py-1 rounded border border-border/60 bg-input/30 text-muted-foreground hover:text-foreground hover:bg-white/5"
                        title={`Добавить ${a}`}
                      >
                        <Plus className="w-3 h-3 inline mr-1" /> {fmt(a)}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-foreground mb-1.5 flex items-center gap-2">
                    <CreditCard className="w-4 h-4 text-red-400" /> Kaspi / Карта
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

                  <div className="mt-2 flex flex-wrap gap-2">
                    {[500, 1000, 2000, 5000, 10000].map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => quickAdd('kaspi', a)}
                        className="text-[10px] px-2 py-1 rounded border border-border/60 bg-input/30 text-muted-foreground hover:text-foreground hover:bg-white/5"
                        title={`Добавить ${a}`}
                      >
                        <Plus className="w-3 h-3 inline mr-1" /> {fmt(a)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* total mobile */}
              <div className="mt-4 sm:hidden">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Итого</div>
                <div className="mt-1 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/10 text-red-300 font-bold font-mono">
                  {total > 0 ? `${fmt(total)} ₸` : '—'}
                </div>
              </div>

              {/* Comment */}
              <div className="mt-6 relative">
                <label className="text-xs text-muted-foreground mb-1.5 block ml-1">Комментарий</label>
                <FileText className="absolute left-3 top-9 w-4 h-4 text-muted-foreground/50" />
                <textarea
                  rows={2}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  className="w-full bg-input border border-border rounded-lg py-2 pl-10 pr-3 text-sm focus:border-accent transition-colors resize-none"
                  placeholder="Например: закуп колы, ремонт джойстика..."
                />
              </div>
            </Card>

            {/* Actions */}
            <div className="flex gap-4 pt-2">
              <Link href="/expenses" className="flex-1">
                <Button type="button" variant="outline" className="w-full h-12 border-border hover:bg-white/5">
                  Отмена
                </Button>
              </Link>

              <Button
                type="submit"
                disabled={!canSubmit}
                className="flex-[2] h-12 bg-red-600 hover:bg-red-700 text-white text-base font-medium shadow-[0_0_20px_rgba(220,38,38,0.4)] disabled:opacity-60"
              >
                {saving ? (
                  'Сохранение...'
                ) : (
                  <span className="flex items-center gap-2">
                    <Save className="w-4 h-4" /> Подтвердить расход
                  </span>
                )}
              </Button>
            </div>

            {/* small hint */}
            <div className="text-[11px] text-muted-foreground/70">
              Подсказка: суммы округляются до целых тенге, дата считается по локальному времени (без UTC-косяков).
            </div>
          </form>
        </div>
      </main>
    </div>
  )
}
