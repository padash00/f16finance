'use client'

import { useEffect, useState, useMemo } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
} from 'lucide-react'

type Category = {
  id: string
  name: string
  type?: string | null
  accounting_group: FinancialGroup | null
  monthly_budget: number | null
  created_at?: string
}

type PageTab = 'categories' | 'groups'

export default function CategoriesPage() {
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
    const response = await fetch('/api/admin/expense-categories', { cache: 'no-store' })
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
    <div className="app-page max-w-6xl space-y-6">

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
                <Card key={cat.id} className={`p-4 border-border bg-card neon-glow group relative overflow-hidden transition-all ${editingId === cat.id ? 'ring-2 ring-accent' : 'hover:bg-white/5'}`}>
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
                        <select value={editAccountingGroup} onChange={e => setEditAccountingGroup(e.target.value as FinancialGroup)}
                          className="w-full bg-input border border-border rounded px-2 py-1 text-xs">
                          {FINANCIAL_GROUP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
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
                        <div className="flex items-center gap-2 mb-1">
                          <Tag className="w-4 h-4 text-accent opacity-70" />
                          <h3 className="font-bold text-foreground">{cat.name}</h3>
                        </div>
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-white/5 text-muted-foreground border border-white/10">
                          {cat.type || 'Общее'}
                        </span>
                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-accent/10 text-accent border border-accent/20">
                          {getFinancialGroupLabel(cat.accounting_group)}
                        </span>
                        {cat.monthly_budget && cat.monthly_budget > 0 ? (
                          <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                            <Banknote className="w-3 h-3" /> Бюджет: {cat.monthly_budget.toLocaleString('ru-RU')} ₸/мес
                          </p>
                        ) : null}
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-accent" onClick={() => startEdit(cat)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-red-500" onClick={() => handleDelete(cat.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                  <div className="absolute -bottom-6 -right-6 w-24 h-24 bg-accent/5 rounded-full blur-2xl pointer-events-none" />
                </Card>
              ))}
            </div>
          </div>

          {/* Форма создания */}
          <div className="lg:col-span-1">
            <Card className="p-6 border-border bg-card neon-glow sticky top-6">
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
                  <select value={newAccountingGroup} onChange={e => setNewAccountingGroup(e.target.value as FinancialGroup)}
                    className="w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm focus:border-accent transition-colors">
                    {FINANCIAL_GROUP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
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
        </div>
      )}

      {/* ═══ ВКЛАДКА 2: ФИНАНСОВЫЕ ГРУППЫ ═══ */}
      {tab === 'groups' && (
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

            {/* CAPEX отдельно */}
            <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-amber-300">CAPEX (отдельно)</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Покупка оборудования — не входит в P&L цепочку, учитывается отдельным блоком.
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  (countByGroup['capex'] || 0) > 0 ? 'bg-amber-500/20 text-amber-300' : 'bg-white/5 text-muted-foreground'
                }`}>
                  {countByGroup['capex'] || 0} кат.
                </span>
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
                <Card key={group.value} className="p-4 border-border bg-card/60 hover:bg-white/5 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-accent/15 text-accent border border-accent/20">
                          {group.label}
                        </span>
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
                    <button
                      onClick={() => { setNewAccountingGroup(group.value as FinancialGroup); setTab('categories') }}
                      className="shrink-0 flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs text-muted-foreground transition hover:border-accent/40 hover:text-accent"
                    >
                      <Plus className="w-3 h-3" />
                      Добавить
                    </button>
                  </div>
                </Card>
              )
            })}
          </div>
        </div>
      )}

    </div>
  )
}
