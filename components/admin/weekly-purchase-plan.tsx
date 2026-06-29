'use client'

/**
 * Планировщик закупа.
 * Встроен в страницу weekly-report; данные подшиваются отдельной страницей в недельный PDF.
 * Неделя плана = следующая за отчётной. v1: план + отметка «куплено».
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Loader2,
  Plus,
  ShoppingCart,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

// ── Даты (локальные части, без UTC-сдвига) ───────────────────────────────
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

/** Понедельник недели, содержащей дату (или сегодня). */
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

const fieldInput =
  'h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-900/60 text-sm text-foreground placeholder:text-slate-600'

// ── Комбобокс с поиском и добавлением нового значения ────────────────────
function ComboBox({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder: string
  searchPlaceholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const q = query.trim()
  const exists = options.some((o) => o.toLowerCase() === q.toLowerCase())

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery('') }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(fieldInput, 'flex items-center justify-between gap-2 px-3 text-left')}
        >
          <span className={cn('truncate', value ? 'text-foreground' : 'text-slate-500')}>
            {value || placeholder}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput
            placeholder={searchPlaceholder || 'Поиск или ввод…'}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>Начните вводить, чтобы добавить</CommandEmpty>
            <CommandGroup>
              {value ? (
                <CommandItem
                  value="__clear__"
                  onSelect={() => { onChange(''); setOpen(false); setQuery('') }}
                  className="text-muted-foreground"
                >
                  Очистить
                </CommandItem>
              ) : null}
              {options.map((o) => (
                <CommandItem
                  key={o}
                  value={o}
                  onSelect={() => { onChange(o); setOpen(false); setQuery('') }}
                >
                  <Check className={cn('h-4 w-4', value === o ? 'opacity-100' : 'opacity-0')} />
                  <span className="truncate">{o}</span>
                </CommandItem>
              ))}
              {q && !exists ? (
                <CommandItem
                  value={`__add__${q}`}
                  onSelect={() => { onChange(q); setOpen(false); setQuery('') }}
                >
                  <Plus className="h-4 w-4" />
                  <span className="truncate">Добавить «{q}»</span>
                </CommandItem>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-[11px] font-medium text-slate-500">{label}</label>
      {children}
    </div>
  )
}

export function WeeklyPurchasePlan({ reportEndDate }: { reportEndDate?: string } = {}) {
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
  const [amount, setAmount] = useState('')

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
          amount: amount ? Number(amount) : null,
        }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.error || 'Не удалось добавить')
      // Категория/поставщик могут быть новыми — добавим в подсказки.
      if (category.trim() && !categories.includes(category.trim())) {
        setCategories((p) => [...p, category.trim()].sort((a, b) => a.localeCompare(b, 'ru')))
      }
      if (supplier.trim() && !suppliers.includes(supplier.trim())) {
        setSuppliers((p) => [...p, supplier.trim()].sort((a, b) => a.localeCompare(b, 'ru')))
      }
      setTitle('')
      setSupplier('')
      setAmount('')
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
    return DAYS.filter((d) => m.has(d.value)).map((d) => {
      const list = m.get(d.value)!
      const sum = list.reduce((s, it) => s + (Number(it.amount) || 0), 0)
      return { day: d, list, sum }
    })
  }, [items])

  return (
    <Card className="border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/40 p-4 backdrop-blur-xl sm:p-5">
      {/* Заголовок + навигация по неделям */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300">
            <ShoppingCart className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">План закупок</h3>
            <p className="text-xs text-slate-500">На неделю после отчётной · войдёт отдельной страницей в PDF</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-white/5 bg-slate-100 dark:bg-black/20 p-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => shiftWeek(-1)}
            className="h-8 w-8 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10"
            title="Предыдущая неделя"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[150px] px-1 text-center">
            <div className="text-sm font-medium text-foreground">{planWeekLabel(weekStart)}</div>
            {isPlanWeek ? <div className="text-[11px] text-violet-700 dark:text-violet-300/70">следующая неделя</div> : null}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => shiftWeek(1)}
            className="h-8 w-8 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10"
            title="Следующая неделя"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Форма добавления */}
      <div className="mb-5 rounded-2xl border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-black/20 p-3 sm:p-4">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Добавить позицию
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="День">
            <Select value={String(dayOfWeek)} onValueChange={(v) => setDayOfWeek(Number(v))}>
              <SelectTrigger className={cn(fieldInput, 'px-3')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAYS.map((d) => (
                  <SelectItem key={d.value} value={String(d.value)}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Точка">
            <Select value={companyId} onValueChange={setCompanyId}>
              <SelectTrigger className={cn(fieldInput, 'px-3')}>
                <SelectValue placeholder="Точка" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Категория">
            <ComboBox
              value={category}
              onChange={setCategory}
              options={categories}
              placeholder="Категория"
              searchPlaceholder="Поиск категории…"
            />
          </Field>
          <Field label="Поставщик">
            <ComboBox
              value={supplier}
              onChange={setSupplier}
              options={suppliers}
              placeholder="Поставщик"
              searchPlaceholder="Поиск поставщика…"
            />
          </Field>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_170px_auto]">
          <Field label="Что закупаем *">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addItem() }}
              placeholder="Напр. Coca-Cola 1.5л ×20"
              className={fieldInput}
            />
          </Field>
          <Field label="Сумма, ₸">
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addItem() }}
              placeholder="0"
              className={fieldInput}
            />
          </Field>
          <div className="flex items-end">
            <Button
              onClick={addItem}
              disabled={saving}
              className="h-9 w-full bg-violet-600 text-white hover:bg-violet-500 sm:w-auto sm:px-5"
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Добавить
            </Button>
          </div>
        </div>
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
          {grouped.map(({ day, list, sum }) => (
            <div key={day.value}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300/80">
                  {day.label}
                </span>
                {sum ? <span className="text-xs text-slate-500">{fmtMoney(sum)} ₸</span> : null}
              </div>
              <div className="space-y-1.5">
                {list.map((it) => (
                  <div
                    key={it.id}
                    className={cn(
                      'flex items-center gap-2 rounded-xl border px-3 py-2 text-sm',
                      it.status === 'bought'
                        ? 'border-emerald-500/20 bg-emerald-500/5'
                        : 'border-slate-200 dark:border-white/5 bg-white dark:bg-white/[0.02]',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleBought(it)}
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition',
                        it.status === 'bought'
                          ? 'border-emerald-500 bg-emerald-500 text-white dark:text-white'
                          : 'border-slate-300 dark:border-slate-600 text-transparent hover:border-slate-400',
                      )}
                      title={it.status === 'bought' ? 'Отметить как план' : 'Отметить куплено'}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <span className="shrink-0 rounded-md bg-slate-100 dark:bg-white/5 px-1.5 py-0.5 text-xs text-muted-foreground">
                      {companyName(it.company_id)}
                    </span>
                    <span
                      className={cn(
                        'flex-1 truncate',
                        it.status === 'bought' ? 'text-slate-500 line-through' : 'text-foreground',
                      )}
                    >
                      {it.title}
                      {it.category ? <span className="text-slate-500"> · {it.category}</span> : null}
                      {it.supplier ? <span className="text-slate-500"> · {it.supplier}</span> : null}
                    </span>
                    {it.amount ? (
                      <span className="shrink-0 font-medium text-slate-700 dark:text-slate-200">{fmtMoney(it.amount)} ₸</span>
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
          <div className="flex justify-end border-t border-slate-200 dark:border-white/5 pt-3 text-sm">
            <span className="text-muted-foreground">
              Итого по плану: <b className="text-foreground">{fmtMoney(total)} ₸</b>
            </span>
          </div>
        </div>
      )}
    </Card>
  )
}
