'use client'

import { useCallback, useEffect, useState } from 'react'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { ChefHat, Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'

type Ingredient = { id: string; name: string; unit: string | null; purchase_price: number | null; category?: string | null; stock_qty?: number | null }
type Comp = { id?: string; ingredient_id: string | null; component_recipe_id: string | null; name: string | null; qty: number; unit: string; waste_pct: number }
type Recipe = {
  id: string
  name: string
  category: string | null
  output_qty: number
  output_unit: string
  yield_factor: number
  is_semi_finished: boolean
  sale_item_id: string | null
  components: Comp[]
  recipe_cost: number
  portion_cost: number
}
type SaleItem = { id: string; name: string; sale_price: number | null }

const money = (n: number) => Number(n || 0).toLocaleString('ru-RU') + ' ₸'
const inputCls = 'rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:border-emerald-400/40'

export default function ProductionPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [saleItems, setSaleItems] = useState<SaleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // форма
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [outputQty, setOutputQty] = useState('1')
  const [outputUnit, setOutputUnit] = useState('порц')
  const [yieldPct, setYieldPct] = useState('0') // потери %
  const [comps, setComps] = useState<Comp[]>([{ ingredient_id: null, component_recipe_id: null, name: null, qty: 0, unit: 'г', waste_pct: 0 }])
  const [saleItemId, setSaleItemId] = useState('')

  // анализ продаж
  const todayISO = new Date().toISOString().slice(0, 10)
  const [anFrom, setAnFrom] = useState(todayISO)
  const [anTo, setAnTo] = useState(todayISO)
  const [analysis, setAnalysis] = useState<any>(null)
  const [anLoading, setAnLoading] = useState(false)
  const [showJournal, setShowJournal] = useState(false)
  const [movements, setMovements] = useState<any[]>([])

  // ингредиенты
  const [showIng, setShowIng] = useState(false)
  const [ingName, setIngName] = useState('')
  const [ingUnit, setIngUnit] = useState('г')
  const [ingPrice, setIngPrice] = useState('')
  const [savingIng, setSavingIng] = useState(false)

  const addIngredient = async () => {
    if (!ingName.trim()) { setErr('Укажите название ингредиента'); return }
    setSavingIng(true); setErr(null)
    try {
      const res = await fetch('/api/admin/production/ingredients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: ingName.trim(), unit: ingUnit.trim() || 'г', purchase_price: Number(ingPrice) || 0 }),
      })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j.error || 'Ошибка')
      setIngName(''); setIngPrice(''); await load()
    } catch (e: any) { setErr(e?.message || 'Ошибка') } finally { setSavingIng(false) }
  }
  const deleteIngredient = async (id: string, nm: string) => {
    if (!confirm(`Удалить ингредиент «${nm}»?`)) return
    const res = await fetch(`/api/admin/production/ingredients?id=${id}`, { method: 'DELETE' })
    if (res.ok) await load(); else setErr('Не удалось удалить')
  }

  const stockAction = async (action: string, payload: any, okMsg?: string) => {
    setErr(null)
    const res = await fetch('/api/admin/production/stock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload }) })
    const j = await res.json().catch(() => null)
    if (!res.ok || !j?.ok) { setErr(j?.error || 'Ошибка'); return null }
    await load()
    return j
  }
  const receiptIng = async (ing: Ingredient) => {
    const v = window.prompt(`Приход «${ing.name}» — сколько ${ing.unit} поступило?`, '')
    if (v == null) return
    const qty = Number(v)
    if (!(qty > 0)) { setErr('Введите число > 0'); return }
    await stockAction('receipt', { ingredient_id: ing.id, qty })
  }
  const countIng = async (ing: Ingredient) => {
    const v = window.prompt(`Ревизия «${ing.name}» — фактический остаток (${ing.unit})? Ожидаемый: ${Number(ing.stock_qty || 0)}`, String(Number(ing.stock_qty || 0)))
    if (v == null) return
    const counted = Number(v)
    if (!Number.isFinite(counted)) { setErr('Введите число'); return }
    const j = await stockAction('count', { ingredient_id: ing.id, counted })
    if (j) {
      const variance = Number(j.variance || 0)
      if (variance !== 0) setErr(variance < 0 ? `Недостача ${Math.abs(variance)} ${ing.unit}` : `Излишек ${variance} ${ing.unit}`)
    }
  }
  const writeoffSales = async () => {
    if (!confirm(`Списать ингредиенты по продажам за ${anFrom} — ${anTo}? Остатки уменьшатся на теоретический расход.`)) return
    const j = await stockAction('writeoff_sales', { from: anFrom, to: anTo })
    if (j) setErr(null)
  }

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const res = await fetch('/api/admin/production/recipes', { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j.error || 'Ошибка')
      setRecipes(j.recipes || [])
      setIngredients(j.ingredients || [])
      setSaleItems(j.saleItems || [])
    } catch (e: any) { setErr(e?.message || 'Ошибка') } finally { setLoading(false) }
  }, [])

  const runAnalysis = useCallback(async () => {
    setAnLoading(true); setErr(null)
    try {
      const p = new URLSearchParams({ from: anFrom, to: anTo })
      const res = await fetch(`/api/admin/production/analysis?${p}`, { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j.error || 'Ошибка')
      setAnalysis(j)
    } catch (e: any) { setErr(e?.message || 'Ошибка') } finally { setAnLoading(false) }
  }, [anFrom, anTo])

  useEffect(() => { load() }, [load])

  const loadJournal = async () => {
    const next = !showJournal
    setShowJournal(next)
    if (next) {
      const res = await fetch('/api/admin/production/stock', { cache: 'no-store' })
      const j = await res.json().catch(() => null)
      if (j?.ok) setMovements(j.movements || [])
    }
  }

  const resetForm = () => {
    setEditingId(null)
    setName(''); setCategory(''); setOutputQty('1'); setOutputUnit('порц'); setYieldPct('0'); setSaleItemId('')
    setComps([{ ingredient_id: null, component_recipe_id: null, name: null, qty: 0, unit: 'г', waste_pct: 0 }])
  }

  const openEdit = (r: Recipe) => {
    setEditingId(r.id)
    setName(r.name); setCategory(r.category || ''); setOutputQty(String(r.output_qty)); setOutputUnit(r.output_unit)
    setSaleItemId(r.sale_item_id || '')
    setYieldPct(String(Math.round((1 - (r.yield_factor || 1)) * 100)))
    setComps(
      (r.components || []).length
        ? r.components.map((c) => ({ ingredient_id: c.ingredient_id || null, component_recipe_id: c.component_recipe_id || null, name: c.name || null, qty: Number(c.qty) || 0, unit: c.unit || 'г', waste_pct: Number(c.waste_pct) || 0 }))
        : [{ ingredient_id: null, component_recipe_id: null, name: null, qty: 0, unit: 'г', waste_pct: 0 }],
    )
    setShowForm(true)
  }

  const save = async () => {
    if (!name.trim()) { setErr('Укажите название'); return }
    setSaving(true); setErr(null)
    try {
      const yf = 1 - (Number(yieldPct) || 0) / 100
      const res = await fetch('/api/admin/production/recipes', {
        method: editingId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(editingId ? { id: editingId } : {}),
          name: name.trim(), category: category.trim() || null,
          output_qty: Number(outputQty) || 1, output_unit: outputUnit.trim() || 'порц',
          yield_factor: yf > 0 ? yf : 1, sale_item_id: saleItemId || null,
          components: comps.filter((c) => c.ingredient_id && Number(c.qty) > 0),
        }),
      })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j.error || 'Не удалось сохранить')
      resetForm(); setShowForm(false); await load()
    } catch (e: any) { setErr(e?.message || 'Ошибка') } finally { setSaving(false) }
  }

  const remove = async (id: string, nm: string) => {
    if (!confirm(`Удалить техкарту «${nm}»?`)) return
    const res = await fetch(`/api/admin/production/recipes?id=${id}`, { method: 'DELETE' })
    if (res.ok) await load(); else setErr('Не удалось удалить')
  }

  const setComp = (i: number, patch: Partial<Comp>) => setComps((prev) => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c))
  const addComp = () => setComps((prev) => [...prev, { ingredient_id: null, component_recipe_id: null, name: null, qty: 0, unit: 'г', waste_pct: 0 }])
  const delComp = (i: number) => setComps((prev) => prev.filter((_, idx) => idx !== i))

  return (
    <div className="app-page-wide space-y-5">
      <AdminPageHeader
        title="Техкарты"
        description="Рецептуры, нормы списания и себестоимость блюд (food cost)"
        icon={<ChefHat className="h-5 w-5" />}
        accent="emerald"
        backHref="/"
        actions={
          <div className="flex gap-2">
            <button onClick={load} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Обновить
            </button>
            <button onClick={() => setShowIng((v) => !v)} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10">
              Ингредиенты ({ingredients.length})
            </button>
            <button onClick={loadJournal} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10">
              Журнал
            </button>
            <button onClick={() => setShowForm((v) => !v)} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500">
              <Plus className="h-3.5 w-3.5" /> Новая техкарта
            </button>
          </div>
        }
      />

      {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-200">{err}</div>}

      {showIng && (
        <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 p-5 shadow-lg shadow-black/20">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Ингредиенты (сырьё для техкарт)</h3>
            <button onClick={() => setShowIng(false)} className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"><X className="h-4 w-4" /></button>
          </div>
          <p className="mb-3 text-xs text-slate-500">Мука, сыр, тесто — с ценой за базовую единицу (г/мл/шт). Из них собираются техкарты.</p>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input className={`${inputCls} flex-1 min-w-[180px]`} placeholder="Название (Мука)" value={ingName} onChange={(e) => setIngName(e.target.value)} />
            <input className={`${inputCls} w-24`} placeholder="ед. (г)" value={ingUnit} onChange={(e) => setIngUnit(e.target.value)} />
            <input className={`${inputCls} w-32`} type="number" placeholder="цена за ед." value={ingPrice} onChange={(e) => setIngPrice(e.target.value)} />
            <button onClick={addIngredient} disabled={savingIng} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
              {savingIng ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Добавить
            </button>
          </div>
          {ingredients.length === 0 ? (
            <p className="text-xs text-slate-500">Ингредиентов нет. Добавьте первый — потом из них соберёте техкарту.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-white/5 overflow-hidden rounded-xl border border-slate-200 dark:border-white/10">
              {ingredients.map((ing) => (
                <div key={ing.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2 text-sm">
                  <span className="text-slate-900 dark:text-white">{ing.name} <span className="text-[11px] text-slate-500">/ {ing.unit}</span></span>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="tabular-nums text-slate-500 dark:text-slate-400">{money(Number(ing.purchase_price || 0))}/{ing.unit}</span>
                    <span className="text-[11px] text-slate-500">остаток</span>
                    <span className={`tabular-nums ${Number(ing.stock_qty || 0) < 0 ? 'text-rose-600 dark:text-rose-300' : 'text-slate-900 dark:text-white'}`}>{Number(ing.stock_qty || 0)} {ing.unit}</span>
                    <button onClick={() => receiptIng(ing)} className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 px-2 py-1 text-[11px] text-emerald-700 dark:text-emerald-300 hover:bg-slate-200 dark:hover:bg-white/10">+ приход</button>
                    <button onClick={() => countIng(ing)} className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 px-2 py-1 text-[11px] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10">ревизия</button>
                    <button onClick={() => deleteIngredient(ing.id, ing.name)} className="text-slate-500 hover:text-rose-600 dark:hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showJournal && (
        <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 p-5 shadow-lg shadow-black/20">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Журнал движений ингредиентов</h3>
            <button onClick={() => setShowJournal(false)} className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"><X className="h-4 w-4" /></button>
          </div>
          {movements.length === 0 ? (
            <p className="text-xs text-slate-500">Движений нет.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-white/5 overflow-hidden rounded-xl border border-slate-200 dark:border-white/10">
              {movements.map((m) => {
                const kindLabel = m.kind === 'receipt' ? 'приход' : m.kind === 'count' ? 'ревизия' : m.kind === 'sale_writeoff' ? 'списание (продажи)' : 'ручное'
                return (
                  <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-slate-900 dark:text-white">{m.ingredient_name}</span>
                      <span className="rounded border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-500 dark:text-slate-400">{kindLabel}</span>
                      {m.period_from ? <span className="text-[11px] text-slate-500">{m.period_from}…{m.period_to}</span> : null}
                      <span className="text-[11px] text-slate-500">{new Date(m.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className={`tabular-nums ${Number(m.qty_delta) < 0 ? 'text-rose-600 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{Number(m.qty_delta) > 0 ? '+' : ''}{Number(m.qty_delta)} {m.ingredient_unit}</span>
                      {m.variance != null && Number(m.variance) !== 0 ? <span className={`tabular-nums ${Number(m.variance) < 0 ? 'text-rose-600 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300'}`}>расхожд. {Number(m.variance) > 0 ? '+' : ''}{Number(m.variance)}</span> : null}
                      <span className="tabular-nums text-slate-500 dark:text-slate-400">остаток {Number(m.balance_after)} {m.ingredient_unit}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {showForm && (
        <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 p-5 shadow-lg shadow-black/20">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{editingId ? 'Редактирование техкарты' : 'Новая техкарта'}</h3>
            <button onClick={() => { setShowForm(false); resetForm() }} className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"><X className="h-4 w-4" /></button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input className={inputCls} placeholder="Название (Пицца Маргарита)" value={name} onChange={(e) => setName(e.target.value)} />
            <input className={inputCls} placeholder="Категория (необяз.)" value={category} onChange={(e) => setCategory(e.target.value)} />
            <div className="flex gap-2">
              <input className={`${inputCls} w-20`} type="number" placeholder="Выход" value={outputQty} onChange={(e) => setOutputQty(e.target.value)} />
              <input className={`${inputCls} flex-1`} placeholder="ед. (порц/кг)" value={outputUnit} onChange={(e) => setOutputUnit(e.target.value)} />
            </div>
            <input className={inputCls} type="number" placeholder="Потери выхода, %" value={yieldPct} onChange={(e) => setYieldPct(e.target.value)} />
          </div>

          <div className="mt-3">
            <label className="mb-1 block text-xs text-slate-500 dark:text-slate-400">Блюдо в продаже (для анализа продаж — что списывать при продаже)</label>
            <select className={`${inputCls} w-full`} value={saleItemId} onChange={(e) => setSaleItemId(e.target.value)}>
              <option value="">— не связано —</option>
              {saleItems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-slate-500 dark:text-slate-400">Состав (ингредиенты на весь выход)</div>
            <div className="space-y-2">
              {comps.map((c, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <select className={`${inputCls} min-w-[200px] flex-1`} value={c.ingredient_id || ''} onChange={(e) => {
                    const ing = ingredients.find((x) => x.id === e.target.value)
                    setComp(i, { ingredient_id: e.target.value || null, name: ing?.name || null, unit: ing?.unit || c.unit })
                  }}>
                    <option value="">— ингредиент —</option>
                    {ingredients.map((ing) => <option key={ing.id} value={ing.id}>{ing.name} ({ing.unit})</option>)}
                  </select>
                  <input className={`${inputCls} w-24`} type="number" placeholder="кол-во" value={c.qty || ''} onChange={(e) => setComp(i, { qty: Number(e.target.value) })} />
                  <input className={`${inputCls} w-20`} placeholder="ед." value={c.unit} onChange={(e) => setComp(i, { unit: e.target.value })} />
                  <input className={`${inputCls} w-24`} type="number" placeholder="потери %" value={c.waste_pct || ''} onChange={(e) => setComp(i, { waste_pct: Number(e.target.value) })} />
                  <button onClick={() => delComp(i)} className="text-slate-500 hover:text-rose-600 dark:hover:text-rose-300"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            <button onClick={addComp} className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300 hover:text-emerald-600 dark:hover:text-emerald-200"><Plus className="h-3.5 w-3.5" /> ингредиент</button>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => { setShowForm(false); resetForm() }} className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 px-4 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-white/10">Отмена</button>
            <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Сохранить
            </button>
          </div>
        </div>
      )}

      {/* Анализ продаж — теоретический food cost */}
      <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 p-5 shadow-lg shadow-black/20">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Анализ продаж · теоретический food cost</h3>
          <div className="flex items-center gap-2">
            <input className={inputCls} type="date" value={anFrom} onChange={(e) => setAnFrom(e.target.value)} />
            <span className="text-slate-500">—</span>
            <input className={inputCls} type="date" value={anTo} onChange={(e) => setAnTo(e.target.value)} />
            <button onClick={runAnalysis} disabled={anLoading} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
              {anLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Посчитать
            </button>
            <button onClick={writeoffSales} className="inline-flex items-center gap-1.5 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-700 dark:text-amber-200 hover:bg-amber-500/20" title="Списать теоретический расход ингредиентов со склада за период">
              Списать со склада
            </button>
          </div>
        </div>
        {analysis ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi label="Продано блюд" value={String(analysis.totals.sold)} accent="text-slate-900 dark:text-white" />
              <Kpi label="Выручка" value={money(analysis.totals.revenue)} accent="text-slate-900 dark:text-white" />
              <Kpi label="Food cost (теор.)" value={money(analysis.totals.food_cost)} accent="text-amber-700 dark:text-amber-300" />
              <Kpi label="Food cost %" value={`${analysis.totals.food_cost_pct}%`} accent={analysis.totals.food_cost_pct > 35 ? 'text-rose-600 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'} />
            </div>
            {analysis.rows.length === 0 ? (
              <p className="text-xs text-slate-500">Нет продаж связанных блюд за период. Свяжи техкарты с блюдами в продаже (поле «Блюдо в продаже»).</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-white/10">
                <div className="grid grid-cols-6 gap-2 border-b border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02] px-3 py-2 text-[11px] uppercase tracking-wide text-slate-500">
                  <span className="col-span-2">Блюдо</span><span className="text-right">Продано</span><span className="text-right">Себест.</span><span className="text-right">Food cost</span><span className="text-right">FC %</span>
                </div>
                {analysis.rows.map((r: any) => (
                  <div key={r.recipe_id} className="grid grid-cols-6 gap-2 px-3 py-2 text-sm">
                    <span className="col-span-2 truncate text-slate-900 dark:text-white">{r.name}</span>
                    <span className="text-right tabular-nums text-slate-700 dark:text-slate-300">{r.sold_qty}</span>
                    <span className="text-right tabular-nums text-slate-500 dark:text-slate-400">{money(r.portion_cost)}</span>
                    <span className="text-right tabular-nums text-amber-700 dark:text-amber-300">{money(r.food_cost)}</span>
                    <span className={`text-right tabular-nums ${r.food_cost_pct > 35 ? 'text-rose-600 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300'}`}>{r.food_cost_pct}%</span>
                  </div>
                ))}
              </div>
            )}
            {analysis.ingredients.length > 0 && (
              <div>
                <div className="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">Теоретический расход ингредиентов</div>
                <div className="flex flex-wrap gap-2">
                  {analysis.ingredients.map((g: any) => (
                    <span key={g.ingredient_id} className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] px-2.5 py-1 text-xs text-slate-700 dark:text-slate-300">{g.name}: <b className="text-slate-900 dark:text-white">{g.qty} {g.unit}</b> · {money(g.cost)}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-500">Выбери период → «Посчитать». Покажет теоретический food cost и расход ингредиентов по проданным блюдам (нужно связать техкарты с блюдами).</p>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 shadow-lg shadow-black/20 overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-white/10 px-4 py-3">
          <span className="text-sm font-semibold text-slate-900 dark:text-white">Техкарты</span>
          <span className="rounded-full border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/5 px-2 py-0.5 text-xs text-slate-500 dark:text-slate-400">{recipes.length}</span>
        </div>
        {loading && recipes.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-500 dark:text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /> Загрузка…</div>
        ) : recipes.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-slate-500 dark:text-slate-400">Техкарт нет. Создайте первую.</div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            {recipes.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
                <div className="min-w-[200px] flex-1">
                  <div className="text-sm font-medium text-slate-900 dark:text-white">{r.name}{r.is_semi_finished ? <span className="ml-2 rounded border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">полуфабрикат</span> : null}</div>
                  <div className="text-[11px] text-slate-500">{r.category || '—'} · выход {r.output_qty} {r.output_unit} · {r.components.length} ингр.{r.yield_factor < 1 ? ` · потери ${Math.round((1 - r.yield_factor) * 100)}%` : ''}</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-slate-500">Себестоимость порции</div>
                  <div className="text-base font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{money(r.portion_cost)}</div>
                </div>
                <button onClick={() => openEdit(r)} className="text-slate-500 transition hover:text-emerald-700 dark:hover:text-emerald-300"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => remove(r.id, r.name)} className="text-slate-500 transition hover:text-rose-600 dark:hover:text-rose-300"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Kpi({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.03] p-3">
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-base font-bold tabular-nums ${accent}`}>{value}</div>
    </div>
  )
}
