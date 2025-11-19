'use client'

import { useEffect, useState, useMemo } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
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
  Settings
} from 'lucide-react'

// --- Типы ---
type Company = {
  id: string
  name: string
  code: string | null
  created_at?: string
}

type Staff = {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  role: string | null
  created_at?: string
}

export default function SettingsPage() {
  // Данные
  const [companies, setCompanies] = useState<Company[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [loading, setLoading] = useState(true)

  // Поиск
  const [searchCompany, setSearchCompany] = useState('')
  const [searchStaff, setSearchStaff] = useState('')

  // Формы создания
  const [newComp, setNewComp] = useState({ name: '', code: '' })
  const [newStaff, setNewStaff] = useState({ name: '', phone: '', email: '', role: 'operator' })

  // Редактирование
  const [editCompId, setEditCompId] = useState<string | null>(null)
  const [editCompData, setEditCompData] = useState({ name: '', code: '' })

  const [editStaffId, setEditStaffId] = useState<string | null>(null)
  const [editStaffData, setEditStaffData] = useState({ name: '', phone: '', email: '', role: 'operator' })

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // --- ЗАГРУЗКА ---
  const fetchData = async () => {
    setLoading(true)
    const [compRes, staffRes] = await Promise.all([
        supabase.from('companies').select('*').order('name'),
        supabase.from('staff').select('*').order('full_name')
    ])

    if (compRes.error || staffRes.error) {
        setError('Ошибка загрузки данных')
    } else {
        setCompanies((compRes.data || []) as Company[])
        setStaff((staffRes.data || []) as Staff[])
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchData()
  }, [])

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
    
    const { error } = await supabase.from('companies').insert([{ name: newComp.name, code: newComp.code || null }])
    
    if (!error) {
        setNewComp({ name: '', code: '' })
        fetchData()
    } else {
        alert(error.message)
    }
    setSaving(false)
  }

  const handleSaveCompany = async () => {
    if (!editCompId) return
    setSaving(true)
    const { error } = await supabase.from('companies')
        .update({ name: editCompData.name, code: editCompData.code || null })
        .eq('id', editCompId)
    
    if (!error) {
        setEditCompId(null)
        fetchData()
    }
    setSaving(false)
  }

  const handleDeleteCompany = async (id: string) => {
      if (!confirm('Удалить компанию? Это может сломать отчеты!')) return
      const { error } = await supabase.from('companies').delete().eq('id', id)
      if (!error) fetchData()
  }

  // --- ЛОГИКА СОТРУДНИКОВ ---
  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newStaff.name.trim()) return
    setSaving(true)
    
    const { error } = await supabase.from('staff').insert([{ 
        full_name: newStaff.name, 
        phone: newStaff.phone || null,
        email: newStaff.email || null, // Теперь сохраняем Email!
        role: newStaff.role
    }])
    
    if (!error) {
        setNewStaff({ name: '', phone: '', email: '', role: 'operator' })
        fetchData()
    } else {
        alert(error.message)
    }
    setSaving(false)
  }

  const handleSaveStaff = async () => {
    if (!editStaffId) return
    setSaving(true)
    const { error } = await supabase.from('staff')
        .update({ 
            full_name: editStaffData.name, 
            phone: editStaffData.phone || null,
            email: editStaffData.email || null,
            role: editStaffData.role
        })
        .eq('id', editStaffId)
    
    if (!error) {
        setEditStaffId(null)
        fetchData()
    }
    setSaving(false)
  }

  const handleDeleteStaff = async (id: string) => {
      if (!confirm('Удалить сотрудника?')) return
      const { error } = await supabase.from('staff').delete().eq('id', id)
      if (!error) fetchData()
  }


  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-8 max-w-7xl mx-auto space-y-8">
          
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

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            
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
                                                {c.code && <span className="text-[10px] text-muted-foreground bg-white/5 px-1.5 rounded uppercase tracking-wider">{c.code}</span>}
                                            </div>
                                        </div>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-blue-400" onClick={() => { setEditCompId(c.id); setEditCompData({ name: c.name, code: c.code || '' }) }}>
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
                                                <option value="operator">Оператор</option>
                                                <option value="admin">Админ</option>
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
                                            <div className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-white text-xs ${s.role === 'admin' ? 'bg-purple-600' : 'bg-gray-700'}`}>
                                                {s.role === 'admin' ? <Shield className="w-3 h-3" /> : <User className="w-3 h-3" />}
                                            </div>
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <p className="text-sm font-medium text-foreground truncate">{s.full_name}</p>
                                                    <span className={`text-[9px] px-1.5 rounded border uppercase shrink-0 ${
                                                        s.role === 'admin' ? 'text-purple-400 border-purple-500/30 bg-purple-500/10' : 'text-muted-foreground border-white/10 bg-white/5'
                                                    }`}>
                                                        {s.role === 'admin' ? 'Admin' : 'Operator'}
                                                    </span>
                                                </div>
                                                <div className="flex flex-col gap-0.5 mt-0.5 text-[10px] text-muted-foreground">
                                                    {s.email && <span className="flex items-center gap-1 truncate"><Mail className="w-2.5 h-2.5" /> {s.email}</span>}
                                                    {s.phone && <span className="flex items-center gap-1 truncate"><Phone className="w-2.5 h-2.5" /> {s.phone}</span>}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button size="icon" variant="ghost" className="h-7 w-7 hover:text-purple-400" onClick={() => { setEditStaffId(s.id); setEditStaffData({ name: s.full_name, phone: s.phone || '', email: s.email || '', role: s.role || 'operator' }) }}>
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
                                    <option value="operator">Оператор</option>
                                    <option value="admin">Админ</option>
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
        </div>
      </main>
    </div>
  )
}