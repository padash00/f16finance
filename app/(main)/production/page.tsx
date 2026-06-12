'use client'

import { useCallback, useEffect, useState } from 'react'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { ChefHat, Loader2, Plus, RefreshCw, Trash2, X } from 'lucide-react'

type Ingredient = { id: string; name: string; unit: string | null; default_purchase_price: number | null }
type Comp = { id?: string; item_id: string | null; component_recipe_id: string | null; name: string | null; qty: number; unit: string; waste_pct: number }
type Recipe = {
  id: string
  name: string
  category: string | null
  output_qty: number
  output_unit: string
  yield_factor: number
  is_semi_finished: boolean
  components: Comp[]
  recipe_cost: number
  portion_cost: number
}

const money = (n: number) => Number(n || 0).toLocaleString('ru-RU') + ' ₸'
const inputCls = 'rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/40'

export default function ProductionPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  // форма
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [outputQty, setOutputQty] = useState('1')
  const [outputUnit, setOutputUnit] = useState('порц')
  const [yieldPct, setYieldPct] = useState('0') // потери %
  const [comps, setComps] = useState<Comp[]>([{ item_id: null, component_recipe_id: null, name: null, qty: 0, unit: 'г', waste_pct: 0 }])

  const load = useCallback(async () => {
    setLoading(true); setErr(null)
    try {
      const res = await fetch('/api/admin/production/recipes', { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j.error || 'Ошибка')
      setRecipes(j.recipes || [])
      setIngredients(j.ingredients || [])
    } catch (e: any) { setErr(e?.message || 'Ошибка') } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const resetForm = () => {
    setName(''); setCategory(''); setOutputQty('1'); setOutputUnit('порц'); setYieldPct('0')
    setComps([{ item_id: null, component_recipe_id: null, name: null, qty: 0, unit: 'г', waste_pct: 0 }])
  }

  const save = async () => {
    if (!name.trim()) { setErr('Укажите название'); return }
    setSaving(true); setErr(null)
    try {
      const yf = 1 - (Number(yieldPct) || 0) / 100
      const res = await fetch('/api/admin/production/recipes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), category: category.trim() || null,
          output_qty: Number(outputQty) || 1, output_unit: outputUnit.trim() || 'порц',
          yield_factor: yf > 0 ? yf : 1,
          components: comps.filter((c) => c.item_id && Number(c.qty) > 0),
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
  const addComp = () => setComps((prev) => [...prev, { item_id: null, component_recipe_id: null, name: null, qty: 0, unit: 'г', waste_pct: 0 }])
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
            <button onClick={load} className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/10">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Обновить
            </button>
            <button onClick={() => setShowForm((v) => !v)} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-500">
              <Plus className="h-3.5 w-3.5" /> Новая техкарта
            </button>
          </div>
        }
      />

      {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">{err}</div>}

      {showForm && (
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 shadow-lg shadow-black/20">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Новая техкарта</h3>
            <button onClick={() => { setShowForm(false); resetForm() }} className="text-slate-400 hover:text-white"><X className="h-4 w-4" /></button>
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

          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-slate-400">Состав (ингредиенты на весь выход)</div>
            <div className="space-y-2">
              {comps.map((c, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <select className={`${inputCls} min-w-[200px] flex-1`} value={c.item_id || ''} onChange={(e) => {
                    const ing = ingredients.find((x) => x.id === e.target.value)
                    setComp(i, { item_id: e.target.value || null, name: ing?.name || null, unit: ing?.unit || c.unit })
                  }}>
                    <option value="">— ингредиент —</option>
                    {ingredients.map((ing) => <option key={ing.id} value={ing.id}>{ing.name}</option>)}
                  </select>
                  <input className={`${inputCls} w-24`} type="number" placeholder="кол-во" value={c.qty || ''} onChange={(e) => setComp(i, { qty: Number(e.target.value) })} />
                  <input className={`${inputCls} w-20`} placeholder="ед." value={c.unit} onChange={(e) => setComp(i, { unit: e.target.value })} />
                  <input className={`${inputCls} w-24`} type="number" placeholder="потери %" value={c.waste_pct || ''} onChange={(e) => setComp(i, { waste_pct: Number(e.target.value) })} />
                  <button onClick={() => delComp(i)} className="text-slate-500 hover:text-rose-300"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            <button onClick={addComp} className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200"><Plus className="h-3.5 w-3.5" /> ингредиент</button>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => { setShowForm(false); resetForm() }} className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 hover:bg-white/10">Отмена</button>
            <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Сохранить
            </button>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-slate-900/60 shadow-lg shadow-black/20 overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <span className="text-sm font-semibold text-white">Техкарты</span>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-slate-400">{recipes.length}</span>
        </div>
        {loading && recipes.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /> Загрузка…</div>
        ) : recipes.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-slate-400">Техкарт нет. Создайте первую.</div>
        ) : (
          <div className="divide-y divide-white/5">
            {recipes.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
                <div className="min-w-[200px] flex-1">
                  <div className="text-sm font-medium text-white">{r.name}{r.is_semi_finished ? <span className="ml-2 rounded border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">полуфабрикат</span> : null}</div>
                  <div className="text-[11px] text-slate-500">{r.category || '—'} · выход {r.output_qty} {r.output_unit} · {r.components.length} ингр.{r.yield_factor < 1 ? ` · потери ${Math.round((1 - r.yield_factor) * 100)}%` : ''}</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] text-slate-500">Себестоимость порции</div>
                  <div className="text-base font-bold tabular-nums text-emerald-300">{money(r.portion_cost)}</div>
                </div>
                <button onClick={() => remove(r.id, r.name)} className="text-slate-500 transition hover:text-rose-300"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
