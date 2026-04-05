'use client'

import { useCallback, useEffect, useMemo, useState, FormEvent } from 'react'
import { buildStyledSheet, createWorkbook, downloadWorkbook } from '@/lib/excel/styled-export'
import { AdminPageHeader, AdminTableViewport, adminTableStickyTheadClass } from '@/components/admin/admin-page-header'
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
import { STAFF_ROLE_MATRIX, SUPER_ADMIN_MATRIX_ENTRY } from '@/lib/core/access'
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
  KeyRound,
  Mail,
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
  phone?: string | null
  email?: string | null
}

type StaffAccountState = 'no_email' | 'no_account' | 'invited' | 'active'

type StaffAccountInfo = {
  staffId: string
  email: string | null
  phone: string | null
  full_name: string | null
  accountState: StaffAccountState
  hasAccount: boolean
  emailConfirmedAt: string | null
  lastSignInAt: string | null
  userId: string | null
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

type AddStaffDialogProps = {
  isOpen: boolean
  onClose: () => void
  onSuccess: (newStaff: Staff) => void
}

type AddPaymentDialogProps = {
  isOpen: boolean
  onClose: () => void
  staff: Staff
  paidSoFar: number
  dateDefault: string
  onSuccess: (newPayment: StaffPayment) => void
}

type PageNotice = {
  tone: 'success' | 'error'
  text: string
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

const ACCOUNT_STATE_LABEL: Record<StaffAccountState, { label: string; className: string }> = {
  no_email: {
    label: 'Нет email',
    className: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
  },
  no_account: {
    label: 'Нет аккаунта',
    className: 'text-sky-300 bg-sky-500/10 border-sky-500/20',
  },
  invited: {
    label: 'Приглашён',
    className: 'text-violet-300 bg-violet-500/10 border-violet-500/20',
  },
  active: {
    label: 'Активен',
    className: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
  },
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
    <>
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center animate-pulse">
            <Users2 className="w-8 h-8 text-white" />
          </div>
          <p className="text-gray-400">Загрузка сотрудников...</p>
        </div>
    </>
  )
}

export default function StaffPageSmart() {
  const today = new Date()
  const initialYM = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

  // Data State
  const [staff, setStaff] = useState<Staff[]>([])

  // UI State
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [monthYM, setMonthYM] = useState(initialYM)
  const [isAddStaffOpen, setIsAddStaffOpen] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [accountActionBusyKey, setAccountActionBusyKey] = useState<string | null>(null)
  const [accountInfoByStaffId, setAccountInfoByStaffId] = useState<Record<string, StaffAccountInfo>>({})
  const [pageNotice, setPageNotice] = useState<PageNotice | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'salary'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // --- Derived Data ---
  const { monthFrom, monthTo } = useMemo(() => {
    const { start, end } = getMonthDates(monthYM)
    return { monthFrom: start, monthTo: end }
  }, [monthYM])

  // Statistics
  const stats = useMemo(() => {
    let totalBudget = 0
    let totalStaff = 0

    staff.filter(s => s.is_active || showInactive).forEach(s => {
      if (s.is_active) totalBudget += s.monthly_salary || 0
      totalStaff++
    })

    return {
      totalBudget,
      totalStaff,
      activeStaff: staff.filter(s => s.is_active).length,
      inactiveStaff: staff.filter(s => !s.is_active).length,
      avgSalary: totalBudget / (staff.filter(s => s.is_active).length || 1),
    }
  }, [staff, showInactive])

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
      }

      if (typeof aVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal
    })

    // Active first
    filtered.sort((a, b) => Number(b.is_active) - Number(a.is_active))

    return filtered
  }, [staff, showInactive, searchTerm, sortBy, sortDir])

  // --- Fetching ---
  const loadData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    else setLoading(true)

    const response = await fetch(`/api/admin/staff?from=${monthFrom}&to=${monthTo}`, { cache: 'no-store' })
    const body = await response.json().catch(() => null)

    if (!response.ok) {
      setPageNotice({ tone: 'error', text: `Ошибка загрузки сотрудников: ${body?.error || 'неизвестная ошибка'}` })
      setLoading(false)
      setRefreshing(false)
      return
    }

    {
      const staffRows = (body?.staff as Staff[]) || []
      setStaff(staffRows)

      if (staffRows.length > 0) {
        const response = await fetch(`/api/admin/staff-accounts?staffIds=${encodeURIComponent(staffRows.map((item) => item.id).join(','))}`).catch(() => null)
        const json = await response?.json().catch(() => null)

        if (response?.ok && Array.isArray(json?.items)) {
          const nextAccountInfoByStaffId = Object.fromEntries(
            (json.items as StaffAccountInfo[]).map((item) => [item.staffId, item]),
          )
          setAccountInfoByStaffId(nextAccountInfoByStaffId)
          setStaff((prev) =>
            prev.map((item) => {
              const accountInfo = nextAccountInfoByStaffId[item.id]
              if (!accountInfo) return item
              return {
                ...item,
                full_name: accountInfo.full_name || item.full_name,
                phone: accountInfo.phone || item.phone,
                email: accountInfo.email || item.email,
              }
            }),
          )
        } else if (staffRows.length > 0) {
          setAccountInfoByStaffId({})
        }
      } else {
        setAccountInfoByStaffId({})
      }
    }
    
    setLoading(false)
    setRefreshing(false)
  }, [monthFrom, monthTo])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    let ignore = false

    const loadAccess = async () => {
      const response = await fetch('/api/auth/session-role').catch(() => null)
      const json = await response?.json().catch(() => null)

      if (!ignore && response?.ok) {
        setIsSuperAdmin(!!json?.isSuperAdmin)
      }
    }

    loadAccess()
    return () => {
      ignore = true
    }
  }, [])

  // --- Actions ---
  const toggleStaffStatus = async (s: Staff) => {
    const response = await fetch('/api/admin/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'toggleStaffStatus',
        staffId: s.id,
        is_active: !s.is_active,
      }),
    })
    const json = await response.json().catch(() => null)

    if (!response.ok) {
      showPageNotice({
        tone: 'error',
        text: json?.error || 'Не удалось изменить статус сотрудника',
      })
      return
    }

    setStaff(prev => prev.map(item => item.id === s.id ? { ...item, is_active: !item.is_active } : item))
    showPageNotice({
      tone: 'success',
      text: !s.is_active ? 'Сотрудник активирован.' : 'Сотрудник отправлен в архив.',
    })
  }

  const resetFilters = () => {
    setSearchTerm('')
    setShowInactive(false)
    setSortBy('name')
    setSortDir('asc')
  }

  const showPageNotice = (notice: PageNotice) => {
    setPageNotice(notice)

    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' })
      })
    }
  }

  const runStaffAccountAction = async (
    action: 'inviteStaffAccount' | 'sendPasswordReset',
    staffMember: Staff,
  ) => {
    if (!staffMember.email?.trim()) {
      showPageNotice({
        tone: 'error',
        text: `У сотрудника ${staffMember.full_name || staffMember.short_name || ''} не заполнен email.`,
      })
      return
    }

    if (!staffMember.is_active) {
      showPageNotice({
        tone: 'error',
        text: `Сотрудник ${staffMember.full_name || staffMember.short_name || ''} находится в архиве. Сначала активируй его.`,
      })
      return
    }

    setAccountActionBusyKey(`${action}:${staffMember.id}`)
    setPageNotice(null)

    try {
      const response = await fetch('/api/admin/staff-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          staffId: staffMember.id,
        }),
      })
      const json = await response.json().catch(() => null)

      if (!response.ok) {
        if (json?.code === 'missing_service_role') {
          throw new Error('Не настроен SUPABASE_SERVICE_ROLE_KEY. Добавь service_role ключ в .env и перезапусти dev сервер.')
        }
        if (json?.code === 'email_rate_limit') {
          throw new Error(
            'Supabase временно ограничил отправку писем. Подожди немного и попробуй снова. Для частых писем лучше подключить свой SMTP.',
          )
        }
        if (json?.code === 'user_not_found' && action === 'sendPasswordReset') {
          throw new Error('Аккаунт для этого email ещё не создан. Сначала отправь приглашение.')
        }
        throw new Error(json?.error || `Ошибка запроса (${response.status})`)
      }

      showPageNotice({
        tone: 'success',
        text:
          json?.message ||
          (action === 'sendPasswordReset'
            ? `Письмо для смены пароля отправлено на ${staffMember.email}.`
            : `Письмо-приглашение отправлено на ${staffMember.email}. Сотрудник сам задаст пароль по ссылке.`),
      })

      await loadData(true)
    } catch (error: any) {
      showPageNotice({
        tone: 'error',
        text: error?.message || 'Не удалось отправить приглашение',
      })
    } finally {
      setAccountActionBusyKey(null)
    }
  }

  const handleInviteStaffAccount = async (staffMember: Staff) => {
    await runStaffAccountAction('inviteStaffAccount', staffMember)
  }

  const handleResetStaffPassword = async (staffMember: Staff) => {
    await runStaffAccountAction('sendPasswordReset', staffMember)
  }

  const handleExport = async () => {
    const wb = createWorkbook()
    const staffRows = filteredStaff.map(s => ({
      name: s.full_name,
      role: ROLE_LABEL[s.role as StaffRole]?.label || '',
      salary: s.monthly_salary || 0,
      status: s.is_active ? 'Активен' : 'Архив',
    }))
    const total = staffRows.reduce((acc, r) => acc + r.salary, 0)
    staffRows.push({ _isTotals: true, name: 'ИТОГО', role: '', salary: total, status: '' } as any)
    buildStyledSheet(wb, 'Сотрудники', 'Административные сотрудники', `Всего: ${filteredStaff.length}`, [
      { header: 'Сотрудник', key: 'name', width: 28, type: 'text' },
      { header: 'Роль', key: 'role', width: 18, type: 'text' },
      { header: 'Оклад', key: 'salary', width: 16, type: 'money' },
      { header: 'Статус', key: 'status', width: 12, type: 'text' },
    ], staffRows)
    await downloadWorkbook(wb, `staff_${monthYM}.xlsx`)
  }

  return (
    <>
        <div className="mx-auto max-w-[1400px] space-y-4 px-4 pb-6 pt-4 md:px-6 md:py-6">

          <AdminPageHeader
            title="Команда"
            description="Управление сотрудниками и правами доступа"
            accent="emerald"
            icon={<Users2 className="h-5 w-5" aria-hidden />}
            actions={
              <>
                <Button
                  variant="outline"
                  size="icon"
                  className={`h-9 w-9 rounded-xl border-white/10 bg-white/5 hover:bg-white/10 ${refreshing ? '[&_svg]:animate-spin' : ''}`}
                  onClick={() => void loadData(true)}
                  aria-label="Обновить"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-9 w-9 rounded-xl border-white/10 bg-white/5 hover:bg-white/10" onClick={() => void handleExport()} aria-label="Экспорт Excel">
                  <Download className="h-4 w-4" />
                </Button>
                <Button onClick={() => setIsAddStaffOpen(true)} className="h-9 gap-1.5 rounded-xl bg-emerald-600 text-sm text-white hover:bg-emerald-500">
                  <Plus className="h-4 w-4" />
                  Добавить
                </Button>
              </>
            }
            toolbar={
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                  ФОТ: <span className="font-semibold text-white">{money(stats.totalBudget)}</span>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                  Сотрудников: <span className="font-semibold text-white">{stats.activeStaff}</span>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                  Средний оклад: <span className="font-semibold text-white">{moneyCompact(stats.avgSalary)}</span>
                </div>
              </div>
            }
          />

          {pageNotice && (
            <Card className={cn('p-3 border text-sm', pageNotice.tone === 'success' ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-red-500/30 bg-red-500/10')}>
              <div className={cn('flex items-center gap-2', pageNotice.tone === 'success' ? 'text-emerald-300' : 'text-red-300')}>
                {pageNotice.tone === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                <span>{pageNotice.text}</span>
              </div>
            </Card>
          )}

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input type="text" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} placeholder="Поиск..." className="w-full pl-9 pr-8 h-9 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500/50" />
              {searchTerm && <button onClick={() => setSearchTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>}
            </div>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="h-9 px-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500/50 [color-scheme:dark]">
              <option value="name">По имени</option>
              <option value="salary">По окладу</option>
            </select>
            <button onClick={() => setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')} className="h-9 px-3 bg-white/5 border border-white/10 rounded-xl text-white hover:bg-white/10 transition-colors flex items-center">{sortDir === 'asc' ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-400 ml-1">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="rounded border-white/10 text-emerald-500" />
              Архивные
            </label>
            {(searchTerm || showInactive || sortBy !== 'name' || sortDir !== 'asc') && <button onClick={resetFilters} className="text-sm text-gray-500 hover:text-white transition-colors">Сбросить</button>}
          </div>

          {/* Main Table */}
          <Card className="overflow-hidden border-white/10 bg-white/[0.04] p-0">
            <AdminTableViewport maxHeight="min(70vh, 40rem)" className="rounded-none border-0 bg-transparent">
              <table className="w-full text-sm">
                <thead className={adminTableStickyTheadClass}>
                  <tr className="border-b border-white/5">
                    <th className="py-4 px-4 text-left text-xs font-medium text-gray-400">Сотрудник</th>
                    <th className="py-4 px-4 text-right text-xs font-medium text-gray-400">Оклад</th>
                    <th className="py-4 px-4 text-center text-xs font-medium text-gray-400">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {loading && !refreshing && (
                    <tr>
                      <td colSpan={3} className="py-12 text-center text-gray-500">
                        Загрузка данных...
                      </td>
                    </tr>
                  )}

                  {!loading && filteredStaff.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-12 text-center text-gray-500">
                        {staff.length === 0 
                          ? 'Список сотрудников пуст. Добавьте первого сотрудника.'
                          : 'Нет сотрудников, соответствующих фильтрам'}
                      </td>
                    </tr>
                  )}

                  {filteredStaff.map((s) => {
                    const roleStyle = ROLE_LABEL[s.role as StaffRole] || ROLE_LABEL.other
                    const RoleIcon = roleStyle.icon
                    return (
                      <StaffRow
                        key={s.id}
                        staff={s}
                        roleStyle={roleStyle}
                        RoleIcon={RoleIcon}
                        onToggleStatus={() => toggleStaffStatus(s)}
                        onInviteAccount={() => handleInviteStaffAccount(s)}
                        onResetPassword={() => handleResetStaffPassword(s)}
                        canInviteAccount={isSuperAdmin}
                        accountInfo={accountInfoByStaffId[s.id] || null}
                        inviteBusy={accountActionBusyKey === `inviteStaffAccount:${s.id}`}
                        resetBusy={accountActionBusyKey === `sendPasswordReset:${s.id}`}
                      />
                    )
                  })}
                </tbody>
              </table>
            </AdminTableViewport>
          </Card>

          <div className="text-xs text-slate-500">Показано {filteredStaff.length} из {staff.length} сотрудников</div>
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

    </>
  )
}

// --- Staff Row Component ---
function StaffRow({
  staff,
  roleStyle,
  RoleIcon,
  onToggleStatus,
  onInviteAccount,
  onResetPassword,
  canInviteAccount,
  accountInfo,
  inviteBusy,
  resetBusy,
}: any) {
  const effectiveEmail = accountInfo?.email || staff.email || null
  const accountState = (accountInfo?.accountState || (!effectiveEmail ? 'no_email' : 'no_account')) as StaffAccountState
  const accountStateLabel = ACCOUNT_STATE_LABEL[accountState]
  const inviteBlockedReason = !effectiveEmail?.trim()
    ? 'У сотрудника не заполнен email'
    : !staff.is_active
      ? 'Нельзя отправить приглашение архивному сотруднику'
      : null
  const canResetPassword = accountState === 'invited' || accountState === 'active'

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
              <span className={cn(
                "mt-1 text-[11px]",
                effectiveEmail?.trim() ? "text-gray-500" : "text-amber-300"
              )}>
                {effectiveEmail?.trim() || 'Email не заполнен'}
              </span>
              <div className="mt-1 flex items-center gap-2">
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded border", accountStateLabel.className)}>
                  {accountStateLabel.label}
                </span>
                {accountInfo?.lastSignInAt && (
                  <span className="text-[10px] text-gray-500">
                    Вход: {new Date(accountInfo.lastSignInAt).toLocaleDateString('ru-RU')}
                  </span>
                )}
              </div>
            </div>
          </div>
        </td>
        
        <td className="py-4 px-4 text-right font-medium text-white">
          {money(staff.monthly_salary || 0)}
        </td>

        <td className="py-4 px-4">
          <div className="flex items-center justify-center gap-2">
            {canInviteAccount && (
              <Button
                size="sm"
                variant="outline"
                className={cn(
                  "h-8 px-3 text-xs gap-1.5 border-white/10 bg-white/[0.03]",
                  !effectiveEmail?.trim() && "border-amber-500/30 text-amber-300 hover:bg-amber-500/10",
                  !staff.is_active && "border-gray-700 text-gray-500"
                )}
                onClick={onInviteAccount}
                disabled={inviteBusy}
                  title={
                    inviteBlockedReason ||
                    (accountState === 'no_account'
                      ? `Создать аккаунт и отправить приглашение на ${effectiveEmail}`
                      : `Отправить письмо для повторной установки пароля на ${effectiveEmail}`)
                  }
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  {inviteBusy ? 'Отправка...' : inviteBlockedReason ? 'Проверить' : accountState === 'no_account' ? 'Пригласить' : 'Переотправить'}
                </Button>
              )}

            {canInviteAccount && canResetPassword && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-3 text-xs gap-1.5 border-white/10 bg-white/[0.03]"
                onClick={onResetPassword}
                disabled={resetBusy || !staff.is_active}
                title={!staff.is_active ? 'Нельзя отправить письмо архивному сотруднику' : `Отправить письмо для смены пароля на ${effectiveEmail}`}
              >
                <Mail className="w-3.5 h-3.5" />
                {resetBusy ? 'Отправка...' : 'Сменить пароль'}
              </Button>
            )}
            
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

    </>
  )
}

// --- Add Staff Dialog ---
function AddStaffDialog({ isOpen, onClose, onSuccess }: AddStaffDialogProps) {
  const [form, setForm] = useState({ 
    full_name: '', 
    short_name: '',
    role: 'manager' as StaffRole, 
    monthly_salary: '',
    phone: '',
    email: '',
  })
  const [loading, setLoading] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setSubmitError(null)

    const response = await fetch('/api/admin/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'createStaff',
        payload: {
          ...form,
          monthly_salary: Number(form.monthly_salary),
        },
      }),
    })
    const json = await response.json().catch(() => null)

    setLoading(false)
    if (response.ok) {
      onSuccess(json.data as Staff)
      setForm({ 
        full_name: '', 
        short_name: '',
        role: 'manager', 
        monthly_salary: '',
        phone: '',
        email: '',
          })
      onClose()
      return
    }

    setSubmitError(json?.error || 'Не удалось создать сотрудника')
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
          {submitError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {submitError}
            </div>
          )}

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
function AddPaymentDialog({ isOpen, onClose, staff, paidSoFar, dateDefault, onSuccess }: AddPaymentDialogProps) {
  const salary = staff.monthly_salary || 0
  const remainder = Math.max(0, salary - paidSoFar)
  
  const [amount, setAmount] = useState(String(remainder))
  const [date, setDate] = useState(dateDefault)
  const [slot, setSlot] = useState<PaySlot>('other')
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

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
    setSubmitError(null)

    const response = await fetch('/api/admin/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'createPayment',
        payload: {
          staff_id: staff.id,
          pay_date: date,
          slot,
          amount: Number(amount),
          comment: comment || null,
        },
      }),
    })
    const json = await response.json().catch(() => null)

    setLoading(false)
    if (response.ok) {
      onSuccess(json.data as StaffPayment)
      onClose()
      return
    }

    setSubmitError(json?.error || 'Не удалось сохранить выплату')
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
          {submitError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {submitError}
            </div>
          )}

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
