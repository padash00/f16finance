'use client'

import { useCallback, useEffect, useMemo, useState, FormEvent } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
}

type StaffPayment = {
  id: number
  staff_id: string
  pay_date: string
  slot: PaySlot
  amount: number
  comment: string | null
}

// --- Utils ---
const money = (v: number) =>
  new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'KZT',
    maximumFractionDigits: 0,
  }).format(v)

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

const ROLE_LABEL: Record<StaffRole, string> = {
  manager: 'Руководитель',
  marketer: 'Маркетолог',
  owner: 'Собственник',
  other: 'Сотрудник',
}

export default function StaffPageSmart() {
  const today = new Date()
  const initialYM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  // Data State
  const [staff, setStaff] = useState<Staff[]>([])
  const [payments, setPayments] = useState<StaffPayment[]>([])
  
  // UI State
  const [loading, setLoading] = useState(true)
  const [monthYM, setMonthYM] = useState(initialYM)
  const [isAddStaffOpen, setIsAddStaffOpen] = useState(false)
  const [paymentModal, setPaymentModal] = useState<{ isOpen: boolean; staffId: string | null }>({
    isOpen: false,
    staffId: null,
  })

  // --- Derived Data (Analytics) ---
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

  const stats = useMemo(() => {
    let totalBudget = 0
    let totalPaid = 0

    staff.filter(s => s.is_active).forEach(s => {
      const salary = s.monthly_salary || 0
      const paid = paymentsByStaff.get(s.id)?.reduce((acc, p) => acc + (p.amount || 0), 0) || 0
      
      totalBudget += salary
      totalPaid += paid
    })

    return {
      totalBudget,
      totalPaid,
      totalLeft: Math.max(0, totalBudget - totalPaid),
      progress: totalBudget > 0 ? (totalPaid / totalBudget) * 100 : 0
    }
  }, [staff, paymentsByStaff])

  // --- Fetching ---
  const loadData = useCallback(async () => {
    setLoading(true)
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

  return (
    <div className="flex min-h-screen bg-[#09090b] text-zinc-100 font-sans">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-zinc-950/50">
        <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8">
          
          {/* Header Section */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
                <Users2 className="w-6 h-6 text-emerald-500" />
                Зарплатная ведомость
              </h1>
              <p className="text-sm text-zinc-400 mt-1">
                Управление окладами и фактическими выплатами
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-1 flex items-center gap-2 px-3">
                <CalendarDays className="w-4 h-4 text-zinc-500" />
                <input
                  type="month"
                  value={monthYM}
                  onChange={(e) => setMonthYM(e.target.value)}
                  className="bg-transparent text-sm outline-none text-zinc-200 cursor-pointer font-medium"
                />
              </div>
              <Button onClick={() => setIsAddStaffOpen(true)} size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white">
                <Plus className="w-4 h-4 mr-1" /> Сотрудник
              </Button>
            </div>
          </div>

          {/* Smart Analytics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="bg-zinc-900/50 border-zinc-800">
              <CardContent className="p-6 flex items-center gap-4">
                <div className="p-3 rounded-full bg-blue-500/10 text-blue-500">
                  <Briefcase className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-500 uppercase">Общий бюджет (ФОТ)</p>
                  <p className="text-2xl font-bold text-zinc-100">{money(stats.totalBudget)}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-zinc-900/50 border-zinc-800">
              <CardContent className="p-6 flex items-center gap-4">
                <div className="p-3 rounded-full bg-emerald-500/10 text-emerald-500">
                  <Wallet className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-500 uppercase">Выплачено</p>
                  <p className="text-2xl font-bold text-emerald-400">{money(stats.totalPaid)}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-zinc-900/50 border-zinc-800">
              <CardContent className="p-6 flex items-center gap-4">
                <div className="p-3 rounded-full bg-amber-500/10 text-amber-500">
                  <TrendingUp className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-medium text-zinc-500 uppercase">Остаток к выплате</p>
                  <p className="text-2xl font-bold text-amber-400">{money(stats.totalLeft)}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Table */}
          <Card className="bg-zinc-900/50 border-zinc-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/50 text-xs uppercase text-zinc-500">
                    <th className="py-3 px-4 text-left font-medium">Сотрудник</th>
                    <th className="py-3 px-4 text-left font-medium">Прогресс выплат</th>
                    <th className="py-3 px-4 text-right font-medium">Оклад</th>
                    <th className="py-3 px-4 text-right font-medium">Выплачено</th>
                    <th className="py-3 px-4 text-right font-medium">Остаток</th>
                    <th className="py-3 px-4 text-center font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {loading ? (
                    <tr><td colSpan={6} className="p-8 text-center text-zinc-500">Загрузка данных...</td></tr>
                  ) : staff.length === 0 ? (
                    <tr><td colSpan={6} className="p-8 text-center text-zinc-500">Список сотрудников пуст</td></tr>
                  ) : (
                    staff.sort((a,b) => Number(b.is_active) - Number(a.is_active)).map((s) => {
                      const staffPayments = paymentsByStaff.get(s.id) || []
                      const paid = staffPayments.reduce((acc, p) => acc + (p.amount || 0), 0)
                      const salary = s.monthly_salary || 0
                      const left = salary - paid
                      const percent = salary > 0 ? Math.min(100, (paid / salary) * 100) : 0
                      const isOverpaid = left < 0
                      const isFullyPaid = left <= 0 && salary > 0

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
                          onPay={() => setPaymentModal({ isOpen: true, staffId: s.id })}
                          onDeletePayment={handleDeletePayment}
                          onToggleStatus={() => toggleStaffStatus(s)}
                        />
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* --- MODALS --- */}
        
        {/* Add Staff Modal */}
        <AddStaffDialog 
          isOpen={isAddStaffOpen} 
          onClose={() => setIsAddStaffOpen(false)} 
          onSuccess={(newStaff) => setStaff(prev => [...prev, newStaff])} 
        />

        {/* Add Payment Modal */}
        {paymentModal.staffId && (
          <AddPaymentDialog
            isOpen={paymentModal.isOpen}
            onClose={() => setPaymentModal({ isOpen: false, staffId: null })}
            staff={staff.find(s => s.id === paymentModal.staffId)!}
            paidSoFar={paymentsByStaff.get(paymentModal.staffId!)?.reduce((acc, p) => acc + p.amount, 0) || 0}
            dateDefault={toISODateLocal(new Date())}
            onSuccess={(newPay) => setPayments(prev => [...prev, newPay])}
          />
        )}
      </main>
    </div>
  )
}

// --- Sub-components for cleaner code ---

function StaffRow({ staff, paid, left, percent, history, isOverpaid, isFullyPaid, onPay, onDeletePayment, onToggleStatus }: any) {
  const [showHistory, setShowHistory] = useState(false)

  if (!staff.is_active && !showHistory && paid === 0) return null // Hide inactive with no activity if you want cleaner list, or keep showing them.

  return (
    <>
      <tr className={cn("group transition-colors", staff.is_active ? "hover:bg-zinc-800/30" : "opacity-50 bg-zinc-900/20")}>
        <td className="py-3 px-4 align-top">
          <div className="flex flex-col">
            <span className="font-medium text-zinc-200">{staff.full_name}</span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
                {ROLE_LABEL[staff.role as StaffRole]}
              </span>
              {!staff.is_active && <span className="text-[10px] text-red-500 font-medium">Архив</span>}
            </div>
          </div>
        </td>
        
        <td className="py-3 px-4 align-middle">
          <div className="w-full max-w-[140px]">
            <div className="flex justify-between text-[10px] mb-1 text-zinc-400">
              <span>{Math.round(percent)}%</span>
            </div>
            <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
              <div 
                className={cn("h-full rounded-full", isOverpaid ? "bg-red-500" : isFullyPaid ? "bg-emerald-500" : "bg-blue-500")} 
                style={{ width: `${Math.min(percent, 100)}%` }} 
              />
            </div>
            {isOverpaid && <span className="text-[10px] text-red-400 block mt-1">Переплата!</span>}
          </div>
        </td>

        <td className="py-3 px-4 text-right font-medium text-zinc-300 align-middle">
          {money(staff.monthly_salary || 0)}
        </td>
        
        <td className="py-3 px-4 text-right font-medium text-emerald-400 align-middle">
          {paid > 0 ? money(paid) : <span className="text-zinc-600">—</span>}
        </td>
        
        <td className="py-3 px-4 text-right font-medium align-middle">
           <span className={cn(left > 0 ? "text-amber-400" : "text-zinc-600")}>
             {money(Math.max(0, left))}
           </span>
        </td>

        <td className="py-3 px-4 text-center align-middle">
          <div className="flex items-center justify-center gap-2">
            <Button 
              size="sm" 
              variant="outline" 
              className={cn("h-7 text-xs border-zinc-700 bg-zinc-800 hover:bg-zinc-700 hover:text-white", isFullyPaid ? "opacity-50" : "")}
              onClick={onPay}
              disabled={!staff.is_active}
            >
              <Wallet className="w-3.5 h-3.5 mr-1.5" /> 
              Выплатить
            </Button>
            
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-zinc-500 hover:text-zinc-300"
              onClick={() => setShowHistory(!showHistory)}
              title="История"
            >
              <MoreHorizontal className="w-4 h-4" />
            </Button>
            
             <Button
              size="icon"
              variant="ghost"
              className={cn("h-7 w-7", staff.is_active ? "text-zinc-600 hover:text-red-400" : "text-zinc-600 hover:text-emerald-400")}
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
        <tr className="bg-zinc-900/30">
          <td colSpan={6} className="p-3 pl-12 border-b border-zinc-800/50">
             {history.length === 0 ? (
               <div className="text-xs text-zinc-500 italic">Выплат в этом месяце не было.</div>
             ) : (
               <div className="space-y-2">
                 {history.map((h: StaffPayment) => (
                   <div key={h.id} className="flex items-center gap-3 text-xs bg-black/20 p-2 rounded border border-zinc-800/50 max-w-2xl">
                     <span className="text-zinc-400 w-24">{h.pay_date}</span>
                     <span className="text-emerald-400 font-medium w-20 text-right">{money(h.amount)}</span>
                     <span className="text-zinc-500 px-2 border-l border-zinc-700">
                        {h.slot === 'first' ? 'Аванс' : h.slot === 'second' ? 'ЗП' : 'Другое'}
                     </span>
                     <span className="text-zinc-400 flex-1 truncate">{h.comment}</span>
                     <button onClick={() => onDeletePayment(h.id)} className="text-zinc-600 hover:text-red-400">
                       <Trash2 className="w-3 h-3" />
                     </button>
                   </div>
                 ))}
               </div>
             )}
          </td>
        </tr>
      )}
    </>
  )
}


// --- Dialogs (Modals) ---

function AddStaffDialog({ isOpen, onClose, onSuccess }: any) {
  const [form, setForm] = useState({ full_name: '', role: 'manager', monthly_salary: '' })
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
      setForm({ full_name: '', role: 'manager', monthly_salary: '' })
      onClose()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новый сотрудник</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-xs text-zinc-400">ФИО</label>
            <Input 
              value={form.full_name} 
              onChange={e => setForm({...form, full_name: e.target.value})}
              className="bg-zinc-950 border-zinc-800"
              placeholder="Иванов Иван"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
             <div className="space-y-2">
              <label className="text-xs text-zinc-400">Роль</label>
              <select 
                value={form.role} 
                onChange={e => setForm({...form, role: e.target.value})}
                className="flex h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1 text-sm shadow-sm transition-colors text-white"
              >
                {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs text-zinc-400">Оклад</label>
              <Input 
                type="number"
                value={form.monthly_salary} 
                onChange={e => setForm({...form, monthly_salary: e.target.value})}
                className="bg-zinc-950 border-zinc-800"
                placeholder="0"
              />
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button type="submit" disabled={loading} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
              {loading ? '...' : 'Создать'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AddPaymentDialog({ isOpen, onClose, staff, paidSoFar, dateDefault, onSuccess }: any) {
  const salary = staff.monthly_salary || 0
  const remainder = Math.max(0, salary - paidSoFar)
  
  // Smart Default: If it's the 1st-15th, suggest half salary. If later, suggest remainder.
  // For simplicity, we just suggest remainder now.
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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-zinc-900 border-zinc-800 text-white sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Выплата: {staff.short_name || staff.full_name}</DialogTitle>
          <DialogDescription className="text-zinc-400">
             Оклад: {money(salary)}. Выплачено: {money(paidSoFar)}.
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {Number(amount) > remainder && (
             <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-2 rounded flex items-center gap-2">
               <AlertCircle className="w-4 h-4" /> Внимание: переплата на {money(Number(amount) - remainder)}
             </div>
          )}

          <div className="grid grid-cols-2 gap-3">
             <div className="space-y-1.5">
                <label className="text-[10px] uppercase text-zinc-500 font-bold">Дата</label>
                <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="bg-zinc-950 border-zinc-800" />
             </div>
             <div className="space-y-1.5">
                <label className="text-[10px] uppercase text-zinc-500 font-bold">Тип</label>
                <select 
                  value={slot} 
                  onChange={e => setSlot(e.target.value as PaySlot)}
                  className="flex h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-1 text-sm text-white"
                >
                  <option value="first">1-е число (Аванс)</option>
                  <option value="second">15-е число (ЗП)</option>
                  <option value="other">Другое</option>
                </select>
             </div>
          </div>

          <div className="space-y-1.5">
             <label className="text-[10px] uppercase text-zinc-500 font-bold">Сумма (KZT)</label>
             <div className="relative">
               <span className="absolute left-3 top-2.5 text-zinc-500">₸</span>
               <Input 
                 type="number" 
                 value={amount} 
                 onChange={e => setAmount(e.target.value)} 
                 className="bg-zinc-950 border-zinc-800 pl-8 font-mono text-lg" 
               />
             </div>
             <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setAmount(String(salary / 2))} className="text-[10px] text-zinc-500 hover:text-emerald-400 underline decoration-dotted">50%</button>
                <button type="button" onClick={() => setAmount(String(remainder))} className="text-[10px] text-zinc-500 hover:text-emerald-400 underline decoration-dotted">Остаток</button>
             </div>
          </div>

          <div className="space-y-1.5">
             <label className="text-[10px] uppercase text-zinc-500 font-bold">Комментарий</label>
             <Input 
               value={comment} 
               onChange={e => setComment(e.target.value)} 
               placeholder="Бонус, штраф..."
               className="bg-zinc-950 border-zinc-800"
             />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Отмена</Button>
            <Button type="submit" disabled={loading} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {loading ? '...' : 'Подтвердить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
