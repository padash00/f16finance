'use client'

import { useEffect, useState, FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Calendar, Wallet, CreditCard, Tag, Building2, FileText, Save } from 'lucide-react'

import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'

type ExpenseCategory = {
  id: string
  name: string
}

type Company = {
  id: string
  name: string
  code: string
}

const getToday = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const parseAmount = (v: string) => {
  if (!v) return 0
  const n = Number(v.replace(',', '.').replace(/\s/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}

export default function AddExpensePage() {
  const router = useRouter()

  // Состояния
  const [date, setDate] = useState(getToday())
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  
  // Данные формы
  const [companyId, setCompanyId] = useState('')
  const [categoryName, setCategoryName] = useState('') // Храним имя категории
  const [cash, setCash] = useState('')
  const [kaspi, setKaspi] = useState('')
  const [comment, setComment] = useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Загрузка данных
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const [catRes, compRes] = await Promise.all([
        supabase.from('expense_categories').select('id, name').order('name'),
        supabase.from('companies').select('id, name, code').order('name')
      ])

      if (catRes.error || compRes.error) {
        setError('Ошибка загрузки справочников')
      } else {
        setCategories(catRes.data || [])
        setCompanies(compRes.data || [])
        // Автовыбор первой компании (обычно Общий или Arena)
        if (compRes.data && compRes.data.length > 0) {
           setCompanyId(compRes.data[0].id)
        }
      }
      setLoading(false)
    }
    load()
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)

    try {
      if (!companyId) throw new Error('Выберите компанию (кто платит?)')
      if (!categoryName) throw new Error('Выберите категорию расхода')

      const cashVal = parseAmount(cash)
      const kaspiVal = parseAmount(kaspi)

      if (cashVal <= 0 && kaspiVal <= 0) throw new Error('Введите сумму расхода')

      const { error: insertError } = await supabase.from('expenses').insert([
        {
          date,
          company_id: companyId,
          category: categoryName,
          cash_amount: cashVal,
          kaspi_amount: kaspiVal,
          comment: comment.trim() || null,
        },
      ])

      if (insertError) throw insertError

      router.push('/expenses')
    } catch (err: any) {
      console.error(err)
      setError(err.message || 'Ошибка при сохранении')
      setSaving(false)
    }
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="p-4 md:p-8 max-w-3xl mx-auto">
          
          {/* Хедер */}
          <div className="flex items-center gap-4 mb-6">
            <Link href="/expenses">
                <Button variant="ghost" size="icon" className="rounded-full">
                    <ArrowLeft className="w-5 h-5" />
                </Button>
            </Link>
            <div>
                <h1 className="text-2xl font-bold text-foreground">Записать расход</h1>
                <p className="text-xs text-muted-foreground">Фиксация затрат бизнеса</p>
            </div>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg text-sm flex items-center gap-2 animate-in slide-in-from-top-2">
               <span className="text-lg">⚠️</span> {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            
            {/* 1. Блок: КТО и КОГДА */}
            <Card className="p-5 border-border bg-card neon-glow space-y-4">
                <div className="flex justify-between items-center">
                     <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Детали операции</h3>
                     
                     {/* Дата инпут компактный */}
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

                {/* Выбор компании (Плитки) */}
                <div>
                    <label className="text-xs text-muted-foreground mb-2 block ml-1">Кто платит?</label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                        {loading ? (
                            <div className="text-xs text-muted-foreground">Загрузка...</div>
                        ) : (
                            companies.map(c => (
                                <div 
                                    key={c.id}
                                    onClick={() => setCompanyId(c.id)}
                                    className={`cursor-pointer rounded-lg border p-3 flex flex-col items-center justify-center gap-2 transition-all duration-200 ${
                                        companyId === c.id 
                                        ? 'bg-accent/20 border-accent text-white' 
                                        : 'bg-card/50 border-border/50 text-muted-foreground hover:bg-white/5'
                                    }`}
                                >
                                    <Building2 className={`w-4 h-4 ${companyId === c.id ? 'text-accent' : ''}`} />
                                    <span className="text-[10px] font-bold text-center truncate w-full">{c.name}</span>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </Card>

            {/* 2. Блок: НА ЧТО? (Категории Тегами) */}
            <Card className="p-5 border-border bg-card neon-glow">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Tag className="w-4 h-4" /> Категория
                </h3>
                
                <div className="flex flex-wrap gap-2">
                    {loading && <div className="text-xs text-muted-foreground">Загрузка категорий...</div>}
                    {!loading && categories.map(cat => (
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

            {/* 3. Блок: СКОЛЬКО? */}
            <Card className="p-5 border-border bg-card neon-glow">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Сумма расхода</h3>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div>
                        <label className="text-xs text-foreground mb-1.5 flex items-center gap-2">
                            <Wallet className="w-4 h-4 text-red-400" /> Наличные (Cash)
                        </label>
                        <input 
                            type="number" placeholder="0" min="0"
                            value={cash} onChange={e => setCash(e.target.value)}
                            className="w-full text-lg bg-input border border-border rounded-lg py-3 px-4 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 transition-all"
                        />
                    </div>
                    <div>
                        <label className="text-xs text-foreground mb-1.5 flex items-center gap-2">
                            <CreditCard className="w-4 h-4 text-red-400" /> Kaspi / Карта
                        </label>
                        <input 
                            type="number" placeholder="0" min="0"
                            value={kaspi} onChange={e => setKaspi(e.target.value)}
                            className="w-full text-lg bg-input border border-border rounded-lg py-3 px-4 focus:border-red-500 focus:ring-1 focus:ring-red-500/50 transition-all"
                        />
                    </div>
                </div>

                <div className="mt-6 relative">
                    <label className="text-xs text-muted-foreground mb-1.5 block ml-1">Комментарий</label>
                    <FileText className="absolute left-3 top-9 w-4 h-4 text-muted-foreground/50" />
                    <textarea 
                        rows={2}
                        value={comment}
                        onChange={e => setComment(e.target.value)}
                        className="w-full bg-input border border-border rounded-lg py-2 pl-10 pr-3 text-sm focus:border-accent transition-colors resize-none"
                        placeholder="Например: закуп колы, ремонт джойстика..."
                    />
                </div>
            </Card>

            {/* Кнопки */}
            <div className="flex gap-4 pt-2">
                <Link href="/expenses" className="flex-1">
                    <Button type="button" variant="outline" className="w-full h-12 border-border hover:bg-white/5">
                        Отмена
                    </Button>
                </Link>
                <Button 
                    type="submit" 
                    disabled={saving}
                    className="flex-[2] h-12 bg-red-600 hover:bg-red-700 text-white text-base font-medium shadow-[0_0_20px_rgba(220,38,38,0.4)]"
                >
                    {saving ? 'Сохранение...' : (
                        <span className="flex items-center gap-2">
                            <Save className="w-4 h-4" /> Подтвердить расход
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