'use client'

import { useCallback, useEffect, useMemo, useState, FormEvent } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { supabase } from '@/lib/supabaseClient'
import {
  Users2,
  Plus,
  Briefcase,
  CalendarDays,
  Trash2,
  Wallet,
  TrendingUp,
  CheckCircle2,
  AlertCircle,
  MoreHorizontal,
  DollarSign,
  Clock,
  Award,
  Filter,
  X,
  ChevronDown,
  ChevronUp,
  Download,
  RefreshCw,
  Search,
  Edit2,
  Copy,
  FileText,
  PieChart,
  BarChart3,
  Activity,
  User,
  BadgeDollarSign,
  Landmark,
  Percent,
  Scale,
  Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// --- Types ---
type StaffRole = 'manager' | 'marketer' | 'owner' | 'other'
type PaySlot = 'first' | 'second' | 'other'

type Staff = {
  id: string
  full_name: string | null
  role: StaffRole | null
  short_name: string | null
  monthly_salary: number | null
  is_active: boolean
  hire_date?: string | null
  phone?: string | null
  email?: string | null
}

type StaffPayment = {
  id: number
  staff_id: string
  pay_date: string
  slot: PaySlot
  amount: number
  comment: string | null
  created_at?: string
}

// --- Constants ---
const ROLE_LABEL: Record<StaffRole, { label: string; color: string; icon: any }> = {
  manager: { 
    label: 'Руководитель', 
    color: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    icon: Briefcase 
  },
  marketer: { 
    label: 'Маркетолог', 
    color: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    icon: TrendingUp 
  },
  owner: { 
    label: 'Собственник', 
    color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    icon: Award 
  },
  other: { 
    label: 'Сотрудник', 
    color: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20',
    icon: User 
  },
}

const PAY_SLOT_LABEL: Record<PaySlot, { label: string; icon: any }> = {
  first: { label: 'Аванс (1-е число)', icon: CalendarDays },
  second: { label: 'Зарплата (15-е число)', icon: DollarSign },
  other: { label: 'Другое', icon: Clock },
}

// --- Utils ---
const money = (v: number) =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'KZT',
    maximumFractionDigits: 0,
  }).format(v)

const moneyCompact = (v: number) => {
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M ₸'
  if (abs >= 1_000) return (v / 1_000).toFixed(0) + 'k ₸'
  return v + ' ₸'
}

const toISODateLocal = (d: Date) => {
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

const getMonthDates = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  const start = toISODateLocal(new Date(y, m - 1, 1))
  const end = toISODateLocal(new Date(y, m, 0))
  return { start, end }
}

const formatDate = (date: string) => {
  return new Date(date).toLocaleDateString('ru-RU', { 
    day: 'numeric', 
    month: 'long' 
  })
}

// --- Loading Component ---
function StaffLoading() {
  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
      <Sidebar />
      <main className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center animate-pulse">
            <Users2 className="w-8 h-8 text-white" />
          </div>
          <p className="text-gray-400">Загрузка зарплатной ведомости...</p>
        </div>
      </main>
    </div>
  )
}

export default function StaffPageSmart() {
  const today = new Date()
  const initialYM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  // Data State
  const [staff, setStaff] = useState<Staff[]>([])
  const [payments, setPayments] = useState<StaffPayment[]>([])
  
  // UI State
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [monthYM, setMonthYM] = useState(initialYM)
  const [isAddStaffOpen, setIsAddStaffOpen] = useState(false)
  const [paymentModal, setPaymentModal] = useState<{ isOpen: boolean; staffId: string | null }>({
    isOpen: false,
    staffId: null,
  })
  const [showInactive, setShowInactive] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'salary' | 'progress'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // --- Derived Data ---
  const { monthFrom, monthTo } = useMemo(() => {
    const { start, end } = getMonthDates(monthYM)
    return { monthFrom: start, monthTo: end }
  }, [monthYM])

  const paymentsByStaff = useMemo(() => {
    const map = new Map<string, StaffPayment[]>()
    payments.forEach((p) => {
      const arr = map.get(p.staff_id) || []
      arr.push(p)
      map.set(p.staff_id, arr)
    })
    return map
  }, [payments])

  // Statistics
  const stats = useMemo(() => {
    let totalBudget = 0
    let totalPaid = 0
    let totalStaff = 0
    let fullyPaid = 0
    let partiallyPaid = 0
    let notPaid = 0

    staff.filter(s => s.is_active || showInactive).forEach(s => {
      const salary = s.monthly_salary || 0
      const paid = paymentsByStaff.get(s.id)?.reduce((acc, p) => acc + (p.amount || 0), 0) || 0
      
      if (s.is_active) {
        totalBudget += salary
        totalPaid += paid
        
        if (paid === 0) notPaid++
        else if (paid >= salary) fullyPaid++
        else partiallyPaid++
      }
      
      totalStaff++
    })

    return {
      totalBudget,
      totalPaid,
      totalLeft: Math.max(0, totalBudget - totalPaid),
      progress: totalBudget > 0 ? (totalPaid / totalBudget) * 100 : 0,
      totalStaff,
      activeStaff: staff.filter(s => s.is_active).length,
      inactiveStaff: staff.filter(s => !s.is_active).length,
      fullyPaid,
      partiallyPaid,
      notPaid,
      avgSalary: totalBudget / (staff.filter(s => s.is_active).length || 1),
    }
  }, [staff, paymentsByStaff, showInactive])

  // Filtered and sorted staff
  const filteredStaff = useMemo(() => {
    let filtered = staff.filter(s => showInactive || s.is_active)
    
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      filtered = filtered.filter(s => 
        s.full_name?.toLowerCase().includes(term) ||
        s.short_name?.toLowerCase().includes(term) ||
        ROLE_LABEL[s.role as StaffRole]?.label.toLowerCase().includes(term)
      )
    }

    filtered.sort((a, b) => {
      let aVal: any, bVal: any
      
      switch (sortBy) {
        case 'name':
          aVal = a.full_name || ''
          bVal = b.full_name || ''
          break
        case 'salary':
          aVal = a.monthly_salary || 0
          bVal = b.monthly_salary || 0
          break
        case 'progress':
          const aPaid = paymentsByStaff.get(a.id)?.reduce((acc, p) => acc + p.amount, 0) || 0
          const bPaid = paymentsByStaff.get(b.id)?.reduce((acc, p) => acc + p.amount, 0) || 0
          aVal = a.monthly_salary ? (aPaid / a.monthly_salary) : 0
          bVal = b.monthly_salary ? (bPaid / b.monthly_salary) : 0
          break
      }

      if (typeof aVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal
    })

    // Active first
    filtered.sort((a, b) => Number(b.is_active) - Number(a.is_active))

    return filtered
  }, [staff, showInactive, searchTerm, sortBy, sortDir, paymentsByStaff])

  // --- Fetching ---
  const loadData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    else setLoading(true)

    const [staffRes, payRes] = await Promise.all([
      supabase.from('staff').select('*').order('full_name'),
      supabase
        .from('staff_salary_payments')
        .select('*')
        .gte('pay_date', monthFrom)
        .lte('pay_date', monthTo)
        .order('pay_date', { ascending: true }),
    ])

    if (!staffRes.error && !payRes.error) {
      setStaff(staffRes.data as Staff[])
      setPayments(payRes.data as StaffPayment[])
    }
    
    setLoading(false)
    setRefreshing(false)
  }, [monthFrom, monthTo])

  useEffect(() => {
    loadData()
  }, [loadData])

  // --- Actions ---
  const handleDeletePayment = async (id: number) => {
    if (!confirm('Удалить эту выплату?')) return
    const { error } = await supabase.from('staff_salary_payments').delete().eq('id', id)
    if (!error) {
      setPayments((prev) => prev.filter((p) => p.id !== id))
    }
  }

  const toggleStaffStatus = async (s: Staff) => {
    const { error } = await supabase
      .from('staff')
      .update({ is_active: !s.is_active })
      .eq('id', s.id)
    
    if (!error) {
      setStaff(prev => prev.map(item => item.id === s.id ? { ...item, is_active: !item.is_active } : item))
    }
  }

  const resetFilters = () => {
    setSearchTerm('')
    setShowInactive(false)
    setSortBy('name')
    setSortDir('asc')
  }

  const handleExport = () => {
    const rows = [
      ['Сотрудник', 'Роль', 'Оклад', 'Выплачено', 'Остаток', 'Прогресс', 'Статус'],
      ...filteredStaff.map(s => {
        const paid = paymentsByStaff.get(s.id)?.reduce((acc, p) => acc + p.amount, 0) || 0
        const salary = s.monthly_salary || 0
        const left = salary - paid
        return [
          s.full_name,
          ROLE_LABEL[s.role as StaffRole]?.label || '',
          salary,
          paid,
          left,
          salary > 0 ? `${Math.round((paid / salary) * 100)}%` : '0%',
          s.is_active ? 'Активен' : 'Архив'
        ]
      })
    ]

    const csv = rows.map(row => row.join(';')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `salary_${monthYM}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-gray-100">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
          
          {/* Header */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600/20 via-teal-600/20 to-cyan-600/20 border border-white/10 p-6 lg:p-8">
            <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-teal-500/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-2xl shadow-lg shadow-emerald-500/25">
                  <Users2 className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl lg:text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                    Зарплатная ведомость
                  </h1>
                  <p className="text-gray-400 mt-1 flex items-center gap-2">
                    <BadgeDollarSign className="w-4 h-4" />
                    Управление окладами и фактическими выплатами
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className={`rounded-xl border-white/10 bg-gray-900/50 backdrop-blur-xl hover:bg-white/10 ${refreshing ? 'animate-spin' : ''}`}
                  onClick={() => loadData(true)}
                  title="Обновить"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>

                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-xl border-white/10 bg-gray-900/50 backdrop-blur-xl hover:bg-white/10"
                  onClick={handleExport}
                  title="Экспорт в CSV"
                >
                  <Download className="w-4 h-4" />
                </Button>

                <div className="bg-gray-900/50 backdrop-blur-xl border border-white/10 rounded-xl p-1 flex items-center gap-2 px-3">
                  <CalendarDays className="w-4 h-4 text-gray-500" />
                  <input
                    type="month"
                    value={monthYM}
                    onChange={(e) => setMonthYM(e.target.value)}
                    className="bg-transparent text-sm outline-none text-white cursor-pointer font-medium w-28"
                  />
                </div>

                <Button 
                  onClick={() => setIsAddStaffOpen(true)} 
                  className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Добавить сотрудника
                </Button>
              </div>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="bg-gray-900/40 backdrop-blur-xl border-white/5">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 rounded-xl bg-blue-500/10">
                    <Briefcase className="w-5 h-5 text-blue-400" />
                  </div>
                  <span className="text-xs text-gray-500">{stats.activeStaff} активных</span>
                </div>
                <p className="text-sm text-gray-400 mb-1">Общий бюджет (ФОТ)</p>
                <p className="text-2xl font-bold text-white">{money(stats.totalBudget)}</p>
                <p className="text-xs text-gray-500 mt-2">
                  Средний оклад: {moneyCompact(stats.avgSalary)}
                </p>
              </CardContent>
            </Card>

            <Card className="bg-gray-900/40 backdrop-blur-xl border-white/5">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 rounded-xl bg-emerald-500/10">
                    <Wallet className="w-5 h-5 text-emerald-400" />
                  </div>
                  <span className="text-xs text-gray-500">{stats.fullyPaid} полностью</span>
                </div>
                <p className="text-sm text-gray-400 mb-1">Выплачено</p>
                <p className="text-2xl font-bold text-emerald-400">{money(stats.totalPaid)}</p>
                <div className="w-full h-1.5 bg-gray-800 rounded-full mt-2 overflow-hidden">
                  <div 
                    className="h-full bg-emerald-500 rounded-full"
                    style={{ width: `${Math.min(stats.progress, 100)}%` }}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gray-900/40 backdrop-blur-xl border-white/5">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 rounded-xl bg-amber-500/10">
                    <TrendingUp className="w-5 h-5 text-amber-400" />
                  </div>
                  <span className="text-xs text-gray-500">{stats.notPaid} не получали</span>
                </div>
                <p className="text-sm text-gray-400 mb-1">Остаток к выплате</p>
                <p className="text-2xl font-bold text-amber-400">{money(stats.totalLeft)}</p>
                <p className="text-xs text-gray-500 mt-2">
                  {stats.progress.toFixed(1)}% от бюджета
                </p>
              </CardContent>
            </Card>

            <Card className="bg-gray-900/40 backdrop-blur-xl border-white/5">
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="p-2 rounded-xl bg-purple-500/10">
                    <PieChart className="w-5 h-5 text-purple-400" />
                  </div>
                  <span className="text-xs text-gray-500">{stats.partiallyPaid} частично</span>
                </div>
                <p className="text-sm text-gray-400 mb-1">Статистика выплат</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Полностью:</span>
                    <span className="text-emerald-400">{stats.fullyPaid}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Частично:</span>
                    <span className="text-amber-400">{stats.partiallyPaid}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Не получали:</span>
                    <span className="text-red-400">{stats.notPaid}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <Card className="p-4 bg-gray-900/40 backdrop-blur-xl border-white/5">
            <div className="flex flex-wrap items-center gap-3">
              <Filter className="w-4 h-4 text-gray-500" />

              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Поиск по имени или роли..."
                  className="w-full pl-9 pr-8 py-2 bg-gray-800/50 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50"
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="px-3 py-2 bg-gray-800/50 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-emerald-500/50"
              >
                <option value="name">По имени</option>
                <option value="salary">По окладу</option>
                <option value="progress">По прогрессу</option>
              </select>

              <button
                onClick={() => setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')}
                className="px-3 py-2 bg-gray-800/50 border border-white/10 rounded-lg text-sm text-white hover:bg-gray-700/50 transition-colors"
              >
                {sortDir === 'asc' ? '↑' : '↓'}
              </button>

              <label className="flex items-center gap-2 cursor-pointer ml-2">
                <input
                  type="checkbox"
                  checked={showInactive}
                  onChange={(e) => setShowInactive(e.target.checked)}
                  className="rounded border-white/10 bg-gray-800/50 text-emerald-500 focus:ring-emerald-500/20"
                />
                <span className="text-sm text-gray-400">Показывать архивных</span>
              </label>

              {(searchTerm || showInactive || sortBy !== 'name' || sortDir !== 'asc') && (
                <button
                  onClick={resetFilters}
                  className="text-sm text-gray-500 hover:text-white transition-colors ml-auto"
                >
                  Сбросить
                </button>
              )}
            </div>
          </Card>

          {/* Main Table */}
          <Card className="bg-gray-900/40 backdrop-blur-xl border-white/5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5 bg-gray-900/50">
                    <th className="py-4 px-4 text-left text-xs font-medium text-gray-400">Сотрудник</th>
                    <th className="py-4 px-4 text-left text-xs font-medium text-gray-400">Прогресс</th>
                    <th className="py-4 px-4 text-right text-xs font-medium text-gray-400">Оклад</th>
                    <th className="py-4 px-4 text-right text-xs font-medium text-gray-400">Выплачено</th>
                    <th className="py-4 px-4 text-right text-xs font-medium text-gray-400">Остаток</th>
                    <th className="py-4 px-4 text-center text-xs font-medium text-gray-400">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {loading && !refreshing && (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-gray-500">
                        Загрузка данных...
                      </td>
                    </tr>
                  )}

                  {!loading && filteredStaff.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-gray-500">
                        {staff.length === 0 
                          ? 'Список сотрудников пуст. Добавьте первого сотрудника.'
                          : 'Нет сотрудников, соответствующих фильтрам'}
                      </td>
                    </tr>
                  )}

                  {filteredStaff.map((s) => {
                    const staffPayments = paymentsByStaff.get(s.id) || []
                    const paid = staffPayments.reduce((acc, p) => acc + (p.amount || 0), 0)
                    const salary = s.monthly_salary || 0
                    const left = salary - paid
                    const percent = salary > 0 ? Math.min(100, (paid / salary) * 100) : 0
                    const isOverpaid = left < 0
                    const isFullyPaid = left <= 0 && salary > 0
                    const roleStyle = ROLE_LABEL[s.role as StaffRole] || ROLE_LABEL.other
                    const RoleIcon = roleStyle.icon

                    return (
                      <StaffRow 
                        key={s.id} 
                        staff={s} 
                        paid={paid} 
                        left={left} 
                        percent={percent}
                        history={staffPayments}
                        isOverpaid={isOverpaid}
                        isFullyPaid={isFullyPaid}
                        roleStyle={roleStyle}
                        RoleIcon={RoleIcon}
                        onPay={() => setPaymentModal({ isOpen: true, staffId: s.id })}
                        onDeletePayment={handleDeletePayment}
                        onToggleStatus={() => toggleStaffStatus(s)}
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Bottom info */}
          <div className="flex justify-between items-center text-xs text-gray-500">
            <div>
              Показано {filteredStaff.length} из {staff.length} сотрудников
            </div>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Активные
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-gray-600" />
                В архиве
              </span>
            </div>
          </div>
        </div>

        {/* Modals */}
        <AddStaffDialog 
          isOpen={isAddStaffOpen} 
          onClose={() => setIsAddStaffOpen(false)} 
          onSuccess={(newStaff) => {
            setStaff(prev => [...prev, newStaff])
            loadData(true)
          }} 
        />

        {paymentModal.staffId && (
          <AddPaymentDialog
            isOpen={paymentModal.isOpen}
            onClose={() => setPaymentModal({ isOpen: false, staffId: null })}
            staff={staff.find(s => s.id === paymentModal.staffId)!}
            paidSoFar={paymentsByStaff.get(paymentModal.staffId!)?.reduce((acc, p) => acc + p.amount, 0) || 0}
            dateDefault={toISODateLocal(new Date())}
            onSuccess={(newPay) => {
              setPayments(prev => [...prev, newPay])
              loadData(true)
            }}
          />
        )}
      </main>
    </div>
  )
}

// --- Staff Row Component ---
function StaffRow({ 
  staff, 
  paid, 
  left, 
  percent, 
  history, 
  isOverpaid, 
  isFullyPaid, 
  roleStyle, 
  RoleIcon,
  onPay, 
  onDeletePayment, 
  onToggleStatus 
}: any) {
  const [showHistory, setShowHistory] = useState(false)

  return (
    <>
      <tr className={cn(
        "group transition-colors hover:bg-white/5",
        !staff.is_active && "opacity-50"
      )}>
        <td className="py-4 px-4">
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center",
              roleStyle.color.split(' ')[1]
            )}>
              <RoleIcon className="w-4 h-4" />
            </div>
            <div className="flex flex-col">
              <span className="font-medium text-white">{staff.full_name}</span>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={cn(
                  "text-[10px] px-1.5 py-0.5 rounded border",
                  roleStyle.color
                )}>
                  {roleStyle.label}
                </span>
                {staff.short_name && (
                  <span className="text-[10px] text-gray-500">
                    {staff.short_name}
                  </span>
                )}
                {!staff.is_active && (
                  <span className="text-[10px] text-red-500 font-medium">Архив</span>
                )}
              </div>
            </div>
          </div>
        </td>
        
        <td className="py-4 px-4">
          <div className="w-full max-w-[140px]">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-gray-400">{Math.round(percent)}%</span>
              {isOverpaid && (
                <span className="text-red-400 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  Переплата
                </span>
              )}
              {isFullyPaid && !isOverpaid && (
                <span className="text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  Оплачено
                </span>
              )}
            </div>
            <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden">
              <div 
                className={cn(
                  "h-full rounded-full transition-all",
                  isOverpaid ? "bg-red-500" : isFullyPaid ? "bg-emerald-500" : "bg-blue-500"
                )} 
                style={{ width: `${Math.min(percent, 100)}%` }} 
              />
            </div>
          </div>
        </td>

        <td className="py-4 px-4 text-right font-medium text-white">
          {money(staff.monthly_salary || 0)}
        </td>
        
        <td className="py-4 px-4 text-right font-medium text-emerald-400">
          {paid > 0 ? money(paid) : <span className="text-gray-600">—</span>}
        </td>
        
        <td className="py-4 px-4 text-right font-medium">
          <span className={cn(
            left > 0 ? "text-amber-400" : "text-gray-600"
          )}>
            {money(Math.max(0, left))}
          </span>
        </td>

        <td className="py-4 px-4">
          <div className="flex items-center justify-center gap-2">
            <Button 
              size="sm" 
              className={cn(
                "h-8 px-3 text-xs gap-1.5",
                isFullyPaid 
                  ? "bg-gray-800 text-gray-400 hover:bg-gray-700" 
                  : "bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white"
              )}
              onClick={onPay}
              disabled={!staff.is_active}
            >
              <Wallet className="w-3.5 h-3.5" />
              {isFullyPaid ? 'Выплачено' : 'Выплатить'}
            </Button>
            
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-gray-500 hover:text-white hover:bg-white/5"
              onClick={() => setShowHistory(!showHistory)}
              title="История выплат"
            >
              {showHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
            
            <Button
              size="icon"
              variant="ghost"
              className={cn(
                "h-8 w-8",
                staff.is_active 
                  ? "text-gray-500 hover:text-red-400 hover:bg-red-500/10" 
                  : "text-gray-500 hover:text-emerald-400 hover:bg-emerald-500/10"
              )}
              onClick={onToggleStatus}
              title={staff.is_active ? "В архив" : "Активировать"}
            >
              {staff.is_active ? <Trash2 className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </td>
      </tr>

      {/* History Expandable Row */}
      {showHistory && (
        <tr className="bg-gray-900/30">
          <td colSpan={6} className="p-4 pl-16 border-t border-white/5">
            {history.length === 0 ? (
              <div className="text-sm text-gray-500 italic">
                Выплат в этом месяце не было.
              </div>
            ) : (
              <div className="space-y-2">
                <h4 className="text-xs font-medium text-gray-400 mb-3">История выплат за месяц</h4>
                {history.map((h: StaffPayment) => {
                  const slotStyle = PAY_SLOT_LABEL[h.slot]
                  const SlotIcon = slotStyle.icon
                  
                  return (
                    <div 
                      key={h.id} 
                      className="flex items-center gap-4 text-sm bg-black/20 p-3 rounded-lg border border-white/5 max-w-2xl hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-center gap-2 w-32">
                        <SlotIcon className="w-3.5 h-3.5 text-gray-500" />
                        <span className="text-gray-400">{h.pay_date}</span>
                      </div>
                      <span className="text-emerald-400 font-medium w-24 text-right">
                        {money(h.amount)}
                      </span>
                      <span className={cn(
                        "text-xs px-2 py-1 rounded-full border",
                        h.slot === 'first' ? "text-blue-400 bg-blue-500/10 border-blue-500/20" :
                        h.slot === 'second' ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" :
                        "text-gray-400 bg-gray-500/10 border-gray-500/20"
                      )}>
                        {slotStyle.label}
                      </span>
                      {h.comment && (
                        <span className="text-gray-500 text-sm flex-1 truncate" title={h.comment}>
                          {h.comment}
                        </span>
                      )}
                      <button 
                        onClick={() => onDeletePayment(h.id)} 
                        className="text-gray-600 hover:text-red-400 transition-colors ml-auto"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

// --- Add Staff Dialog ---
function AddStaffDialog({ isOpen, onClose, onSuccess }: any) {
  const [form, setForm] = useState({ 
    full_name: '', 
    short_name: '',
    role: 'manager' as StaffRole, 
    monthly_salary: '',
    phone: '',
    email: '',
    hire_date: toISODateLocal(new Date()),
  })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    
    const { data, error } = await supabase.from('staff').insert([{
      ...form, 
      monthly_salary: Number(form.monthly_salary), 
      is_active: true
    }]).select().single()
    
    setLoading(false)
    if (!error) {
      onSuccess(data)
      setForm({ 
        full_name: '', 
        short_name: '',
        role: 'manager', 
        monthly_salary: '',
        phone: '',
        email: '',
        hire_date: toISODateLocal(new Date()),
      })
      onClose()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-gray-900 border-white/10 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">Новый сотрудник</DialogTitle>
          <DialogDescription className="text-gray-400">
            Добавьте сотрудника в зарплатную ведомость
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-xs text-gray-400 font-medium">ФИО *</label>
            <Input 
              value={form.full_name} 
              onChange={e => setForm({...form, full_name: e.target.value})}
              className="bg-gray-800/50 border-white/10 text-white"
              placeholder="Иванов Иван Иванович"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs text-gray-400 font-medium">Короткое имя</label>
              <Input 
                value={form.short_name} 
                onChange={e => setForm({...form, short_name: e.target.value})}
                className="bg-gray-800/50 border-white/10 text-white"
                placeholder="Иван"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-gray-400 font-medium">Дата найма</label>
              <Input 
                type="date"
                value={form.hire_date} 
                onChange={e => setForm({...form, hire_date: e.target.value})}
                className="bg-gray-800/50 border-white/10 text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs text-gray-400 font-medium">Роль *</label>
              <select 
                value={form.role} 
                onChange={e => setForm({...form, role: e.target.value as StaffRole})}
                className="w-full h-9 rounded-md border border-white/10 bg-gray-800/50 px-3 py-1 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                required
              >
                {Object.entries(ROLE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-gray-400 font-medium">Оклад (₸) *</label>
              <Input 
                type="number"
                value={form.monthly_salary} 
                onChange={e => setForm({...form, monthly_salary: e.target.value})}
                className="bg-gray-800/50 border-white/10 text-white"
                placeholder="200000"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs text-gray-400 font-medium">Телефон</label>
              <Input 
                value={form.phone} 
                onChange={e => setForm({...form, phone: e.target.value})}
                className="bg-gray-800/50 border-white/10 text-white"
                placeholder="+7 (777) 123-45-67"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-gray-400 font-medium">Email</label>
              <Input 
                type="email"
                value={form.email} 
                onChange={e => setForm({...form, email: e.target.value})}
                className="bg-gray-800/50 border-white/10 text-white"
                placeholder="ivan@example.com"
              />
            </div>
          </div>

          <DialogFooter className="pt-4">
            <Button 
              type="button" 
              variant="ghost" 
              onClick={onClose}
              className="text-gray-400 hover:text-white"
            >
              Отмена
            </Button>
            <Button 
              type="submit" 
              disabled={loading}
              className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white"
            >
              {loading ? 'Создание...' : 'Создать сотрудника'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// --- Add Payment Dialog ---
function AddPaymentDialog({ isOpen, onClose, staff, paidSoFar, dateDefault, onSuccess }: any) {
  const salary = staff.monthly_salary || 0
  const remainder = Math.max(0, salary - paidSoFar)
  
  const [amount, setAmount] = useState(String(remainder))
  const [date, setDate] = useState(dateDefault)
  const [slot, setSlot] = useState<PaySlot>('other')
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)

  // Suggest slot based on date
  useEffect(() => {
    const day = new Date(date).getDate()
    if (day <= 5) setSlot('first')
    else if (day >= 15 && day <= 20) setSlot('second')
    else setSlot('other')
  }, [date])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    
    const { data, error } = await supabase.from('staff_salary_payments').insert([{
      staff_id: staff.id,
      pay_date: date,
      slot,
      amount: Number(amount),
      comment: comment || null
    }]).select().single()

    setLoading(false)
    if (!error) {
      onSuccess(data)
      onClose()
    }
  }

  const roleStyle = ROLE_LABEL[staff.role as StaffRole] || ROLE_LABEL.other
  const RoleIcon = roleStyle.icon

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-gray-900 border-white/10 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center",
              roleStyle.color.split(' ')[1]
            )}>
              <RoleIcon className="w-4 h-4" />
            </div>
            <span>{staff.short_name || staff.full_name}</span>
          </DialogTitle>
          <DialogDescription className="text-gray-400">
            Оклад: {money(salary)} · Выплачено: {money(paidSoFar)}
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {Number(amount) > remainder && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <div>
                <span className="font-medium">Переплата!</span>{' '}
                Сумма превышает остаток на {money(Number(amount) - remainder)}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs text-gray-400 font-medium">Дата</label>
              <Input 
                type="date" 
                value={date} 
                onChange={e => setDate(e.target.value)} 
                className="bg-gray-800/50 border-white/10 text-white"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-gray-400 font-medium">Тип выплаты</label>
              <select 
                value={slot} 
                onChange={e => setSlot(e.target.value as PaySlot)}
                className="w-full h-9 rounded-md border border-white/10 bg-gray-800/50 px-3 py-1 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                required
              >
                <option value="first">Аванс (1-е число)</option>
                <option value="second">Зарплата (15-е число)</option>
                <option value="other">Другое</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-gray-400 font-medium">Сумма (₸)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-lg">₸</span>
              <Input 
                type="number" 
                value={amount} 
                onChange={e => setAmount(e.target.value)} 
                className="bg-gray-800/50 border-white/10 text-white pl-10 font-mono text-lg" 
                required
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button 
                type="button" 
                onClick={() => setAmount(String(Math.floor(salary / 2)))} 
                className="text-xs text-gray-500 hover:text-emerald-400 transition-colors px-2 py-1 hover:bg-white/5 rounded"
              >
                50%
              </button>
              <button 
                type="button" 
                onClick={() => setAmount(String(remainder))} 
                className="text-xs text-gray-500 hover:text-emerald-400 transition-colors px-2 py-1 hover:bg-white/5 rounded"
              >
                Остаток
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs text-gray-400 font-medium">Комментарий</label>
            <Input 
              value={comment} 
              onChange={e => setComment(e.target.value)} 
              placeholder="Бонус, штраф, примечание..."
              className="bg-gray-800/50 border-white/10 text-white"
            />
          </div>

          <DialogFooter className="pt-4">
            <Button 
              type="button" 
              variant="ghost" 
              onClick={onClose}
              className="text-gray-400 hover:text-white"
            >
              Отмена
            </Button>
            <Button 
              type="submit" 
              disabled={loading}
              className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white"
            >
              {loading ? 'Сохранение...' : 'Подтвердить выплату'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
