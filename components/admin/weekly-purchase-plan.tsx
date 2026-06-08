'use client'

/**
 * Планировщик закупа.
 * Встроен в страницу weekly-report; данные подшиваются отдельной страницей в недельный PDF.
 * По умолчанию — текущая неделя (ту, что планируешь). Неделю можно листать.
 * v1: только план + отметка «куплено». Превращение в реальный заказ — позже.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  ShoppingCart,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

// Локальное форматирование YYYY-MM-DD без UTC-сдвига (toISOString отдаёт UTC и уводит дату).
function fmtLocalISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function parseLocal(iso: string): Date | null {
  const parts = String(iso || '').split('-').map(Number)
  if (parts.length !== 3 || !parts[0]) return null
  return new Date(parts[0], parts[1] - 1, parts[2])
}

/** Понедельник недели, содержащей дату (или сегодня). Без таймзонных багов. */
export function currentWeekMondayISO(fromIso?: string): string {
  const base = (fromIso ? parseLocal(fromIso) : null) || new Date()
  const x = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  const dow = (x.getDay() + 6) % 7 // 0=Пн .. 6=Вс
  x.setDate(x.getDate() - dow)
  return fmtLocalISO(x)
}

/** Понедельник СЛЕДУЮЩЕЙ недели относительно даты — «неделя после отчётной». */
export function nextWeekMondayISO(fromIso?: string): string {
  const monday = parseLocal(currentWeekMondayISO(fromIso))
  if (!monday) return currentWeekMondayISO(fromIso)
  monday.setDate(monday.getDate() + 7)
  return fmtLocalISO(monday)
}

/** «08 июн — 14 июн» по дате понедельника. */
export function planWeekLabel(weekStartIso: string): string {
  const start = parseLocal(weekStartIso)
  if (!start) return ''
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
  const f = (d: Date) => d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
  return `${f(start)} — ${f(end)}`
}

const DAYS = [
  { value: 1, label: 'Понедельник' },
  { value: 2, label: 'Вторник' },
  { value: 3, label: 'Среда' },
  { value: 4, label: 'Четверг' },
  { value: 5, label: 'Пятница' },
  { value: 6, label: 'Суббота' },
  { value: 7, label: 'Воскресенье' },
] as const

type Company = { id: string; name: string; code?: string | null }
type PlanItem = {
  id: string
  company_id: string | null
  week_start: string
  day_of_week: number
  category: string | null
  title: string
  supplier: string | null
  quantity: number | null
  amount: number | null
  comment: string | null
  status: 'planned' | 'bought'
}

const fmtMoney = (n: number) => new Intl.NumberFormat('ru-RU').format(Math.round(n || 0))

export function WeeklyPurchasePlan({ reportEndDate }: { reportEndDate?: string } = {}) {
  // Неделя плана = следующая за отчётной (смотришь отчёт за 1–7 → план на 8–14).
  const [weekStart, setWeekStart] = useState<string>(() => nextWeekMondayISO(reportEndDate))
  const [companies, setCompanies] = useState<Company[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [suppliers, setSuppliers] = useState<string[]>([])
  const [items, setItems] = useState<PlanItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Форма добавления строки
  const [companyId, setCompanyId] = useState('')
  const [dayOfWeek, setDayOfWeek] = useState(1)
  const [category, setCategory] = useState('')
  const [title, setTitle] = useState('')
  const [supplier, setSupplier] = useState('')
  const [quantity, setQuantity] = useState('')
  const [amount, setAmount] = useState('')
  const [comment, setComment] = useState('')

  const isPlanWeek = !!reportEndDate && weekStart === nextWeekMondayISO(reportEndDate)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const [cRes, catRes, supRes] = await Promise.all([
          fetch('/api/admin/companies', { cache: 'no-store' }),
          fetch('/api/admin/expense-categories', { cache: 'no-store' }),
          fetch('/api/admin/store/suppliers', { cache: 'no-store' }),
        ])
        const [cj, catj, supj] = await Promise.all([
          cRes.json().catch(() => null),
          catRes.json().catch(() => null),
          supRes.json().catch(() => null),
        ])
        if (!active) return
        const comps: Company[] = Array.isArray(cj?.data) ? cj.data : []
        setCompanies(comps)
        if (comps[0]?.id) setCompanyId(String(comps[0].id))
        setCategories(
          (Array.isArray(catj?.data) ? catj.data : []).map((x: any) => String(x.name || '')).filter(Boolean),
        )
        setSuppliers(
          (supj?.data?.suppliers || []).map((x: any) => String(x.name || '')).filter(Boolean),
        )
      } catch {
        /* справочники не критичны */
      }
    })()
    return () => {
      active = false
    }
  }, [])

  // Меняется отчётная неделя на странице → план встаёт на следующую за ней.
  useEffect(() => {
    if (reportEndDate) setWeekStart(nextWeekMondayISO(reportEndDate))
  }, [reportEndDate])

  const loadItems = useCallback(async (ws: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/purchase-plan?week_start=${ws}`, { cache: 'no-store' })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.error || 'Не удалось загрузить план')
      setItems(Array.isArray(j?.data) ? j.data : [])
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки плана')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadItems(weekStart)
  }, [weekStart, loadItems])

  const addItem = async () => {
    if (!title.trim()) {
      setError('Укажите, что закупаем')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/purchase-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId || null,
          week_start: weekStart,
          day_of_week: dayOfWeek,
          category: category.trim() || null,
          title: title.trim(),
          supplier: supplier.trim() || null,
          quantity: quantity ? Number(quantity) : null,
          amount: amount ? Number(amount) : null,
          comment: comment.trim() || null,
        }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.error || 'Не удалось добавить')
      setTitle('')
      setSupplier('')
      setQuantity('')
      setAmount('')
      setComment('')
      await loadItems(weekStart)
    } catch (e: any) {
      setError(e?.message || 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const toggleBought = async (it: PlanItem) => {
    const next = it.status === 'bought' ? 'planned' : 'bought'
    setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, status: next } : p)))
    try {
      await fetch('/api/admin/purchase-plan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: it.id, status: next }),
      })
    } catch {
      loadItems(weekStart)
    }
  }

  const removeItem = async (id: string) => {
    setItems((prev) => prev.filter((p) => p.id !== id))
    try {
      await fetch(`/api/admin/purchase-plan?id=${id}`, { method: 'DELETE' })
    } catch {
      loadItems(weekStart)
    }
  }

  const companyName = useCallback(
    (id: string | null) => companies.find((c) => String(c.id) === String(id))?.name || '—',
    [companies],
  )

  const shiftWeek = (delta: number) => {
    const d = parseLocal(weekStart)
    if (!d) return
    d.setDate(d.getDate() + delta * 7)
    setWeekStart(fmtLocalISO(d))
  }

  const total = useMemo(() => items.reduce((s, it) => s + (Number(it.amount) || 0), 0), [items])

  const grouped = useMemo(() => {
    const m = new Map<number, PlanItem[]>()
    for (const it of items) {
      const d = Number(it.day_of_week) || 0
      if (!m.has(d)) m.set(d, [])
      m.get(d)!.push(it)
    }
    return DAYS.filter((d) => m.has(d.value)).map((d) => ({ day: d, list: m.get(d.value)! }))
  }, [items])

  return (
    <Card className="border-white/5 bg-slate-900/40 p-4 backdrop-blur-xl sm:p-5">
      {/* Заголовок + навигация по неделям */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300">
            <ShoppingCart className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">План закупок</h3>
            <p className="text-xs text-slate-500">На неделю после отчётной · войдёт отдельной страницей в PDF</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => shiftWeek(-1)}
            className="h-9 w-9 rounded-xl hover:bg-white/10"
            title="Предыдущая неделя"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[150px] text-center">
            <div className="text-sm font-medium text-white">{planWeekLabel(weekStart)}</div>
            {isPlanWeek ? <div className="text-[11px] text-violet-300/70">следующая неделя</div> : null}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => shiftWeek(1)}
            className="h-9 w-9 rounded-xl hover:bg-white/10"
            title="Следующая неделя"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Форма добавления */}
      <div className="mb-4 grid grid-cols-2 gap-2 rounded-2xl border border-white/5 bg-black/20 p-3 sm:grid-cols-12">
        <select
          value={dayOfWeek}
          onChange={(e) => setDayOfWeek(Number(e.target.value))}
          className="col-span-1 rounded-lg border border-white/10 bg-slate-900/60 px-2 py-2 text-sm text-white sm:col-span-2"
        >
          {DAYS.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
        <select
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
          className="col-span-1 rounded-lg border border-white/10 bg-slate-900/60 px-2 py-2 text-sm text-white sm:col-span-2"
        >
          <option value="">— точка —</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Input
          list="plan-categories"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Категория"
          className="col-span-2 border-white/10 bg-slate-900/60 text-white placeholder:text-slate-600 sm:col-span-2"
        />
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Что закупаем *"
          className="col-span-2 border-white/10 bg-slate-900/60 text-white placeholder:text-slate-600 sm:col-span-2"
        />
        <Input
          list="plan-suppliers"
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
          placeholder="Поставщик"
          className="col-span-2 border-white/10 bg-slate-900/60 text-white placeholder:text-slate-600 sm:col-span-2"
        />
        <Input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Сумма ₸"
          className="col-span-1 border-white/10 bg-slate-900/60 text-white placeholder:text-slate-600 sm:col-span-1"
        />
        <Button
          onClick={addItem}
          disabled={saving}
          className="col-span-1 bg-violet-600 text-white hover:bg-violet-500 sm:col-span-1"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </Button>

        <datalist id="plan-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <datalist id="plan-suppliers">
          {suppliers.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>

      {error ? <p className="mb-3 text-sm text-rose-400">{error}</p> : null}

      {/* Список по дням */}
      {loading ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
        </div>
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">
          На эту неделю плана пока нет. Добавьте первую позицию выше.
        </p>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ day, list }) => (
            <div key={day.value}>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-violet-300/80">
                {day.label}
              </div>
              <div className="space-y-1.5">
                {list.map((it) => (
                  <div
                    key={it.id}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                      it.status === 'bought'
                        ? 'border-emerald-500/20 bg-emerald-500/5'
                        : 'border-white/5 bg-white/[0.02]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleBought(it)}
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                        it.status === 'bought'
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : 'border-slate-600 text-transparent hover:border-slate-400'
                      }`}
                      title={it.status === 'bought' ? 'Отметить как план' : 'Отметить куплено'}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-xs text-slate-400">
                      {companyName(it.company_id)}
                    </span>
                    <span
                      className={`flex-1 truncate ${
                        it.status === 'bought' ? 'text-slate-500 line-through' : 'text-white'
                      }`}
                    >
                      {it.title}
                      {it.category ? <span className="text-slate-500"> · {it.category}</span> : null}
                      {it.supplier ? <span className="text-slate-500"> · {it.supplier}</span> : null}
                    </span>
                    {it.amount ? (
                      <span className="shrink-0 font-medium text-slate-200">{fmtMoney(it.amount)} ₸</span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => removeItem(it.id)}
                      className="shrink-0 rounded-lg p-1.5 text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-400"
                      title="Удалить"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="flex justify-end border-t border-white/5 pt-3 text-sm">
            <span className="text-slate-400">
              Итого по плану: <b className="text-white">{fmtMoney(total)} ₸</b>
            </span>
          </div>
        </div>
      )}
    </Card>
  )
}
