'use client'

import { useEffect, useState, useMemo } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Plus,
  Pencil,
  Trash2,
  Save,
  X,
  Building2,
  Users,
  Search,
  Shield,
  User,
  Phone,
  Mail,
  Settings,
  Tag,
} from 'lucide-react'
import { FINANCIAL_GROUP_OPTIONS, type FinancialGroup } from '@/lib/core/financial-groups'

// --- Типы ---
type Company = {
  id: string
  name: string
  code: string | null
  show_in_structure: boolean
  created_at?: string
}

type Staff = {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  role: 'manager' | 'marketer' | 'owner' | 'other' | null
  created_at?: string
}

type ExpenseCategory = {
  id: string
  name: string
  monthly_budget: number | null
  accounting_group: FinancialGroup | null
}

export default function SettingsPage() {
  // Данные
  const [companies, setCompanies] = useState<Company[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [loading, setLoading] = useState(true)

  // Поиск
  const [searchCompany, setSearchCompany] = useState('')
  const [searchStaff, setSearchStaff] = useState('')
  const [searchCategory, setSearchCategory] = useState('')

  // Формы создания
  const [newComp, setNewComp] = useState({ name: '', code: '', show_in_structure: true })
  const [newStaff, setNewStaff] = useState({ name: '', phone: '', email: '', role: 'other' })
  const [newCat, setNewCat] = useState({ name: '', monthly_budget: '', accounting_group: '' as FinancialGroup | '' })

  // Редактирование
  const [editCompId, setEditCompId] = useState<string | null>(null)
  const [editCompData, setEditCompData] = useState({ name: '', code: '', show_in_structure: true })

  const [editStaffId, setEditStaffId] = useState<string | null>(null)
  const [editStaffData, setEditStaffData] = useState({ name: '', phone: '', email: '', role: 'other' })

  const [editCatId, setEditCatId] = useState<string | null>(null)
  const [editCatData, setEditCatData] = useState({ name: '', monthly_budget: '', accounting_group: '' as FinancialGroup | '' })

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mutateSettings = async (payload: unknown) => {
    const response = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const json = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(json?.error || `Ошибка запроса (${response.status})`)
    }
  }

  // --- ЗАГРУЗКА ---
  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/settings', { cache: 'no-store' })
      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || `Ошибка запроса (${response.status})`)
      }

      setCompanies((json?.companies || []) as Company[])
      setStaff((json?.staff || []) as Staff[])
      setCategories((json?.categories || []) as ExpenseCategory[])
    } catch (err: any) {
      setError(err?.message || 'Ошибка загрузки данных')
      setCompanies([])
      setStaff([])
      setCategories([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const filteredCategories = useMemo(() => {
    return categories.filter(c => c.name.toLowerCase().includes(searchCategory.toLowerCase()))
  }, [categories, searchCategory])

  // --- ФИЛЬТРАЦИЯ ---
  const filteredCompanies = useMemo(() => {
      return companies.filter(c => 
        c.name.toLowerCase().includes(searchCompany.toLowerCase()) || 
        (c.code && c.code.toLowerCase().includes(searchCompany.toLowerCase()))
      )
  }, [companies, searchCompany])

  const filteredStaff = useMemo(() => {
      return staff.filter(s => 
        s.full_name.toLowerCase().includes(searchStaff.toLowerCase()) ||
        (s.email && s.email.toLowerCase().includes(searchStaff.toLowerCase())) ||
        (s.phone && s.phone.includes(searchStaff))
      )
  }, [staff, searchStaff])


  // --- ЛОГИКА КОМПАНИЙ ---
  const handleAddCompany = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newComp.name.trim()) return
    setSaving(true)

    try {
      await mutateSettings({
        entity: 'company',
        action: 'create',
        payload: {
          name: newComp.name,
          code: newComp.code || null,
          show_in_structure: newComp.show_in_structure,
        },
      })
      setNewComp({ name: '', code: '', show_in_structure: true })
      fetchData()
    } catch (err: any) {
      alert(err.message)
    }
    setSaving(false)
  }

  const handleSaveCompany = async () => {
    if (!editCompId) return
    setSaving(true)
    try {
      await mutateSettings({
        entity: 'company',
        action: 'update',
        id: editCompId,
        payload: {
          name: editCompData.name,
          code: editCompData.code || null,
          show_in_structure: editCompData.show_in_structure,
        },
      })
      setEditCompId(null)
      fetchData()
    }
    catch (err: any) {
      alert(err.message)
    }
    setSaving(false)
  }

  const handleDeleteCompany = async (id: string) => {
      if (!confirm('Удалить компанию? Это может сломать отчеты!')) return
      try {
        await mutateSettings({ entity: 'company', action: 'delete', id })
        fetchData()
      } catch (err: any) {
        alert(err.message)
      }
  }

  // --- ЛОГИКА СОТРУДНИКОВ ---
  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newStaff.name.trim()) return
    setSaving(true)

    try {
      await mutateSettings({
        entity: 'staff',
        action: 'create',
        payload: {
          name: newStaff.name,
          phone: newStaff.phone || null,
          email: newStaff.email || null,
          role: newStaff.role,
        },
      })
      setNewStaff({ name: '', phone: '', email: '', role: 'other' })
      fetchData()
    } catch (err: any) {
      alert(err.message)
    }
    setSaving(false)
  }

  const handleSaveStaff = async () => {
    if (!editStaffId) return
    setSaving(true)
    try {
      await mutateSettings({
        entity: 'staff',
        action: 'update',
        id: editStaffId,
        payload: {
          name: editStaffData.name,
          phone: editStaffData.phone || null,
          email: editStaffData.email || null,
          role: editStaffData.role,
        },
      })
      setEditStaffId(null)
      fetchData()
    } catch (err: any) {
      alert(err.message)
    }
    setSaving(false)
  }

  const handleDeleteStaff = async (id: string) => {
      if (!confirm('Удалить сотрудника?')) return
      try {
        await mutateSettings({ entity: 'staff', action: 'delete', id })
        fetchData()
      } catch (err: any) {
        alert(err.message)
      }
  }

  // --- ЛОГИКА КАТЕГОРИЙ ---
  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCat.name.trim()) return
    setSaving(true)
    try {
      await mutateSettings({
        entity: 'expense_category',
        action: 'create',
        payload: {
          name: newCat.name,
          monthly_budget: newCat.monthly_budget ? Number(newCat.monthly_budget) : null,
          accounting_group: newCat.accounting_group || null,
        },
      })
      setNewCat({ name: '', monthly_budget: '', accounting_group: '' })
      fetchData()
    } catch (err: any) {
      alert(err.message)
    }
    setSaving(false)
  }

  const handleSaveCategory = async () => {
    if (!editCatId) return
    setSaving(true)
    try {
      await mutateSettings({
        entity: 'expense_category',
        action: 'update',
        id: editCatId,
        payload: {
          name: editCatData.name,
          monthly_budget: editCatData.monthly_budget ? Number(editCatData.monthly_budget) : null,
          accounting_group: editCatData.accounting_group || null,
        },
      })
      setEditCatId(null)
      fetchData()
    } catch (err: any) {
      alert(err.message)
    }
    setSaving(false)
  }

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('Удалить категорию? Расходы с этой категорией останутся, но потеряют привязку к финансовой группе.')) return
    try {
      await mutateSettings({ entity: 'expense_category', action: 'delete', id })
      fetchData()
    } catch (err: any) {
      alert(err.message)
    }
  }

  return (
    <>
        <div className="app-page max-w-7xl space-y-8">
          
          {/* Хедер */}
          <div className="flex items-center gap-4">
            <div className="p-3 bg-accent/10 rounded-xl">
                <Settings className="w-8 h-8 text-accent" />
            </div>
            <div>
                <h1 className="text-3xl font-bold text-foreground">Настройки системы</h1>
                <p className="text-muted-foreground mt-1">Управление структурой бизнеса и командой</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 xl:gap-8">
            
            {/* 🏢 КОМПАНИИ */}
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <Building2 className="w-5 h-5 text-blue-400" /> Компании
                    </h2>
                    <span className="text-xs bg-card border border-border px-2 py-1 rounded-full text-muted-foreground">
                        {companies.length} активных
                    </span>
                </div>

                <Card className="p-4 border-border bg-card neon-glow flex flex-col h-[600px]">
                    {/* Поиск */}
                    <div className="relative mb-4">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input 
                            placeholder="Поиск компании..."
                            value={searchCompany}
                            onChange={e => setSearchCompany(e.target.value)}
                            className="w-full bg-input/50 border border-border rounded-lg py-2 pl-9 pr-4 text-sm focus:border-blue-500 transition-colors"
                        />
                    </div>

                    {/* Список */}
                    <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                        {loading && <p className="text-center text-sm text-muted-foreground py-10">Загрузка...</p>}
                        {!loading && filteredCompanies.map(c => (
                            <div key={c.id} className="group p-3 rounded-lg border border-border/50 bg-black/20 hover:bg-white/5 transition-all flex items-center justify-between">
                                {editCompId === c.id ? (
                                    <div className="flex-1 flex items-center gap-2">
                                        <input 
                                            value={editCompData.name} 
                                            onChange={e => setEditCompData({...editCompData, name: e.target.value})}
                                            className="bg-input border border-border rounded px-2 py-1 text-sm flex-1"
                                            autoFocus
                                        />
                                        <input 
                                            value={editCompData.code} 
                                            onChange={e => setEditCompData({...editCompData, code: e.target.value})}
                                            className="bg-input border border-border rounded px-2 py-1 text-sm w-20 uppercase"
                                            placeholder="CODE"
                                        />
                                        <label className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap">
                                            <input
                                                type="checkbox"
                                                checked={editCompData.show_in_structure}
                                                onChange={e => setEditCompData({ ...editCompData, show_in_structure: e.target.checked })}
                                                className="rounded border-white/10 bg-input"
                                            />
                                            В структуре
                                        </label>
                                        <Button size="icon" className="h-7 w-7 bg-green-600 hover:bg-green-700" onClick={handleSaveCompany}>
                                            <Save className="w-3 h-3" />
                                        </Button>
                                        <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setEditCompId(null)}>
                                            <X className="w-3 h-3" />
                                        </Button>
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded bg-blue-500/10 flex items-center justify-center text-blue-500 font-bold text-xs">
                                                {c.name.charAt(0)}
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-foreground">{c.name}</p>
                                                <div className="flex flex-wrap items-center gap-2">
                                                    {c.code && <span className="text-[10px] text-muted-foreground bg-white/5 px-1.5 rounded uppercase tracking-wider">{c.code}</span>}
                                                    <span className={`text-[10px] px-1.5 rounded border ${c.show_in_structure ? 'text-cyan-300 border-cyan-500/30 bg-cyan-500/10' : 'text-gray-400 border-white/10 bg-white/5'}`}>
                                                        {c.show_in_structure ? 'В структуре' : 'Скрыта'}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-blue-400" onClick={() => { setEditCompId(c.id); setEditCompData({ name: c.name, code: c.code || '', show_in_structure: c.show_in_structure }) }}>
                                                <Pencil className="w-3 h-3" />
                                            </Button>
                                            <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-red-400" onClick={() => handleDeleteCompany(c.id)}>
                                                <Trash2 className="w-3 h-3" />
                                            </Button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Добавление */}
                    <div className="pt-4 mt-2 border-t border-border">
                        <form onSubmit={handleAddCompany} className="flex gap-2">
                            <input 
                                value={newComp.name}
                                onChange={e => setNewComp({...newComp, name: e.target.value})}
                                placeholder="Новая компания..."
                                className="flex-1 bg-input border border-border rounded-lg px-3 py-2 text-sm focus:border-blue-500"
                            />
                            <input 
                                value={newComp.code}
                                onChange={e => setNewComp({...newComp, code: e.target.value})}
                                placeholder="CODE"
                                className="w-24 bg-input border border-border rounded-lg px-3 py-2 text-sm uppercase focus:border-blue-500"
                            />
                            <label className="flex items-center gap-2 rounded-lg border border-border bg-input px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                                <input
                                    type="checkbox"
                                    checked={newComp.show_in_structure}
                                    onChange={e => setNewComp({ ...newComp, show_in_structure: e.target.checked })}
                                    className="rounded border-white/10 bg-input"
                                />
                                В структуре
                            </label>
                            <Button type="submit" disabled={!newComp.name.trim() || saving} className="bg-blue-600 hover:bg-blue-700">
                                <Plus className="w-4 h-4" />
                            </Button>
                        </form>
                    </div>
                </Card>
            </div>

            {/* 👥 СОТРУДНИКИ (Обновлено: Email + Телефон) */}
            <div className="space-y-6">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <Users className="w-5 h-5 text-purple-400" /> Команда
                    </h2>
                    <span className="text-xs bg-card border border-border px-2 py-1 rounded-full text-muted-foreground">
                        {staff.length} человек
                    </span>
                </div>

                <Card className="p-4 border-border bg-card neon-glow flex flex-col h-[600px]">
                    {/* Поиск */}
                    <div className="relative mb-4">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <input 
                            placeholder="Поиск сотрудника..."
                            value={searchStaff}
                            onChange={e => setSearchStaff(e.target.value)}
                            className="w-full bg-input/50 border border-border rounded-lg py-2 pl-9 pr-4 text-sm focus:border-purple-500 transition-colors"
                        />
                    </div>

                    {/* Список */}
                    <div className="flex-1 overflow-y-auto space-y-3 pr-2">
                        {loading && <p className="text-center text-sm text-muted-foreground py-10">Загрузка...</p>}
                        {!loading && filteredStaff.map(s => (
                            <div key={s.id} className="group p-3 rounded-lg border border-border/50 bg-black/20 hover:bg-white/5 transition-all">
                                {editStaffId === s.id ? (
                                    // РЕЖИМ РЕДАКТИРОВАНИЯ СОТРУДНИКА
                                    <div className="space-y-2">
                                        <input 
                                            value={editStaffData.name} 
                                            onChange={e => setEditStaffData({...editStaffData, name: e.target.value})} 
                                            className="w-full bg-input border border-border rounded px-2 py-1 text-sm font-bold" 
                                            placeholder="ФИО"
                                        />
                                        <input 
                                            value={editStaffData.email} 
                                            onChange={e => setEditStaffData({...editStaffData, email: e.target.value})} 
                                            className="w-full bg-input border border-border rounded px-2 py-1 text-xs" 
                                            placeholder="Email (для входа)"
                                        />
                                        <div className="flex gap-2">
                                            <input 
                                                value={editStaffData.phone} 
                                                onChange={e => setEditStaffData({...editStaffData, phone: e.target.value})} 
                                                className="flex-1 bg-input border border-border rounded px-2 py-1 text-xs" 
                                                placeholder="Телефон"
                                            />
                                            <select 
                                                value={editStaffData.role} 
                                                onChange={e => setEditStaffData({...editStaffData, role: e.target.value})} 
                                                className="bg-input border border-border rounded px-2 py-1 text-xs"
                                            >
                                                <option value="other">Сотрудник</option>
                                                <option value="manager">Руководитель</option>
                                                <option value="marketer">Маркетолог</option>
                                                <option value="owner">Владелец</option>
                                            </select>
                                        </div>
                                        <div className="flex justify-end gap-2 mt-2">
                                            <Button size="sm" onClick={handleSaveStaff} disabled={saving} className="h-7 text-xs bg-green-600"><Save className="w-3 h-3 mr-1"/> Сохранить</Button>
                                            <Button size="sm" variant="outline" onClick={() => setEditStaffId(null)} className="h-7 text-xs"><X className="w-3 h-3 mr-1"/> Отмена</Button>
                                        </div>
                                    </div>
                                ) : (
                                    // РЕЖИМ ПРОСМОТРА
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3 overflow-hidden">
                                            <div className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-white text-xs ${
                                              s.role === 'owner' ? 'bg-amber-600' :
                                              s.role === 'manager' ? 'bg-blue-600' :
                                              s.role === 'marketer' ? 'bg-purple-600' :
                                              'bg-gray-700'
                                            }`}>
                                                {s.role === 'owner' || s.role === 'manager' || s.role === 'marketer' ? <Shield className="w-3 h-3" /> : <User className="w-3 h-3" />}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <p className="text-sm font-medium text-foreground truncate">{s.full_name}</p>
                                                    <span className={`text-[9px] px-1.5 rounded border uppercase shrink-0 ${
                                                        s.role === 'owner' ? 'text-amber-400 border-amber-500/30 bg-amber-500/10' :
                                                        s.role === 'manager' ? 'text-blue-400 border-blue-500/30 bg-blue-500/10' :
                                                        s.role === 'marketer' ? 'text-purple-400 border-purple-500/30 bg-purple-500/10' :
                                                        'text-muted-foreground border-white/10 bg-white/5'
                                                    }`}>
                                                        {s.role === 'owner' ? 'Owner' : s.role === 'manager' ? 'Manager' : s.role === 'marketer' ? 'Marketer' : 'Other'}
                                                    </span>
                                                </div>
                                                <div className="flex flex-col gap-0.5 mt-0.5 text-[10px] text-muted-foreground">
                                                    {s.email && <span className="flex items-center gap-1 truncate"><Mail className="w-2.5 h-2.5" /> {s.email}</span>}
                                                    {s.phone && <span className="flex items-center gap-1 truncate"><Phone className="w-2.5 h-2.5" /> {s.phone}</span>}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-purple-400" onClick={() => { setEditStaffId(s.id); setEditStaffData({ name: s.full_name, phone: s.phone || '', email: s.email || '', role: s.role || 'other' }) }}>
                                                <Pencil className="w-3 h-3" />
                                            </Button>
                                            <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-red-400" onClick={() => handleDeleteStaff(s.id)}>
                                                <Trash2 className="w-3 h-3" />
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Добавление (Обновлено: Email обязателен) */}
                    <div className="pt-4 mt-2 border-t border-border">
                        <form onSubmit={handleAddStaff} className="space-y-2">
                            <input 
                                value={newStaff.name}
                                onChange={e => setNewStaff({...newStaff, name: e.target.value})}
                                placeholder="ФИО сотрудника..."
                                className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm focus:border-purple-500"
                            />
                            {/* Поле Email теперь видно сразу */}
                            <input 
                                value={newStaff.email}
                                onChange={e => setNewStaff({...newStaff, email: e.target.value})}
                                placeholder="Email (для входа)..."
                                className="w-full bg-input border border-border rounded-lg px-3 py-2 text-xs focus:border-purple-500"
                            />
                            <div className="flex gap-2">
                                <input 
                                    value={newStaff.phone}
                                    onChange={e => setNewStaff({...newStaff, phone: e.target.value})}
                                    placeholder="Телефон"
                                    className="flex-1 bg-input border border-border rounded-lg px-3 py-2 text-xs focus:border-purple-500"
                                />
                                <select 
                                    value={newStaff.role}
                                    onChange={e => setNewStaff({...newStaff, role: e.target.value})}
                                    className="w-28 bg-input border border-border rounded-lg px-2 py-2 text-xs focus:border-purple-500"
                                >
                                    <option value="other">Сотрудник</option>
                                    <option value="manager">Руководитель</option>
                                    <option value="marketer">Маркетолог</option>
                                    <option value="owner">Владелец</option>
                                </select>
                            </div>
                            <Button type="submit" disabled={!newStaff.name.trim() || saving} className="w-full bg-purple-600 hover:bg-purple-700 mt-2">
                                <Plus className="w-4 h-4 mr-2" /> Добавить сотрудника
                            </Button>
                        </form>
                    </div>
                </Card>
            </div>

          </div>

          {/* 🏷️ КАТЕГОРИИ РАСХОДОВ */}
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Tag className="w-5 h-5 text-amber-400" /> Категории расходов
              </h2>
              <span className="text-xs bg-card border border-border px-2 py-1 rounded-full text-muted-foreground">
                {categories.length} категорий
              </span>
            </div>

            <Card className="p-4 border-border bg-card neon-glow flex flex-col" style={{ minHeight: 400 }}>
              {/* Поиск */}
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  placeholder="Поиск категории..."
                  value={searchCategory}
                  onChange={e => setSearchCategory(e.target.value)}
                  className="w-full bg-input/50 border border-border rounded-lg py-2 pl-9 pr-4 text-sm focus:border-amber-500 transition-colors"
                />
              </div>

              {/* Список */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[480px]">
                {loading && <p className="text-center text-sm text-muted-foreground py-10">Загрузка...</p>}
                {!loading && filteredCategories.map(cat => {
                  const groupOption = FINANCIAL_GROUP_OPTIONS.find(g => g.value === cat.accounting_group)
                  return (
                    <div key={cat.id} className="group p-3 rounded-lg border border-border/50 bg-black/20 hover:bg-white/5 transition-all flex items-center justify-between gap-2">
                      {editCatId === cat.id ? (
                        <div className="flex-1 flex flex-wrap items-center gap-2">
                          <input
                            value={editCatData.name}
                            onChange={e => setEditCatData({ ...editCatData, name: e.target.value })}
                            className="bg-input border border-border rounded px-2 py-1 text-sm flex-1 min-w-32"
                            autoFocus
                          />
                          <select
                            value={editCatData.accounting_group}
                            onChange={e => setEditCatData({ ...editCatData, accounting_group: e.target.value as FinancialGroup | '' })}
                            className="bg-input border border-border rounded px-2 py-1 text-sm [color-scheme:dark]"
                          >
                            <option value="">— Авто —</option>
                            {FINANCIAL_GROUP_OPTIONS.map(g => (
                              <option key={g.value} value={g.value}>{g.label}</option>
                            ))}
                          </select>
                          <input
                            type="number"
                            value={editCatData.monthly_budget}
                            onChange={e => setEditCatData({ ...editCatData, monthly_budget: e.target.value })}
                            placeholder="Бюджет/мес"
                            className="bg-input border border-border rounded px-2 py-1 text-sm w-28"
                          />
                          <Button size="icon" className="h-7 w-7 bg-green-600 hover:bg-green-700" onClick={handleSaveCategory}>
                            <Save className="w-3 h-3" />
                          </Button>
                          <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => setEditCatId(null)}>
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div className="w-8 h-8 shrink-0 rounded bg-amber-500/10 flex items-center justify-center text-amber-400">
                              <Tag className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{cat.name}</p>
                              <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                {groupOption ? (
                                  <span className="text-[10px] px-1.5 rounded border text-amber-300 border-amber-500/30 bg-amber-500/10">
                                    {groupOption.label}
                                  </span>
                                ) : (
                                  <span className="text-[10px] px-1.5 rounded border text-muted-foreground border-white/10 bg-white/5">
                                    Авто
                                  </span>
                                )}
                                {cat.monthly_budget ? (
                                  <span className="text-[10px] text-muted-foreground">
                                    бюджет {cat.monthly_budget.toLocaleString('ru')} ₸/мес
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-amber-400" onClick={() => {
                              setEditCatId(cat.id)
                              setEditCatData({
                                name: cat.name,
                                monthly_budget: cat.monthly_budget ? String(cat.monthly_budget) : '',
                                accounting_group: cat.accounting_group || '',
                              })
                            }}>
                              <Pencil className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-red-400" onClick={() => handleDeleteCategory(cat.id)}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Добавление */}
              <div className="pt-4 mt-2 border-t border-border">
                <form onSubmit={handleAddCategory} className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      value={newCat.name}
                      onChange={e => setNewCat({ ...newCat, name: e.target.value })}
                      placeholder="Название категории..."
                      className="flex-1 bg-input border border-border rounded-lg px-3 py-2 text-sm focus:border-amber-500"
                    />
                    <input
                      type="number"
                      value={newCat.monthly_budget}
                      onChange={e => setNewCat({ ...newCat, monthly_budget: e.target.value })}
                      placeholder="Бюджет ₸"
                      className="w-28 bg-input border border-border rounded-lg px-3 py-2 text-sm focus:border-amber-500"
                    />
                  </div>
                  <div className="flex gap-2">
                    <select
                      value={newCat.accounting_group}
                      onChange={e => setNewCat({ ...newCat, accounting_group: e.target.value as FinancialGroup | '' })}
                      className="flex-1 bg-input border border-border rounded-lg px-3 py-2 text-sm focus:border-amber-500 [color-scheme:dark]"
                    >
                      <option value="">— Финансовая группа (Авто) —</option>
                      {FINANCIAL_GROUP_OPTIONS.map(g => (
                        <option key={g.value} value={g.value}>{g.label} — {g.description}</option>
                      ))}
                    </select>
                    <Button type="submit" disabled={!newCat.name.trim() || saving} className="bg-amber-600 hover:bg-amber-700">
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                </form>
              </div>
            </Card>
          </div>

        </div>
    </>
  )
}
