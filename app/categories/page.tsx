'use client'

import { useEffect, useState, useMemo } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import { FINANCIAL_GROUP_OPTIONS, getFinancialGroupLabel, type FinancialGroup } from '@/lib/core/financial-groups'
import { 
  Plus, 
  Pencil, 
  Trash2, 
  Save, 
  X, 
  Tag, 
  Layers, 
  Search,
  AlertCircle
} from 'lucide-react'

type Category = {
  id: string
  name: string
  type: string | null
  accounting_group: FinancialGroup | null
  monthly_budget: number | null
  created_at: string
}

// SQL: ALTER TABLE expense_categories ADD COLUMN monthly_budget numeric DEFAULT 0;

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  // Форма добавления
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('')
  const [newAccountingGroup, setNewAccountingGroup] = useState<FinancialGroup>('operating')

  // Форма добавления - бюджет
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
    const { data, error } = await supabase
      .from('expense_categories')
      .select('id, name, type, accounting_group, monthly_budget, created_at')
      .order('name', { ascending: true })

    if (error) {
      setError('Ошибка загрузки')
    } else {
      setCategories((data || []) as Category[])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadCategories()
  }, [])

  // Фильтрация
  const filteredCategories = useMemo(() => {
    return categories.filter(c => c.name.toLowerCase().includes(searchTerm.toLowerCase()))
  }, [categories, searchTerm])

  // Добавление
  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    setSaving(true)

    const { error } = await supabase.from('expense_categories').insert([{
        name: newName.trim(),
        type: newType.trim() || 'Общее',
        accounting_group: newAccountingGroup,
        monthly_budget: Number(newBudget) || 0,
    }])

    if (error) {
        setError(error.message)
    } else {
        setNewName('')
        setNewType('')
        setNewAccountingGroup('operating')
        setNewBudget('')
        loadCategories()
    }
    setSaving(false)
  }

  // Редактирование
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

    const { error } = await supabase.from('expense_categories')
      .update({ name: editName.trim(), type: editType.trim() || null, accounting_group: editAccountingGroup, monthly_budget: Number(editBudget) || 0 })
      .eq('id', editingId)

    if (error) {
         setError('Ошибка обновления')
    } else {
         setEditingId(null)
         loadCategories()
    }
    setSaving(false)
  }

  // Удаление
  const handleDelete = async (id: string) => {
    if (!confirm('Удалить эту категорию?')) return
    setSaving(true)
    const { error } = await supabase.from('expense_categories').delete().eq('id', id)
    if (!error) {
        setCategories(prev => prev.filter(c => c.id !== id))
    }
    setSaving(false)
  }

  return (
    <div className="app-shell-layout">
      <Sidebar />
      <main className="app-main">
        <div className="app-page max-w-6xl space-y-8">
          
          {/* Хедер */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
                <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
                    <Layers className="w-8 h-8 text-accent" />
                    Справочник категорий
                </h1>
                <p className="text-muted-foreground mt-1 text-sm">
                    Управление статьями расходов для аналитики
                </p>
            </div>

            {/* Статистика */}
            <div className="flex gap-4">
                <Card className="px-4 py-2 border-border bg-card/50 flex flex-col items-center">
                    <span className="text-[10px] text-muted-foreground uppercase font-bold">Всего</span>
                    <span className="text-xl font-bold text-foreground">{categories.length}</span>
                </Card>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* ЛЕВАЯ КОЛОНКА: СПИСОК (Плитки) */}
            <div className="lg:col-span-2 space-y-4">
                
                {/* Поиск */}
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

                {/* Сетка категорий */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {loading && <div className="col-span-2 text-center py-10 text-muted-foreground animate-pulse">Загрузка...</div>}
                    
                    {/* ИСПРАВЛЕНО: используем filteredCategories вместо filteredRows */}
                    {!loading && filteredCategories.map((cat) => (
                        <Card key={cat.id} className={`p-4 border-border bg-card neon-glow group relative overflow-hidden transition-all ${editingId === cat.id ? 'ring-2 ring-accent' : 'hover:bg-white/5'}`}>
                            
                            {editingId === cat.id ? (
                                // РЕЖИМ РЕДАКТИРОВАНИЯ
                                <div className="space-y-3 relative z-10">
                                    <div>
                                        <label className="text-[10px] text-muted-foreground">Название</label>
                                        <input 
                                            value={editName} 
                                            onChange={e => setEditName(e.target.value)}
                                            className="w-full bg-input border border-border rounded px-2 py-1 text-sm font-bold"
                                            autoFocus
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-muted-foreground">Тип</label>
                                        <input 
                                            value={editType} 
                                            onChange={e => setEditType(e.target.value)}
                                            className="w-full bg-input border border-border rounded px-2 py-1 text-xs"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-muted-foreground">Финансовая группа</label>
                                        <select
                                            value={editAccountingGroup}
                                            onChange={e => setEditAccountingGroup(e.target.value as FinancialGroup)}
                                            className="w-full bg-input border border-border rounded px-2 py-1 text-xs"
                                        >
                                            {FINANCIAL_GROUP_OPTIONS.map((option) => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-muted-foreground">Месячный бюджет (₸)</label>
                                        <input
                                            type="number"
                                            value={editBudget}
                                            onChange={e => setEditBudget(e.target.value)}
                                            placeholder="0 — без лимита"
                                            className="w-full bg-input border border-border rounded px-2 py-1 text-xs"
                                        />
                                    </div>
                                    <div className="flex gap-2 pt-1">
                                        <Button size="sm" onClick={handleSaveEdit} disabled={saving} className="h-7 text-xs bg-green-600 hover:bg-green-700">
                                            <Save className="w-3 h-3 mr-1"/> Сохранить
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={() => setEditingId(null)} className="h-7 text-xs">
                                            <X className="w-3 h-3 mr-1"/> Отмена
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                // РЕЖИМ ПРОСМОТРА
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
                                          <p className="text-xs text-amber-400 mt-1">💰 Бюджет: {cat.monthly_budget.toLocaleString('ru-RU')} ₸/мес</p>
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
                            
                            {/* Декор фона */}
                            <div className="absolute -bottom-6 -right-6 w-24 h-24 bg-accent/5 rounded-full blur-2xl pointer-events-none" />
                        </Card>
                    ))}
                </div>
            </div>

            {/* ПРАВАЯ КОЛОНКА: СОЗДАНИЕ */}
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
                            <input 
                                type="text" 
                                value={newName}
                                onChange={e => setNewName(e.target.value)}
                                placeholder="Например: Такси"
                                className="w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm focus:border-accent transition-colors"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Тип / Группа</label>
                            <input 
                                type="text" 
                                value={newType}
                                onChange={e => setNewType(e.target.value)}
                                placeholder="Например: Транспорт"
                                className="w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm focus:border-accent transition-colors"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Финансовая группа</label>
                            <select
                                value={newAccountingGroup}
                                onChange={e => setNewAccountingGroup(e.target.value as FinancialGroup)}
                                className="w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm focus:border-accent transition-colors"
                            >
                                {FINANCIAL_GROUP_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                                {FINANCIAL_GROUP_OPTIONS.find((option) => option.value === newAccountingGroup)?.description}
                            </p>
                        </div>
                        <div>
                            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Месячный бюджет (₸)</label>
                            <input
                                type="number"
                                value={newBudget}
                                onChange={e => setNewBudget(e.target.value)}
                                placeholder="0 — без лимита"
                                className="w-full bg-input border border-border rounded-lg px-3 py-2.5 text-sm focus:border-accent transition-colors"
                            />
                        </div>

                        <Button
                            type="submit" 
                            disabled={!newName.trim() || saving} 
                            className="w-full bg-accent text-accent-foreground hover:bg-accent/90 mt-2"
                        >
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
        </div>
      </main>
    </div>
  )
}
