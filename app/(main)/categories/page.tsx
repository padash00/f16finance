'use client'

import { useEffect, useState, useMemo } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCapabilities } from '@/lib/client/use-capabilities'
import {
  FINANCIAL_GROUP_OPTIONS,
  PL_CHAIN,
  getFinancialGroupLabel,
  type FinancialGroup,
} from '@/lib/core/financial-groups'
import {
  Plus,
  Pencil,
  Trash2,
  Save,
  X,
  Tag,
  Layers,
  Search,
  AlertCircle,
  Banknote,
  TrendingDown,
  BarChart3,
  Info,
  Lock,
  PieChart,
  Wallet,
} from 'lucide-react'

// Цвет по финансовой группе — чтобы категории читались с первого взгляда.
const GROUP_STYLE: Record<string, { text: string; bg: string; border: string }> = {
  revenue: { text: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/25' },
  cogs: { text: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/25' },
  operating: { text: 'text-sky-300', bg: 'bg-sky-500/10', border: 'border-sky-500/25' },
  pos_commission: { text: 'text-violet-300', bg: 'bg-violet-500/10', border: 'border-violet-500/25' },
  payroll: { text: 'text-blue-300', bg: 'bg-blue-500/10', border: 'border-blue-500/25' },
  payroll_advance: { text: 'text-blue-300', bg: 'bg-blue-500/10', border: 'border-blue-500/25' },
  payroll_tax: { text: 'text-indigo-300', bg: 'bg-indigo-500/10', border: 'border-indigo-500/25' },
  income_tax: { text: 'text-rose-300', bg: 'bg-rose-500/10', border: 'border-rose-500/25' },
  financial_expenses: { text: 'text-fuchsia-300', bg: 'bg-fuchsia-500/10', border: 'border-fuchsia-500/25' },
  non_operating: { text: 'text-orange-300', bg: 'bg-orange-500/10', border: 'border-orange-500/25' },
  depreciation: { text: 'text-cyan-300', bg: 'bg-cyan-500/10', border: 'border-cyan-500/25' },
  capex: { text: 'text-amber-300', bg: 'bg-amber-500/10', border: 'border-amber-500/25' },
  profit_distribution: { text: 'text-purple-300', bg: 'bg-purple-500/10', border: 'border-purple-500/25' },
}
const groupStyle = (g: string | null) => GROUP_STYLE[g || 'operating'] || { text: 'text-slate-300', bg: 'bg-slate-500/10', border: 'border-slate-500/20' }

type Category = {
  id: string
  name: string
  type?: string | null
  accounting_group: FinancialGroup | null
  monthly_budget: number | null
  spent_this_month?: number | null
  created_at?: string
}

type PageTab = 'categories' | 'groups'

export default function CategoriesPage() {
  const { can } = useCapabilities()
  const [tab, setTab] = useState<PageTab>('categories')
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  // Форма добавления
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('')
  const [newAccountingGroup, setNewAccountingGroup] = useState<FinancialGroup>('operating')
  const [newBudget, setNewBudget] = useState('')

  // Редактирование
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editType, setEditType] = useState('')
  const [editAccountingGroup, setEditAccountingGroup] = useState<FinancialGroup>('operating')
  const [editBudget, setEditBudget] = useState('')

  const [saving, setSaving] = useState(false)

  const loadCategories = async () => {
    setLoading(true)
    const response = await fetch('/api/admin/expense-categories?with_usage=1', { cache: 'no-store' })
    const body = await response.json().catch(() => null)

    if (!response.ok) {
      setError('Ошибка загрузки')
    } else {
      setCategories((body?.data || []) as Category[])
    }
    setLoading(false)
  }

  useEffect(() => { loadCategories() }, [])

  const filteredCategories = useMemo(() => {
    return categories.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()))
  }, [categories, searchTerm])

  // Количество категорий по группе
  const countByGroup = useMemo(() => {
    const map: Record<string, number> = {}
    for (const cat of categories) {
      const g = cat.accounting_group || 'operating'
      map[g] = (map[g] || 0) + 1
    }
    return map
  }, [categories])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    setSaving(true)
    const response = await fetch('/api/admin/expense-categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newName.trim(),
        accounting_group: newAccountingGroup,
        monthly_budget: Number(newBudget) || 0,
      }),
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) {
      setError(body?.error || 'Ошибка сохранения')
    } else {
      setNewName('')
      setNewType('')
      setNewAccountingGroup('operating')
      setNewBudget('')
      loadCategories()
    }
    setSaving(false)
  }

  const startEdit = (cat: Category) => {
    setEditingId(cat.id)
    setEditName(cat.name)
    setEditType(cat.type || '')
    setEditAccountingGroup((cat.accounting_group as FinancialGroup) || 'operating')
    setEditBudget(String(cat.monthly_budget || ''))
  }

  const handleSaveEdit = async () => {
    if (!editingId || !editName.trim()) return
    setSaving(true)
    const response = await fetch('/api/admin/expense-categories', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingId,
        name: editName.trim(),
        accounting_group: editAccountingGroup,
        monthly_budget: Number(editBudget) || 0,
      }),
    })
    if (!response.ok) {
      setError('Ошибка обновления')
    } else {
      setEditingId(null)
      loadCategories()
    }
    setSaving(false)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить эту категорию?')) return
    setSaving(true)
    const response = await fetch(`/api/admin/expense-categories?id=${id}`, { method: 'DELETE' })
    if (response.ok) setCategories(prev => prev.filter(c => c.id !== id))
    setSaving(false)
  }

  return (
    <div className="app-page-wide space-y-6">

      {/* Хедер */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <Layers className="w-8 h-8 text-accent" />
            Справочник категорий
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Управление статьями расходов и финансовыми группами
          </p>
        </div>
        <Card className="px-4 py-2 border-border bg-card/50 flex flex-col items-center">
          <span className="text-[10px] text-muted-foreground uppercase font-bold">Категорий</span>
          <span className="text-xl font-bold text-foreground">{categories.length}</span>
        </Card>
      </div>

      {/* Вкладки */}
      <div className="flex gap-1 border-b border-border">
        {([
          { id: 'categories' as const, label: 'Категории расходов', icon: Tag },
          { id: 'groups'     as const, label: 'Финансовые группы',  icon: BarChart3 },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === id
                ? 'border-accent text-accent'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ═══ ВКЛАДКА 1: КАТЕГОРИИ ═══ */}
      {tab === 'categories' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">

          {/* Список */}
          <div className="lg:col-span-2 space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Поиск категории..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-card border border-border rounded-lg py-3 pl-10 pr-4 text-sm focus:border-accent transition-colors"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {loading && <div className="col-span-2 text-center py-10 text-muted-foreground animate-pulse">Загрузка...</div>}

              {!loading && filteredCategories.map((cat) => (
                <Card key={cat.id} className={`group relative overflow-hidden border-white/[0.08] bg-white/[0.025] p-4 transition-all ${editingId === cat.id ? 'ring-2 ring-amber-500/40' : 'hover:border-white/20 hover:bg-white/[0.05]'}`}>
                  {editingId === cat.id ? (
                    <div className="space-y-3 relative z-10">
                      <div>
                        <label className="text-[10px] text-muted-foreground">Название</label>
                        <input value={editName} onChange={e => setEditName(e.target.value)}
                          className="w-full bg-input border border-border rounded px-2 py-1 text-sm font-bold" autoFocus />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Тип</label>
                        <input value={editType} onChange={e => setEditType(e.target.value)}
                          className="w-full bg-input border border-border rounded px-2 py-1 text-xs" />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Финансовая группа</label>
                        <Select value={editAccountingGroup} onValueChange={(v) => setEditAccountingGroup(v as FinancialGroup)}>
                          <SelectTrigger className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {FINANCIAL_GROUP_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Месячный бюджет (₸)</label>
                        <input type="number" value={editBudget} onChange={e => setEditBudget(e.target.value)}
                          placeholder="0 — без лимита"
                          className="w-full bg-input border border-border rounded px-2 py-1 text-xs" />
                      </div>
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" onClick={handleSaveEdit} disabled={saving} className="h-7 text-xs bg-green-600 hover:bg-green-700">
                          <Save className="w-3 h-3 mr-1" /> Сохранить
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)} className="h-7 text-xs">
                          <X className="w-3 h-3 mr-1" /> Отмена
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-between items-start relative z-10">
                      <div>
                        <div className="mb-2 flex items-center gap-2.5">
                          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${groupStyle(cat.accounting_group).bg} ${groupStyle(cat.accounting_group).border} ${groupStyle(cat.accounting_group).text}`}>
                            <Tag className="h-4 w-4" />
                          </span>
                          <h3 className="truncate font-bold text-foreground">{cat.name}</h3>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center rounded border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {cat.type || 'Общее'}
                          </span>
                          <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-medium ${groupStyle(cat.accounting_group).bg} ${groupStyle(cat.accounting_group).border} ${groupStyle(cat.accounting_group).text}`}>
                            {getFinancialGroupLabel(cat.accounting_group)}
                          </span>
                        </div>
                        {cat.monthly_budget && cat.monthly_budget > 0 ? (
                          (() => {
                            const budget = Number(cat.monthly_budget || 0)
                            const spent = Number(cat.spent_this_month || 0)
                            const pct = budget > 0 ? Math.min(100, Math.round((spent / budget) * 100)) : 0
                            const overBy = Math.max(0, spent - budget)
                            const barColor =
                              pct >= 100
                                ? 'bg-red-500'
                                : pct >= 90
                                  ? 'bg-red-400'
                                  : pct >= 70
                                    ? 'bg-amber-400'
                                    : 'bg-emerald-400'
                            const textColor =
                              pct >= 100
                                ? 'text-red-400'
                                : pct >= 90
                                  ? 'text-red-300'
                                  : pct >= 70
                                    ? 'text-amber-400'
                                    : 'text-emerald-400'
                            return (
                              <div className="mt-2 space-y-1">
                                <div className="flex items-center justify-between text-[11px]">
                                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                                    <Banknote className="w-3 h-3" /> Бюджет
                                  </span>
                                  <span className={textColor}>
                                    {spent.toLocaleString('ru-RU')} / {budget.toLocaleString('ru-RU')} ₸ ({pct}%)
                                  </span>
                                </div>
                                <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
                                  <div
                                    className={`h-full transition-all ${barColor}`}
                                    style={{ width: `${Math.min(100, pct)}%` }}
                                  />
                                </div>
                                {overBy > 0 ? (
                                  <p className="text-[10px] text-red-400">
                                    Превышение на {overBy.toLocaleString('ru-RU')} ₸
                                  </p>
                                ) : null}
                              </div>
                            )
                          })()
                        ) : null}
                      </div>
                      <div className="flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                        {can('categories.edit') && (
                          <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-accent" onClick={() => startEdit(cat)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}
                        {can('categories.delete') && (
                          <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-red-500" onClick={() => handleDelete(cat.id)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  <div className={`pointer-events-none absolute -bottom-8 -right-8 h-24 w-24 rounded-full blur-2xl ${groupStyle(cat.accounting_group).bg}`} />
                </Card>
              ))}
            </div>
          </div>

          {/* Форма создания */}
          {can('categories.create') && (
          <div className="lg:col-span-1">
            <Card className="sticky top-6 border-white/[0.08] bg-white/[0.03] p-6">
              <div className="flex items-center gap-2 mb-6 pb-4 border-b border-border">
                <div className="p-2 bg-accent/10 rounded-lg text-accent">
                  <Plus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-foreground">Новая категория</h3>
                  <p className="text-xs text-muted-foreground">Добавить статью расходов</p>
                </div>
              </div>

              <form onSubmit={handleAdd} className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Название *</label>
                  <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
                    placeholder="Например: Такси"
                    className="w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm focus:border-accent transition-colors" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Тип / Группа</label>
                  <input type="text" value={newType} onChange={e => setNewType(e.target.value)}
                    placeholder="Например: Транспорт"
                    className="w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm focus:border-accent transition-colors" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Финансовая группа</label>
                  <Select value={newAccountingGroup} onValueChange={(v) => setNewAccountingGroup(v as FinancialGroup)}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FINANCIAL_GROUP_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {FINANCIAL_GROUP_OPTIONS.find(o => o.value === newAccountingGroup)?.description}
                  </p>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Месячный бюджет (₸)</label>
                  <input type="number" value={newBudget} onChange={e => setNewBudget(e.target.value)}
                    placeholder="0 — без лимита"
                    className="w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm focus:border-accent transition-colors" />
                </div>
                <Button type="submit" disabled={!newName.trim() || saving}
                  className="w-full bg-accent text-accent-foreground hover:bg-accent/90 mt-2">
                  {saving ? 'Сохранение...' : 'Создать категорию'}
                </Button>
              </form>

              {error && (
                <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" /> {error}
                </div>
              )}
            </Card>
          </div>
          )}
        </div>
      )}

      {/* ═══ ВКЛАДКА 2: ФИНАНСОВЫЕ ГРУППЫ ═══ */}
      {tab === 'groups' && (
        <div className="space-y-6">

        {/* Info-баннер: почему группы фиксированные */}
        <div className="rounded-xl border border-blue-500/25 bg-blue-500/5 px-4 py-3 flex items-start gap-3">
          <div className="shrink-0 p-1.5 rounded-lg bg-blue-500/15 text-blue-300">
            <Info className="w-4 h-4" />
          </div>
          <div className="text-xs text-muted-foreground leading-relaxed flex-1">
            <p className="font-semibold text-foreground mb-1 flex items-center gap-1.5">
              <Lock className="w-3 h-3" />
              Финансовые группы стандартизированы и не редактируются
            </p>
            <p>
              Это узлы цепочки P&L (ОПИУ): <span className="text-foreground">Выручка → COGS → Валовая → Операционные/ФОТ → EBITDA → Амортизация → EBIT → Финансовые → EBT → Налог → Чистая прибыль</span>. Дашборд, /profitability и cashflow считают показатели на основе этого порядка. Любая ваша категория относится к одной из 11 групп — выберите подходящую при создании.
            </p>
            <p className="mt-1.5">
              <span className="text-purple-300 font-medium">Доля партнёра / дивиденды</span> → группа <span className="text-foreground font-medium">«Распределение прибыли»</span> (вне P&L, как CAPEX).
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

          {/* P&L Цепочка */}
          <div className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
              Цепочка P&L (ОПИУ)
            </h2>

            {PL_CHAIN.map((node, idx) => {
              if (node.kind === 'subtotal') {
                const isFirst = node.key === 'revenue'
                const isLast = node.key === 'net'
                return (
                  <div key={node.key}
                    className={`flex items-center justify-between rounded-xl px-4 py-3 font-bold text-sm ${
                      isLast
                        ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                        : isFirst
                        ? 'bg-blue-500/15 border border-blue-500/30 text-blue-300'
                        : 'bg-white/[0.06] border border-white/10 text-foreground'
                    }`}
                  >
                    <span>{node.label}</span>
                    {isFirst && <span className="text-xs font-normal text-muted-foreground">100%</span>}
                    {isLast && <span className="text-xs font-normal text-emerald-400">Цель</span>}
                  </div>
                )
              }

              const groupInfo = FINANCIAL_GROUP_OPTIONS.find(o => o.value === node.group)!
              const count = countByGroup[node.group] || 0
              return (
                <div key={node.group} className="flex items-center gap-3 pl-4">
                  <div className="flex flex-col items-center w-4 self-stretch">
                    <div className="w-px flex-1 bg-white/10" />
                  </div>
                  <div className="flex-1 flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 my-0.5">
                    <div className="flex items-center gap-2">
                      <TrendingDown className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-foreground">— {groupInfo.label}</p>
                        <p className="text-[11px] text-muted-foreground">{groupInfo.description}</p>
                      </div>
                    </div>
                    <span className={`ml-3 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      count > 0 ? 'bg-accent/15 text-accent' : 'bg-white/5 text-muted-foreground'
                    }`}>
                      {count} кат.
                    </span>
                  </div>
                </div>
              )
            })}

            {/* Off-chain группы (CAPEX, Распределение прибыли) — отдельно от P&L цепочки */}
            <div className="mt-6 space-y-2">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground/70 px-1 flex items-center gap-1.5">
                <Wallet className="w-3 h-3" />
                Вне P&L (после чистой прибыли)
              </p>
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-amber-300">CAPEX</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Покупка оборудования — капитализируется, не идёт в расход периода.
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    (countByGroup['capex'] || 0) > 0 ? 'bg-amber-500/20 text-amber-300' : 'bg-white/5 text-muted-foreground'
                  }`}>
                    {countByGroup['capex'] || 0} кат.
                  </span>
                </div>
              </div>
              <div className="rounded-xl border border-purple-500/25 bg-purple-500/5 px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-purple-300 flex items-center gap-1.5">
                      <PieChart className="w-3.5 h-3.5" />
                      Распределение прибыли
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Доля партнёра, дивиденды учредителям — выплата УЖЕ полученной чистой прибыли.
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    (countByGroup['profit_distribution'] || 0) > 0 ? 'bg-purple-500/20 text-purple-300' : 'bg-white/5 text-muted-foreground'
                  }`}>
                    {countByGroup['profit_distribution'] || 0} кат.
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Карточки групп */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-4">
              Все финансовые группы
            </h2>

            {FINANCIAL_GROUP_OPTIONS.map((group) => {
              const count = countByGroup[group.value] || 0
              const catsInGroup = categories.filter(c => (c.accounting_group || 'operating') === group.value)
              return (
                <Card key={group.value} className={`border-l-2 border-white/[0.08] bg-white/[0.025] p-4 transition-colors hover:bg-white/[0.05] ${groupStyle(group.value).border}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${groupStyle(group.value).bg} ${groupStyle(group.value).text} ${groupStyle(group.value).border}`}>
                          {group.label}
                        </span>
                        {group.kind === 'off_chain' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/[0.04] text-muted-foreground border border-white/10">
                            <Wallet className="w-2.5 h-2.5" />
                            Вне P&L
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">{count} категор.</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5">{group.description}</p>
                      {catsInGroup.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {catsInGroup.slice(0, 5).map(c => (
                            <span key={c.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-white/5 text-muted-foreground border border-white/10">
                              <Tag className="w-2.5 h-2.5" />
                              {c.name}
                            </span>
                          ))}
                          {catsInGroup.length > 5 && (
                            <span className="text-[10px] text-muted-foreground">+{catsInGroup.length - 5} ещё</span>
                          )}
                        </div>
                      )}
                    </div>
                    {can('categories.create') && (
                      <button
                        onClick={() => { setNewAccountingGroup(group.value as FinancialGroup); setTab('categories') }}
                        className="shrink-0 flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs text-muted-foreground transition hover:border-accent/40 hover:text-accent"
                      >
                        <Plus className="w-3 h-3" />
                        Добавить
                      </button>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        </div>
        </div>
      )}

    </div>
  )
}
